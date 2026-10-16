import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CELDAS, agruparEnListas, aplicarPapeleta, claveLista, clasificarPapeleta, construirResumenSenado, contadoresVacios, leerEntradaSenado,
  porcentajeSenado, totalesContadores, validarSenado,
} from '../src/senado.js';

// Candidatos: lista PP (1,2,3), lista PSOE (4,5,6), agrupación (7,8), suelto (9).
const CAND = [
  { id: 1, nombre: 'A1', orden: 1, activo: 1, candidatura_id: 10, partido_siglas: 'PP' },
  { id: 2, nombre: 'A2', orden: 2, activo: 1, candidatura_id: 10, partido_siglas: 'PP' },
  { id: 3, nombre: 'A3', orden: 3, activo: 1, candidatura_id: 10, partido_siglas: 'PP' },
  { id: 4, nombre: 'B1', orden: 4, activo: 1, candidatura_id: 11, partido_siglas: 'PSOE' },
  { id: 5, nombre: 'B2', orden: 5, activo: 1, candidatura_id: 11, partido_siglas: 'PSOE' },
  { id: 6, nombre: 'B3', orden: 6, activo: 1, candidatura_id: 11, partido_siglas: 'PSOE' },
  { id: 7, nombre: 'C1', orden: 7, activo: 1, candidatura_id: null, agrupacion: 'Cívica' },
  { id: 8, nombre: 'C2', orden: 8, activo: 1, candidatura_id: null, agrupacion: ' cívica ' },
  { id: 9, nombre: 'D1', orden: 9, activo: 1, candidatura_id: null, agrupacion: '' },
];
const grupoDe = (id) => claveLista(CAND.find((c) => c.id === Number(id)));
const IDS = CAND.map((c) => c.id);

// ---------- Reglas de la papeleta ----------
test('papeleta: sin marcas = blanca; hasta 3 = válida; más de 3 = nula', () => {
  assert.deepEqual(clasificarPapeleta([], grupoDe), { tipo: 'blanca' });
  assert.equal(clasificarPapeleta([1], grupoDe).tipo, 'valida');
  assert.equal(clasificarPapeleta([1, 2, 3], grupoDe).marcas, 3);
  assert.deepEqual(clasificarPapeleta([1, 2, 3, 4], grupoDe), { tipo: 'nula' });
  assert.deepEqual(clasificarPapeleta([1, 2, 3, 4, 5, 6], grupoDe), { tipo: 'nula' });
  assert.equal(clasificarPapeleta([1, 1, 2], grupoDe).marcas, 2, 'una marca repetida cuenta una vez');
});

test('papeleta: «mismo partido» (1 marca siempre sí; partidos, agrupaciones y sueltos distinguidos)', () => {
  assert.equal(clasificarPapeleta([4], grupoDe).misma, true);
  assert.equal(clasificarPapeleta([1, 2], grupoDe).misma, true);
  assert.equal(clasificarPapeleta([1, 2, 3], grupoDe).misma, true);
  assert.equal(clasificarPapeleta([1, 4], grupoDe).misma, false);
  assert.equal(clasificarPapeleta([1, 2, 4], grupoDe).misma, false);
  assert.equal(clasificarPapeleta([7, 8], grupoDe).misma, true, 'misma agrupación (sin distinguir mayúsculas ni espacios)');
  assert.equal(clasificarPapeleta([7, 9], grupoDe).misma, false);
  assert.equal(clasificarPapeleta([9], grupoDe).misma, true);
});

