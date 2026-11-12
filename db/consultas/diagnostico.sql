-- Ronda R1: diagnóstico. Se corre después (o durante) una prueba de k6.

-- 1) ¿Qué consulta consumió más tiempo en total?
\echo '== Consultas con más tiempo total (pg_stat_statements) =='
SELECT
  calls                               AS llamadas,
  round(total_exec_time::numeric, 0)  AS ms_totales,
  round(mean_exec_time::numeric, 2)   AS ms_promedio,
  left(regexp_replace(query, '\s+', ' ', 'g'), 90) AS consulta
FROM pg_stat_statements
WHERE query ILIKE '%conductores%'
ORDER BY total_exec_time DESC
LIMIT 5;

-- 2) ¿Cómo la ejecuta PostgreSQL?
--    Sin índice aparece "Seq Scan" (lee la tabla entera) y "Rows Removed by Filter".
--    Con índice aparece "Index Scan" y lee solo las filas que devuelve.
\echo '== Plan de ejecución de la consulta de conductores disponibles =='
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, nombre, calificacion
FROM conductores
WHERE zona = 'centro' AND estado = 'DISPONIBLE'
ORDER BY calificacion DESC
LIMIT 20;
