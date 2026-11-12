-- Esquema de la demo: una sola tabla de conductores.
-- A propósito NO se crea ningún índice además de la clave primaria:
-- la ronda R0 tiene que mostrar la consulta lenta (lectura de la tabla entera).

-- Extensión que registra el tiempo de cada consulta (se usa en la ronda R1).
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

CREATE TABLE IF NOT EXISTS conductores (
  id           SERIAL PRIMARY KEY,
  nombre       TEXT          NOT NULL,
  zona         TEXT          NOT NULL,
  estado       TEXT          NOT NULL CHECK (estado IN ('DISPONIBLE', 'OCUPADO', 'DESCONECTADO')),
  calificacion NUMERIC(3, 2) NOT NULL CHECK (calificacion BETWEEN 1 AND 5)
);
