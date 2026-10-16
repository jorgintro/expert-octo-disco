import { test } from 'node:test';
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import path from 'node:path';
import {
  agrupacionesExistentes, borrarCandidato, canonicaAgrupacion, listarCandidatos, normalizarAgrupaciones,
} from '../src/candidatosSenado.js';
import { borrarCandidatura } from '../src/candidaturas.js';
import { TOP_INDIVIDUAL, agruparEnListas, claveAgrupacion, construirResumenSenado, estadisticaBloque, limpiarAgrupacion, textoSenado } from '../src/senado.js';
import { fijarSenadoAbierto } from '../src/recuentoEstado.js';
import { pasarSenadoATotales } from '../src/servicioSenado.js';
import {
  CANDIDATURAS_MADRID, crearAgente, crearEntorno, crearReloj, get, getAgente, insertarCandidaturas, insertarCandidatosSenado, loginAdmin,
  loginAgente, post, postAgente,
} from './ayuda.js';

const DEMO_ISO = '2026-10-20T10:00:00Z';
const REAL_21H = '2026-11-29T20:30:00Z';
const ADMIN = { tipo: 'admin', id: 1 };
const SAB = { '1:1': 0, '2:0': 0, '2:1': 0, '3:0': 0, '3:1': 0 };

// n candidatos: los 3 primeros del PP, los 3 siguientes del PSOE, el resto de la «Agrupación Cívica» en bloques de 3.
async function montar(iso = DEMO_ISO, { n = 14 } = {}) {
  const e = await crearEntorno({ reloj: crearReloj(iso) });
  const partidos = insertarCandidaturas(e.db, CANDIDATURAS_MADRID.slice(0, 2));
  const lista = Array.from({ length: n }, (_, i) => {
    const nombre = `Candidato ${String(i + 1).padStart(2, '0')}`;
    if (i < 3) return { nombre, candidatura_id: partidos[0] };
    if (i < 6) return { nombre, candidatura_id: partidos[1] };
    return { nombre, agrupacion: `Agrupación ${Math.floor((i - 6) / 3) + 1}`, color: '#8e24aa' };
  });
  const ids = insertarCandidatosSenado(e.db, lista);
  e.app.datos.sincronizar();
  const mesas = e.db.prepare('SELECT id, codigo, censo FROM mesa ORDER BY id').all();
  const captura = () => e.app.datos.captura();
  // Guarda una mesa del Senado directamente en la capa de captura (sin pasar por la validación del servicio).
  const poner = (idx, { modo = 'sabana', votos = [], matriz = {}, blancas = 0, nulas = 0, estado = 'cerrado', validas = null } = {}) => {
    const m = mesas[idx];
    const v = new Map(ids.map((id, i) => [id, votos[i] ?? 0]));
    const mx = modo === 'sabana' ? new Map(Object.entries({ ...SAB, ...matriz })) : null;
    const val = validas ?? (mx ? [...mx.values()].reduce((a, b) => a + b, 0) : 0);
    captura().guardarSenado({ mesaId: m.id, valores: { modo, votos: v, matriz: mx, validas: val, blancas, nulas }, estado, versionEsperada: 0, actor: { tipo: 'agente', id: 7 } });
    return m.id;
  };
  const ad = await loginAdmin(e.app);
  const resumen = () => construirResumenSenado({ mesas: mesas.map(({ id, codigo, censo }) => ({ id, codigo, censo })), candidatos: listarCandidatos(e.db), registros: captura().listarSenado() });
  return { ...e, partidos, ids, mesas, poner, ad, captura, resumen };
}
const pantallazo = (e, cookie = e.ad.cookie) => get(e.app, '/pantallazo?variante=senado', cookie);
const nombres = (html) => [...html.matchAll(/class="sen-cand">([^<]+)</g)].map((m) => m[1]);
const textoWa = (html) => /<textarea[^>]*>([\s\S]*?)<\/textarea>/.exec(html)[1].replace(/&amp;/g, '&');

