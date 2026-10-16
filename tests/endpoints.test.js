import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { crearEntorno } from './ayuda.js';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('/healthz responde ok', async () => {
  const { app } = await crearEntorno();
  const r = await app.inject('/healthz');
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.json(), { estado: 'ok', modo: 'DEMO' });
});

test('/version devuelve la versión de package.json', async () => {
  const { app } = await crearEntorno();
  const r = await app.inject('/version');
  assert.equal(r.json().version, version);
  assert.equal(r.json().modo, 'DEMO');
});

test('la página de inicio muestra la versión, el acceso admin y cabeceras de seguridad', async () => {
  const { app } = await crearEntorno();
  const r = await app.inject('/');
  assert.equal(r.statusCode, 200);
  assert.match(r.body, new RegExp(`Versión ${version.replaceAll('.', '\\.')}`));
  assert.match(r.body, /href="\/admin\/login"/);
  assert.match(r.body, /name="viewport"/);
  assert.equal(r.headers['x-content-type-options'], 'nosniff');
  assert.ok(r.headers['content-security-policy']);
});

test('sirve el CSS estático', async () => {
  const { app } = await crearEntorno();
  const r = await app.inject('/estilos.css');
  assert.equal(r.statusCode, 200);
  assert.match(r.headers['content-type'], /text\/css/);
});

test('estáticos: Cache-Control no-cache con ETag (revalidan con 304) y versión en la URL del CSS', async () => {
  const { app } = await crearEntorno();
  for (const url of ['/estilos.css', '/agente.js', '/resumen.js']) {
    const r = await app.inject(url);
    assert.equal(r.statusCode, 200, url);
    assert.equal(r.headers['cache-control'], 'no-cache', url);
    assert.ok(r.headers.etag, `${url} lleva ETag`);
    const condicional = await app.inject({ url, headers: { 'if-none-match': r.headers.etag } });
    assert.equal(condicional.statusCode, 304, `${url} se revalida con 304`);
  }
  const inicio = await app.inject('/');
  assert.match(inicio.body, new RegExp(`href="/estilos\\.css\\?v=${version.replaceAll('.', '\\.')}"`));
});

test('la hoja de estilos hace que [hidden] oculte de verdad y pinta los vacíos en gris', async () => {
  const { app } = await crearEntorno();
  const css = (await app.inject('/estilos.css')).body;
  assert.match(css, /\[hidden\]\s*\{\s*display:\s*none\s*!important/);
  assert.match(css, /font-variant-numeric:\s*tabular-nums/);
  assert.match(css, /\.celda\.vacia/);
});
