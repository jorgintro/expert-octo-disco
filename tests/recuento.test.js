import { test } from 'node:test';
import assert from 'node:assert/strict';
import { construirResumenRecuento, formatoPorcentaje2, leerCampo, leerEntrada, porcentaje2, sumaVotos, textoRecuento, ultimaParticipacion, validarRecuento } from '../src/recuento.js';

const ETIQ = new Map([[1, 'PP'], [2, 'PSOE'], [3, 'VOX']]);
const valores = (o = {}) => ({ votantes: null, blancos: null, nulos: null, votos: new Map([[1, null], [2, null], [3, null]]), ...o });
const conVotos = (m, o = {}) => valores({ ...o, votos: new Map(Object.entries(m).map(([k, v]) => [Number(k), v])) });

test('leerCampo: vacío es «sin rellenar» (null) y 0 es 0; solo cifras', () => {
  assert.deepEqual(leerCampo(''), { ok: true, valor: null });
  assert.deepEqual(leerCampo('   '), { ok: true, valor: null });
  assert.deepEqual(leerCampo(null), { ok: true, valor: null });
  assert.deepEqual(leerCampo('0'), { ok: true, valor: 0 });
  assert.deepEqual(leerCampo(' 42 '), { ok: true, valor: 42 });
  assert.notEqual(leerCampo('0').valor, leerCampo('').valor, 'sin rellenar y 0 son distintos');
  for (const malo of ['-1', '1.5', '1,5', 'abc', '1e3', '+5', '12 3', '12345678', '99999999']) assert.equal(leerCampo(malo).ok, false, malo);
});

test('leerEntrada: interpreta todos los campos y nombra el que falla', () => {
  const ok = leerEntrada({ votantes: '100', blancos: '', nulos: '0', votos: { 1: '60', 2: '', 3: '0' } }, [1, 2, 3], ETIQ);
  assert.deepEqual(ok.errores, []);
  assert.equal(ok.valores.votantes, 100);
  assert.equal(ok.valores.blancos, null);
  assert.equal(ok.valores.nulos, 0);
  assert.deepEqual([...ok.valores.votos], [[1, 60], [2, null], [3, 0]]);
  const mal = leerEntrada({ votantes: '1x', blancos: '2', nulos: '', votos: { 1: '-3', 2: '', 3: '' } }, [1, 2, 3], ETIQ);
  assert.equal(mal.errores.length, 2);
  assert.match(mal.errores[0], /^Total de votantes: solo cifras/);
  assert.match(mal.errores[1], /^PP: solo cifras/);
});

test('borrador: acepta datos parciales; solo exige votantes <= censo', () => {
  const r = validarRecuento({ valores: conVotos({ 1: 50, 2: null, 3: null }, { votantes: 80 }), censo: 600, etiquetas: ETIQ, cerrar: false });
  assert.deepEqual(r.errores, []);
  assert.equal(r.suma, 50);
  const mal = validarRecuento({ valores: valores({ votantes: 601 }), censo: 600, etiquetas: ETIQ, cerrar: false });
  assert.match(mal.errores[0], /no puede superar el censo de la mesa \(600\)/);
});

test('cerrar: exige todo relleno (0 incluido) y que candidaturas + blancos + nulos = total de votantes', () => {
  const cuadra = conVotos({ 1: 60, 2: 30, 3: 0 }, { votantes: 100, blancos: 6, nulos: 4 });
  assert.deepEqual(validarRecuento({ valores: cuadra, censo: 600, etiquetas: ETIQ, cerrar: true }).errores, []);

  const vacios = validarRecuento({ valores: conVotos({ 1: 60, 2: null, 3: null }, { votantes: 100, blancos: null, nulos: 4 }), censo: 600, etiquetas: ETIQ, cerrar: true });
  assert.equal(vacios.errores.length, 1);
  assert.match(vacios.errores[0], /Faltan: PSOE, VOX, blancos\./);
  assert.ok(!/suma/.test(vacios.errores[0]), 'no mezcla la suma cuando faltan campos');

  const sobran = validarRecuento({ valores: conVotos({ 1: 60, 2: 30, 3: 5 }, { votantes: 100, blancos: 6, nulos: 4 }), censo: 600, etiquetas: ETIQ, cerrar: true });
  assert.match(sobran.errores[0], /\(105\) no coincide con el total de votantes \(100\): sobran 5\./);
  const faltan = validarRecuento({ valores: conVotos({ 1: 60, 2: 30, 3: 0 }, { votantes: 100, blancos: 5, nulos: 0 }), censo: 600, etiquetas: ETIQ, cerrar: true });
  assert.match(faltan.errores[0], /\(95\).*faltan 5\./);

  const sinTotal = validarRecuento({ valores: conVotos({ 1: 1, 2: 1, 3: 1 }, { blancos: 0, nulos: 0 }), censo: 600, etiquetas: ETIQ, cerrar: true });
  assert.match(sinTotal.errores[0], /Faltan: total de votantes/);

  const mas = validarRecuento({ valores: conVotos({ 1: 400, 2: 300, 3: 0 }, { votantes: 700, blancos: 0, nulos: 0 }), censo: 600, etiquetas: ETIQ, cerrar: true });
  assert.ok(mas.errores.some((e) => /no puede superar el censo/.test(e)));
});

