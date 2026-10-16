import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { cargarKit, directorioContenido, kitParaRol, validarContenido } from '../src/kit.js';
import { raiz } from '../src/version.js';
import { crearAgente, crearDirectorioTemporal, crearEntorno, get, getAgente, loginAdmin, loginAgente } from './ayuda.js';

const CHECK = {
  fases: [
    { id: 'abrir', titulo: 'Abrir', puntos: [
      { id: 'a1', texto: 'Punto libre de la fase' },
      { id: 'a2', texto: '[VERIFICAR] Punto de norma SECRETO-A', verificar: true },
      { id: 'a3', texto: 'Solo para el apoderado', solo: 'apoderado' },
    ] },
    { id: 'solo-pendiente', titulo: 'Fase pendiente', puntos: [{ id: 'b1', texto: '[VERIFICAR] FaseSECRETO-B', verificar: true }] },
  ],
};
const GUIA = {
  secciones: [
    { id: 'g1', titulo: 'Guía libre', intro: 'Intro visible', puntos: [{ texto: 'Consejo libre' }, { texto: '[VERIFICAR] Consejo SECRETO-C', verificar: true }] },
    { id: 'g2', titulo: 'Sección pendiente', puntos: [{ texto: '[VERIFICAR] SeccionSECRETO-D', verificar: true }] },
  ],
};
const SECRETOS = ['SECRETO-A', 'SECRETO-B', 'SECRETO-C', 'SECRETO-D'];

function dirContenido(checklist = CHECK, guia = GUIA) {
  const d = crearDirectorioTemporal();
  mkdirSync(d, { recursive: true });
  writeFileSync(path.join(d, 'checklist.json'), typeof checklist === 'string' ? checklist : JSON.stringify(checklist));
  writeFileSync(path.join(d, 'guia.json'), typeof guia === 'string' ? guia : JSON.stringify(guia));
  return d;
}
const clon = (o) => JSON.parse(JSON.stringify(o));
const errores = (checklist, guia = GUIA) => validarContenido({ checklist, guia });

// ---------------- Validación del contenido ----------------

test('el contenido real de content/ es válido y se carga', () => {
  const kit = cargarKit(directorioContenido({}));
  assert.ok(kit.fases.length >= 6);
  assert.ok(kit.secciones.length >= 4);
  for (const f of kit.fases) for (const p of f.puntos) assert.ok(p.id && p.texto);
});

test('en el contenido real, todo punto con [VERIFICAR] lleva la bandera y viceversa (nada se escapa a un agente)', () => {
  const kit = cargarKit(directorioContenido({}));
  const todos = [...kit.fases, ...kit.secciones].flatMap((g) => g.puntos);
  assert.ok(todos.some((p) => p.verificar), 'debe haber puntos pendientes de verificar');
  for (const p of todos) assert.equal(p.texto.includes('[VERIFICAR]'), p.verificar);
  const crudo = readFileSync(path.join(raiz, 'content', 'checklist.json'), 'utf8') + readFileSync(path.join(raiz, 'content', 'guia.json'), 'utf8');
  assert.equal((crudo.match(/\[VERIFICAR\]/g) ?? []).length, todos.filter((p) => p.verificar).length);
  const paraAgente = JSON.stringify(kitParaRol(kit, false));
  assert.ok(!paraAgente.includes('VERIFICAR'));
});

test('contenido válido de prueba: sin errores', () => {
  assert.deepEqual(errores(CHECK), []);
});

test('validación: JSON roto, archivo ausente y estructura incorrecta impiden cargar, con mensaje claro', () => {
  assert.throws(() => cargarKit(dirContenido('{ no es json')), /no es un JSON válido/);
  assert.throws(() => cargarKit(path.join(crearDirectorioTemporal(), 'no-existe')), /no se puede leer/);
  assert.throws(() => cargarKit(dirContenido({ fases: [] })), /al menos un elemento/);
  assert.ok(errores([]).some((e) => /checklist\.json: debe ser un objeto/.test(e)));
  assert.ok(validarContenido({ checklist: CHECK, guia: [] }).some((e) => /guia\.json: debe ser un objeto/.test(e)));
});

