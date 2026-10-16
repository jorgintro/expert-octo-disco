import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import path from 'node:path';
import { abrirRecuento, cerrarRecuento, comprobarApertura } from '../src/servicioApertura.js';
import { cargarMesaRecuento, guardarRecuentoMesa, reabrirRecuentoMesa } from '../src/servicioRecuento.js';
import { recuentoAbierto, recuentoActivado, fijarAbierto } from '../src/recuentoEstado.js';
import { CANDIDATURAS_MADRID, crearEntorno, crearReloj, insertarCandidaturas } from './ayuda.js';

const ADMIN = { tipo: 'admin', id: 1 };
const AGENTE = { tipo: 'agente', id: 7 };
const DEMO_ISO = '2026-10-20T10:00:00Z';
const REAL_21H = '2026-11-29T20:30:00Z'; // 21:30 en Madrid, REAL

async function montar(iso = DEMO_ISO, nCand = 3) {
  const e = await crearEntorno({ reloj: crearReloj(iso) });
  const ids = insertarCandidaturas(e.db, CANDIDATURAS_MADRID.slice(0, nCand));
  e.app.datos.sincronizar();
  const mesa = e.db.prepare("SELECT id, censo FROM mesa WHERE codigo = '4-2-A'").get();
  const modo = () => e.app.datos.estado.modo;
  const captura = () => e.app.datos.captura();
  const entrada = ({ votantes = '', blancos = '', nulos = '', votos = [] } = {}) => ({
    votantes, blancos, nulos, votos: Object.fromEntries(ids.map((id, i) => [id, votos[i] ?? ''])),
  });
  const guardar = (extra = {}) =>
    guardarRecuentoMesa({ db: e.db, captura: captura(), actor: AGENTE, mesaId: mesa.id, entrada: entrada(), version: 0, modo: modo(), ...extra });
  const cab = () => captura().obtenerRecuento(mesa.id).cab;
  return { ...e, ids, mesa, entrada, guardar, cab, modo, captura };
}
// Una mesa cuadrada: 60 + 30 + 0 + 6 blancos + 4 nulos = 100 votantes.
const CUADRA = { votantes: '100', blancos: '6', nulos: '4', votos: ['60', '30', '0'] };

test('un agente no puede tocar el recuento si no está abierto; el administrador sí (plan B)', async () => {
  const e = await montar();
  const r = e.guardar({ entrada: e.entrada({ votantes: '10' }) });
  assert.equal(r.estado, 'recuento_cerrado');
  assert.equal(e.cab(), null, 'no se escribió nada');
  const admin = e.guardar({ actor: ADMIN, entrada: e.entrada({ votantes: '10' }) });
  assert.equal(admin.estado, 'guardado');
  fijarAbierto(e.db, 'DEMO', true);
  assert.equal(e.guardar({ version: 1, entrada: e.entrada({ votantes: '11' }) }).estado, 'bloqueado', 'lo del administrador no lo edita el agente');
});

test('borrador: guarda datos parciales (sin rellenar ≠ 0) y rechaza formato o votantes > censo sin escribir', async () => {
  const e = await montar();
  fijarAbierto(e.db, 'DEMO', true);
  const ok = e.guardar({ entrada: e.entrada({ votantes: '80', blancos: '0', votos: ['50', '', '0'] }) });
  assert.deepEqual([ok.estado, ok.version, ok.suma], ['guardado', 1, 50]);
  const { votos } = e.captura().obtenerRecuento(e.mesa.id);
  assert.deepEqual([...votos], [[e.ids[0], 50], [e.ids[2], 0]]);
  assert.equal(e.cab().votos_nulos, null);

  const formato = e.guardar({ version: 1, entrada: e.entrada({ votantes: '8x' }) });
  assert.equal(formato.estado, 'error');
  assert.match(formato.errores[0], /Total de votantes: solo cifras/);
  const censo = e.guardar({ version: 1, entrada: e.entrada({ votantes: String(e.mesa.censo + 1) }) });
  assert.match(censo.errores[0], /no puede superar el censo/);
  assert.equal(e.cab().version, 1, 'los errores no escriben');
});

test('cerrar: confirmación previa, todo relleno y cuadra; los avisos no bloquean', async () => {
  const e = await montar();
  fijarAbierto(e.db, 'DEMO', true);
  const confirmar = e.guardar({ cerrar: true, entrada: e.entrada(CUADRA) });
  assert.equal(confirmar.estado, 'confirmar');
  assert.equal(e.cab(), null, 'sin confirmar no se guarda nada');
  const cerrado = e.guardar({ cerrar: true, confirmar: true, entrada: e.entrada(CUADRA) });
  assert.deepEqual([cerrado.estado, cerrado.version], ['cerrado', 1]);
  assert.equal(e.cab().estado, 'cerrado');
  assert.equal(e.captura().obtenerRecuento(e.mesa.id).votos.get(e.ids[2]), 0, 'el 0 explícito se guarda');
});

