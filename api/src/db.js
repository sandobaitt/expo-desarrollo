// Acceso a PostgreSQL, la fuente de verdad.
import pg from 'pg'
import { config } from './config.js'

export const pool = new pg.Pool({
  connectionString: config.urlBase,
  max: config.conexionesBase
})

// Contador de consultas: sirve para mostrar cuánto trabajo le ahorra Redis a la base.
let consultasEjecutadas = 0
export const contarConsultas = () => consultasEjecutadas
export const reiniciarContador = () => { consultasEjecutadas = 0 }

export async function consultar (sql, parametros) {
  consultasEjecutadas++
  return pool.query(sql, parametros)
}

// La "consulta lenta" de la demo: los 20 conductores libres de una zona, mejor calificados primero.
// Sin índice, PostgreSQL lee las 200.000 filas para devolver 20.
export async function buscarDisponibles (zona) {
  const { rows } = await consultar(
    `SELECT id, nombre, calificacion
       FROM conductores
      WHERE zona = $1 AND estado = 'DISPONIBLE'
      ORDER BY calificacion DESC
      LIMIT 20`,
    [zona]
  )
  return rows.map(fila => ({ ...fila, calificacion: Number(fila.calificacion) }))
}

// Cambia el estado de un conductor. Devuelve su zona (para saber qué copia borrar) o null si no existe.
export async function cambiarEstado (id, estado) {
  const { rows } = await consultar(
    'UPDATE conductores SET estado = $2 WHERE id = $1 RETURNING zona, estado',
    [id, estado]
  )
  return rows[0] ?? null
}

// "Base para decidir": la asignación se hace en un único UPDATE atómico.
// Solo cambia la fila si el conductor TODAVÍA está disponible; si dos pasajeros
// lo piden a la vez, uno solo lo consigue. Nunca se decide leyendo la caché.
export async function asignarConductor (id) {
  const { rows } = await consultar(
    `UPDATE conductores SET estado = 'OCUPADO'
      WHERE id = $1 AND estado = 'DISPONIBLE'
      RETURNING zona`,
    [id]
  )
  return rows[0] ?? null
}
