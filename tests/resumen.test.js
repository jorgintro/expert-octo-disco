import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VARIANTES, construirResumen, elegirVariante, textoWhatsApp } from '../src/resumen.js';

const MESAS = [
  { id: 1, codigo: '4-2-A', censo: 600 },
  { id: 2, codigo: '4-2-B', censo: 400 },
  { id: 3, codigo: '4-3-A', censo: 500 },
  { id: 4, codigo: '4-3-B', censo: 500 },
];
const CORTES = ['10:00', '12:00', '14:00'].map((hora, i) => ({ id: i + 1, hora }));
const fila = (mesa, corte, votantes, tipo = 'agente') => ({ mesa_id: mesa, corte_id: corte, votantes_acumulados: votantes, introducido_por_tipo: tipo, introducido_por_id: 1, actualizado_en: 'x' });
const FILAS = [fila(1, 1, 60), fila(1, 2, 120), fila(2, 1, 40), fila(2, 2, 100), fila(3, 1, 50)];

test('resumen: totales por corte, mesas informadas y % sobre el censo de las mesas informadas', () => {
  const r = construirResumen({ mesas: MESAS, cortes: CORTES, filas: FILAS });
  const [t1, t2, t3] = r.totales;
  assert.deepEqual([t1.informadas, t1.total, t1.faltan, t1.acumulado, t1.parcial, t1.censoInformado, t1.porcentaje], [3, 4, 1, 150, 150, 1500, 10]);
  assert.deepEqual([t2.informadas, t2.faltan, t2.acumulado, t2.parcial, t2.censoInformado, t2.porcentaje], [2, 2, 220, 120, 1000, 22]);
  assert.deepEqual([t3.informadas, t3.faltan, t3.acumulado, t3.porcentaje], [0, 4, 0, null]);
  assert.equal(r.indiceUltimo, 1);
  assert.deepEqual(r.indicesConDatos, [0, 1]);
  assert.equal(r.totalMesas, 4);
});

test('resumen: la celda lleva acumulado, parcial y % de la mesa', () => {
  const r = construirResumen({ mesas: MESAS, cortes: CORTES, filas: FILAS });
  const a = r.mesas[0].historial;
  assert.deepEqual([a[0].acumulado, a[0].parcial, a[0].porcentaje], [60, 60, 10]);
  assert.deepEqual([a[1].acumulado, a[1].parcial, a[1].porcentaje], [120, 60, 20]);
  assert.equal(a[2].vacio, true);
  assert.equal(r.mesas[3].historial.every((c) => c.vacio), true);
});

test('provisional mientras el último corte con datos no tenga todas las mesas; pendientes del último corte', () => {
  const r = construirResumen({ mesas: MESAS, cortes: CORTES, filas: FILAS });
  assert.equal(r.provisional, true);
  assert.deepEqual(r.pendientesUltimo, ['4-3-A', '4-3-B']);

  const completo = construirResumen({ mesas: MESAS, cortes: CORTES, filas: [...FILAS, fila(3, 2, 150), fila(4, 2, 100)] });
  assert.equal(completo.provisional, false);
  assert.deepEqual(completo.pendientesUltimo, []);
  assert.equal(completo.totales[1].porcentaje, 23.5); // (120+100+150+100) / (600+400+500+500)
});

test('un hueco en un corte anterior no impide que el resumen sea completo en el último', () => {
  // La mesa 4 no informó las 10:00 pero sí las 12:00: el último corte está completo.
  const filas = [fila(1, 1, 10), fila(2, 1, 10), fila(3, 1, 10), fila(1, 2, 20), fila(2, 2, 20), fila(3, 2, 20), fila(4, 2, 99)];
  const r = construirResumen({ mesas: MESAS, cortes: CORTES, filas });
  assert.equal(r.provisional, false);
  assert.equal(r.totales[0].faltan, 1);
  assert.equal(r.mesas[3].historial[1].parcial, 99, 'sin corte anterior, el parcial es el acumulado');
});

test('sin datos: provisional, sin último corte y todas las mesas pendientes', () => {
  const r = construirResumen({ mesas: MESAS, cortes: CORTES, filas: [] });
  assert.deepEqual([r.indiceUltimo, r.provisional, r.indicesConDatos], [-1, true, []]);
  assert.equal(r.pendientesUltimo.length, 4);
});

