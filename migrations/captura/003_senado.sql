-- Recuento del Senado. Tablas de CAPTURA (app.db y demo.db), sin claves foráneas. SOLO contadores:
-- nunca se guarda el contenido de cada papeleta.
--  modo 'sabana'  : se cuentan papeletas una a una; hay matriz de marcas.
--  modo 'totales' : se teclean totales; la matriz queda vacía («no disponible»).
CREATE TABLE senado_mesa (
  mesa_id              INTEGER PRIMARY KEY,
  modo                 TEXT NOT NULL CHECK (modo IN ('sabana', 'totales')),   -- queda fijado al guardar el primer dato
  validas              INTEGER CHECK (validas IS NULL OR validas >= 0),       -- papeletas con al menos una marca (≤ 3)
  blancas              INTEGER CHECK (blancas IS NULL OR blancas >= 0),
  nulas                INTEGER CHECK (nulas IS NULL OR nulas >= 0),
  estado               TEXT NOT NULL DEFAULT 'borrador' CHECK (estado IN ('borrador', 'cerrado')),
  version              INTEGER NOT NULL DEFAULT 1,                            -- control de concurrencia optimista
  introducido_por_tipo TEXT NOT NULL CHECK (introducido_por_tipo IN ('agente', 'admin')),
  introducido_por_id   INTEGER,
  actualizado_en       TEXT NOT NULL
);

CREATE TABLE senado_voto (
  mesa_id      INTEGER NOT NULL,
  candidato_id INTEGER NOT NULL,
  votos        INTEGER NOT NULL CHECK (votos >= 0),
  PRIMARY KEY (mesa_id, candidato_id)
);

-- Papeletas válidas por número de marcas (1, 2, 3) y por «todas las marcas son del mismo partido» (1/0).
-- Con 1 marca siempre es 1. Base de la estadística de bloque (0.6.2).
CREATE TABLE senado_matriz (
  mesa_id       INTEGER NOT NULL,
  marcas        INTEGER NOT NULL CHECK (marcas BETWEEN 1 AND 3),
  mismo_partido  INTEGER NOT NULL CHECK (mismo_partido IN (0, 1)),
  papeletas     INTEGER NOT NULL CHECK (papeletas >= 0),
  PRIMARY KEY (mesa_id, marcas, mismo_partido)
);
