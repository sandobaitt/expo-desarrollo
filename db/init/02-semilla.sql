-- Semilla fija: 200.000 conductores en 50 zonas, ~10 % disponibles.
-- setseed() hace que random() devuelva siempre la misma secuencia:
-- cada vez que se corre, se generan exactamente los mismos datos (reproducibilidad).
-- Se puede volver a correr entre rondas para dejar la base como al principio.

TRUNCATE conductores RESTART IDENTITY;

SELECT setseed(0.42);

WITH zonas AS (
  SELECT ARRAY[
    'centro', 'terminal', 'universidad', 'costanera', 'hospital',
    'barrio-06', 'barrio-07', 'barrio-08', 'barrio-09', 'barrio-10',
    'barrio-11', 'barrio-12', 'barrio-13', 'barrio-14', 'barrio-15',
    'barrio-16', 'barrio-17', 'barrio-18', 'barrio-19', 'barrio-20',
    'barrio-21', 'barrio-22', 'barrio-23', 'barrio-24', 'barrio-25',
    'barrio-26', 'barrio-27', 'barrio-28', 'barrio-29', 'barrio-30',
    'barrio-31', 'barrio-32', 'barrio-33', 'barrio-34', 'barrio-35',
    'barrio-36', 'barrio-37', 'barrio-38', 'barrio-39', 'barrio-40',
    'barrio-41', 'barrio-42', 'barrio-43', 'barrio-44', 'barrio-45',
    'barrio-46', 'barrio-47', 'barrio-48', 'barrio-49', 'barrio-50'
  ] AS lista
),
azar AS (
  SELECT g, random() AS r_zona, random() AS r_estado, random() AS r_calif
  FROM generate_series(1, 200000) AS g
)
INSERT INTO conductores (nombre, zona, estado, calificacion)
SELECT
  'Conductor ' || g,
  zonas.lista[1 + floor(r_zona * 50)::int],
  CASE WHEN r_estado < 0.10 THEN 'DISPONIBLE'
       WHEN r_estado < 0.60 THEN 'OCUPADO'
       ELSE 'DESCONECTADO' END,
  round((3 + r_calif * 2)::numeric, 2)
FROM azar, zonas
ORDER BY g;

-- Actualiza las estadísticas que usa el planificador de consultas.
ANALYZE conductores;