test('cerrar: con muchas candidaturas pendientes la lista se abrevia', () => {
  const ids = Array.from({ length: 12 }, (_, i) => i + 1);
  const etiquetas = new Map(ids.map((i) => [i, `C${i}`]));
  const v = { votantes: 10, blancos: 0, nulos: 0, votos: new Map(ids.map((i) => [i, null])) };
  const r = validarRecuento({ valores: v, censo: 600, etiquetas, cerrar: true });
  assert.match(r.errores[0], /Faltan: C1, C2, C3, C4, C5, C6 y 6 más\./);
});

test('aviso (no bloquea) si el total de votantes difiere de la última participación informada', () => {
  const v = conVotos({ 1: 60, 2: 30, 3: 0 }, { votantes: 100, blancos: 6, nulos: 4 });
  const ult = { valor: 480, hora: '20:00' };
  const r = validarRecuento({ valores: v, censo: 600, etiquetas: ETIQ, cerrar: true, ultimaPart: ult });
  assert.deepEqual(r.errores, []);
  assert.match(r.avisos[0], /\(100\) difiere de la última participación informada \(480, de las 20:00\)/);
  assert.deepEqual(validarRecuento({ valores: v, censo: 600, etiquetas: ETIQ, cerrar: true, ultimaPart: { valor: 100, hora: '20:00' } }).avisos, []);
  assert.deepEqual(validarRecuento({ valores: v, censo: 600, etiquetas: ETIQ, cerrar: true, ultimaPart: null }).avisos, []);
});

test('última participación informada: el corte más reciente (por orden) con dato', () => {
  const cortes = [{ id: 1, hora: '10:00' }, { id: 2, hora: '12:00' }, { id: 3, hora: '14:00' }];
  const filas = [{ corte_id: 1, votantes_acumulados: 10 }, { corte_id: 2, votantes_acumulados: 99 }];
  assert.deepEqual(ultimaParticipacion(filas, cortes), { valor: 99, hora: '12:00' });
  assert.equal(ultimaParticipacion([], cortes), null);
});

test('suma y porcentajes: 2 decimales sobre votos válidos', () => {
  assert.equal(sumaVotos(conVotos({ 1: 10, 2: 20, 3: null }, { blancos: 3, nulos: 2 })), 35);
  assert.equal(porcentaje2(1, 3), 33.33);
  assert.equal(porcentaje2(2, 3), 66.67);
  assert.equal(porcentaje2(5, 0), null);
  assert.equal(formatoPorcentaje2(32.45), '32,45 %');
  assert.equal(formatoPorcentaje2(5), '5,00 %');
  assert.equal(formatoPorcentaje2(null), '–');
});

// ---------- Resumen ----------
const MESAS = [{ id: 1, codigo: '4-2-A', censo: 600 }, { id: 2, codigo: '4-2-B', censo: 400 }, { id: 3, codigo: '4-3-A', censo: 500 }];
const CAND = [
  { id: 1, nombre: 'Partido Popular', siglas: 'PP', orden: 1, destacada: 1, activa: 1, color: '#1d84ce' },
  { id: 2, nombre: 'PSOE', siglas: 'PSOE', orden: 2, destacada: 1, activa: 1, color: '#e30613' },
  { id: 3, nombre: 'Partido Pequeño', siglas: 'PPQ', orden: 3, destacada: 0, activa: 1, color: '#888888' },
  { id: 4, nombre: 'Otro Partido', siglas: 'OP', orden: 4, destacada: 0, activa: 1, color: '#999999' },
];
const cab = (estado, votantes, blancos, nulos) => ({ estado, votantes, votos_blancos: blancos, votos_nulos: nulos });
const rec = (c, votos) => ({ cab: c, votos: new Map(Object.entries(votos).map(([k, v]) => [Number(k), v])) });