test('contadores: cada papeleta suma en candidatos y en la celda (marcas, mismo partido); blancas y nulas aparte', () => {
  let c = contadoresVacios(IDS);
  c = aplicarPapeleta(c, clasificarPapeleta([1, 2, 3], grupoDe));
  c = aplicarPapeleta(c, clasificarPapeleta([1, 4], grupoDe));
  c = aplicarPapeleta(c, clasificarPapeleta([4], grupoDe));
  c = aplicarPapeleta(c, clasificarPapeleta([], grupoDe));
  c = aplicarPapeleta(c, clasificarPapeleta([1, 2, 3, 4], grupoDe));
  assert.deepEqual([c.votos[1], c.votos[2], c.votos[3], c.votos[4]], [2, 1, 1, 2]);
  assert.deepEqual(c.matriz, { '1:1': 1, '2:0': 1, '2:1': 0, '3:0': 0, '3:1': 1 });
  assert.deepEqual([c.blancas, c.nulas], [1, 1]);
  const t = totalesContadores(c);
  assert.deepEqual([t.validas, t.marcas, t.votosCandidatos, t.contadas], [3, 6, 6, 5]);
  assert.equal(t.marcas, t.votosCandidatos, 'las marcas por papeleta coinciden con los votos de los candidatos');
});

test('deshacer = aplicar la inversa de la última papeleta; no deja contadores negativos', () => {
  const base = contadoresVacios(IDS);
  const p = clasificarPapeleta([1, 5], grupoDe);
  const tras = aplicarPapeleta(base, p);
  assert.deepEqual(aplicarPapeleta(tras, p, -1), base);
  assert.deepEqual(aplicarPapeleta(aplicarPapeleta(base, { tipo: 'nula' }), { tipo: 'nula' }, -1), base);
  assert.equal(aplicarPapeleta(base, p, -1), null, 'no se puede deshacer lo que no está contado');
  assert.equal(aplicarPapeleta(base, { tipo: 'blanca' }, -1), null);
  assert.deepEqual(tras.votos, { ...base.votos, 1: 1, 5: 1 }, 'aplicar no muta el original');
});

// ---------- Listas ----------
test('listas: por partido, por agrupación (mismo texto) o sueltas; en el orden de su primer candidato', () => {
  const listas = agruparEnListas([...CAND].reverse());
  assert.deepEqual(listas.map((l) => [l.nombre, l.candidatos.map((c) => c.id)]), [
    ['PP', [1, 2, 3]], ['PSOE', [4, 5, 6]], ['Cívica', [7, 8]], ['D1', [9]],
  ]);
});

// ---------- Lectura y validación ----------
const ent = (extra = {}) => ({ modo: 'totales', validas: '', blancas: '', nulas: '', votos: {}, matriz: {}, ...extra });
const votosTxt = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, String(v)]));

test('lectura: formato estricto de cifras; «sin rellenar» en totales y 0 en sábana', () => {
  const t = leerEntradaSenado(ent({ validas: '10', blancas: '', votos: votosTxt({ 1: 4, 2: '' }) }), [1, 2]);
  assert.deepEqual([t.valores.validas, t.valores.blancas, t.valores.votos.get(1), t.valores.votos.get(2)], [10, null, 4, null]);
  assert.equal(t.valores.matriz, null);
  const malo = leerEntradaSenado(ent({ validas: '1,5', votos: votosTxt({ 1: '-2' }) }), [1], new Map([[1, 'A1']]));
  assert.equal(malo.errores.length, 2);
  assert.match(malo.errores.join(' '), /A1: solo cifras/);
  const s = leerEntradaSenado({ modo: 'sabana', votos: { 1: '2' }, matriz: { '1:1': '1', '2:1': '1' } }, [1, 2]);
  assert.deepEqual([s.valores.validas, s.valores.votos.get(2), s.valores.blancas, s.valores.matriz.get('3:0')], [2, 0, 0, 0]);
  assert.match(leerEntradaSenado({ modo: 'x' }, []).errores[0], /Modo de recuento no válido/);
});

