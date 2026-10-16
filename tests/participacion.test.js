import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  construirHistorial, corteActual, corteHaLlegado, formatoPorcentaje, leerNumero, porcentajeSobreCenso, validarParticipacion,
} from '../src/participacion.js';
import { horaMadrid } from '../src/tiempo.js';

const CORTES = ['10:00', '12:00', '14:00', '16:00', '18:00', '20:00'].map((hora, i) => ({ id: i + 1, hora, orden: i + 1 }));
const validar = (valor, corteId, existentes = {}, censo = 600) =>
  validarParticipacion({ valor, censo, cortes: CORTES, corteId, valores: new Map(Object.entries(existentes).map(([k, v]) => [Number(k), v])) });

test('leerNumero acepta enteros >= 0 y rechaza el resto', () => {
  for (const [texto, valor] of [['0', 0], ['123', 123], [' 45 ', 45], ['0007', 7]]) {
    assert.deepEqual(leerNumero(texto), { ok: true, valor });
  }
  for (const malo of ['', '   ', '-1', '1.5', '1,5', 'abc', '1e3', '12 3', '+5', '12345678', null, undefined]) {
    assert.equal(leerNumero(malo).ok, false, JSON.stringify(malo));
  }
});

test('validación: acumulado <= censo', () => {
  assert.deepEqual(validar(600, 1).errores, []);
  assert.match(validar(601, 1).errores[0], /superar el censo de la mesa \(600\)/);
});

test('validación: no baja respecto al corte anterior ni supera el siguiente ya introducido', () => {
  const existentes = { 1: 100, 3: 300 }; // 10:00 y 14:00
  assert.deepEqual(validar(200, 2, existentes).errores, []);
  assert.deepEqual(validar(100, 2, existentes).errores, [], 'igual al anterior vale');
  assert.deepEqual(validar(300, 2, existentes).errores, [], 'igual al siguiente vale');
  assert.match(validar(99, 2, existentes).errores[0], /menor que el acumulado de las 10:00 \(100\)/);
  assert.match(validar(301, 2, existentes).errores[0], /mayor que el acumulado de las 14:00 \(300\)/);
  // Con huecos: compara con el más cercano que sí está introducido
  assert.match(validar(50, 4, { 1: 100 }).errores[0], /10:00 \(100\)/);
  assert.match(validar(500, 1, { 6: 400 }).errores[0], /20:00 \(400\)/);
  assert.equal(validar(500, 1, { 1: 10, 6: 400 }).errores.length, 1, 'el propio corte no cuenta como vecino');
});

test('salto de más del 25 % del censo en un tramo: aviso, no error', () => {
  assert.deepEqual(validar(150, 1).avisos, [], 'exactamente el 25 % no avisa');
  const r = validar(151, 1);
  assert.deepEqual(r.errores, []);
  assert.equal(r.avisos.length, 1);
  assert.match(r.avisos[0], /151 votantes.*25 %.*600/);
  // El tramo se mide contra el último corte anterior introducido
  assert.deepEqual(validar(400, 3, { 2: 250 }).avisos, []);
  assert.equal(validar(401, 3, { 2: 250 }).avisos.length, 1);
  assert.equal(validar(401, 4, { 1: 250 }).avisos.length, 1, '401-250=151 supera el 25 % de 600 (150): avisa');
  assert.equal(validar(400, 4, { 1: 250 }).avisos.length, 0, '400-250=150 es justo el 25 %: no avisa');
});

test('el parcial se calcula contra el corte anterior introducido (o 0)', () => {
  assert.equal(validar(80, 1).parcial, 80);
  assert.equal(validar(230, 2, { 1: 80 }).parcial, 150);
  assert.equal(validar(230, 4, { 1: 80 }).parcial, 150);
});

test('censo 0: solo vale 0 y nunca avisa de salto', () => {
  assert.deepEqual(validar(0, 1, {}, 0).errores, []);
  assert.equal(validar(1, 1, {}, 0).errores.length, 1);
  assert.deepEqual(validar(0, 1, {}, 0).avisos, []);
});

test('corte actual: el más reciente cuya hora ya pasó, o el primero antes de las 10:00', () => {
  const casos = [['00:00', '10:00'], ['09:59', '10:00'], ['10:00', '10:00'], ['11:59', '10:00'], ['12:00', '12:00'],
    ['13:59', '12:00'], ['19:59', '18:00'], ['20:00', '20:00'], ['23:59', '20:00']];
  for (const [ahora, esperado] of casos) assert.equal(corteActual(CORTES, ahora).hora, esperado, ahora);
  assert.equal(corteHaLlegado(CORTES[2], '13:59'), false);
  assert.equal(corteHaLlegado(CORTES[2], '14:00'), true);
});

test('hora de Madrid para comparar con los cortes', () => {
  assert.equal(horaMadrid(Date.parse('2026-10-20T10:00:00Z')), '12:00'); // CEST
  assert.equal(horaMadrid(Date.parse('2026-11-29T08:59:00Z')), '09:59'); // CET
});

test('histórico: acumulado, parcial y % sobre censo, con huecos', () => {
  const filas = [
    { corte_id: 1, votantes_acumulados: 100, introducido_por_tipo: 'agente', introducido_por_id: 1, actualizado_en: 'x' },
    { corte_id: 3, votantes_acumulados: 250, introducido_por_tipo: 'admin', introducido_por_id: 1, actualizado_en: 'y' },
  ];
  const h = construirHistorial({ cortes: CORTES, filas, censo: 615 });
  assert.equal(h.length, 6);
  assert.deepEqual([h[0].acumulado, h[0].parcial, h[0].porcentaje, h[0].tipo], [100, 100, 16.3, 'agente']);
  assert.equal(h[1].vacio, true);
  assert.deepEqual([h[2].acumulado, h[2].parcial, h[2].tipo], [250, 150, 'admin']);
  assert.equal(h[5].vacio, true);
  assert.equal(formatoPorcentaje(16.3), '16,3 %');
  assert.equal(formatoPorcentaje(100), '100,0 %');
  assert.equal(formatoPorcentaje(null), '—');
  assert.equal(porcentajeSobreCenso(5, 0), null);
});
