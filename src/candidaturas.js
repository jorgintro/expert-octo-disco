// Candidaturas del Congreso (configuración compartida por DEMO y REAL). Reglas:
//  - Sin candidaturas en el código ni en el seed: las carga el administrador.
//  - El orden es el de la Junta Electoral Central (1..n, estable; lo mantiene la app).
//  - Con el recuento activado se BLOQUEA LA ESTRUCTURA (crear, borrar, activar/desactivar, ordenar, destacar);
//    siguen editables nombre, siglas, color y logo (erratas), con auditoría.
//  - No se borra una candidatura con votos (ni reales ni de demo): solo se desactiva.
import { createHash } from 'node:crypto';
import { auditar } from './auditoria.js';
import { estructuraBloqueada } from './recuentoEstado.js';

export const ELECCION = 'congreso';
export const MAX_LOGO = 300 * 1024;
export const COLOR_DEFECTO = '#546e7a';

export class ErrorCandidatura extends Error {
  constructor(mensajes, codigo = 422) {
    super([].concat(mensajes).join(' '));
    this.name = 'ErrorCandidatura';
    this.mensajes = [].concat(mensajes);
    this.codigo = codigo;
  }
}

const COLUMNAS = 'id, eleccion, nombre, siglas, orden, destacada, activa, color, logo_tipo, logo_hash, (logo IS NOT NULL) AS tiene_logo';

export const listarCandidaturas = (db) =>
  db.prepare(`SELECT ${COLUMNAS} FROM candidatura WHERE eleccion = ? ORDER BY orden, id`).all(ELECCION);

export const obtenerCandidatura = (db, id) =>
  Number.isInteger(id) ? db.prepare(`SELECT ${COLUMNAS} FROM candidatura WHERE id = ? AND eleccion = ?`).get(id, ELECCION) : undefined;

// Texto sobre el color de la candidatura: blanco o negro según el contraste.
export function colorTexto(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? '#000000' : '#ffffff';
}

// Hoja de estilos con el color de cada candidatura (los estilos en línea no están permitidos por la CSP).
export function hojaCandidaturas(db) {
  // También los candidatos del Senado (.cs-<id>): heredan el color de su partido o usan el suyo.
  const candidatos = db
    .prepare('SELECT s.id, COALESCE(c.color, s.color) AS color FROM candidato_senado s LEFT JOIN candidatura c ON c.id = s.candidatura_id ORDER BY s.id')
    .all();
  const css = [
    ...listarCandidaturas(db).map((c) => `.cand-${c.id}{--c:${c.color};--t:${colorTexto(c.color)}}`),
    ...candidatos.map((c) => `.cs-${c.id}{--c:${c.color};--t:${colorTexto(c.color)}}`),
  ].join('\n');
  const hash = createHash('sha1').update(css).digest('hex').slice(0, 10);
  return { css: `${css}\n`, hash, url: `/candidaturas.css?v=${hash}` };
}

const normalizar = (t) => String(t ?? '').replace(/\s+/g, ' ').trim();
const marcado = (v) => v === '1' || v === 'on' || v === true;

