-- Contadores de intentos por IP y ámbito. Sustituye a intento_login.
-- Ámbitos independientes: un fallo de contraseña de administrador nunca bloquea a los agentes
-- (comparten IP pública) y viceversa.
DROP TABLE IF EXISTS intento_login;

CREATE TABLE bloqueo_ip (
  ambito          TEXT NOT NULL CHECK (ambito IN ('admin', 'pin')),
  ip              TEXT NOT NULL,
  fallos          INTEGER NOT NULL DEFAULT 0,
  desde           TEXT,              -- inicio de la ventana de recuento de fallos (UTC)
  bloqueado_hasta TEXT,              -- UTC; NULL si no está bloqueada
  PRIMARY KEY (ambito, ip)
);
