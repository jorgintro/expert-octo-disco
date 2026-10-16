import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { Captura, ModoCambiadoError } from '../src/captura.js';
import { GestorDatos, asegurarQueEsDemo, borrarArchivosDemo } from '../src/datos.js';
import { abrirDb, migrarApp } from '../src/db.js';
import { sembrar } from '../src/seed.js';
import { raiz } from '../src/version.js';
import { CONFIG, crearDirectorioTemporal, crearEntorno, crearReloj, get } from './ayuda.js';

const DIA = '2026-11-29T10:00:00Z';
const ADMIN = { tipo: 'admin', id: 1 };
const AGENTE = { tipo: 'agente', id: 7 };

async function crearGestor(iso) {
  const dataDir = crearDirectorioTemporal();
  const db = abrirDb(path.join(dataDir, 'app.db'));
  migrarApp(db);
  await sembrar(db, { ...CONFIG, dataDir });
  const reloj = crearReloj(iso);
  const gestor = new GestorDatos({ db, dataDir, fechaElecciones: CONFIG.fechaElecciones, reloj: reloj.ahora });
  const mesaId = db.prepare('SELECT id FROM mesa ORDER BY id LIMIT 1').get().id;
  const corteId = db.prepare('SELECT id FROM corte ORDER BY orden LIMIT 1').get().id;
  return { gestor, db, dataDir, reloj, mesaId, corteId, rutaDemo: gestor.rutaDemo };
}

const abrirSoloLectura = (ruta) => new Database(ruta, { readonly: true });
const contar = (db, tabla) => db.prepare(`SELECT COUNT(*) n FROM ${tabla}`).get().n;
const escribir = (g, votantes = 10, mesaId = g.mesaId, corteId = g.corteId, actor = AGENTE) => {
  g.gestor.sincronizar();
  return g.gestor.captura().guardarParticipacion({ mesaId, corteId, votantes, actor });
};

test('antes de las elecciones arranca en DEMO con una demo.db que solo tiene tablas de captura', async () => {
  const g = await crearGestor('2026-10-20T10:00:00Z');
  const estado = g.gestor.sincronizar();
  assert.deepEqual([estado.modo, estado.origen], ['DEMO', 'automatico']);
  assert.ok(existsSync(g.rutaDemo));
  const demo = abrirSoloLectura(g.rutaDemo);
  const tablas = demo.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((t) => t.name);
  assert.ok(tablas.includes('participacion') && tablas.includes('auditoria'));
  for (const config of ['mesa', 'corte', 'agente', 'admin', 'colegio', 'ajuste', 'sesion']) {
    assert.ok(!tablas.includes(config), `demo.db no debe contener ${config}`);
  }
  demo.close();
  g.gestor.cerrar();
});

test('en DEMO la captura va a demo.db y no cambia NINGUNA fila de captura real', async () => {
  const g = await crearGestor('2026-10-20T10:00:00Z');
  g.gestor.sincronizar();
  const fotoReal = () => JSON.stringify({
    participacion: g.db.prepare('SELECT * FROM participacion').all(),
    auditoria: g.db.prepare('SELECT * FROM auditoria ORDER BY id').all(),
  });
  const antes = fotoReal();

  const cortes = g.db.prepare('SELECT id FROM corte ORDER BY orden').all();
  cortes.slice(0, 3).forEach((c, i) => escribir(g, 10 * (i + 1), g.mesaId, c.id));
  escribir(g, 15, g.mesaId, cortes[0].id, ADMIN); // corrección posterior (update)

  assert.equal(fotoReal(), antes, 'app.db (participación y auditoría) no debe cambiar');
  const demo = abrirSoloLectura(g.rutaDemo);
  assert.equal(contar(demo, 'participacion'), 3);
  assert.equal(contar(demo, 'auditoria'), 4);
  assert.equal(demo.prepare('SELECT introducido_por_tipo t FROM participacion WHERE corte_id = ?').get(cortes[0].id).t, 'admin');
  demo.close();
  assert.equal(g.gestor.contarRegistrosDemo(), 3);
  g.gestor.cerrar();
});