// Lee y valida el formulario. Devuelve valores normalizados y errores.
export function leerCandidatura(body, { db, idActual = null }) {
  const errores = [];
  const nombre = normalizar(body.nombre);
  const siglas = normalizar(body.siglas);
  const color = String(body.color ?? COLOR_DEFECTO).trim().toLowerCase();
  const destacada = marcado(body.destacada);
  // En el formulario (campo oculto `estructura=1`) una casilla desmarcada no se envía: ausente = desmarcada.
  // Sin ese campo (alta directa) «activa» vale true por defecto.
  const activa = body.estructura === '1' || body.activa !== undefined ? marcado(body.activa) : true;

  if (nombre === '') errores.push('El nombre es obligatorio.');
  else if (nombre.length > 80) errores.push('El nombre no puede superar los 80 caracteres.');
  if (siglas.length > 16) errores.push('Las siglas no pueden superar los 16 caracteres.');
  if (!/^#[0-9a-f]{6}$/.test(color)) errores.push('El color debe ser un valor hexadecimal #RRGGBB.');
  if (nombre !== '') {
    const repetida = db
      .prepare('SELECT id FROM candidatura WHERE eleccion = ? AND LOWER(nombre) = LOWER(?) AND id != ?')
      .get(ELECCION, nombre, idActual ?? 0);
    if (repetida) errores.push(`Ya existe una candidatura llamada «${nombre}».`);
  }
  if (destacada && nombre.toLowerCase() === 'otros') {
    errores.push('«Otros» no puede ser destacada: el grupo «Otros» del pantallazo ya reúne a las no destacadas.');
  }
  return { errores, valores: { nombre, siglas, color, destacada: destacada ? 1 : 0, activa: activa ? 1 : 0 } };
}

const estado = (c) => ({ nombre: c.nombre, siglas: c.siglas, orden: c.orden, destacada: c.destacada, activa: c.activa, color: c.color });

function renumerar(db, actor, motivo) {
  const filas = db.prepare('SELECT id, orden FROM candidatura WHERE eleccion = ? ORDER BY orden, id').all(ELECCION);
  filas.forEach((f, i) => {
    if (f.orden !== i + 1) {
      db.prepare('UPDATE candidatura SET orden = ? WHERE id = ?').run(i + 1, f.id);
      auditar(db, actor, 'editar', 'candidatura', f.id, { orden: f.orden }, { orden: i + 1, motivo });
    }
  });
}

function exigirEstructuraLibre(db, modo) {
  if (estructuraBloqueada(db, modo)) {
    throw new ErrorCandidatura(
      'El recuento ya está activado: la estructura de las candidaturas (crear, borrar, activar, ordenar y destacar) está bloqueada.',
      409
    );
  }
}

export function crearCandidatura(db, { valores, posicion = null }, actor, modo) {
  exigirEstructuraLibre(db, modo);
  return db.transaction(() => {
    const total = db.prepare('SELECT COUNT(*) AS n FROM candidatura WHERE eleccion = ?').get(ELECCION).n;
    const pos = Math.min(Math.max(posicion ?? total + 1, 1), total + 1);
    db.prepare('UPDATE candidatura SET orden = orden + 1 WHERE eleccion = ? AND orden >= ?').run(ELECCION, pos);
    const id = Number(
      db
        .prepare('INSERT INTO candidatura (eleccion, nombre, siglas, orden, destacada, activa, color) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run(ELECCION, valores.nombre, valores.siglas, pos, valores.destacada, valores.activa, valores.color).lastInsertRowid
    );
    auditar(db, actor, 'crear', 'candidatura', id, null, { ...valores, orden: pos });
    renumerar(db, actor, 'alta');
    return id;
  })();
}

// Edita una candidatura. Nombre, siglas y color (cosmético) siempre; destacada, activa y posición
// (estructura) solo si la estructura no está bloqueada.
export function editarCandidatura(db, id, { valores, posicion = null }, actor, modo) {
  return db.transaction(() => {
    const actual = obtenerCandidatura(db, id);
    if (!actual) throw new ErrorCandidatura('Candidatura no encontrada.', 404);
    const total = db.prepare('SELECT COUNT(*) AS n FROM candidatura WHERE eleccion = ?').get(ELECCION).n;
    const destino = Math.min(Math.max(posicion ?? actual.orden, 1), total);
    const estructuraCambia = valores.destacada !== actual.destacada || valores.activa !== actual.activa || destino !== actual.orden;
    if (estructuraCambia) exigirEstructuraLibre(db, modo);

    const antes = estado(actual);
    db.prepare('UPDATE candidatura SET nombre = ?, siglas = ?, color = ?, destacada = ?, activa = ? WHERE id = ?').run(
      valores.nombre, valores.siglas, valores.color, valores.destacada, valores.activa, id
    );
    const despues = { ...antes, ...valores, orden: antes.orden };
    const cambios = Object.keys(valores).filter((k) => antes[k] !== despues[k]);
    if (cambios.length > 0) {
      auditar(db, actor, 'editar', 'candidatura', id, Object.fromEntries(cambios.map((k) => [k, antes[k]])), Object.fromEntries(cambios.map((k) => [k, despues[k]])));
    }
    if (destino !== actual.orden) {
      const otras = db.prepare('SELECT id FROM candidatura WHERE eleccion = ? AND id != ? ORDER BY orden, id').all(ELECCION, id).map((f) => f.id);
      otras.splice(destino - 1, 0, id);
      otras.forEach((cid, i) => db.prepare('UPDATE candidatura SET orden = ? WHERE id = ?').run(i + 1, cid));
      auditar(db, actor, 'editar', 'candidatura', id, { orden: actual.orden }, { orden: destino });
    }
  })();
}

export function moverCandidatura(db, id, sentido, actor, modo) {
  exigirEstructuraLibre(db, modo);
  const actual = obtenerCandidatura(db, id);
  if (!actual) throw new ErrorCandidatura('Candidatura no encontrada.', 404);
  const destino = sentido === 'subir' ? actual.orden - 1 : actual.orden + 1;
  editarCandidatura(db, id, { valores: { nombre: actual.nombre, siglas: actual.siglas, color: actual.color, destacada: actual.destacada, activa: actual.activa }, posicion: destino }, actor, modo);
}

// votos: { real: Map, demo: Map } de GestorDatos.contarVotosPorCandidatura()
export function borrarCandidatura(db, id, actor, modo, votos) {
  exigirEstructuraLibre(db, modo);
  return db.transaction(() => {
    const actual = obtenerCandidatura(db, id);
    if (!actual) throw new ErrorCandidatura('Candidatura no encontrada.', 404);
    const r = votos.real.get(id) ?? 0;
    const d = votos.demo.get(id) ?? 0;
    if (r + d > 0) {
      throw new ErrorCandidatura(`No se puede borrar una candidatura que ya tiene votos (${r} reales, ${d} de demo): desactívala en su lugar.`, 409);
    }
    const senadores = db.prepare('SELECT COUNT(*) AS n FROM candidato_senado WHERE candidatura_id = ?').get(id).n;
    if (senadores > 0) {
      throw new ErrorCandidatura(`No se puede borrar: ${senadores} candidato${senadores === 1 ? '' : 's'} del Senado ${senadores === 1 ? 'tiene' : 'tienen'} esta candidatura como partido. Desactívala en su lugar.`, 409);
    }
    db.prepare('DELETE FROM candidatura WHERE id = ?').run(id);
    auditar(db, actor, 'borrar', 'candidatura', id, estado(actual), null);
    renumerar(db, actor, 'baja');
  })();
}

// ---- Logos (PNG, JPEG o WebP; nunca SVG: puede llevar scripts) ----
export function tipoDeImagen(buf) {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  return null;
}

export function guardarLogo(db, id, buf, actor) {
  if (!Buffer.isBuffer(buf) || buf.length === 0) throw new ErrorCandidatura('No se ha recibido ninguna imagen.');
  if (buf.length > MAX_LOGO) throw new ErrorCandidatura(`El logo no puede superar los ${MAX_LOGO / 1024} KB.`, 413);
  const tipo = tipoDeImagen(buf);
  if (!tipo) throw new ErrorCandidatura('El logo debe ser una imagen PNG, JPEG o WebP (no se admite SVG).', 415);
  const hash = createHash('sha256').update(buf).digest('hex').slice(0, 12);
  return db.transaction(() => {
    const actual = obtenerCandidatura(db, id);
    if (!actual) throw new ErrorCandidatura('Candidatura no encontrada.', 404);
    db.prepare('UPDATE candidatura SET logo = ?, logo_tipo = ?, logo_hash = ? WHERE id = ?').run(buf, tipo, hash, id);
    auditar(db, actor, 'editar', 'candidatura', id, { logo: actual.logo_hash }, { logo: hash });
    return hash;
  })();
}

export function quitarLogo(db, id, actor) {
  db.transaction(() => {
    const actual = obtenerCandidatura(db, id);
    if (!actual) throw new ErrorCandidatura('Candidatura no encontrada.', 404);
    if (!actual.tiene_logo) return;
    db.prepare('UPDATE candidatura SET logo = NULL, logo_tipo = NULL, logo_hash = NULL WHERE id = ?').run(id);
    auditar(db, actor, 'editar', 'candidatura', id, { logo: actual.logo_hash }, { logo: null });
  })();
}

export const leerLogo = (db, id) =>
  Number.isInteger(id) ? db.prepare('SELECT logo, logo_tipo, logo_hash FROM candidatura WHERE id = ? AND logo IS NOT NULL').get(id) : undefined;
