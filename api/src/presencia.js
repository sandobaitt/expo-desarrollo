// Datos efímeros: "¿el conductor sigue conectado?".
// La app del conductor manda una señal (heartbeat) cada 10 s. Cada señal escribe
// la clave vivo:<id> con vencimiento de 30 s. Si las señales se cortan, la clave
// vence sola y el conductor deja de aparecer, sin escribir nada en PostgreSQL.
import { config } from './config.js'
import { redis } from './redis.js'

const clavePresencia = id => `vivo:${id}`

export async function registrarLatido (id) {
  // SET con EX: guarda y pone el vencimiento en un solo comando. Cada latido reinicia el reloj.
  await redis.set(clavePresencia(id), Date.now(), 'EX', config.presenciaTtlSegundos)
}

// Deja en la lista solo a los conductores cuya señal sigue viva.
// MGET pide todas las claves en un solo viaje a Redis.
export async function filtrarConectados (conductores) {
  if (conductores.length === 0) return conductores
  try {
    const senales = await redis.mget(conductores.map(c => clavePresencia(c.id)))
    return conductores.filter((_, i) => senales[i] !== null)
  } catch {
    return conductores // sin Redis no se puede saber quién está conectado: se muestra la lista completa
  }
}

export async function segundosRestantes (id) {
  return redis.ttl(clavePresencia(id)) // -2 = la clave ya no existe
}