test('cerrar se bloquea si falta algo o no cuadra, aunque se confirme', async () => {
  const e = await montar();
  fijarAbierto(e.db, 'DEMO', true);
  const falta = e.guardar({ cerrar: true, confirmar: true, entrada: e.entrada({ ...CUADRA, votos: ['60', '', '0'] }) });
  assert.equal(falta.estado, 'error');
  assert.match(falta.errores[0], /Faltan: Candidatura|Faltan: PSOE/);
  const noCuadra = e.guardar({ cerrar: true, confirmar: true, entrada: e.entrada({ ...CUADRA, votos: ['61', '30', '0'] }) });
  assert.match(noCuadra.errores[0], /\(101\) no coincide con el total de votantes \(100\): sobran 1/);
  assert.equal(e.cab(), null);
  // Las 3 candidaturas están en el formulario: PP, PSOE, VOX
  const ok = e.guardar({ cerrar: true, confirmar: true, entrada: e.entrada(CUADRA) });
  assert.equal(ok.estado, 'cerrado');
});

test('aviso al cerrar si el total de votantes difiere de la última participación informada', async () => {
  const e = await montar();
  fijarAbierto(e.db, 'DEMO', true);
  const corte = e.db.prepare('SELECT id FROM corte ORDER BY orden DESC LIMIT 1').get().id;
  e.captura().guardarParticipacion({ mesaId: e.mesa.id, corteId: corte, votantes: 480, actor: ADMIN });
  const r = e.guardar({ cerrar: true, entrada: e.entrada(CUADRA) });
  assert.equal(r.estado, 'confirmar');
  assert.match(r.avisos[0], /\(100\) difiere de la última participación informada \(480, de las 20:00\)/);
  assert.equal(e.guardar({ cerrar: true, confirmar: true, entrada: e.entrada(CUADRA) }).estado, 'cerrado', 'solo advierte');
});

test('una mesa cerrada no la edita el agente; solo el administrador la reabre (y conserva la autoría)', async () => {
  const e = await montar();
  fijarAbierto(e.db, 'DEMO', true);
  e.guardar({ cerrar: true, confirmar: true, entrada: e.entrada(CUADRA) });
  const intento = e.guardar({ version: 1, entrada: e.entrada({ ...CUADRA, votos: ['1', '1', '1'] }) });
  assert.equal(intento.estado, 'mesa_cerrada');
  assert.match(intento.mensaje, /Esta mesa está cerrada y ya no se puede editar/);
  assert.throws(() => reabrirRecuentoMesa({ db: e.db, captura: e.captura(), actor: AGENTE, mesaId: e.mesa.id, version: 1 }), /Solo el administrador/);
  const r = reabrirRecuentoMesa({ db: e.db, captura: e.captura(), actor: ADMIN, mesaId: e.mesa.id, version: 1 });
  assert.deepEqual([r.estado, r.version], ['reabierta', 2]);
  assert.equal(e.cab().introducido_por_tipo, 'agente');
  const otra = e.guardar({ version: 2, entrada: e.entrada({ ...CUADRA, votos: ['61', '29', '0'] }) });
  assert.equal(otra.estado, 'guardado', 'reabierta por el administrador, el agente puede seguir (la autoría era suya)');
  assert.equal(reabrirRecuentoMesa({ db: e.db, captura: e.captura(), actor: ADMIN, mesaId: e.mesa.id, version: 3 }).estado, 'sin_cambios');
});

test('el administrador edita una mesa cerrada solo si sigue cuadrando; sigue cerrada y pasa a ser suya', async () => {
  const e = await montar();
  fijarAbierto(e.db, 'DEMO', true);
  e.guardar({ cerrar: true, confirmar: true, entrada: e.entrada(CUADRA) });
  const mal = e.guardar({ actor: ADMIN, version: 1, entrada: e.entrada({ ...CUADRA, votos: ['70', '30', '0'] }) });
  assert.equal(mal.estado, 'error');
  assert.match(mal.errores[0], /sobran 10/);
  const bien = e.guardar({ actor: ADMIN, version: 1, entrada: e.entrada({ ...CUADRA, votos: ['65', '25', '0'] }) });
  assert.equal(bien.estado, 'guardado');
  assert.deepEqual([e.cab().estado, e.cab().introducido_por_tipo], ['cerrado', 'admin']);
  // Reabierta, el agente no puede tocar lo que ahora es del administrador
  reabrirRecuentoMesa({ db: e.db, captura: e.captura(), actor: ADMIN, mesaId: e.mesa.id, version: 2 });
  assert.equal(e.guardar({ version: 3, entrada: e.entrada(CUADRA) }).estado, 'bloqueado');
});