test('en REAL la captura va a app.db, con su auditoría, y no existe demo.db', async () => {
  const g = await crearGestor(DIA);
  const estado = g.gestor.sincronizar();
  assert.deepEqual([estado.modo, estado.origen], ['REAL', 'automatico']);
  assert.ok(!existsSync(g.rutaDemo));
  const r = escribir(g, 42);
  assert.equal(r.anterior, null);
  assert.equal(contar(g.db, 'participacion'), 1);
  const fila = g.db.prepare("SELECT * FROM auditoria WHERE entidad = 'participacion'").get();
  assert.equal(fila.accion, 'crear');
  assert.equal(JSON.parse(fila.valor_nuevo).votantes_acumulados, 42);
  assert.equal(escribir(g, 50).anterior, 42);
  assert.ok(!existsSync(g.rutaDemo));
  g.gestor.cerrar();
});

test('salir de DEMO a REAL elimina demo.db y volver a DEMO parte de una demo vacía', async () => {
  const g = await crearGestor('2026-10-20T10:00:00Z');
  escribir(g, 11);
  assert.equal(g.gestor.contarRegistrosDemo(), 1);

  g.gestor.cambiarModo('REAL', ADMIN);
  const sobrantes = readdirSync(g.dataDir).filter((f) => f.startsWith('demo.db'));
  assert.deepEqual(sobrantes, [], 'no debe quedar demo.db ni sus -wal/-shm');
  assert.equal(g.gestor.contarRegistrosDemo(), 0);

  escribir(g, 99); // dato real
  g.gestor.cambiarModo('DEMO', ADMIN);
  assert.ok(existsSync(g.rutaDemo));
  assert.equal(g.gestor.contarRegistrosDemo(), 0, 'nada de lo hecho en la demo anterior sobrevive');
  assert.equal(g.gestor.captura().listarParticipacion().length, 0);
  assert.equal(g.db.prepare('SELECT votantes_acumulados v FROM participacion').get().v, 99, 'lo real se conserva');
  g.gestor.cerrar();
});

test('Reiniciar demo borra solo demo.db y no toca app.db', async () => {
  const g = await crearGestor(DIA);
  escribir(g, 77); // real
  g.gestor.cambiarModo('DEMO', ADMIN, { enJornadaConfirmada: true });
  escribir(g, 5);
  escribir(g, 6, g.mesaId, g.db.prepare('SELECT id FROM corte ORDER BY orden LIMIT 1 OFFSET 1').get().id);
  const realAntes = JSON.stringify(g.db.prepare('SELECT * FROM participacion').all());

  g.gestor.reiniciarDemo(ADMIN);
  assert.equal(g.gestor.contarRegistrosDemo(), 0);
  assert.ok(existsSync(g.rutaDemo));
  assert.ok(existsSync(path.join(g.dataDir, 'app.db')), 'app.db sigue existiendo');
  assert.equal(JSON.stringify(g.db.prepare('SELECT * FROM participacion').all()), realAntes);
  const reinicio = g.db.prepare("SELECT * FROM auditoria WHERE accion = 'reiniciar_demo'").get();
  assert.equal(JSON.parse(reinicio.valor_anterior).registros, 2);

  g.gestor.cambiarModo('REAL', ADMIN);
  assert.throws(() => g.gestor.reiniciarDemo(ADMIN), /modo DEMO/);
  g.gestor.cerrar();
});

test('la puerta de borrado solo admite demo.db y nunca la base principal', async () => {
  const g = await crearGestor('2026-10-20T10:00:00Z');
  const app = path.join(g.dataDir, 'app.db');
  assert.throws(() => asegurarQueEsDemo(app, app), /solo se puede borrar demo\.db/);
  assert.throws(() => asegurarQueEsDemo(path.join(g.dataDir, 'otra.db'), app), /solo se puede borrar/);
  assert.throws(() => asegurarQueEsDemo(path.join(g.dataDir, 'demo.db', '..', 'app.db'), app), /solo se puede borrar/);
  assert.throws(() => asegurarQueEsDemo('/tmp/demo.db.bak', app), /solo se puede borrar/);
  // Aunque un fichero se llame demo.db, si fuera la base principal se rechaza
  const trampa = path.join(g.dataDir, 'demo.db');
  assert.throws(() => asegurarQueEsDemo(trampa, trampa), /base principal/);
  assert.throws(() => borrarArchivosDemo(app, app));
  assert.ok(existsSync(app), 'app.db intacta');
  assert.equal(asegurarQueEsDemo(trampa, app), trampa);
  // La ruta del gestor es la constante <dataDir>/demo.db
  assert.equal(g.rutaDemo, path.join(g.dataDir, 'demo.db'));
  g.gestor.cerrar();
});

