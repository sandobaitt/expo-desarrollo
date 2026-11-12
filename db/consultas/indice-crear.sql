-- Ronda R2: el índice que arregla la consulta lenta.
-- Ordena las filas por zona, estado y calificación (de mayor a menor):
-- PostgreSQL va directo a "centro / DISPONIBLE" y lee las 20 primeras, ya ordenadas.
CREATE INDEX IF NOT EXISTS idx_conductores_zona_estado_calificacion
  ON conductores (zona, estado, calificacion DESC);

ANALYZE conductores;