test('control de versión: un guardado o una reapertura con versión vieja devuelve «conflicto» y no escribe', async () => {
  const e = await montar();
  fijarAbierto(e.db, 'DEMO', true);
  e.guardar({ entrada: e.entrada({ votantes: '10' }) });
  e.guardar({ version: 1, entrada: e.entrada({ votantes: '11' }) });
  const c = e.guardar({ version: 1, entrada: e.entrada({ votantes: '99' }), automatico: true });
  assert.deepEqual([c.estado, c.versionActual], ['conflicto', 2]);
  assert.match(c.mensaje, /modificada desde otro dispositivo/);
  assert.equal(e.cab().votantes, 11);
  assert.equal(reabrirRecuentoMesa({ db: e.db, captura: e.captura(), actor: ADMIN, mesaId: e.mesa.id, version: 1 }).estado, 'conflicto');
});

test('una candidatura inactiva solo sale en el formulario de una mesa que ya tiene votos suyos', async () => {
  const e = await montar();
  fijarAbierto(e.db, 'DEMO', true);
  e.guardar({ entrada: e.entrada({ votos: ['5', '', ''] }) });
  e.db.prepare('UPDATE candidatura SET activa = 0 WHERE id = ?').run(e.ids[0]);
  assert.deepEqual(cargarMesaRecuento(e.db, e.captura(), e.mesa.id).candidaturas.map((c) => c.id), e.ids, 'la mesa con votos de PP sigue viéndola');
  const otra = e.db.prepare("SELECT id FROM mesa WHERE codigo = '4-2-B'").get().id;
  assert.deepEqual(cargarMesaRecuento(e.db, e.captura(), otra).candidaturas.map((c) => c.id), e.ids.slice(1));
});

test('AISLAMIENTO: el recuento en DEMO no toca app.db; en REAL va a app.db y no hay demo.db', async () => {
  const demo = await montar();
  fijarAbierto(demo.db, 'DEMO', true);
  demo.guardar({ cerrar: true, confirmar: true, entrada: demo.entrada(CUADRA) });
  assert.equal(demo.db.prepare('SELECT COUNT(*) n FROM recuento_mesa').get().n, 0);
  assert.equal(demo.db.prepare('SELECT COUNT(*) n FROM recuento_voto').get().n, 0);
  assert.equal(demo.db.prepare("SELECT COUNT(*) n FROM auditoria WHERE entidad = 'recuento'").get().n, 0);
  const d = new Database(path.join(demo.dataDir, 'demo.db'), { readonly: true });
  assert.equal(d.prepare('SELECT COUNT(*) n FROM recuento_mesa').get().n, 1);
  d.close();

  const real = await montar(REAL_21H);
  assert.equal(real.modo(), 'REAL');
  fijarAbierto(real.db, 'REAL', true);
  real.guardar({ cerrar: true, confirmar: true, entrada: real.entrada(CUADRA) });
  assert.equal(real.db.prepare('SELECT COUNT(*) n FROM recuento_mesa').get().n, 1);
});

// ---------- Apertura ----------
test('abrir en REAL exige la participación del último corte de TODAS las mesas activas; en DEMO no', async () => {
  const e = await montar(REAL_21H);
  const ultimo = e.db.prepare('SELECT id FROM corte ORDER BY orden DESC LIMIT 1').get().id;
  const mesas = e.db.prepare('SELECT id, codigo FROM mesa ORDER BY id').all();
  const comprobar = () => comprobarApertura({ db: e.db, captura: e.captura(), modo: 'REAL', ahora: e.reloj.ahora() });

  const sin = comprobar();
  assert.equal(sin.ok, false);
  assert.equal(sin.pendientes.length, 6);
  assert.match(sin.motivos[0], /Falta la participación del corte de las 20:00 de las mesas 4-2-A, 4-2-B, 4-3-A, 4-3-B, 5-18-U, 5-31-U/);

  // Una participación de un corte anterior no vale: tiene que ser la del último
  const primero = e.db.prepare('SELECT id FROM corte ORDER BY orden LIMIT 1').get().id;
  e.captura().guardarParticipacion({ mesaId: mesas[0].id, corteId: primero, votantes: 10, actor: ADMIN });
  assert.equal(comprobar().pendientes.length, 6);

  for (const m of mesas.slice(0, 5)) e.captura().guardarParticipacion({ mesaId: m.id, corteId: ultimo, votantes: 10, actor: ADMIN });
  const casi = comprobar();
  assert.deepEqual([casi.ok, casi.pendientes.map((m) => m.codigo)], [false, ['5-31-U']]);
  assert.match(casi.motivos[0], /la mesa 5-31-U/);

  e.captura().guardarParticipacion({ mesaId: mesas[5].id, corteId: ultimo, votantes: 10, actor: ADMIN });
  assert.deepEqual([comprobar().ok, comprobar().motivos], [true, []]);

  // Una mesa de baja no se exige
  const e2 = await montar(REAL_21H);
  e2.db.prepare("UPDATE mesa SET activa = 0 WHERE codigo != '4-2-A'").run();
  const parcial = comprobarApertura({ db: e2.db, captura: e2.captura(), modo: 'REAL', ahora: e2.reloj.ahora() });
  assert.equal(parcial.pendientes.length, 1);

  // En DEMO no hay requisito de participación
  const d = await montar();
  assert.equal(comprobarApertura({ db: d.db, captura: d.captura(), modo: 'DEMO', ahora: d.reloj.ahora() }).ok, true);
});