test('Captura comprueba que la conexión es la del destino', async () => {
  const g = await crearGestor('2026-10-20T10:00:00Z');
  g.gestor.sincronizar();
  assert.throws(() => new Captura(g.gestor, 'demo', g.db, 0), /solo puede abrir demo\.db/);
  const demo = abrirDb(g.rutaDemo);
  assert.throws(() => new Captura(g.gestor, 'real', demo, 0), /no puede usar demo\.db/);
  assert.throws(() => new Captura(g.gestor, 'otro', demo, 0), /desconocido/);
  demo.close();
  g.gestor.cerrar();
});

test('al llegar el día se anula el override manual, se pasa a REAL y se descarta la demo (una sola vez)', async () => {
  const g = await crearGestor('2026-10-20T10:00:00Z');
  g.gestor.cambiarModo('REAL', ADMIN);
  g.gestor.cambiarModo('DEMO', ADMIN); // override DEMO fijado antes del día
  escribir(g, 12);
  assert.equal(g.gestor.sincronizar().origen, 'manual');

  g.reloj.fijar('2026-11-28T22:59:59Z');
  assert.equal(g.gestor.sincronizar().modo, 'DEMO', 'un segundo antes sigue en DEMO');

  g.reloj.fijar('2026-11-28T23:00:00Z');
  const estado = g.gestor.sincronizar();
  assert.deepEqual([estado.modo, estado.origen], ['REAL', 'automatico']);
  assert.ok(!existsSync(g.rutaDemo), 'la demo se descarta');
  assert.equal(g.db.prepare("SELECT COUNT(*) n FROM ajuste WHERE clave = 'modo_manual'").get().n, 0);
  const registro = (accion) => g.db.prepare('SELECT * FROM auditoria WHERE accion = ?').all(accion);
  const haciaReal = () => registro('cambio_modo').filter((f) => JSON.parse(f.valor_nuevo).modo === 'REAL');
  assert.equal(registro('anular_override_modo').length, 1);
  assert.equal(haciaReal().length, 1);
  assert.equal(JSON.parse(haciaReal()[0].valor_nuevo).origen, 'automatico');

  // Idempotente: repetir la evaluación no repite efectos ni auditoría
  g.gestor.sincronizar();
  g.gestor.sincronizar();
  assert.equal(registro('anular_override_modo').length, 1);
  assert.equal(haciaReal().length, 1);
  g.gestor.cerrar();
});

test('pasar a DEMO desde el día de las elecciones exige confirmación reforzada y el override se respeta', async () => {
  const g = await crearGestor(DIA);
  assert.throws(() => g.gestor.cambiarModo('DEMO', ADMIN), /confirmación reforzada/);
  assert.equal(g.gestor.sincronizar().modo, 'REAL');
  g.gestor.cambiarModo('DEMO', ADMIN, { enJornadaConfirmada: true });
  assert.deepEqual([g.gestor.estado.modo, g.gestor.estado.origen], ['DEMO', 'manual']);
  const fila = g.db.prepare("SELECT * FROM auditoria WHERE accion = 'cambiar_modo'").get();
  assert.equal(JSON.parse(fila.valor_nuevo).en_jornada, true);

  g.reloj.fijar('2026-11-30T10:00:00Z'); // el override fijado en jornada sigue vigente
  assert.deepEqual([g.gestor.sincronizar().modo, g.gestor.estado.origen], ['DEMO', 'manual']);
  g.gestor.cambiarModo('REAL', ADMIN); // volver a REAL no exige confirmación reforzada
  assert.equal(g.gestor.estado.modo, 'REAL');
  g.gestor.cerrar();
});

test('cambiarModo es idempotente: repetirlo no escribe ni audita de nuevo', async () => {
  const g = await crearGestor('2026-10-20T10:00:00Z');
  g.gestor.cambiarModo('REAL', ADMIN);
  g.gestor.cambiarModo('REAL', ADMIN);
  g.gestor.cambiarModo('REAL', ADMIN);
  assert.equal(g.db.prepare("SELECT COUNT(*) n FROM auditoria WHERE accion = 'cambiar_modo'").get().n, 1);
  g.gestor.cerrar();
});

