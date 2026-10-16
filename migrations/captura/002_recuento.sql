-- Recuento del Congreso. Tablas de CAPTURA: se aplican igual a app.db (reales) y a demo.db (de prueba),
-- sin claves foráneas (mesa y candidatura viven en app.db; la aplicación valida los ids).
-- «Sin rellenar» se distingue de «0»: NULL en la cabecera o ausencia de fila en recuento_voto.

CREATE TABLE recuento_mesa (
  mesa_id              INTEGER NOT NULL,
  eleccion             TEXT NOT NULL DEFAULT 'congreso' CHECK (eleccion IN ('congreso', 'senado')),
  votantes             INTEGER CHECK (votantes IS NULL OR votantes >= 0),       -- total de votantes de la mesa
  votos_blancos        INTEGER CHECK (votos_blancos IS NULL OR votos_blancos >= 0),
  votos_nulos          INTEGER CHECK (votos_nulos IS NULL OR votos_nulos >= 0),
  estado               TEXT NOT NULL DEFAULT 'borrador' CHECK (estado IN ('borrador', 'cerrado')),
  version              INTEGER NOT NULL DEFAULT 1,                              -- control de concurrencia optimista
  introducido_por_tipo TEXT NOT NULL CHECK (introducido_por_tipo IN ('agente', 'admin')),
  introducido_por_id   INTEGER,
  actualizado_en       TEXT NOT NULL,
  PRIMARY KEY (mesa_id, eleccion)
);

CREATE TABLE recuento_voto (
  mesa_id        INTEGER NOT NULL,
  candidatura_id INTEGER NOT NULL,
  votos          INTEGER NOT NULL CHECK (votos >= 0),
  PRIMARY KEY (mesa_id, candidatura_id)
);
