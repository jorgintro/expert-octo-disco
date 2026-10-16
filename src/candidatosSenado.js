// Candidatos del Senado (configuración compartida por DEMO y REAL). Reglas:
//  - Sin candidatos en el código ni en el seed: los carga el administrador. Todos los activos cuentan igual.
//  - El orden es el de la papeleta (1..n, estable; lo mantiene la app).
//  - Partido asociado (opcional): una candidatura del Congreso, de la que hereda color y logo. Sin partido, el
//    candidato tiene su propio color y, si se quiere agrupar con otros, una «agrupación» (mismo texto = misma lista).
//  - Con el recuento del Senado activado se BLOQUEA LA ESTRUCTURA (alta, borrado, orden y activo); siguen editables
//    nombre, partido, agrupación y color (erratas), con auditoría.
//  - No se borra un candidato con votos (ni reales ni de demo): solo se desactiva.
import { auditar } from './auditoria.js';
import { COLOR_DEFECTO, obtenerCandidatura } from './candidaturas.js';
import { estructuraSenadoBloqueada } from './recuentoEstado.js';

export class ErrorCandidato extends Error {
  constructor(mensajes, codigo = 422) {
    super([].concat(mensajes).join(' '));
    this.name = 'ErrorCandidato';
    this.mensajes = [].concat(mensajes);
    this.codigo = codigo;
  }
}

const SELECT = `SELECT s.id, s.nombre, s.orden, s.candidatura_id, s.agrupacion, s.color, s.activo,
  c.siglas AS partido_siglas, c.nombre AS partido_nombre, c.logo_hash, (c.logo IS NOT NULL) AS tiene_logo,
  COALESCE(c.color, s.color) AS color_efectivo
  FROM candidato_senado s LEFT JOIN candidatura c ON c.id = s.candidatura_id`;

export const listarCandidatos = (db) => db.prepare(`${SELECT} ORDER BY s.orden, s.id`).all();
export const obtenerCandidato = (db, id) => (Number.isInteger(id) ? db.prepare(`${SELECT} WHERE s.id = ?`).get(id) : undefined);

const normalizar = (t) => String(t ?? '').replace(/\s+/g, ' ').trim();
const marcado = (v) => v === '1' || v === 'on' || v === true;

