// Clave-valor de configuración (tabla `ajuste` de app.db).
export function leerAjuste(db, clave) {
  return db.prepare('SELECT valor FROM ajuste WHERE clave = ?').get(clave)?.valor ?? null;
}

export function escribirAjuste(db, clave, valor) {
  db.prepare('INSERT INTO ajuste (clave, valor) VALUES (?, ?) ON CONFLICT(clave) DO UPDATE SET valor = excluded.valor').run(
    clave,
    String(valor)
  );
}
