export const MAX_FALLOS = 5;
export const BLOQUEO_MS = 5 * 60 * 1000;

export function estaBloqueada(db, ip, ahora = Date.now()) {
  const fila = db.prepare('SELECT bloqueado_hasta FROM intento_login WHERE ip = ?').get(ip);
  return Boolean(fila?.bloqueado_hasta && fila.bloqueado_hasta > new Date(ahora).toISOString());
}

export function registrarFallo(db, ip, ahora = Date.now()) {
  const fila = db.prepare('SELECT fallos FROM intento_login WHERE ip = ?').get(ip);
  const fallos = (fila?.fallos ?? 0) + 1;
  const bloquear = fallos >= MAX_FALLOS;
  db.prepare(
    `INSERT INTO intento_login (ip, fallos, bloqueado_hasta) VALUES (?, ?, ?)
     ON CONFLICT(ip) DO UPDATE SET fallos = excluded.fallos, bloqueado_hasta = excluded.bloqueado_hasta`
  ).run(ip, bloquear ? 0 : fallos, bloquear ? new Date(ahora + BLOQUEO_MS).toISOString() : null);
}

export function limpiarFallos(db, ip) {
  db.prepare('DELETE FROM intento_login WHERE ip = ?').run(ip);
}
