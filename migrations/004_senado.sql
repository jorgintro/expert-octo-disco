-- Candidatos del Senado (configuración compartida por DEMO y REAL). Se eligen 4 senadores; cada lista lleva
-- 3 candidatos y cada elector marca hasta 3 nombres. Sin candidatos en el seed: los carga el administrador.
--  - `orden`: posición en la papeleta (1..n, estable; lo mantiene la app). Las listas salen en el orden de su primer candidato.
--  - La lista (grupo) de un candidato es su partido (una candidatura del Congreso, de la que hereda color y logo) o,
--    si no tiene, su `agrupacion` (texto libre, mismo texto = misma lista) y su propio color. Sin ninguna de las dos
--    es una lista de un solo candidato.
CREATE TABLE candidato_senado (
  id             INTEGER PRIMARY KEY,
  nombre         TEXT NOT NULL,
  orden          INTEGER NOT NULL CHECK (orden >= 1),
  candidatura_id INTEGER REFERENCES candidatura(id),
  agrupacion     TEXT NOT NULL DEFAULT '',
  color          TEXT NOT NULL DEFAULT '#546e7a'
                 CHECK (color GLOB '#[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]'),
  activo         INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0, 1))
);
CREATE INDEX candidato_senado_orden ON candidato_senado(orden);