const valida = (entrada, opciones = {}) => {
  const { valores, errores: ef } = leerEntradaSenado(entrada, IDS);
  assert.deepEqual(ef, []);
  return validarSenado({ valores, censo: 500, listas: agruparEnListas(CAND), cerrar: true, etiquetas: new Map(CAND.map((c) => [c.id, c.nombre])), ...opciones });
};
const TOT = (validas, blancas, nulas, votos) => ent({ validas: String(validas), blancas: String(blancas), nulas: String(nulas), votos: votosTxt(Object.fromEntries(IDS.map((id) => [id, votos[id] ?? 0]))) });

test('validación (totales): el cierre exige todo relleno y marcas entre 1× y 3× las válidas', () => {
  assert.deepEqual(valida(TOT(10, 2, 1, { 1: 8, 2: 7, 4: 9 })).errores, []); // suma 24 ∈ [10,30]
  assert.match(valida(ent({ validas: '10' })).errores[0], /hay que rellenar todo.*Faltan/);
  assert.match(valida(TOT(10, 0, 0, { 1: 3, 2: 3 })).errores[0], /entre las papeletas válidas \(10\) y 3 veces/);   // suma 6 < 10
  assert.match(valida(TOT(10, 0, 0, { 1: 10, 2: 10, 4: 10, 5: 1 })).errores.join(' '), /entre las papeletas válidas/); // suma 31 > 30
  const borde = valida(TOT(10, 0, 0, { 1: 10, 2: 10, 4: 10 }));
  assert.deepEqual(borde.errores, [], 'justo 3× es válido');
  assert.deepEqual(valida(TOT(10, 0, 0, { 1: 10 })).errores, [], 'justo 1× es válido');
});