test('resumen: solo las mesas CERRADAS suman; los borradores no', () => {
  const recuentos = new Map([
    [1, rec(cab('cerrado', 100, 6, 4), { 1: 50, 2: 30, 3: 8, 4: 2 })],
    [2, rec(cab('cerrado', 50, 2, 0), { 1: 20, 2: 20, 3: 4, 4: 2 })],
    [3, rec(cab('borrador', 999, 9, 9), { 1: 500, 2: 400 })],
  ]);
  const r = construirResumenRecuento({ mesas: MESAS, candidaturas: CAND, recuentos });
  assert.deepEqual([r.cerradas, r.borradores, r.sinIniciar, r.totalMesas, r.provisional], [2, 1, 0, 3, true]);
  const porId = Object.fromEntries(r.candidaturas.map((c) => [c.cand.id, c.votos]));
  assert.deepEqual(porId, { 1: 70, 2: 50, 3: 12, 4: 4 });
  assert.deepEqual([r.blancos, r.nulos, r.votantes], [8, 4, 150]);
  assert.equal(r.validos, 70 + 50 + 12 + 4 + 8); // candidaturas + blancos
  assert.equal(r.candidaturas[0].porcentaje, 48.61); // 70 / 144
  assert.equal(r.porcentajeBlancos, 5.56); // 8 / 144
});

test('resumen: destacadas arriba y «Otros» agrupa el resto; sin destacadas se muestran todas; vacío si no hay resto', () => {
  const recuentos = new Map([[1, rec(cab('cerrado', 100, 0, 0), { 1: 50, 2: 30, 3: 15, 4: 5 })]]);
  const r = construirResumenRecuento({ mesas: [MESAS[0]], candidaturas: CAND, recuentos });
  assert.deepEqual(r.destacadas.map((c) => c.cand.siglas), ['PP', 'PSOE']);
  assert.deepEqual([r.otros.cantidad, r.otros.votos, r.otros.porcentaje], [2, 20, 20]);
  assert.equal(r.provisional, false);

  const ninguna = construirResumenRecuento({ mesas: [MESAS[0]], candidaturas: CAND.map((c) => ({ ...c, destacada: 0 })), recuentos });
  assert.equal(ninguna.destacadas.length, 4);
  assert.equal(ninguna.otros, null);
  const todas = construirResumenRecuento({ mesas: [MESAS[0]], candidaturas: CAND.map((c) => ({ ...c, destacada: 1 })), recuentos });
  assert.equal(todas.otros, null, 'si todas son destacadas no hay «Otros»');
});

test('resumen: una candidatura inactiva solo aparece si tiene votos; las mesas sin recuento cuentan 0', () => {
  const cand = CAND.map((c) => (c.id === 4 ? { ...c, activa: 0 } : c));
  const sin = construirResumenRecuento({ mesas: MESAS, candidaturas: cand, recuentos: new Map() });
  assert.equal(sin.candidaturas.some((c) => c.cand.id === 4), false);
  assert.deepEqual([sin.cerradas, sin.sinIniciar, sin.provisional, sin.validos], [0, 3, true, 0]);
  assert.equal(sin.candidaturas[0].porcentaje, null);
  const con = construirResumenRecuento({ mesas: MESAS, candidaturas: cand, recuentos: new Map([[1, rec(cab('cerrado', 7, 0, 0), { 1: 3, 4: 4 })]]) });
  assert.equal(con.candidaturas.some((c) => c.cand.id === 4 && c.votos === 4), true);
});

test('resumen: completo cuando todas las mesas están cerradas', () => {
  const recuentos = new Map(MESAS.map((m) => [m.id, rec(cab('cerrado', 10, 0, 0), { 1: 10 })]));
  const r = construirResumenRecuento({ mesas: MESAS, candidaturas: CAND, recuentos });
  assert.deepEqual([r.cerradas, r.provisional], [3, false]);
});

