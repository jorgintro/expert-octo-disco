-- Tablas de CAPTURA. Se aplican igual a app.db (datos reales) y a demo.db (datos de prueba).
-- No llevan claves foráneas a mesa/corte porque en demo.db esas tablas no existen: viven en
-- app.db, y la aplicación valida mesa_id y corte_id contra app.db antes de escribir.

CREATE TABLE participacion (
  id                  INTEGER PRIMARY KEY,
  mesa_id             INTEGER NOT NULL,
  corte_id            INTEGER NOT NULL,
  votantes_acumulados INTEGER NOT NULL CHECK (votantes_acumulados >= 0),
  introducido_por_tipo TEXT NOT NULL CHECK (introducido_por_tipo IN ('agente', 'admin')),
  introducido_por_id  INTEGER,
  actualizado_en      TEXT NOT NULL,
  UNIQUE (mesa_id, corte_id)
);

-- Auditoría de la captura. En app.db ya existe (la crea 001_inicial.sql y guarda también la
-- auditoría de configuración); en demo.db se crea aquí y solo contiene auditoría de captura demo.
CREATE TABLE IF NOT EXISTS auditoria (
  id             INTEGER PRIMARY KEY,
  fecha          TEXT NOT NULL,
  actor_tipo     TEXT NOT NULL,
  actor_id       INTEGER,
  accion         TEXT NOT NULL,
  entidad        TEXT NOT NULL,
  entidad_id     INTEGER,
  valor_anterior TEXT,
  valor_nuevo    TEXT
);
CREATE INDEX IF NOT EXISTS auditoria_fecha ON auditoria(fecha);