test('validación: ningún candidato supera las válidas; válidas+blancas+nulas ≤ censo (también en borrador)', () => {
  assert.match(valida(TOT(10, 0, 0, { 1: 11, 2: 10, 3: 10 })).errores.join(' '), /A1 tiene más votos \(11\) que papeletas válidas \(10\)/);
  assert.match(valida(TOT(400, 100, 1, { 1: 400 })).errores[0], /papeletas contadas \(501.*censo de la mesa \(500\)/);
  const { valores } = leerEntradaSenado(ent({ validas: '480', blancas: '30' }), IDS);
  const borrador = validarSenado({ valores, censo: 500, cerrar: false, listas: [] });
  assert.match(borrador.errores[0], /no pueden superar el censo/, 'el censo bloquea también el borrador');
  const parcial = leerEntradaSenado(ent({ validas: '10' }), IDS).valores;
  assert.deepEqual(validarSenado({ valores: parcial, censo: 500, cerrar: false, listas: [] }).errores, [], 'un borrador parcial no exige nada más');
});

const SAB = (matriz, votos, blancas = 0, nulas = 0) => ({ modo: 'sabana', blancas: String(blancas), nulas: String(nulas), votos: votosTxt(votos), matriz: votosTxt(matriz) });

test('validación (sábana): coherencia marcas/votos comprobada en servidor y «mismo partido» imposible', () => {
  // 3 papeletas: una de 3 marcas del PP, una de 2 marcas mixtas, una de 1 marca → votos 6.
  const ok = valida(SAB({ '3:1': 1, '2:0': 1, '1:1': 1 }, { 1: 2, 2: 1, 3: 1, 4: 1, 5: 1 }, 2, 1));
  assert.deepEqual(ok.errores, []);
  assert.equal(ok.contadas, 6);
  const mal = valida(SAB({ '3:1': 1 }, { 1: 1, 2: 1 })); // marcas 3 ≠ votos 2
  assert.match(mal.errores[0], /marcas por papeleta \(3\) no coinciden con la suma de votos de los candidatos \(2\)/);
  const imposible = valida(SAB({ '3:1': 1 }, { 1: 1, 2: 1, 3: 1 }), { listas: agruparEnListas(CAND.filter((c) => c.id >= 7)) });
  assert.match(imposible.errores.join(' '), /ningún partido tiene 3 candidatos/);
  assert.match(valida(SAB({ '1:1': 1 }, { 1: 2 })).errores.join(' '), /no coinciden|tiene más votos/);
});

test('avisos (no bloquean): difiere del total de votantes del Congreso o de la última participación', () => {
  const t = TOT(10, 2, 1, { 1: 10, 2: 10 });
  assert.deepEqual(valida(t, { votantesCongreso: 13, ultimaPart: { valor: 13, hora: '20:00' } }).avisos, []);
  const a = valida(t, { votantesCongreso: 14, ultimaPart: { valor: 15, hora: '20:00' } });
  assert.deepEqual(a.errores, []);
  assert.equal(a.avisos.length, 2);
  assert.match(a.avisos[0], /Senado \(13\) difieren del total de votantes del Congreso.*\(14\)/);
  assert.match(a.avisos[1], /última participación informada \(15, de las 20:00\)/);
});

// ---------- Resumen ----------
const rec = (cab, votos = {}, matriz = {}) => ({ cab, votos: new Map(Object.entries(votos).map(([k, v]) => [Number(k), v])), matriz: new Map(Object.entries(matriz)) });
const cab = (estado, validas, blancas, nulas, modo = 'totales') => ({ estado, validas, blancas, nulas, modo });

test('resumen: solo suman las mesas CERRADAS; % sobre papeletas válidas; partidos; ranking con desempate por orden', () => {
  const mesas = [{ id: 1, codigo: 'A', censo: 500 }, { id: 2, codigo: 'B', censo: 500 }, { id: 3, codigo: 'C', censo: 500 }];
  const registros = new Map([
    [1, rec(cab('cerrado', 100, 5, 2), { 1: 60, 2: 60, 3: 20, 4: 50, 7: 50 })],
    [2, rec(cab('cerrado', 50, 1, 1), { 1: 30, 2: 10, 4: 30, 5: 50 })],
    [3, rec(cab('borrador', 999, 9, 9), { 1: 999 })],
  ]);
  const r = construirResumenSenado({ mesas, candidatos: CAND, registros });
  assert.deepEqual([r.cerradas, r.borradores, r.sinIniciar, r.provisional], [2, 1, 0, true]);
  assert.deepEqual([r.validas, r.blancas, r.nulas, r.contadas], [150, 6, 3, 159]);
  const votos = Object.fromEntries(r.candidatos.map((c) => [c.cand.id, c.votos]));
  assert.deepEqual([votos[1], votos[2], votos[4], votos[5], votos[7], votos[9]], [90, 70, 80, 50, 50, 0]);
  assert.equal(r.candidatos.find((c) => c.cand.id === 1).porcentaje, 60); // 90 / 150
  assert.deepEqual(r.ranking.slice(0, 4).map((c) => c.cand.id), [1, 4, 2, 5], 'votos desc.; empate (5 y 7: 50) por orden');
  assert.equal(r.ranking[3].cand.id, 5);
  const pp = r.partidos.find((p) => p.nombre === 'PP');
  assert.deepEqual([pp.votos, pp.porcentaje], [90 + 70 + 20, 120]);
  assert.equal(porcentajeSenado(1, 0), null);
});

test('resumen: un candidato inactivo solo aparece si tiene votos', () => {
  const cands = [...CAND.slice(0, 2), { ...CAND[2], activo: 0 }];
  const mesas = [{ id: 1, codigo: 'A', censo: 500 }];
  const sin = construirResumenSenado({ mesas, candidatos: cands, registros: new Map() });
  assert.deepEqual(sin.candidatos.map((c) => c.cand.id), [1, 2]);
  const con = construirResumenSenado({ mesas, candidatos: cands, registros: new Map([[1, rec(cab('cerrado', 10, 0, 0), { 3: 4 })]]) });
  assert.deepEqual(con.candidatos.map((c) => c.cand.id), [1, 2, 3]);
  assert.equal(CELDAS.length, 5);
});
