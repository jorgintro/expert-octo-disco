// Registra una modificación. Nunca pases PIN ni contraseñas en los valores.
export function auditar(db, actor, accion, entidad, entidadId, anterior = null, nuevo = null) {
  db.prepare(
    `INSERT INTO auditoria (fecha, actor_tipo, actor_id, accion, entidad, entidad_id, valor_anterior, valor_nuevo)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    new Date().toISOString(),
    actor.tipo,
    actor.id ?? null,
    accion,
    entidad,
    entidadId ?? null,
    anterior === null ? null : JSON.stringify(anterior),
    nuevo === null ? null : JSON.stringify(nuevo)
  );
}

// ---- Consulta (histórico) ----
// Entidades cuya auditoría es de CAPTURA (vive en la base del modo: demo.db o app.db).
export const ENTIDADES_CAPTURA = ['participacion', 'recuento'];

function condiciones({ mesa = null, actor = null, accion = null } = {}, excluirEntidades = []) {
  const donde = [];
  const params = [];
  if (actor) {
    donde.push('actor_tipo = ?');
    params.push(actor);
  }
  if (accion) {
    donde.push('accion = ?');
    params.push(accion);
  }
  if (mesa) {
    // Cambios de la propia mesa (censo, baja...) y datos de participación de esa mesa.
    donde.push(`((entidad IN ('mesa', 'recuento') AND entidad_id = ?) OR (entidad = 'participacion' AND COALESCE(
      CASE WHEN json_valid(valor_nuevo) THEN json_extract(valor_nuevo, '$.mesa_id') END,
      CASE WHEN json_valid(valor_anterior) THEN json_extract(valor_anterior, '$.mesa_id') END) = ?))`);
    params.push(mesa, mesa);
  }
  if (excluirEntidades.length > 0) {
    donde.push(`entidad NOT IN (${excluirEntidades.map(() => '?').join(', ')})`);
    params.push(...excluirEntidades);
  }
  return { sql: donde.length ? `WHERE ${donde.join(' AND ')}` : '', params };
}

export function contarAuditoria(db, filtros, excluirEntidades = []) {
  const { sql, params } = condiciones(filtros, excluirEntidades);
  return db.prepare(`SELECT COUNT(*) AS n FROM auditoria ${sql}`).get(...params).n;
}

// Las `limite` filas más recientes que cumplen los filtros.
export function listarAuditoria(db, filtros, { limite, excluirEntidades = [] }) {
  const { sql, params } = condiciones(filtros, excluirEntidades);
  return db.prepare(`SELECT * FROM auditoria ${sql} ORDER BY fecha DESC, id DESC LIMIT ?`).all(...params, limite);
}

export function accionesDistintas(db, excluirEntidades = []) {
  const { sql, params } = condiciones({}, excluirEntidades);
  return db.prepare(`SELECT DISTINCT accion FROM auditoria ${sql} ORDER BY accion`).all(...params).map((f) => f.accion);
}
