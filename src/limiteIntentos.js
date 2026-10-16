// Límite de intentos por IP con contadores SEPARADOS por ámbito:
//  - admin: contraseña de administrador (login, pantalla de modo, cambio de contraseña).
//  - pin:   PIN de agentes (más permisivo: los agentes de un colegio comparten IP pública).
// Un fallo en un ámbito nunca afecta al otro.
export const LIMITES = {
  admin: { max: 5, ventanaMs: 15 * 60 * 1000, bloqueoMs: 5 * 60 * 1000 },
  pin: { max: 15, ventanaMs: 5 * 60 * 1000, bloqueoMs: 5 * 60 * 1000 },
};

export const AMBITOS = Object.keys(LIMITES);

function limites(ambito) {
  const l = LIMITES[ambito];
  if (!l) throw new Error(`Ámbito de límite de intentos desconocido: ${ambito}`);
  return l;
}

const iso = (ms) => new Date(ms).toISOString();

export function estaBloqueada(db, ambito, ip, ahora = Date.now()) {
  limites(ambito);
  const fila = db.prepare('SELECT bloqueado_hasta FROM bloqueo_ip WHERE ambito = ? AND ip = ?').get(ambito, ip);
  return Boolean(fila?.bloqueado_hasta && fila.bloqueado_hasta > iso(ahora));
}

export function registrarFallo(db, ambito, ip, ahora = Date.now()) {
  const { max, ventanaMs, bloqueoMs } = limites(ambito);
  const fila = db.prepare('SELECT fallos, desde FROM bloqueo_ip WHERE ambito = ? AND ip = ?').get(ambito, ip);
  const ventanaVigente = fila?.desde && Date.parse(fila.desde) + ventanaMs > ahora;
  const fallos = ventanaVigente ? fila.fallos + 1 : 1;
  const desde = ventanaVigente ? fila.desde : iso(ahora);
  const bloquear = fallos >= max;
  db.prepare(
    `INSERT INTO bloqueo_ip (ambito, ip, fallos, desde, bloqueado_hasta) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(ambito, ip) DO UPDATE SET fallos = excluded.fallos, desde = excluded.desde,
       bloqueado_hasta = excluded.bloqueado_hasta`
  ).run(ambito, ip, bloquear ? 0 : fallos, bloquear ? null : desde, bloquear ? iso(ahora + bloqueoMs) : null);
}

export function limpiarFallos(db, ambito, ip) {
  limites(ambito);
  db.prepare('DELETE FROM bloqueo_ip WHERE ambito = ? AND ip = ?').run(ambito, ip);
}

// Filas con bloqueo vigente o fallos recientes (y limpia las caducadas).
export function listarBloqueos(db, ahora = Date.now()) {
  const filas = db.prepare('SELECT * FROM bloqueo_ip ORDER BY ambito, ip').all();
  const vigentes = [];
  for (const f of filas) {
    const bloqueada = Boolean(f.bloqueado_hasta && f.bloqueado_hasta > iso(ahora));
    const conFallos = f.fallos > 0 && f.desde && Date.parse(f.desde) + LIMITES[f.ambito].ventanaMs > ahora;
    if (bloqueada || conFallos) vigentes.push({ ...f, bloqueada });
    else db.prepare('DELETE FROM bloqueo_ip WHERE ambito = ? AND ip = ?').run(f.ambito, f.ip);
  }
  return vigentes;
}

// Quita bloqueos y contadores. Sin filtros, quita todos. Devuelve cuántas filas se borraron.
export function desbloquear(db, { ambito = null, ip = null } = {}) {
  if (ambito !== null) limites(ambito);
  return db
    .prepare('DELETE FROM bloqueo_ip WHERE (? IS NULL OR ambito = ?) AND (? IS NULL OR ip = ?)')
    .run(ambito, ambito, ip, ip).changes;
}
