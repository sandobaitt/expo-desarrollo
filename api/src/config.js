// Configuración por variables de entorno.
// Cada ronda de la demo cambia UNA de estas variables y nada más.

const siONo = (valor, porDefecto) =>
  valor === undefined ? porDefecto : ['1', 'true', 'si', 'sí'].includes(String(valor).toLowerCase())

export const config = {
  puerto: Number(process.env.PUERTO ?? 3000),
  urlBase: process.env.DATABASE_URL ?? 'postgres://demo:demo@localhost:5432/demo',
  urlRedis: process.env.REDIS_URL ?? 'redis://localhost:6379',

  // Pool de conexiones a PostgreSQL: 10 "cajas" atendiendo consultas (Ley de Little).
  conexionesBase: Number(process.env.CONEXIONES_BASE ?? 10),

  // R0-R2: false (sin Redis). R3 en adelante: true.
  cacheHabilitada: siONo(process.env.CACHE_HABILITADA, true),

  // R4: se corre con true y con false para ver la diferencia.
  invalidacionHabilitada: siONo(process.env.INVALIDACION_HABILITADA, true),

  // Tiempo de vida de la copia de cada zona, en segundos.
  cacheTtlSegundos: Number(process.env.CACHE_TTL_S ?? 30),

  // Variación al azar del TTL (jitter): 0.1 = más o menos 10 %.
  cacheJitter: Number(process.env.CACHE_JITTER ?? 0.1),

  // Datos efímeros: cuánto vive la señal "sigo conectado" de un conductor.
  presenciaTtlSegundos: Number(process.env.PRESENCIA_TTL_S ?? 30)
}
