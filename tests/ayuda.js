import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { crearApp } from '../src/app.js';
import { abrirDb, migrarApp } from '../src/db.js';
import { sembrar } from '../src/seed.js';

export const CONFIG = {
  puerto: 0,
  dataDir: ':memory:',
  sessionSecret: 's'.repeat(40),
  pinHmacSecret: 'p'.repeat(40),
  adminUser: 'admin',
  adminPasswordInitial: 'contraseña-inicial-1',
  cookieSegura: true,
  trustProxy: 2,
  fechaElecciones: '2026-11-29',
};

const directorios = [];
process.on('exit', () => directorios.forEach((d) => rmSync(d, { recursive: true, force: true })));
export const crearDirectorioTemporal = () => {
  const d = mkdtempSync(path.join(tmpdir(), 'tiroriro-test-'));
  directorios.push(d);
  return d;
};

// Reloj simulado (ms). Por defecto, antes de las elecciones (modo automático DEMO).
export function crearReloj(iso = '2026-10-20T10:00:00Z') {
  let t = Date.parse(iso);
  return { ahora: () => t, fijar: (nuevo) => { t = Date.parse(nuevo); } };
}

export async function crearEntorno({ reloj = crearReloj() } = {}) {
  const dataDir = crearDirectorioTemporal();
  const config = { ...CONFIG, dataDir };
  const db = abrirDb(':memory:');
  migrarApp(db);
  await sembrar(db, config);
  const app = crearApp({ db, config, reloj: reloj.ahora });
  return { app, db, dataDir, reloj, config };
}

const formulario = (datos) => new URLSearchParams(datos).toString();
const CABECERA_FORM = { 'content-type': 'application/x-www-form-urlencoded' };

export function post(app, url, datos, cookie, opciones = {}) {
  return app.inject({
    method: 'POST',
    url,
    payload: formulario(datos),
    headers: { ...CABECERA_FORM, ...(cookie ? { cookie: `sid=${cookie}` } : {}) },
    ...opciones,
  });
}

export function get(app, url, cookie) {
  return app.inject({ method: 'GET', url, headers: cookie ? { cookie: `sid=${cookie}` } : {} });
}

export const cookieDe = (res) => res.cookies.find((c) => c.name === 'sid');

// Pide el formulario de login (token CSRF + cookie) y envía el POST, como haría un navegador.
export async function intentarLogin(app, datos, { remoteAddress, headers = {} } = {}) {
  const red = remoteAddress ? { remoteAddress } : {};
  const pagina = await app.inject({ method: 'GET', url: '/admin/login', headers, ...red });
  const csrf = /name="_csrf" value="([^"]+)"/.exec(pagina.body)?.[1];
  const valor = pagina.cookies.find((c) => c.name === 'csrf_login')?.value;
  return app.inject({
    method: 'POST',
    url: '/admin/login',
    payload: formulario({ _csrf: csrf, ...datos }),
    headers: { ...CABECERA_FORM, cookie: `csrf_login=${valor}`, ...headers },
    ...red,
  });
}

// Inicia sesión como administrador y devuelve la cookie y el token CSRF.
export async function loginAdmin(app, contrasena = CONFIG.adminPasswordInitial) {
  const res = await intentarLogin(app, { usuario: CONFIG.adminUser, contrasena });
  const cookie = cookieDe(res)?.value;
  const pagina = await get(app, '/admin', cookie);
  const csrf = /name="_csrf" value="([^"]+)"/.exec(pagina.body)?.[1];
  return { res, cookie, csrf };
}