test('no se abre sin candidaturas activas (ni en DEMO)', async () => {
  const e = await crearEntorno();
  e.app.datos.sincronizar();
  const sin = comprobarApertura({ db: e.db, captura: e.app.datos.captura(), modo: 'DEMO', ahora: e.reloj.ahora() });
  assert.equal(sin.ok, false);
  assert.match(sin.motivos[0], /No hay candidaturas activas/);
  const [id] = insertarCandidaturas(e.db, [CANDIDATURAS_MADRID[0]]);
  e.db.prepare('UPDATE candidatura SET activa = 0 WHERE id = ?').run(id);
  assert.equal(comprobarApertura({ db: e.db, captura: e.app.datos.captura(), modo: 'DEMO', ahora: e.reloj.ahora() }).ok, false, 'una inactiva no cuenta');
});

test('en REAL avisa (sin impedir) si es antes de las 20:00; a las 20:00 o después no avisa', async () => {
  const e = await montar('2026-11-29T16:00:00Z'); // 17:00 en Madrid, REAL
  const hecho = async () => {
    const mesas = e.db.prepare('SELECT id FROM mesa').all();
    const ultimo = e.db.prepare('SELECT id FROM corte ORDER BY orden DESC LIMIT 1').get().id;
    mesas.forEach((m) => e.captura().guardarParticipacion({ mesaId: m.id, corteId: ultimo, votantes: 1, actor: ADMIN }));
  };
  await hecho();
  const temprano = comprobarApertura({ db: e.db, captura: e.captura(), modo: 'REAL', ahora: e.reloj.ahora() });
  assert.equal(temprano.ok, true, 'no lo impide');
  assert.match(temprano.avisos[0], /Son las 17:00: los colegios cierran a las 20:00/);
  e.reloj.fijar('2026-11-29T19:00:00Z'); // 20:00 en Madrid
  assert.deepEqual(comprobarApertura({ db: e.db, captura: e.captura(), modo: 'REAL', ahora: e.reloj.ahora() }).avisos, []);
});

test('abrir y cerrar el recuento: por modo, idempotente, auditado y activa el bloqueo de estructura', async () => {
  const e = await montar();
  assert.equal(abrirRecuento(e.db, 'DEMO', ADMIN), true);
  assert.equal(abrirRecuento(e.db, 'DEMO', ADMIN), false, 'abrirlo dos veces no hace nada');
  assert.deepEqual([recuentoAbierto(e.db, 'DEMO'), recuentoAbierto(e.db, 'REAL'), recuentoActivado(e.db, 'DEMO')], [true, false, true]);
  assert.equal(cerrarRecuento(e.db, 'DEMO', ADMIN), true);
  assert.equal(cerrarRecuento(e.db, 'DEMO', ADMIN), false);
  assert.deepEqual([recuentoAbierto(e.db, 'DEMO'), recuentoActivado(e.db, 'DEMO')], [false, true], 'cerrar no desactiva: sigue «activado»');
  const filas = e.db.prepare("SELECT * FROM auditoria WHERE accion IN ('abrir_recuento', 'cerrar_recuento') ORDER BY id").all();
  assert.deepEqual(filas.map((f) => f.accion), ['abrir_recuento', 'cerrar_recuento']);
  assert.equal(filas[0].actor_tipo, 'admin');
  assert.deepEqual(JSON.parse(filas[0].valor_nuevo), { abierto: true, modo: 'DEMO' });
});
