// Comprobación de arranque: falla (código distinto de 0) si el entorno no puede ejecutar la app.
// Se ejecuta durante el build de Docker y desde scripts/smoke.sh. Un segfault de un módulo nativo
// mata el proceso sin mensaje (código 139): por eso se prueba antes de desplegar.
//
// Uso: node scripts/comprobar-arranque.js [--exigir-cli]
//   --exigir-cli  falla si no está el binario sqlite3 (necesario para las copias de seguridad).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const exigirCli = process.argv.includes('--exigir-cli');
const dir = mkdtempSync(path.join(tmpdir(), 'tiroriro-arranque-'));
let paso = 'inicio';

async function comprobar(nombre, fn) {
  paso = nombre;
  const detalle = await fn();
  console.log(`  ok  ${nombre}${detalle ? ` — ${detalle}` : ''}`);
}

try {
  await comprobar('versión de Node >= 22', () => {
    const mayor = Number(process.versions.node.split('.')[0]);
    if (mayor < 22) throw new Error(`Node ${process.versions.node}: se requiere Node 22 o superior`);
    return `Node ${process.versions.node}`;
  });

  await comprobar('better-sqlite3: base en memoria y base en disco con WAL', async () => {
    const { default: Database } = await import('better-sqlite3');
    const memoria = new Database(':memory:');
    const sqlite = memoria.prepare('SELECT sqlite_version() AS v').get().v;
    memoria.close();

    const disco = new Database(path.join(dir, 'prueba.db'));
    const modo = disco.pragma('journal_mode = WAL', { simple: true });
    if (modo !== 'wal') throw new Error(`journal_mode devolvió "${modo}" en lugar de "wal"`);
    disco.exec('CREATE TABLE t (n INTEGER); INSERT INTO t VALUES (42)');
    if (disco.prepare('SELECT n FROM t').get().n !== 42) throw new Error('lectura/escritura incorrecta');
    disco.close();
    return `SQLite ${sqlite}`;
  });

  await comprobar('argon2: hash y verificación', async () => {
    const { default: argon2 } = await import('argon2');
    const hash = await argon2.hash('comprobacion-de-arranque');
    if (!(await argon2.verify(hash, 'comprobacion-de-arranque'))) throw new Error('la verificación falló');
    if (await argon2.verify(hash, 'otra-cosa')) throw new Error('verificó una contraseña incorrecta');
  });

  await comprobar('aplicación: migraciones, seed y /healthz', async () => {
    const { abrirDb, migrar } = await import('../src/db.js');
    const { sembrar } = await import('../src/seed.js');
    const { crearApp } = await import('../src/app.js');
    const db = abrirDb(path.join(dir, 'app.db'));
    migrar(db);
    const config = {
      puerto: 0, dataDir: dir, sessionSecret: 's'.repeat(32), pinHmacSecret: 'p'.repeat(32),
      adminUser: 'admin', adminPasswordInitial: 'contraseña-de-prueba', cookieSegura: true, trustProxy: 0,
    };
    await sembrar(db, config);
    const mesas = db.prepare('SELECT COUNT(*) AS n FROM mesa').get().n;
    if (mesas !== 6) throw new Error(`el seed creó ${mesas} mesas en lugar de 6`);
    const app = crearApp({ db, config });
    const salud = await app.inject('/healthz');
    if (salud.statusCode !== 200) throw new Error(`/healthz respondió ${salud.statusCode}`);
    await app.close();
    db.close();
    return '6 mesas sembradas';
  });

  await comprobar('cliente sqlite3 (copias de seguridad)', () => {
    try {
      return execFileSync('sqlite3', ['--version'], { encoding: 'utf8' }).split(' ')[0];
    } catch {
      if (exigirCli) throw new Error('no se encuentra el binario sqlite3');
      return 'no instalado (omitido)';
    }
  });

  console.log('OK: el entorno puede arrancar la aplicación');
} catch (err) {
  console.error(`ERROR en «${paso}»: ${err.message}`);
  process.exitCode = 1;
} finally {
  rmSync(dir, { recursive: true, force: true });
}