test('validación: ids repetidos o inválidos, textos vacíos o largos, claves desconocidas y «solo» incorrecto', () => {
  const c = clon(CHECK);
  c.fases[0].puntos[1].id = 'a1';
  assert.ok(errores(c).some((e) => /«a1» está repetido/.test(e)));
  const d = clon(CHECK);
  d.fases[0].puntos[0].id = 'Mal Id';
  assert.ok(errores(d).some((e) => /identificador debe ser minúsculas/.test(e)));
  const e = clon(CHECK);
  e.fases[0].puntos[0].texto = '   ';
  assert.ok(errores(e).some((x) => /texto no vacío/.test(x)));
  const f = clon(CHECK);
  f.fases[0].puntos[0].texto = 'x'.repeat(501);
  assert.ok(errores(f).some((x) => /supera los 500/.test(x)));
  const g = clon(CHECK);
  g.fases[0].puntos[0].extra = 1;
  assert.ok(errores(g).some((x) => /clave desconocida «extra»/.test(x)));
  const h = clon(CHECK);
  h.fases[0].puntos[0].solo = 'fiscal';
  assert.ok(errores(h).some((x) => /apoderado.*interventor/.test(x)));
  const i = clon(CHECK);
  i.fases[0].puntos = [];
  assert.ok(errores(i).some((x) => /al menos un punto/.test(x)));
  const j = clon(CHECK);
  j.fases[0].titulo = '';
  assert.ok(errores(j).some((x) => /titulo/.test(x)));
});

test('validación: un texto con [VERIFICAR] sin la bandera (o al revés) se rechaza para que no llegue a un agente', () => {
  const sinBandera = clon(CHECK);
  delete sinBandera.fases[0].puntos[1].verificar;
  assert.ok(errores(sinBandera).some((e) => /falta "verificar": true/.test(e)));
  const sinMarca = clon(CHECK);
  sinMarca.fases[0].puntos[1].texto = 'Sin la marca';
  assert.ok(errores(sinMarca).some((e) => /no lleva \[VERIFICAR\]/.test(e)));
  const guiaMala = clon(GUIA);
  delete guiaMala.secciones[0].puntos[1].verificar;
  assert.ok(errores(CHECK, guiaMala).some((e) => /falta "verificar": true/.test(e)));
  const noBooleana = clon(CHECK);
  noBooleana.fases[0].puntos[1].verificar = 'si';
  assert.ok(errores(noBooleana).some((e) => /true o false/.test(e)));
});

test('la app no arranca con contenido inválido', async () => {
  await assert.rejects(() => crearEntorno({ configExtra: { contentDir: dirContenido('{ roto') } }), /no es un JSON válido/);
});

// ---------------- Filtro por rol ----------------

test('kitParaRol: el agente no recibe los puntos pendientes ni las fases y secciones que quedan vacías; el administrador, todo', () => {
  const kit = cargarKit(dirContenido());
  const agente = kitParaRol(kit, false);
  assert.deepEqual(agente.fases.map((f) => f.id), ['abrir']);
  assert.deepEqual(agente.fases[0].puntos.map((p) => p.id), ['a1', 'a3']);
  assert.deepEqual(agente.secciones.map((s) => s.id), ['g1']);
  assert.equal(agente.secciones[0].puntos.length, 1);
  const admin = kitParaRol(kit, true);
  assert.equal(admin.fases.length, 2);
  assert.equal(admin.fases[0].puntos.length, 3);
  assert.equal(admin.secciones.length, 2);
});

// ---------------- Rutas: permisos y renderizado ----------------

async function montar() {
  const e = await crearEntorno({ configExtra: { contentDir: dirContenido() } });
  const agente = crearAgente(e.db, { nombre: 'Ana' });
  const sesion = await loginAgente(e.app, agente.pin);
  const admin = await loginAdmin(e.app);
  return { ...e, agente, sesionAgente: sesion, admin };
}

test('permisos: sin sesión no se accede al kit; el agente no entra en /admin/kit; el administrador no usa /agente/kit', async () => {
  const e = await montar();
  const a = await getAgente(e.app, '/agente/kit');
  assert.equal(a.statusCode, 302);
  assert.equal(a.headers.location, '/');
  const b = await get(e.app, '/admin/kit');
  assert.equal(b.statusCode, 302);
  assert.equal(b.headers.location, '/admin/login');
  const c = await e.app.inject({ method: 'GET', url: '/admin/kit', headers: { cookie: `sid=${e.sesionAgente.cookie}` } });
  assert.ok([302, 403].includes(c.statusCode));
  const d = await getAgente(e.app, '/agente/kit', e.admin.cookie);
  assert.equal(d.statusCode, 302);
  // el contenido no se sirve como archivo estático
  assert.equal((await get(e.app, '/content/checklist.json')).statusCode, 404);
  assert.equal((await get(e.app, '/checklist.json')).statusCode, 404);
});

