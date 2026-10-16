import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO, REAL, modoEfectivo } from '../src/modo.js';
import { esFechaValida, fechaLarga, fechaMadrid, formatearMadrid } from '../src/tiempo.js';

const FECHA = '2026-11-29';
const ms = (iso) => Date.parse(iso);
// 00:00 del 29-nov-2026 en Madrid (CET, UTC+1) = 23:00Z del día 28.
const PRIMER_INSTANTE = '2026-11-28T23:00:00Z';
const efectivo = (ahora, override = null) => modoEfectivo({ ahora: ms(ahora), fechaElecciones: FECHA, override });

test('zona horaria: fechaMadrid y formatearMadrid', () => {
  assert.equal(fechaMadrid(ms('2026-11-28T22:59:59Z')), '2026-11-28');
  assert.equal(fechaMadrid(ms(PRIMER_INSTANTE)), '2026-11-29');
  assert.equal(fechaMadrid(ms('2026-07-01T22:00:00Z')), '2026-07-02', 'en verano Madrid va 2 h por delante');
  assert.equal(formatearMadrid('2026-10-20T10:00:00Z'), '20/10/2026 12:00:00');
  assert.equal(fechaLarga('2026-11-29'), '29/11/2026');
  assert.equal(esFechaValida('2026-02-28'), true);
  assert.equal(esFechaValida('2026-02-30'), false);
});

test('automático: DEMO antes de la fecha, REAL desde las 00:00 de Madrid del día', () => {
  assert.equal(efectivo('2026-10-16T08:00:00Z').modo, DEMO);
  assert.equal(efectivo('2026-11-28T22:59:59Z').modo, DEMO, 'un segundo antes');
  assert.equal(efectivo(PRIMER_INSTANTE).modo, REAL, 'a las 00:00 en punto');
  assert.equal(efectivo('2026-11-29T12:00:00Z').modo, REAL, 'el día');
  assert.equal(efectivo('2026-12-15T12:00:00Z').modo, REAL, 'después');
  const e = efectivo('2026-10-16T08:00:00Z');
  assert.equal(e.origen, 'automatico');
  assert.equal(e.diaDeElecciones, false);
  assert.equal(efectivo(PRIMER_INSTANTE).diaDeElecciones, true);
});

test('override manual antes de la fecha: manda sobre el automático', () => {
  const real = efectivo('2026-10-20T10:00:00Z', { modo: REAL, fijado_en: '2026-10-19T10:00:00Z' });
  assert.deepEqual([real.modo, real.origen, real.overrideCaducado], [REAL, 'manual', false]);
  const demo = efectivo('2026-11-28T22:59:59Z', { modo: DEMO, fijado_en: '2026-10-19T10:00:00Z' });
  assert.deepEqual([demo.modo, demo.origen], [DEMO, 'manual']);
});

test('al llegar el día se anula el override fijado antes, sea DEMO o REAL', () => {
  for (const modo of [DEMO, REAL]) {
    const e = efectivo(PRIMER_INSTANTE, { modo, fijado_en: '2026-11-28T22:59:59Z' });
    assert.deepEqual([e.modo, e.origen, e.overrideCaducado], [REAL, 'automatico', true], modo);
  }
  const despues = efectivo('2026-12-02T10:00:00Z', { modo: DEMO, fijado_en: '2026-11-01T10:00:00Z' });
  assert.deepEqual([despues.modo, despues.overrideCaducado], [REAL, true]);
});

test('un override fijado el día de las elecciones o después sí se respeta', () => {
  const e = efectivo('2026-11-29T15:00:00Z', { modo: DEMO, fijado_en: PRIMER_INSTANTE });
  assert.deepEqual([e.modo, e.origen, e.overrideCaducado], [DEMO, 'manual', false]);
  const luego = efectivo('2026-12-05T10:00:00Z', { modo: DEMO, fijado_en: '2026-11-29T15:00:00Z' });
  assert.deepEqual([luego.modo, luego.origen], [DEMO, 'manual']);
});
