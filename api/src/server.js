import Fastify from 'fastify'
import { config } from './config.js'
import { rutas } from './rutas.js'
import { pool } from './db.js'
import { redis } from './redis.js'

// Sin un log por pedido: durante una prueba de carga escribiría miles de líneas por segundo
// y mediríamos la velocidad de la consola, no la de la API.
const app = Fastify({ logger: { level: 'warn' } })

await app.register(rutas)

const cerrar = async () => {
  await app.close()
  await pool.end()
  redis.disconnect()
  process.exit(0)
}
process.on('SIGTERM', cerrar)
process.on('SIGINT', cerrar)

await app.listen({ port: config.puerto, host: '0.0.0.0' })
console.log(
  `API de conductores en el puerto ${config.puerto} · caché ${config.cacheHabilitada ? 'ACTIVADA' : 'DESACTIVADA'}` +
  ` · invalidación ${config.invalidacionHabilitada ? 'ACTIVADA' : 'DESACTIVADA'} · TTL ${config.cacheTtlSegundos} s`
)