test('texto WhatsApp del recuento: destacadas, Otros, blancos, nulos, total y mesas escrutadas; DEMO marcado', () => {
  const recuentos = new Map([[1, rec(cab('cerrado', 100, 6, 4), { 1: 50, 2: 30, 3: 8, 4: 2 })]]);
  const resumen = construirResumenRecuento({ mesas: MESAS, candidaturas: CAND, recuentos });
  const real = textoRecuento({ resumen, colegio: 'Colegio Dulcinea', modo: 'REAL', actualizado: '29/11/2026 21:30:00', tipoEleccion: 'Elecciones Generales' }).split('\n');
  assert.equal(real[0], '*Colegio Dulcinea · Elecciones Generales*');
  assert.equal(real[1], 'Recuento Congreso — PROVISIONAL (1/3 mesas escrutadas)');
  assert.ok(real.includes('PP: 50 (52,08 %)')); // 50 / 96
  assert.ok(real.includes('PSOE: 30 (31,25 %)'));
  assert.ok(real.includes('Otros: 10 votos (10,42 %)'));
  assert.ok(real.includes('PPQ 8 · OP 2'), 'desglose compacto de las pequeñas');
  assert.ok(real.includes('Blancos: 6 (6,25 %)'));
  assert.ok(real.includes('Nulos: 4'));
  assert.ok(real.includes('*Total de votantes: 100*'));
  assert.ok(real.includes('(% sobre votos válidos: candidaturas + blancos)'));
  assert.equal(real.at(-1), 'Actualizado: 29/11/2026 21:30:00 (hora de Madrid)');
  assert.ok(!real.join('\n').includes('DEMO'));
  const demo = textoRecuento({ resumen, colegio: 'C', modo: 'DEMO', actualizado: 'x', tipoEleccion: 'E' }).split('\n');
  assert.equal(demo[0], '*** DEMO - DATOS DE PRUEBA, NO SON REALES ***');
  assert.equal(demo.at(-1), '*** DEMO - DATOS DE PRUEBA, NO SON REALES ***');
  const vacio = textoRecuento({ resumen: construirResumenRecuento({ mesas: MESAS, candidaturas: CAND, recuentos: new Map() }), colegio: 'C', modo: 'REAL', actualizado: 'x', tipoEleccion: 'E' });
  assert.match(vacio, /Todavía no hay mesas escrutadas\./);
});

test('desglose de «Otros»: de más a menos votos, empate por orden; el texto siempre lo lleva; sin pequeñas no hay «Otros»', () => {
  const cands = [
    ...CAND.slice(0, 2),
    { id: 3, nombre: 'Tres', siglas: 'TRES', orden: 3, destacada: 0, activa: 1, color: '#111111' },
    { id: 4, nombre: 'Cuatro', siglas: 'CUA', orden: 4, destacada: 0, activa: 1, color: '#222222' },
    { id: 5, nombre: 'Cinco', siglas: '', orden: 5, destacada: 0, activa: 1, color: '#333333' },
    { id: 6, nombre: 'Seis', siglas: 'SEI', orden: 6, destacada: 0, activa: 1, color: '#444444' },
  ];
  const recuentos = new Map([[1, rec(cab('cerrado', 2000, 0, 0), { 1: 700, 2: 500, 3: 5, 4: 1234, 5: 5, 6: 1556 })]]);
  const r = construirResumenRecuento({ mesas: MESAS, candidaturas: cands, recuentos });
  assert.deepEqual(r.otros.candidaturas.map((c) => c.cand.id), [6, 4, 3, 5], 'votos desc.; empate 3 y 5 por orden');
  assert.equal(r.otros.votos, 1234 + 1556 + 5 + 5);
  const texto = textoRecuento({ resumen: r, colegio: 'C', modo: 'REAL', actualizado: 'x', tipoEleccion: 'E' });
  assert.ok(texto.split('\n').includes('SEI 1.556 · CUA 1.234 · TRES 5 · Cinco 5'));

  const sinPequenas = construirResumenRecuento({ mesas: MESAS, candidaturas: CAND.slice(0, 2), recuentos });
  assert.equal(sinPequenas.otros, null);
  assert.doesNotMatch(textoRecuento({ resumen: sinPequenas, colegio: 'C', modo: 'REAL', actualizado: 'x', tipoEleccion: 'E' }), /Otros/);
});
