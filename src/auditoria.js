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