// ---------- Orden por votos ----------
test('ranking: de mayor a menor número de votos en una sola clasificación; desempate por orden de la papeleta', async () => {
  const e = await montar(DEMO_ISO, { n: 9 });
  // votos por candidato (índice): el último (9) gana; 2 y 5 empatan; 1 y 4 empatan a 0.
  e.poner(0, { votos: [0, 50, 10, 0, 50, 10, 30, 20, 90], matriz: { '1:1': 10 }, validas: 100 });
  const r = e.resumen();
  assert.deepEqual(r.ranking.map((c) => c.cand.nombre), [
    'Candidato 09', 'Candidato 02', 'Candidato 05', 'Candidato 07', 'Candidato 08', 'Candidato 03', 'Candidato 06', 'Candidato 01', 'Candidato 04',
  ]);
  assert.equal(r.ranking[0].porcentaje, 90, '90 de 100 válidas');
  assert.ok(r.ranking.every((c, i, a) => i === 0 || a[i - 1].votos > c.votos || (a[i - 1].votos === c.votos && a[i - 1].cand.orden < c.cand.orden)));
});

test('el orden se recalcula con los datos: un cambio de votos reordena la clasificación', async () => {
  const e = await montar(DEMO_ISO, { n: 4 });
  const m = e.poner(0, { votos: [10, 5, 3, 1], validas: 10, estado: 'borrador' });
  assert.deepEqual(e.resumen().ranking.map((c) => c.votos), [0, 0, 0, 0], 'un borrador no suma');
  const v = new Map(e.ids.map((id, i) => [id, [1, 3, 9, 4][i]]));
  e.captura().guardarSenado({ mesaId: m, valores: { modo: 'sabana', votos: v, matriz: new Map(Object.entries(SAB)), validas: 0, blancas: 0, nulas: 0 }, estado: 'cerrado', versionEsperada: 1, actor: ADMIN });
  assert.deepEqual(e.resumen().ranking.map((c) => c.cand.nombre), ['Candidato 03', 'Candidato 04', 'Candidato 02', 'Candidato 01']);
});

// ---------- Pantallazo ----------
test('pantallazo Senado: clasificación por votos, 12 primeros a la vista y el resto en un desplegable cerrado', async () => {
  const e = await montar(DEMO_ISO, { n: 14 });
  e.poner(0, { votos: [5, 90, 20, 70, 30, 60, 1, 2, 3, 4, 10, 11, 12, 13], matriz: { '1:1': 50, '3:0': 50 }, validas: 100, blancas: 4, nulas: 2 });
  const p = await pantallazo(e);
  assert.equal(p.statusCode, 200);
  const todos = nombres(p.body);
  assert.equal(todos.filter((n) => n.startsWith('Candidato')).length, TOP_INDIVIDUAL, 'solo los 12 primeros llevan fila individual');
  assert.deepEqual(todos.slice(0, 3), ['Candidato 02', 'Candidato 04', 'Candidato 06']);
  assert.match(p.body, /<details class="rec-otros rec-resto" data-persistir="senado:resto">/);
  assert.doesNotMatch(p.body, /<details[^>]*rec-resto[^>]* open/, 'cerrado por defecto');
  assert.match(p.body, /Resto \(2\)/);
  const resto = [...p.body.matchAll(/class="rp-siglas">(Candidato \d+)/g)].map((m) => m[1]);
  assert.deepEqual(resto, ['Candidato 08', 'Candidato 07'], 'las dos de menos votos, de mayor a menor (2 y 1 votos)');
  assert.match(p.body, /Elecciones Generales · Senado/);
  assert.match(p.body, /PROVISIONAL · 1\/6 mesas escrutadas/);
  assert.match(p.body, /MODO DEMO|class="marca-agua"/);
  assert.match(p.body, /class="aviso-sin-conexion"/);
  assert.match(p.body, /id="sondeo"/);
  assert.match(p.body, /Papeletas válidas[\s\S]*?En blanco[\s\S]*?Nulas[\s\S]*?Total de papeletas/);
  assert.match(p.body, /href="\/pantallazo\?variante=senado"/, 'la variante Senado está activa en el selector');
  assert.doesNotMatch(p.body, /\belectos?\b|\bsenadores?\b/i, 'sin marcar a los 4 primeros');
  assert.match(p.body, /\/candidaturas\.css\?v=/);
  // Los 4 primeros no se distinguen del 5.º: mismas clases.
  const clases = [...p.body.matchAll(/class="rec-fila sen-fila (cs-\d+)"/g)].length;
  assert.equal(clases, 12);
});

