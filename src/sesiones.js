import { createHmac, randomBytes } from 'node:crypto';

export const DURACION_SESION_MS = 14 * 60 * 60 * 1000;

const idDeToken = (secreto, token) => createHmac('sha256', secreto).update(token).digest('hex');

export function crearSesion(db, secreto, actorTipo, actorId) {
  const token = randomBytes(32).toString('base64url');
  const csrf = randomBytes(24).toString('base64url');
  const ahora = Date.now();
  db.prepare('DELETE FROM sesion WHERE expira_en < ?').run(new Date(ahora).toISOString());
  db.prepare(
    'INSERT INTO sesion (id, actor_tipo, actor_id, csrf, creada_en, expira_en) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(
    idDeToken(secreto, token),
    actorTipo,
    actorId,
    csrf,
    new Date(ahora).toISOString(),
    new Date(ahora + DURACION_SESION_MS).toISOString()
  );
  return { token, csrf };
}

export function buscarSesion(db, secreto, token) {
  if (typeof token !== 'string' || token === '') return null;
  const fila = db.prepare('SELECT * FROM sesion WHERE id = ?').get(idDeToken(secreto, token));
  if (!fila || fila.expira_en < new Date().toISOString()) return null;
  return fila;
}

export function borrarSesion(db, secreto, token) {
  if (typeof token === 'string') db.prepare('DELETE FROM sesion WHERE id = ?').run(idDeToken(secreto, token));
}

export function borrarSesionesDeActor(db, actorTipo, actorId, exceptoId = null) {
  db.prepare('DELETE FROM sesion WHERE actor_tipo = ? AND actor_id = ? AND id IS NOT ?').run(
    actorTipo,
    actorId,
    exceptoId
  );
}

// Borra la sesión del token solo si pertenece al tipo de actor indicado (una cookie de un rol no
// debe poder eliminar la sesión de otro).
export function borrarSesionDeTipo(db, secreto, token, actorTipo) {
  if (typeof token === 'string') {
    db.prepare('DELETE FROM sesion WHERE id = ? AND actor_tipo = ?').run(idDeToken(secreto, token), actorTipo);
  }
}