export function leerCandidato(body, { db, idActual = null }) {
  const errores = [];
  const nombre = normalizar(body.nombre);
  const color = String(body.color ?? COLOR_DEFECTO).trim().toLowerCase();
  const crudoPartido = String(body.candidatura_id ?? '').trim();
  const candidaturaId = /^\d{1,9}$/.test(crudoPartido) ? Number(crudoPartido) : null;
  const agrupacionCruda = normalizar(body.agrupacion);
  // Ausente = desmarcada cuando el formulario incluye la estructura (campo oculto estructura=1).
  const activo = body.estructura === '1' || body.activo !== undefined ? marcado(body.activo) : true;

  if (nombre === '') errores.push('El nombre es obligatorio.');
  else if (nombre.length > 80) errores.push('El nombre no puede superar los 80 caracteres.');
  if (crudoPartido !== '' && candidaturaId === null) errores.push('Partido no válido.');
  if (candidaturaId !== null && !obtenerCandidatura(db, candidaturaId)) errores.push('El partido elegido no existe.');
  if (agrupacionCruda.length > 60) errores.push('La agrupación no puede superar los 60 caracteres.');
  if (!/^#[0-9a-f]{6}$/.test(color)) errores.push('El color debe ser un valor hexadecimal #RRGGBB.');
  if (nombre !== '') {
    const repetido = db.prepare('SELECT id FROM candidato_senado WHERE LOWER(nombre) = LOWER(?) AND id != ?').get(nombre, idActual ?? 0);
    if (repetido) errores.push(`Ya existe un candidato llamado «${nombre}».`);
  }
  // Con partido, la agrupación sobra: la lista es el partido.
  return { errores, valores: { nombre, candidatura_id: candidaturaId, agrupacion: candidaturaId ? '' : agrupacionCruda, color, activo: activo ? 1 : 0 } };
}

const estado = (c) => ({ nombre: c.nombre, orden: c.orden, candidatura_id: c.candidatura_id, agrupacion: c.agrupacion, color: c.color, activo: c.activo });

function renumerar(db, actor, motivo) {
  db.prepare('SELECT id, orden FROM candidato_senado ORDER BY orden, id').all().forEach((f, i) => {
    if (f.orden !== i + 1) {
      db.prepare('UPDATE candidato_senado SET orden = ? WHERE id = ?').run(i + 1, f.id);
      auditar(db, actor, 'editar', 'candidato_senado', f.id, { orden: f.orden }, { orden: i + 1, motivo });
    }
  });
}

function exigirEstructuraLibre(db, modo) {
  if (estructuraSenadoBloqueada(db, modo)) {
    throw new ErrorCandidato('El recuento del Senado ya está activado: la estructura de los candidatos (alta, borrado, orden y activo) está bloqueada.', 409);
  }
}

export function crearCandidato(db, { valores, posicion = null }, actor, modo) {
  exigirEstructuraLibre(db, modo);
  return db.transaction(() => {
    const total = db.prepare('SELECT COUNT(*) AS n FROM candidato_senado').get().n;
    const pos = Math.min(Math.max(posicion ?? total + 1, 1), total + 1);
    db.prepare('UPDATE candidato_senado SET orden = orden + 1 WHERE orden >= ?').run(pos);
    const id = Number(
      db
        .prepare('INSERT INTO candidato_senado (nombre, orden, candidatura_id, agrupacion, color, activo) VALUES (?, ?, ?, ?, ?, ?)')
        .run(valores.nombre, pos, valores.candidatura_id, valores.agrupacion, valores.color, valores.activo).lastInsertRowid
    );
    auditar(db, actor, 'crear', 'candidato_senado', id, null, { ...valores, orden: pos });
    renumerar(db, actor, 'alta');
    return id;
  })();
}

// Nombre, partido, agrupación y color siempre; activo y posición (estructura) solo si no está bloqueada.
export function editarCandidato(db, id, { valores, posicion = null }, actor, modo) {
  return db.transaction(() => {
    const actual = obtenerCandidato(db, id);
    if (!actual) throw new ErrorCandidato('Candidato no encontrado.', 404);
    const total = db.prepare('SELECT COUNT(*) AS n FROM candidato_senado').get().n;
    const destino = Math.min(Math.max(posicion ?? actual.orden, 1), total);
    if (valores.activo !== actual.activo || destino !== actual.orden) exigirEstructuraLibre(db, modo);

    const antes = estado(actual);
    db.prepare('UPDATE candidato_senado SET nombre = ?, candidatura_id = ?, agrupacion = ?, color = ?, activo = ? WHERE id = ?').run(
      valores.nombre, valores.candidatura_id, valores.agrupacion, valores.color, valores.activo, id
    );
    const cambios = Object.keys(valores).filter((k) => antes[k] !== valores[k]);
    if (cambios.length > 0) {
      auditar(db, actor, 'editar', 'candidato_senado', id, Object.fromEntries(cambios.map((k) => [k, antes[k]])), Object.fromEntries(cambios.map((k) => [k, valores[k]])));
    }
    if (destino !== actual.orden) {
      const otros = db.prepare('SELECT id FROM candidato_senado WHERE id != ? ORDER BY orden, id').all(id).map((f) => f.id);
      otros.splice(destino - 1, 0, id);
      otros.forEach((cid, i) => db.prepare('UPDATE candidato_senado SET orden = ? WHERE id = ?').run(i + 1, cid));
      auditar(db, actor, 'editar', 'candidato_senado', id, { orden: actual.orden }, { orden: destino });
    }
  })();
}

export function moverCandidato(db, id, sentido, actor, modo) {
  exigirEstructuraLibre(db, modo);
  const actual = obtenerCandidato(db, id);
  if (!actual) throw new ErrorCandidato('Candidato no encontrado.', 404);
  const destino = sentido === 'subir' ? actual.orden - 1 : actual.orden + 1;
  editarCandidato(db, id, { valores: { nombre: actual.nombre, candidatura_id: actual.candidatura_id, agrupacion: actual.agrupacion, color: actual.color, activo: actual.activo }, posicion: destino }, actor, modo);
}

// votos: { real: Map, demo: Map } de GestorDatos.contarVotosPorCandidato()
export function borrarCandidato(db, id, actor, modo, votos) {
  exigirEstructuraLibre(db, modo);
  return db.transaction(() => {
    const actual = obtenerCandidato(db, id);
    if (!actual) throw new ErrorCandidato('Candidato no encontrado.', 404);
    const r = votos.real.get(id) ?? 0;
    const d = votos.demo.get(id) ?? 0;
    if (r + d > 0) throw new ErrorCandidato(`No se puede borrar un candidato que ya tiene votos (${r} reales, ${d} de demo): desactívalo en su lugar.`, 409);
    db.prepare('DELETE FROM candidato_senado WHERE id = ?').run(id);
    auditar(db, actor, 'borrar', 'candidato_senado', id, estado(actual), null);
    renumerar(db, actor, 'baja');
  })();
}