test('con 12 candidatos o menos no hay desplegable «Resto»; con 0 candidatos, aviso', async () => {
  const e = await montar(DEMO_ISO, { n: 12 });
  e.poner(0, { votos: Array(12).fill(5), matriz: { '1:1': 20 }, validas: 20 });
  assert.doesNotMatch((await pantallazo(e)).body, /rec-resto|Resto \(/);
  const poca = await montar(DEMO_ISO, { n: 5 });
  assert.doesNotMatch((await pantallazo(poca)).body, /rec-resto/);
  const vacio = await crearEntorno({ reloj: crearReloj(DEMO_ISO) });
  const ad = await loginAdmin(vacio.app);
  assert.match((await get(vacio.app, '/pantallazo?variante=senado', ad.cookie)).body, /No hay candidatos cargados/);
});

test('pantallazo REAL: sin marca de agua ni la palabra DEMO fuera de nombres; COMPLETO con todas las mesas cerradas', async () => {
  const e = await montar(REAL_21H, { n: 4 });
  e.mesas.forEach((_, i) => e.poner(i, { votos: [4, 3, 2, 1], matriz: { '1:1': 5 }, validas: 5 }));
  const p = await pantallazo(e);
  assert.doesNotMatch(p.body, /marca-agua|MODO DEMO|DATOS DE PRUEBA/);
  assert.match(p.body, /COMPLETO · 6\/6 mesas escrutadas/);
  assert.doesNotMatch(textoWa(p.body), /DEMO/);
});

test('permisos: el pantallazo del Senado exige administrador (anónimo y agente no entran)', async () => {
  const e = await montar();
  assert.equal((await get(e.app, '/pantallazo?variante=senado')).statusCode, 302);
  const agente = crearAgente(e.db);
  const ag = await loginAgente(e.app, agente.pin);
  const r = await e.app.inject({ method: 'GET', url: '/pantallazo?variante=senado', headers: { cookie: `sid=${ag.cookie}` } });
  assert.notEqual(r.statusCode, 200);
});

// ---------- Texto de WhatsApp ----------
const r14 = (e) => {
  e.poner(0, { votos: [5, 90, 20, 70, 30, 60, 1, 2, 3, 4, 10, 11, 12, 1234], matriz: { '1:1': 40, '2:0': 30, '3:1': 30 }, validas: 100, blancas: 4, nulas: 2 });
  return e.resumen();
};

test('texto WhatsApp: cabecera, 12 primeros uno por línea con posición/partido/votos/%, resto SIEMPRE en una línea, válidas/blancas/nulas y bloque', async () => {
  const e = await montar(DEMO_ISO, { n: 14 });
  const t = textoSenado({ resumen: r14(e), colegio: 'Colegio Dulcinea', modo: 'DEMO', actualizado: '20/10/2026 12:34:56', tipoEleccion: 'Elecciones Generales' });
  const l = t.split('\n');
  assert.equal(l[0], '*** DEMO - DATOS DE PRUEBA, NO SON REALES ***');
  assert.equal(l.at(-1), '*** DEMO - DATOS DE PRUEBA, NO SON REALES ***');
  assert.ok(l.includes('*Colegio Dulcinea · Elecciones Generales*'));
  assert.ok(l.includes('Senado — PROVISIONAL (1/6 mesas escrutadas)'));
  assert.equal(l.filter((x) => /^\d+\. /.test(x)).length, 12);
  assert.equal(l.find((x) => x.startsWith('1. ')), '1. Candidato 14 (Agrupación 3): 1.234 (1.234,00 %)'.replace('1.234,00 %', '1234,00 %'));
  assert.ok(l.some((x) => /^2\. Candidato 02 \(PP\): 90 \(90,00 %\)$/.test(x)));
  const resto = l.filter((x) => x.startsWith('Resto'));
  assert.equal(resto.length, 1, 'el resto, en una sola línea');
  assert.equal(resto[0], 'Resto (2): Candidato 08 2 · Candidato 07 1');
  assert.ok(l.includes('Válidas: 100 · En blanco: 4 · Nulas: 2 · *Total de papeletas: 106*'));
  assert.ok(l.some((x) => /^Voto en bloque: 50,00 % · mixto: 50,00 % \(datos de 1\/1 mesas\)$/.test(x)), l.join('\n'));
  const real = textoSenado({ resumen: r14(await montar(REAL_21H, { n: 14 })), colegio: 'C', modo: 'REAL', actualizado: 'x', tipoEleccion: 'E' });
  assert.doesNotMatch(real, /DEMO/);
});

test('texto WhatsApp: el resto va siempre (también por la ruta), igual con el desplegable abierto o cerrado; sin resto no hay línea', async () => {
  const e = await montar(DEMO_ISO, { n: 14 });
  r14(e);
  const wa = textoWa((await pantallazo(e)).body);
  assert.match(wa, /^Resto \(2\): Candidato 08 2 · Candidato 07 1$/m);
  assert.match(wa, /COMPLETO|PROVISIONAL/);
  const poco = await montar(DEMO_ISO, { n: 5 });
  poco.poner(0, { votos: [1, 2, 3, 4, 5], matriz: { '1:1': 5 }, validas: 5 });
  assert.doesNotMatch(textoWa((await pantallazo(poco)).body), /Resto/);
  const sin = await montar(DEMO_ISO, { n: 5 });
  assert.match(textoSenado({ resumen: sin.resumen(), colegio: 'C', modo: 'REAL', actualizado: 'x', tipoEleccion: 'E' }), /Todavía no hay mesas escrutadas/);
});

// ---------- Estadística de bloque ----------
test('bloque: solo mesas cerradas en sábana; las de totales se excluyen y se indica; % entre papeletas de 2 o 3 marcas', async () => {
  const e = await montar(DEMO_ISO, { n: 6 });
  e.poner(0, { matriz: { '1:1': 20, '2:1': 10, '2:0': 10, '3:1': 20, '3:0': 40 }, votos: [1, 1, 1, 1, 1, 1] }); // 100 válidas
  e.poner(1, { matriz: { '1:1': 0, '2:1': 0, '2:0': 0, '3:1': 100, '3:0': 0 }, votos: [1, 1, 1, 1, 1, 1] });      // 100 válidas
  e.poner(2, { modo: 'totales', votos: [50, 50, 50, 0, 0, 0], validas: 60 });                                      // excluida
  e.poner(3, { matriz: { '1:1': 999 }, votos: [1, 1, 1, 1, 1, 1], estado: 'borrador' });                          // borrador: no suma
  const b = e.resumen().bloque;
  assert.deepEqual([b.mesasSabana, b.mesasCerradas, b.mesasTotales, b.disponible], [2, 3, 1, true]);
  assert.deepEqual(b.porMarcas.map((m) => [m.marcas, m.papeletas, m.porcentaje]), [[3, 160, 80], [2, 20, 10], [1, 20, 10]]);
  assert.deepEqual([b.enBloque, b.mixto], [130, 50]);
  assert.deepEqual([b.porcentajeBloque, b.porcentajeMixto], [72.22, 27.78]);
  const p = await pantallazo(e);
  assert.match(p.body, /Estadística de bloque/);
  assert.match(p.body, /Datos de 2\/3 mesas escrutadas \(1 en modo totales, excluidas/);
  assert.match(p.body, /Todas del mismo partido[\s\S]*?72,22 %/);
  assert.match(p.body, /Voto mixto[\s\S]*?27,78 %/);
  assert.match(textoWa(p.body), /Voto en bloque: 72,22 % · mixto: 27,78 % \(datos de 2\/3 mesas\)/);
});

test('bloque: sin mesas en sábana (solo totales) o sin cerrar, el bloque no aparece ni en pantalla ni en el texto', async () => {
  const e = await montar(DEMO_ISO, { n: 5 });
  e.poner(0, { modo: 'totales', votos: [5, 4, 3, 2, 1], validas: 5 });
  e.poner(1, { matriz: { '1:1': 5 }, votos: [1, 1, 1, 1, 1], estado: 'borrador' });
  assert.equal(e.resumen().bloque.disponible, false);
  const p = await pantallazo(e);
  assert.doesNotMatch(p.body, /Estadística de bloque/);
  assert.doesNotMatch(textoWa(p.body), /Voto en bloque/);
  assert.equal(estadisticaBloque([]).disponible, false);
});

test('bloque: con solo papeletas de una marca se enseña el reparto por marcas pero no hay voto en bloque que medir', async () => {
  const e = await montar(DEMO_ISO, { n: 5 });
  e.poner(0, { matriz: { '1:1': 50 }, votos: [10, 10, 10, 10, 10] });
  const p = await pantallazo(e);
  assert.match(p.body, /no hay voto en bloque que medir/);
  assert.doesNotMatch(textoWa(p.body), /Voto en bloque/);
});

// ---------- Panel del administrador ----------
test('panel /admin/senado: la clasificación y la matriz usan el orden por votos (no el de la papeleta); sondeo activo', async () => {
  const e = await montar(DEMO_ISO, { n: 6 });
  e.poner(0, { votos: [1, 50, 3, 40, 2, 60], matriz: { '1:1': 10 }, validas: 100 });
  const panel = await get(e.app, '/admin/senado', e.ad.cookie);
  const orden = [...panel.body.matchAll(/class="celda-siglas">(Candidato \d+)</g)].map((m) => m[1]);
  const esperado = ['Candidato 06', 'Candidato 02', 'Candidato 04', 'Candidato 03', 'Candidato 05', 'Candidato 01'];
  assert.deepEqual(orden.slice(0, 6), esperado, 'resultados');
  assert.deepEqual(orden.slice(-6), esperado, 'matriz candidato × mesa');
  assert.match(panel.body, /<span class="puesto">1<\/span>/);
  assert.match(panel.body, /id="sondeo" data-intervalo="5000"/);
});

// ---------- Ajuste A: agrupación normalizada ----------
test('agrupación: limpieza y clave sin espacios sobrantes, sin mayúsculas ni tildes', () => {
  assert.equal(limpiarAgrupacion('  Agrupación   Cívica  '), 'Agrupación Cívica');
  for (const v of ['PP', ' pp ', 'Pp', 'pP', '  P   P ']) assert.equal(claveAgrupacion(v).replace(' ', ''), 'pp', v);
  assert.equal(claveAgrupacion('Cívica'), claveAgrupacion(' civica '));
  assert.equal(claveAgrupacion('Ñandú'), claveAgrupacion('nandu'), 'la ñ se trata como n (sin marca diacrítica)');
  assert.notEqual(claveAgrupacion('Cívica Madrid'), claveAgrupacion('Cívica'));
  const g = agruparEnListas([
    { id: 1, nombre: 'a', orden: 1, agrupacion: 'PP' }, { id: 2, nombre: 'b', orden: 2, agrupacion: ' pp ' }, { id: 3, nombre: 'c', orden: 3, agrupacion: 'Pp' },
    { id: 4, nombre: 'd', orden: 4, agrupacion: 'Cívica' }, { id: 5, nombre: 'e', orden: 5, agrupacion: 'civica' },
  ]);
  assert.deepEqual(g.map((l) => l.candidatos.length), [3, 2]);
});

test('agrupación: al guardar, «PP», « pp » y «Pp» quedan con la grafía de la primera y forman UNA lista; el formulario ofrece las existentes', async () => {
  const e = await montar(DEMO_ISO, { n: 3 });
  const crear = (nombre, agrupacion) => post(e.app, '/admin/senado/candidatos', { _csrf: e.ad.csrf, nombre, agrupacion, estructura: '1', activo: '1' }, e.ad.cookie);
  for (const [n, a] of [['Uno', 'PP'], ['Dos', ' pp '], ['Tres', 'Pp'], ['Cuatro', '  Agrupación   Cívica '], ['Cinco', 'agrupacion civica']]) assert.equal((await crear(n, a)).statusCode, 302, n);
  const guardadas = Object.fromEntries(listarCandidatos(e.db).filter((c) => c.agrupacion).map((c) => [c.nombre, c.agrupacion]));
  assert.deepEqual(guardadas, { Uno: 'PP', Dos: 'PP', Tres: 'PP', Cuatro: 'Agrupación Cívica', Cinco: 'Agrupación Cívica' });
  const listas = agruparEnListas(listarCandidatos(e.db).filter((c) => c.agrupacion));
  assert.equal(listas.length, 2);
  const form = await get(e.app, '/admin/senado/candidatos/nuevo', e.ad.cookie);
  assert.match(form.body, /list="agrupaciones"/);
  assert.match(form.body, /<datalist id="agrupaciones"><option value="PP"><\/option><option value="Agrupación Cívica"><\/option><\/datalist>/);
  assert.deepEqual(agrupacionesExistentes(e.db), ['PP', 'Agrupación Cívica']);
  assert.equal(canonicaAgrupacion(e.db, 'pp'), 'PP');
  assert.equal(canonicaAgrupacion(e.db, 'Nueva  Lista'), 'Nueva Lista');
  // Con partido, la agrupación sobra.
  await post(e.app, '/admin/senado/candidatos', { _csrf: e.ad.csrf, nombre: 'Seis', candidatura_id: e.partidos[0], agrupacion: 'PP', estructura: '1', activo: '1' }, e.ad.cookie);
  assert.equal(listarCandidatos(e.db).find((c) => c.nombre === 'Seis').agrupacion, '');
});

test('agrupación: la migración unifica las existentes (idempotente y auditada)', async () => {
  const e = await montar(DEMO_ISO, { n: 3 });
  const sucio = insertarCandidatosSenado(e.db, [
    { nombre: 'S1', agrupacion: 'Lista Cívica' }, { nombre: 'S2', agrupacion: ' lista  cívica' }, { nombre: 'S3', agrupacion: 'LISTA CIVICA ' }, { nombre: 'S4', agrupacion: 'Otra' },
  ]);
  normalizarAgrupaciones(e.db);
  assert.deepEqual(sucio.map((id) => e.db.prepare('SELECT agrupacion FROM candidato_senado WHERE id = ?').get(id).agrupacion), ['Lista Cívica', 'Lista Cívica', 'Lista Cívica', 'Otra']);
  const antes = e.db.prepare("SELECT COUNT(*) AS n FROM auditoria WHERE valor_nuevo LIKE '%agrupación normalizada%'").get().n;
  assert.equal(antes, 2);
  normalizarAgrupaciones(e.db);
  assert.equal(e.db.prepare("SELECT COUNT(*) AS n FROM auditoria WHERE valor_nuevo LIKE '%agrupación normalizada%'").get().n, 2, 'idempotente');
  assert.equal(agruparEnListas(listarCandidatos(e.db).filter((c) => c.nombre.startsWith('S'))).filter((l) => l.candidatos.length === 3).length, 1);
});

// ---------- Ajuste B: de sábana a totales conservando cifras ----------
async function conSabana(iso = DEMO_ISO, estado = 'cerrado') {
  const e = await montar(iso, { n: 6 });
  const mesaId = e.poner(0, { votos: [3, 2, 1, 0, 4, 2], matriz: { '1:1': 2, '2:1': 1, '2:0': 1, '3:1': 1 }, blancas: 3, nulas: 1, estado });
  return { ...e, mesaId, cab: () => e.captura().obtenerSenado(mesaId) };
}

test('pasar a totales: conserva votos, válidas, blancas y nulas; descarta la matriz; cambia a modo totales y audita antes/después', async () => {
  const e = await conSabana();
  const antes = e.cab();
  const r = pasarSenadoATotales({ db: e.db, captura: e.captura(), actor: ADMIN, mesaId: e.mesaId, version: 1, estadoFinal: 'cerrado' });
  assert.deepEqual([r.estado, r.version, r.estadoMesa], ['convertida', 2, 'cerrado']);
  const despues = e.cab();
  assert.deepEqual([despues.cab.modo, despues.cab.estado, despues.cab.validas, despues.cab.blancas, despues.cab.nulas], ['totales', 'cerrado', 5, 3, 1]);
  assert.deepEqual([...despues.votos], [...antes.votos], 'mismos votos por candidato');
  assert.equal(despues.matriz.size, 0, 'matriz descartada: datos de bloque no disponibles');
  assert.equal(despues.cab.introducido_por_tipo, 'admin');
  const a = e.db.prepare("SELECT * FROM auditoria WHERE accion = 'pasar_a_totales'").get() ?? new Database(path.join(e.dataDir, 'demo.db'), { readonly: true }).prepare("SELECT * FROM auditoria WHERE accion = 'pasar_a_totales'").get();
  const [ant, des] = [JSON.parse(a.valor_anterior), JSON.parse(a.valor_nuevo)];
  assert.deepEqual([ant.modo, des.modo, ant.estado, des.estado], ['sabana', 'totales', 'cerrado', 'cerrado']);
  assert.equal(ant.matriz['2:1'], 1);
  assert.deepEqual(des.matriz, {});
  assert.deepEqual([ant.validas, des.validas, des.blancas], [5, 5, 3]);
  assert.equal(a.actor_tipo, 'admin');
  // la mesa deja de contar en la estadística de bloque pero sigue sumando votos
  const res = e.resumen();
  assert.equal(res.bloque.disponible, false);
  assert.equal(res.ranking.find((c) => c.cand.nombre === 'Candidato 05').votos, 4);
});

test('pasar a totales: cerrada puede quedar reabierta (borrador) o cerrada; una mesa en borrador sigue en borrador', async () => {
  const a = await conSabana();
  assert.equal(pasarSenadoATotales({ db: a.db, captura: a.captura(), actor: ADMIN, mesaId: a.mesaId, version: 1, estadoFinal: 'borrador' }).estadoMesa, 'borrador');
  assert.equal(a.cab().cab.estado, 'borrador');
  const b = await conSabana(DEMO_ISO, 'borrador');
  assert.equal(pasarSenadoATotales({ db: b.db, captura: b.captura(), actor: ADMIN, mesaId: b.mesaId, version: 1, estadoFinal: 'cerrado' }).estadoMesa, 'borrador', 'no se cierra una mesa que no estaba cerrada');
});

test('pasar a totales: versión vieja → conflicto sin escribir; una mesa ya en totales o sin datos no cambia', async () => {
  const e = await conSabana();
  const c = pasarSenadoATotales({ db: e.db, captura: e.captura(), actor: ADMIN, mesaId: e.mesaId, version: 0 });
  assert.deepEqual([c.estado, c.versionActual], ['conflicto', 1]);
  assert.equal(e.cab().cab.modo, 'sabana');
  assert.equal(pasarSenadoATotales({ db: e.db, captura: e.captura(), actor: ADMIN, mesaId: e.mesaId, version: 1 }).estado, 'convertida');
  assert.equal(pasarSenadoATotales({ db: e.db, captura: e.captura(), actor: ADMIN, mesaId: e.mesaId, version: 2 }).estado, 'sin_cambios', 'ya está en totales');
  assert.equal(pasarSenadoATotales({ db: e.db, captura: e.captura(), actor: ADMIN, mesaId: e.mesas[3].id, version: 0 }).estado, 'sin_cambios', 'sin datos');
});

test('pasar a totales: solo el administrador; el agente ni lo ve ni lo ejecuta (servicio y rutas)', async () => {
  const e = await conSabana();
  assert.throws(() => pasarSenadoATotales({ db: e.db, captura: e.captura(), actor: { tipo: 'agente', id: 7 }, mesaId: e.mesaId, version: 1 }), /Solo el administrador/);
  fijarSenadoAbierto(e.db, 'DEMO', true);
  const agente = crearAgente(e.db, { nombre: 'Ana', mesas: [e.mesas[0].codigo] });
  const ag = await loginAgente(e.app, agente.pin);
  const vista = await getAgente(e.app, `/agente/mesa/${e.mesaId}/senado`, ag.cookie);
  assert.doesNotMatch(vista.body, /conservando cifras|pasar-a-totales/);
  const intento = await postAgente(e.app, `/agente/mesa/${e.mesaId}/senado/pasar-a-totales`, { _csrf: ag.csrf, version: 1, confirmar: '1' }, ag.cookie);
  assert.equal(intento.statusCode, 404);
  const comoAdmin = await post(e.app, `/admin/senado/mesa/${e.mesaId}/pasar-a-totales`, { _csrf: ag.csrf, version: 1, confirmar: '1' }, ag.cookie);
  assert.notEqual(comoAdmin.statusCode, 302, 'la cookie de agente no vale como administrador');
  assert.equal((await post(e.app, `/admin/senado/mesa/${e.mesaId}/pasar-a-totales`, { version: 1, confirmar: '1' })).statusCode, 302, 'anónimo → login');
  assert.equal(e.cab().cab.modo, 'sabana');
});

test('pasar a totales (ficha del administrador): botón, confirmación con opción de estado, ejecución y aviso; después es editable en totales', async () => {
  const e = await conSabana();
  const ficha = await get(e.app, `/admin/senado/mesa/${e.mesaId}`, e.ad.cookie);
  assert.match(ficha.body, /Pasar a modo totales conservando cifras…/);
  const pide = await post(e.app, `/admin/senado/mesa/${e.mesaId}/pasar-a-totales`, { _csrf: e.ad.csrf, version: 1 }, e.ad.cookie);
  assert.equal(pide.statusCode, 200);
  assert.match(pide.body, /¿Pasar la mesa .* a modo totales\?/);
  assert.match(pide.body, /name="estado_final" value="borrador" checked/);
  assert.match(pide.body, /name="estado_final" value="cerrado"/);
  assert.equal(e.cab().cab.modo, 'sabana', 'sin confirmar no cambia nada');
  const ok = await post(e.app, `/admin/senado/mesa/${e.mesaId}/pasar-a-totales`, { _csrf: e.ad.csrf, version: 1, confirmar: '1', estado_final: 'cerrado' }, e.ad.cookie);
  assert.equal(ok.statusCode, 302);
  assert.match(ok.headers.location, /senado_pasada_totales/);
  const despues = await get(e.app, `/admin/senado/mesa/${e.mesaId}`, e.ad.cookie);
  assert.match(despues.body, /data-modo="totales"/, 'editable en totales (el administrador edita también una mesa cerrada)');
  assert.match(despues.body, /datos de bloque no disponibles/i);
  assert.doesNotMatch(despues.body, /Pasar a modo totales conservando cifras…/);
  assert.match(despues.body, /Reiniciar el Senado de esta mesa…/, 'el reinicio completo se mantiene');
  const hist = await get(e.app, '/admin/historico', e.ad.cookie);
  assert.match(hist.body, /pasado de sábana a totales conservando cifras/);
  const repetir = await post(e.app, `/admin/senado/mesa/${e.mesaId}/pasar-a-totales`, { _csrf: e.ad.csrf, version: 2, confirmar: '1' }, e.ad.cookie);
  assert.equal(repetir.statusCode, 409);
});

// ---------- Candidatos de prueba (config compartida, votos en demo.db) ----------
test('de DEMO a REAL: un candidato que solo tenía votos de prueba se puede borrar; uno con votos reales, no', async () => {
  const e = await montar(DEMO_ISO, { n: 4 });
  const [conDemo, otro] = [e.ids[0], e.ids[3]];
  e.poner(0, { votos: [5, 0, 0, 0], matriz: { '1:1': 5 } });
  let votos = e.app.datos.contarVotosPorCandidato();
  assert.ok(votos.demo.get(conDemo) > 0, 'en DEMO tiene votos de prueba');
  assert.throws(() => borrarCandidato(e.db, conDemo, ADMIN, 'DEMO', votos), /tiene votos \(0 reales, 1 de demo\)/);
  e.app.datos.cambiarModo('REAL', ADMIN); // se borra demo.db
  assert.equal(new Database(e.app.datos.rutaDemo).constructor.name, 'Database'); // el fichero se recrea vacío al abrirlo, no existía
  votos = e.app.datos.contarVotosPorCandidato();
  assert.equal(votos.demo.size, 0, 'demo.db ya no existe: no quedan votos de prueba');
  assert.doesNotThrow(() => borrarCandidato(e.db, conDemo, ADMIN, 'REAL', votos), 'solo tenía votos de prueba: se puede borrar');
  assert.equal(listarCandidatos(e.db).some((c) => c.id === conDemo), false);
  // Votos REALES: no se puede borrar.
  e.poner(1, { votos: [0, 7, 0, 0], matriz: { '1:1': 7 } });
  votos = e.app.datos.contarVotosPorCandidato();
  assert.ok(votos.real.get(e.ids[1]) > 0);
  assert.throws(() => borrarCandidato(e.db, e.ids[1], ADMIN, 'REAL', votos), /tiene votos \(1 reales, 0 de demo\)|estructura de los candidatos/);
  assert.equal(listarCandidatos(e.db).some((c) => c.id === e.ids[1]), true);
  assert.ok(otro);
});

test('de DEMO a REAL (candidaturas del Congreso): con votos solo de prueba se pueden borrar; con votos reales, no', async () => {
  const e = await crearEntorno({ reloj: crearReloj(DEMO_ISO) });
  const [a, b] = insertarCandidaturas(e.db, CANDIDATURAS_MADRID.slice(5, 7));
  e.app.datos.sincronizar();
  const mesa = e.db.prepare('SELECT id FROM mesa ORDER BY id LIMIT 1').get().id;
  const guardar = (votos) => e.app.datos.captura().guardarRecuento({ mesaId: mesa, valores: { votantes: 5, blancos: 0, nulos: 0, votos }, estado: 'borrador', versionEsperada: 0, actor: ADMIN });
  guardar(new Map([[a, 3]]));
  assert.throws(() => borrarCandidatura(e.db, a, ADMIN, 'DEMO', e.app.datos.contarVotosPorCandidatura()), /ya tiene votos/);
  e.app.datos.cambiarModo('REAL', ADMIN);
  assert.doesNotThrow(() => borrarCandidatura(e.db, a, ADMIN, 'REAL', e.app.datos.contarVotosPorCandidatura()));
  guardar(new Map([[b, 4]]));
  assert.throws(() => borrarCandidatura(e.db, b, ADMIN, 'REAL', e.app.datos.contarVotosPorCandidatura()), /ya tiene votos \(1 reales, 0 de demo\)/);
});

test('los estáticos usados por el pantallazo se sirven sin caché; el JS conserva el estado por desplegable', async () => {
  const e = await montar();
  const r = await get(e.app, '/resumen.js');
  assert.equal(r.headers['cache-control'], 'no-cache');
  assert.match(r.body, /details\[data-persistir\]/);
  assert.match(r.body, /sessionStorage/);
  assert.match(r.body, /main details:not\(\[data-persistir\]\)/, 'el sondeo no pliega los desplegables persistentes');
});
