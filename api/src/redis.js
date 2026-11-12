// Cliente de Redis configurado para FALLAR RÁPIDO.
// Si Redis no responde, el comando da error enseguida y la API sigue trabajando
// con PostgreSQL (ronda R6). La caché nunca es imprescindible.
import Redis from 'ioredis'
import { config } from './config.js'

export const redis = new Redis(config.urlRedis, {
  enableOfflineQueue: false,   // si está desconectado, no encola: falla al instante
  maxRetriesPerRequest: 0,     // no reintenta cada comando
  commandTimeout: 200,         // un comando que tarda más de 200 ms cuenta como error
  connectTimeout: 1000,
  retryStrategy: intentos => Math.min(intentos * 200, 2000) // reconecta solo, cada vez más espaciado
})

// Sin este manejador, cada error de conexión cortaría el proceso.
let ultimoAviso = 0
redis.on('error', error => {
  const ahora = Date.now()
  if (ahora - ultimoAviso > 5000) {
    console.warn(`[redis] sin conexión (${error.code ?? error.message}); se responde desde PostgreSQL`)
    ultimoAviso = ahora
  }
})
redis.on('ready', () => console.log('[redis] conectado'))