test('solo cuentan las mesas que se pasan (las de baja no) aunque haya datos suyos', () => {
  const r = construirResumen({ mesas: MESAS.slice(0, 2), cortes: CORTES, filas: [...FILAS, fila(99, 1, 500)] });
  assert.equal(r.totalMesas, 2);
  assert.equal(r.totales[0].acumulado, 100);
});

test('variantes: participación, último corte recuento y senado; una variante desconocida cae en participación', () => {
  assert.deepEqual(VARIANTES.map((v) => [v.id, v.disponible]), [['participacion', true], ['ultimo', true], ['recuento', true], ['senado', true]]);
  assert.equal(elegirVariante('ultimo').id, 'ultimo');
  assert.equal(elegirVariante('recuento').id, 'recuento');
  assert.equal(elegirVariante('senado').id, 'senado');
  assert.equal(elegirVariante('x').id, 'participacion');
  assert.equal(elegirVariante(undefined).id, 'participacion');
});

const texto = (variante, modo = 'REAL', filas = FILAS) =>
  textoWhatsApp({ resumen: construirResumen({ mesas: MESAS, cortes: CORTES, filas }), variante, colegio: 'Colegio Dulcinea', modo, actualizado: '20/10/2026 12:34:56' });

test('texto WhatsApp, participación: una línea por mesa, total por corte con mesas informadas y aviso de provisional', () => {
  const t = texto('participacion');
  const lineas = t.split('\n');
  assert.equal(lineas[0], '*Colegio Dulcinea · Elecciones Generales*');
  assert.ok(lineas.includes('Participación acumulada — PROVISIONAL (2/4 mesas)'));
  assert.ok(lineas.includes('Cortes: 10:00 → 12:00'));
  assert.ok(lineas.includes('4-2-A: 60 → 120 · 20,0 %'));
  assert.ok(lineas.includes('4-3-A: 50 → – · 10,0 %'));
  assert.ok(lineas.includes('4-3-B: sin datos'));
  assert.ok(lineas.includes('*TOTAL por corte:*'));
  assert.ok(lineas.includes('10:00: 150 (3/4 mesas) · 10,0 %'));
  assert.ok(lineas.includes('12:00: 220 (2/4 mesas) · 22,0 %'));
  assert.ok(lineas.includes('(% del total sobre el censo de las mesas informadas)'));
  assert.equal(lineas.at(-1), 'Actualizado: 20/10/2026 12:34:56 (hora de Madrid)');
  assert.ok(!t.includes('DEMO'));
});

test('texto WhatsApp, último corte: acumulado, parcial y % por mesa y total', () => {
  const lineas = texto('ultimo').split('\n');
  assert.ok(lineas.includes('Participación a las 12:00 — PROVISIONAL (2/4 mesas)'));
  assert.ok(lineas.includes('4-2-A: 120 (+60) · 20,0 %'));
  assert.ok(lineas.includes('4-2-B: 100 (+60) · 25,0 %'));
  assert.ok(lineas.includes('4-3-A: sin dato'));
  assert.ok(lineas.includes('*TOTAL: 220 (+120) · 22,0 %*'));
});

test('texto WhatsApp: completo no dice provisional; sin datos lo indica', () => {
  const completo = texto('ultimo', 'REAL', [...FILAS, fila(3, 2, 150), fila(4, 2, 100)]);
  assert.match(completo, /COMPLETO \(4\/4 mesas\)/);
  assert.ok(!completo.includes('PROVISIONAL'));
  assert.match(texto('participacion', 'REAL', []), /Todavía no hay datos de participación\./);
});

test('texto WhatsApp en DEMO: marca inconfundible al principio y al final; en REAL, ninguna', () => {
  for (const variante of ['participacion', 'ultimo']) {
    const lineas = texto(variante, 'DEMO').split('\n');
    assert.equal(lineas[0], '*** DEMO - DATOS DE PRUEBA, NO SON REALES ***', variante);
    assert.equal(lineas.at(-1), '*** DEMO - DATOS DE PRUEBA, NO SON REALES ***', variante);
    assert.ok(!texto(variante, 'REAL').includes('DEMO'), variante);
  }
  assert.match(texto('ultimo', 'DEMO', []), /DEMO - DATOS DE PRUEBA/);
});
