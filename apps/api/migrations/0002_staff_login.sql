-- Intentos fallidos de login por empleado: tras 5 seguidos, se bloquea un rato.
CREATE TABLE staff_logins (
  name TEXT PRIMARY KEY,
  fails INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT
);
