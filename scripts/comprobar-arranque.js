// Comprobación de arranque: falla (código distinto de 0) si el entorno no puede ejecutar la app.
// Se ejecuta durante el build de Docker y desde scripts/smoke.sh. Un segfault de un módulo nativo
// mata el proceso sin mensaje (código 139): por eso se prueba antes de desplegar.
//
// Uso: node scripts/comprobar-arranque.js [--exigir-cli]
//   --exigir-cli  falla si no está el binario sqlite3 (necesario para las copias de seguridad).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
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

  await comprobar('zona horaria Europe/Madrid (ICU)', async () => {
    const { fechaMadrid } = await import('../src/tiempo.js');
    // 23:00Z del 28-nov es ya el 29-nov en Madrid (CET). Si ICU no tuviera zonas, fallaría.
    if (fechaMadrid(Date.UTC(2026, 10, 28, 23, 0, 0)) !== '2026-11-29') throw new Error('la zona Europe/Madrid no funciona');
    if (fechaMadrid(Date.UTC(2026, 10, 28, 22, 59, 59)) !== '2026-11-28') throw new Error('la zona Europe/Madrid no funciona');
  });

  await comprobar('aplicación: migraciones, seed, modo DEMO/REAL y /healthz', async () => {
    const { abrirDb, migrarApp } = await import('../src/db.js');
    const { sembrar } = await import('../src/seed.js');
    const { crearApp } = await import('../src/app.js');
    const db = abrirDb(path.join(dir, 'app.db'));
    migrarApp(db);
    const config = {
      puerto: 0, dataDir: dir, sessionSecret: 's'.repeat(32), pinHmacSecret: 'p'.repeat(32),
      adminUser: 'admin', adminPasswordInitial: 'contraseña-de-prueba', cookieSegura: true, trustProxy: 0,
      fechaElecciones: '2999-01-01', // futura: el modo automático es DEMO
    };
    await sembrar(db, config);
    const mesas = db.prepare('SELECT COUNT(*) AS n FROM mesa').get().n;
    if (mesas !== 6) throw new Error(`el seed creó ${mesas} mesas en lugar de 6`);
    const app = crearApp({ db, config });
    const salud = await app.inject('/healthz');
    if (salud.statusCode !== 200) throw new Error(`/healthz respondió ${salud.statusCode}`);
    if (salud.json().modo !== 'DEMO') throw new Error(`modo inesperado: ${salud.json().modo}`);
    const entrada = await app.inject('/');
    if (entrada.statusCode !== 200 || !entrada.body.includes('name="pin"')) throw new Error('la pantalla de PIN no se sirve');
    for (const recurso of ['/agente.js', '/resumen.js', '/estilos.css']) {
      if ((await app.inject(recurso)).statusCode !== 200) throw new Error(`falta public${recurso} en la imagen`);
    }
    for (const protegida of ['/admin/resumen', '/pantallazo', '/admin/historico', '/admin/cortes']) {
      const r = await app.inject(protegida);
      if (r.statusCode !== 302 || r.headers.location !== '/admin/login') throw new Error(`${protegida} debe exigir sesión de administrador`);
    }
    if (!existsSync(path.join(dir, 'demo.db'))) throw new Error('no se creó demo.db en modo DEMO');
    // Captura de prueba: debe ir a demo.db y no tocar app.db
    const captura = app.datos.captura();
    captura.guardarParticipacion({ mesaId: 1, corteId: 1, votantes: 1, actor: { tipo: 'admin', id: 1 } });
    if (db.prepare('SELECT COUNT(*) AS n FROM participacion').get().n !== 0) throw new Error('la captura demo llegó a app.db');
    // Al pasar a REAL la demo se descarta
    app.datos.cambiarModo('REAL', { tipo: 'sistema', id: null });
    if (existsSync(path.join(dir, 'demo.db'))) throw new Error('demo.db no se eliminó al pasar a REAL');
    await app.close();
    db.close();
    return '6 mesas sembradas; DEMO -> REAL correcto';
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