test('recuperación: el estado converge aunque se haya caído a medias o alguien toque los ficheros', async () => {
  // REAL con una demo.db sobrante => se elimina
  const real = await crearGestor(DIA);
  real.gestor.sincronizar();
  const huerfana = abrirDb(real.rutaDemo);
  huerfana.close();
  assert.ok(existsSync(real.rutaDemo));
  real.gestor.sincronizar();
  assert.ok(!existsSync(real.rutaDemo));
  real.gestor.cerrar();

  // DEMO con el fichero borrado en caliente => se recrea vacía y la captura antigua queda invalidada
  const demo = await crearGestor('2026-10-20T10:00:00Z');
  escribir(demo, 3);
  const vieja = demo.gestor.captura();
  readdirSync(demo.dataDir).filter((f) => f.startsWith('demo.db')).forEach((f) => abrirDb(':memory:').close());
  for (const sufijo of ['', '-wal', '-shm']) {
    try { (await import('node:fs')).rmSync(demo.rutaDemo + sufijo, { force: true }); } catch { /* nada */ }
  }
  demo.gestor.sincronizar();
  assert.ok(existsSync(demo.rutaDemo));
  assert.equal(demo.gestor.contarRegistrosDemo(), 0);
  assert.throws(() => vieja.listarParticipacion(), ModoCambiadoError);
  demo.gestor.cerrar();
});

test('reiniciar el proceso en DEMO conserva la demo; la reconciliación al arrancar no la borra', async () => {
  const g = await crearGestor('2026-10-20T10:00:00Z');
  escribir(g, 8);
  g.gestor.cerrar();
  const otro = new GestorDatos({ db: g.db, dataDir: g.dataDir, fechaElecciones: CONFIG.fechaElecciones, reloj: g.reloj.ahora });
  assert.equal(otro.sincronizar().modo, 'DEMO');
  assert.equal(otro.contarRegistrosDemo(), 1);
  otro.cerrar();
});

test('una Captura obtenida en DEMO deja de valer si el modo cambia (nunca escribe en otro destino)', async () => {
  const g = await crearGestor('2026-10-20T10:00:00Z');
  g.gestor.sincronizar();
  const enDemo = g.gestor.captura();
  g.gestor.cambiarModo('REAL', ADMIN);
  assert.throws(
    () => enDemo.guardarParticipacion({ mesaId: g.mesaId, corteId: g.corteId, votantes: 1, actor: AGENTE }),
    ModoCambiadoError
  );
  assert.equal(contar(g.db, 'participacion'), 0, 'nada se coló en app.db');
  g.gestor.cerrar();
});

test('peticiones simultáneas al cruzar la medianoche: una sola transición, sin errores', async () => {
  const reloj = crearReloj('2026-11-28T22:00:00Z');
  const { app, db, dataDir } = await crearEntorno({ reloj });
  assert.equal((await get(app, '/healthz')).json().modo, 'DEMO');
  assert.ok(existsSync(path.join(dataDir, 'demo.db')));

  reloj.fijar('2026-11-28T23:00:00Z');
  const respuestas = await Promise.all(Array.from({ length: 30 }, () => get(app, '/healthz')));
  for (const r of respuestas) {
    assert.equal(r.statusCode, 200);
    assert.equal(r.json().modo, 'REAL');
  }
  assert.ok(!existsSync(path.join(dataDir, 'demo.db')));
  assert.equal(db.prepare("SELECT COUNT(*) n FROM auditoria WHERE accion = 'cambio_modo' AND valor_nuevo LIKE '%REAL%'").get().n, 1);
  await app.close();
});

test('estructura: ninguna ruta ni módulo, salvo la capa de captura, tiene SQL sobre las tablas de captura', () => {
  const sql = /\b(FROM|INTO|UPDATE|JOIN|TABLE)\s+(participacion|recuento_\w+|senado_\w+)/i;
  const analizar = (dir) =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const ruta = path.join(dir, e.name);
      if (e.isDirectory()) return analizar(ruta);
      return e.name.endsWith('.js') ? [ruta] : [];
    });
  const permitidos = new Set(['captura.js']);
  const infractores = analizar(path.join(raiz, 'src'))
    .filter((f) => !permitidos.has(path.basename(f)))
    .filter((f) => sql.test(readFileSync(f, 'utf8')))
    .map((f) => path.relative(raiz, f));
  assert.deepEqual(infractores, []);
  // Las rutas tampoco reciben conexiones a la base de demo ni importan el módulo de captura
  const rutas = analizar(path.join(raiz, 'src', 'rutas'));
  for (const f of rutas) {
    const texto = readFileSync(f, 'utf8');
    assert.ok(!/demo\.db|abrirDb|from '\.\.\/captura\.js'/.test(texto), `${path.basename(f)} no debe acceder a la captura directamente`);
  }
});
