-- Candidaturas (configuración compartida por DEMO y REAL). Solo Congreso en la 0.5; el Senado llegará
-- en la 0.6 con su propio modelo. Sin candidaturas en el seed: las carga el administrador desde el panel.
CREATE TABLE candidatura (
  id        INTEGER PRIMARY KEY,
  eleccion  TEXT NOT NULL DEFAULT 'congreso' CHECK (eleccion IN ('congreso', 'senado')),
  nombre    TEXT NOT NULL,
  siglas    TEXT NOT NULL DEFAULT '',
  orden     INTEGER NOT NULL CHECK (orden >= 1),      -- orden de la Junta Electoral Central; lo mantiene la app (1..n)
  destacada INTEGER NOT NULL DEFAULT 0 CHECK (destacada IN (0, 1)),
  activa    INTEGER NOT NULL DEFAULT 1 CHECK (activa IN (0, 1)),
  color     TEXT NOT NULL DEFAULT '#546e7a'
            CHECK (color GLOB '#[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]'),
  logo      BLOB,                                     -- PNG, JPEG o WebP (nunca SVG), subido desde el panel
  logo_tipo TEXT,
  logo_hash TEXT                                      -- para versionar la URL del logo
);
CREATE INDEX candidatura_orden ON candidatura(eleccion, orden);
