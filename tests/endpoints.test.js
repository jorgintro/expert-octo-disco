import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { crearApp } from '../src/app.js';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

test('/healthz responde ok', async () => {
  const app = crearApp();
  const r = await app.inject('/healthz');
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.json(), { estado: 'ok' });
  await app.close();
});

test('/version devuelve la versión de package.json', async () => {
  const app = crearApp();
  const r = await app.inject('/version');
  assert.equal(r.statusCode, 200);
  assert.equal(r.json().version, version);
  await app.close();
});

test('la página de inicio muestra la versión en el pie y cabeceras de seguridad', async () => {
  const app = crearApp();
  const r = await app.inject('/');
  assert.equal(r.statusCode, 200);
  assert.match(r.headers['content-type'], /text\/html/);
  assert.match(r.body, new RegExp(`Versión ${version.replaceAll('.', '\\.')}`));
  assert.match(r.body, /name="viewport"/);
  assert.equal(r.headers['x-content-type-options'], 'nosniff');
  assert.ok(r.headers['content-security-policy']);
  await app.close();
});

test('sirve el CSS estático', async () => {
  const app = crearApp();
  const r = await app.inject('/estilos.css');
  assert.equal(r.statusCode, 200);
  assert.match(r.headers['content-type'], /text\/css/);
  await app.close();
});
