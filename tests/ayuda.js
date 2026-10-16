import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { crearApp } from '../src/app.js';
import { abrirDb, migrarApp } from '../src/db.js';
import { generarPin, hmacPin } from '../src/pin.js';
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

// ---- Agentes ----
export const getAgente = (app, url, cookie, opciones = {}) =>
  app.inject({ method: 'GET', url, headers: cookie ? { cookie: `sid_agente=${cookie}` } : {}, ...opciones });

export const postAgente = (app, url, datos, cookie, opciones = {}) =>
  app.inject({
    method: 'POST',
    url,
    payload: formulario(datos),
    headers: { ...CABECERA_FORM, ...(cookie ? { cookie: `sid_agente=${cookie}` } : {}) },
    ...opciones,
  });

// Crea un agente activo con PIN (aleatorio o el dado) y mesas asignadas por código.
export function crearAgente(db, { nombre = 'Ana', mesas = ['4-2-A'], pin = null } = {}) {
  const { pin: claro, hmac } = pin
    ? { pin, hmac: hmacPin(CONFIG.pinHmacSecret, pin) }
    : generarPin(db, CONFIG.pinHmacSecret);
  const id = Number(
    db.prepare('INSERT INTO agente (nombre, pin_hmac, creado_en) VALUES (?, ?, ?)').run(nombre, hmac, new Date().toISOString()).lastInsertRowid
  );
  for (const codigo of mesas) {
    db.prepare('INSERT INTO agente_mesa (agente_id, mesa_id) SELECT ?, id FROM mesa WHERE codigo = ?').run(id, codigo);
  }
  return { id, pin: claro };
}

// Pide la pantalla de PIN (token CSRF + cookie) y envía el POST, como haría un navegador.
export async function intentarPin(app, pin, { remoteAddress, headers = {} } = {}) {
  const red = remoteAddress ? { remoteAddress } : {};
  const pagina = await app.inject({ method: 'GET', url: '/', headers, ...red });
  const csrf = /name="_csrf" value="([^"]+)"/.exec(pagina.body)?.[1];
  const valor = pagina.cookies.find((c) => c.name === 'csrf_pin')?.value;
  return app.inject({
    method: 'POST',
    url: '/entrar',
    payload: formulario({ _csrf: csrf, pin }),
    headers: { ...CABECERA_FORM, cookie: `csrf_pin=${valor}`, ...headers },
    ...red,
  });
}

// Entra como agente y devuelve cookie de sesión y token CSRF.
export async function loginAgente(app, pin, opciones) {
  const res = await intentarPin(app, pin, opciones);
  const cookie = res.cookies.find((c) => c.name === 'sid_agente')?.value;
  let pagina = await getAgente(app, '/agente', cookie);
  if (pagina.statusCode === 302) pagina = await getAgente(app, pagina.headers.location, cookie);
  const csrf = /name="_csrf" value="([^"]+)"/.exec(pagina.body)?.[1];
  return { res, cookie, csrf };
}

// ---- Candidaturas (configuración) ----
export function insertarCandidaturas(db, lista) {
  const siguiente = () => db.prepare("SELECT COALESCE(MAX(orden), 0) + 1 AS n FROM candidatura WHERE eleccion = 'congreso'").get().n;
  return lista.map(({ nombre, siglas = '', color = '#546e7a', destacada = 0, activa = 1 }) =>
    Number(
      db
        .prepare('INSERT INTO candidatura (nombre, siglas, orden, destacada, activa, color) VALUES (?, ?, ?, ?, ?, ?)')
        .run(nombre, siglas, siguiente(), destacada, activa, color).lastInsertRowid
    )
  );
}

// Candidaturas de Madrid de ejemplo: 5 destacadas + resto (para pruebas y capturas).
export const CANDIDATURAS_MADRID = [
  { nombre: 'Partido Popular', siglas: 'PP', color: '#1d84ce', destacada: 1 },
  { nombre: 'Partido Socialista Obrero Español', siglas: 'PSOE', color: '#e30613', destacada: 1 },
  { nombre: 'VOX', siglas: 'VOX', color: '#63be21', destacada: 1 },
  { nombre: 'Frente Amplio', siglas: 'FA', color: '#f6a800', destacada: 1 },
  { nombre: 'Podemos', siglas: 'PODEMOS', color: '#6b2c91', destacada: 1 },
  { nombre: 'Partido Animalista', siglas: 'PACMA', color: '#8bc34a' },
  { nombre: 'Escaños en Blanco', siglas: 'EB', color: '#9e9e9e' },
  { nombre: 'Recortes Cero', siglas: 'RC', color: '#00796b' },
];

// Imágenes mínimas válidas (por sus primeros bytes) para probar logos.
export const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
export const JPEG_MIN = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(40, 1)]);
export const WEBP_MIN = Buffer.concat([Buffer.from('RIFF', 'latin1'), Buffer.from([0x20, 0, 0, 0]), Buffer.from('WEBP', 'latin1'), Buffer.alloc(30, 2)]);
