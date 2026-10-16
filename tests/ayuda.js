import { crearApp } from '../src/app.js';
import { abrirDb, migrar } from '../src/db.js';
import { sembrar } from '../src/seed.js';

export const CONFIG = {
  puerto: 0,
  dataDir: ':memory:',
  sessionSecret: 's'.repeat(40),
  pinHmacSecret: 'p'.repeat(40),
  adminUser: 'admin',
  adminPasswordInitial: 'contraseña-inicial-1',
  cookieSegura: true,
};

export async function crearEntorno() {
  const db = abrirDb(':memory:');
  migrar(db);
  await sembrar(db, CONFIG);
  const app = crearApp({ db, config: CONFIG });
  return { app, db };
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

// Inicia sesión como administrador y devuelve la cookie y el token CSRF.
export async function loginAdmin(app, contrasena = CONFIG.adminPasswordInitial) {
  const res = await post(app, '/admin/login', { usuario: CONFIG.adminUser, contrasena });
  const cookie = cookieDe(res)?.value;
  const pagina = await get(app, '/admin', cookie);
  const csrf = /name="_csrf" value="([^"]+)"/.exec(pagina.body)?.[1];
  return { res, cookie, csrf };
}