test('el agente ve el kit sin ningún punto [VERIFICAR] (ni en el HTML), con banner de modo y su clave de dispositivo', async () => {
  const e = await montar();
  const r = await getAgente(e.app, '/agente/kit', e.sesionAgente.cookie);
  assert.equal(r.statusCode, 200);
  assert.match(r.headers['content-type'], /text\/html/);
  assert.ok(r.body.includes('Punto libre de la fase'));
  assert.ok(r.body.includes('Consejo libre'));
  assert.ok(r.body.includes('Solo apoderado'));
  assert.ok(r.body.includes('Intro visible'));
  for (const s of SECRETOS) assert.ok(!r.body.includes(s), `no debe aparecer ${s}`);
  assert.ok(!r.body.includes('VERIFICAR') && !r.body.includes('Pendiente de verificar') && !r.body.includes('pendiente de verificar'));
  assert.ok(!r.body.includes('Fase pendiente') && !r.body.includes('Sección pendiente'));
  assert.ok(r.body.includes('MODO DEMO - datos de prueba'));
  assert.match(r.body, new RegExp(`data-clave="tiroriro:kit:agente-${e.agente.id}"`));
  assert.match(r.body, /data-modo="DEMO"/);
  assert.match(r.body, /<script src="\/kit\.js\?v=/);
  assert.ok(!/<script>/.test(r.body) && !/ style="/.test(r.body), 'CSP: sin scripts ni estilos inline');
  assert.equal(r.headers['cache-control'], 'no-store');
});

test('el administrador ve los puntos pendientes con la etiqueta «Pendiente de verificar»', async () => {
  const e = await montar();
  const r = await get(e.app, '/admin/kit', e.admin.cookie);
  assert.equal(r.statusCode, 200);
  for (const s of SECRETOS) assert.ok(r.body.includes(s), `el administrador debe ver ${s}`);
  assert.ok(r.body.includes('Pendiente de verificar'));
  assert.ok(r.body.includes('Fase pendiente'));
  assert.match(r.body, /data-clave="tiroriro:kit:admin"/);
  assert.ok(r.body.includes('href="/admin/kit"'));
});

test('cada punto del checklist es una casilla con su id y hay botones de copiar y reiniciar con confirmación oculta', async () => {
  const e = await montar();
  const r = await getAgente(e.app, '/agente/kit', e.sesionAgente.cookie);
  assert.equal((r.body.match(/<input type="checkbox" data-id="/g) ?? []).length, 2);
  assert.match(r.body, /data-copiar-kit/);
  assert.match(r.body, /data-reiniciar>/);
  assert.match(r.body, /data-confirmar hidden/);
  assert.match(r.body, /<details class="kit-seccion"/);
  assert.match(r.body, /<textarea id="kit-texto" readonly/);
});

test('el enlace al kit aparece en las pantallas del agente y en el menú y la portada del administrador', async () => {
  const e = await montar();
  const a = await getAgente(e.app, '/agente/kit', e.sesionAgente.cookie);
  assert.ok(a.body.includes('href="/agente/kit"'));
  const m = await getAgente(e.app, '/agente/mesa/' + e.db.prepare('SELECT id FROM mesa WHERE codigo = ?').get('4-2-A').id, e.sesionAgente.cookie);
  assert.ok(m.body.includes('href="/agente/kit"'));
  const p = await get(e.app, '/admin', e.admin.cookie);
  assert.ok(p.body.includes('href="/admin/kit"'));
});

test('el kit no escribe en la base: ni auditoría ni datos de captura', async () => {
  const e = await montar();
  const antes = e.db.prepare('SELECT COUNT(*) n FROM auditoria').get().n;
  await getAgente(e.app, '/agente/kit', e.sesionAgente.cookie);
  await get(e.app, '/admin/kit', e.admin.cookie);
  assert.equal(e.db.prepare('SELECT COUNT(*) n FROM auditoria').get().n, antes);
});

test('kit.js y la hoja de estilos del kit se sirven con la versión; kit.js no usa recursos externos', async () => {
  const e = await montar();
  const js = await get(e.app, '/kit.js');
  assert.equal(js.statusCode, 200);
  assert.ok(!/https?:\/\//.test(js.body));
  assert.match(js.body, /try \{/);
  assert.match(js.body, /localStorage/);
  assert.match((await get(e.app, '/estilos.css')).body, /\.kit-punto/);
  assert.match((await get(e.app, '/estilos.css')).body, /@media print/);
});
