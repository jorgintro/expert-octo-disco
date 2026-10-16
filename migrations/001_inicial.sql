-- Modelo de datos de la fase 0.2. Fechas en UTC (ISO 8601).

CREATE TABLE colegio (
  id        INTEGER PRIMARY KEY,
  nombre    TEXT NOT NULL,
  municipio TEXT NOT NULL
);

CREATE TABLE mesa (
  id         INTEGER PRIMARY KEY,
  colegio_id INTEGER NOT NULL REFERENCES colegio(id),
  distrito   TEXT NOT NULL,
  seccion    TEXT NOT NULL,
  letra      TEXT NOT NULL,
  codigo     TEXT NOT NULL,
  censo      INTEGER NOT NULL CHECK (censo >= 0),
  activa     INTEGER NOT NULL DEFAULT 1 CHECK (activa IN (0, 1)),
  UNIQUE (colegio_id, codigo)
);

CREATE TABLE agente (
  id        INTEGER PRIMARY KEY,
  nombre    TEXT NOT NULL,
  pin_hmac  TEXT UNIQUE,            -- NULL = sin PIN (nunca generado o revocado)
  activo    INTEGER NOT NULL DEFAULT 1 CHECK (activo IN (0, 1)),
  creado_en TEXT NOT NULL
);

CREATE TABLE agente_mesa (
  agente_id INTEGER NOT NULL REFERENCES agente(id) ON DELETE CASCADE,
  mesa_id   INTEGER NOT NULL REFERENCES mesa(id),
  PRIMARY KEY (agente_id, mesa_id)
);

CREATE TABLE admin (
  id            INTEGER PRIMARY KEY,
  usuario       TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL
);

CREATE TABLE corte (
  id    INTEGER PRIMARY KEY,
  hora  TEXT NOT NULL UNIQUE,       -- HH:MM
  orden INTEGER NOT NULL
);

CREATE TABLE ajuste (
  clave TEXT PRIMARY KEY,
  valor TEXT NOT NULL
);

CREATE TABLE auditoria (
  id             INTEGER PRIMARY KEY,
  fecha          TEXT NOT NULL,
  actor_tipo     TEXT NOT NULL,     -- admin / agente / sistema
  actor_id       INTEGER,
  accion         TEXT NOT NULL,
  entidad        TEXT NOT NULL,
  entidad_id     INTEGER,
  valor_anterior TEXT,              -- JSON
  valor_nuevo    TEXT               -- JSON
);
CREATE INDEX auditoria_fecha ON auditoria(fecha);

-- Sesiones del servidor (admin ahora; agentes en la 0.3). El id es un HMAC del token.
CREATE TABLE sesion (
  id         TEXT PRIMARY KEY,
  actor_tipo TEXT NOT NULL CHECK (actor_tipo IN ('admin', 'agente')),
  actor_id   INTEGER NOT NULL,
  csrf       TEXT NOT NULL,
  creada_en  TEXT NOT NULL,
  expira_en  TEXT NOT NULL
);
CREATE INDEX sesion_actor ON sesion(actor_tipo, actor_id);

-- Límite de intentos de login por IP.
CREATE TABLE intento_login (
  ip              TEXT PRIMARY KEY,
  fallos          INTEGER NOT NULL DEFAULT 0,
  bloqueado_hasta TEXT
);
