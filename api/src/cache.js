// Patrón cache-aside ("caché al costado"): la aplicación maneja la caché.
//   1. Busca en Redis.            -> si está: HIT, responde sin tocar la base.
//   2. Si no está: va a la base.  -> MISS.
//   3. Guarda el resultado en Redis con un TTL y responde.
import { config } from './config.js'
import { redis } from './redis.js'

export const claveZona = zona => `disponibles:zona:${zona}`

const esperar = ms => new Promise(resolver => setTimeout(resolver, ms))

// TTL con jitter: 30 s más o menos 10 %. Así las claves creadas juntas no vencen todas
// en el mismo segundo y no mandan a todos los pedidos a la base a la vez.
function ttlConJitter () {
  const variacion = config.cacheTtlSegundos * config.cacheJitter
  return Math.max(1, Math.round(config.cacheTtlSegundos - variacion + Math.random() * 2 * variacion))
}

async function leer (clave) {
  const guardado = await redis.get(clave)
  return guardado === null ? null : JSON.parse(guardado)
}

/**
 * Devuelve { datos, origen }. origen va al encabezado X-Cache de la respuesta:
 *   HIT          estaba en Redis
 *   MISS         no estaba; se buscó en la base y se guardó
 *   DESACTIVADA  la caché está apagada (rondas R0 a R2)
 *   REDIS-CAIDO  Redis no respondió; se usó la base (ronda R6)
 */
export async function leerConCache (clave, cargarDesdeBase) {
  if (!config.cacheHabilitada) {
    return { datos: await cargarDesdeBase(), origen: 'DESACTIVADA' }
  }

  // Paso 1: buscar en Redis. Un error de Redis se trata como un fallo: se va a la base.
  try {
    const datos = await leer(clave)
    if (datos !== null) return { datos, origen: 'HIT' }
  } catch {
    return { datos: await cargarDesdeBase(), origen: 'REDIS-CAIDO' }
  }

  // Protección contra la estampida (cache stampede): cuando vence la clave del centro,
  // cientos de pedidos fallan a la vez. Solo el que consigue el candado va a la base;
  // SET ... NX solo escribe si la clave no existe, y PX hace que el candado venza solo.
  const candado = `candado:${clave}`
  let tengoCandado = false
  try {
    tengoCandado = (await redis.set(candado, '1', 'PX', 2000, 'NX')) === 'OK'
  } catch { /* sin Redis no hay candado: se sigue igual */ }

  if (!tengoCandado) {
    // Otro pedido ya está buscando en la base: esperar un poco y leer lo que guarde.
    for (let intento = 0; intento < 5; intento++) {
      await esperar(20)
      try {
        const datos = await leer(clave)
        if (datos !== null) return { datos, origen: 'HIT' }
      } catch { break }
    }
  }

  // Pasos 2 y 3: ir a la base y guardar la copia con su TTL.
  const datos = await cargarDesdeBase()
  try {
    await redis.set(clave, JSON.stringify(datos), 'EX', ttlConJitter())
    if (tengoCandado) await redis.del(candado)
  } catch { /* si no se pudo guardar, el próximo pedido volverá a ir a la base */ }
  return { datos, origen: 'MISS' }
}

// Invalidación: se BORRA la copia (no se reescribe). Se llama DESPUÉS de que el cambio
// quedó guardado en PostgreSQL; si se borrara antes, otro pedido podría leer el dato
// viejo de la base y volver a dejarlo en Redis. El TTL queda como red de seguridad.
export async function invalidar (clave) {
  if (!config.cacheHabilitada || !config.invalidacionHabilitada) return false
  try {
    await redis.del(clave)
    return true
  } catch {
    return false // si Redis está caído no hay copia que borrar; el TTL limpia lo que haya quedado
  }
}

// Tasa de aciertos según el propio Redis (comando INFO stats).
export async function estadisticasRedis () {
  try {
    const info = await redis.info('stats')
    const valor = nombre => Number(info.match(new RegExp(`${nombre}:(\\d+)`))?.[1] ?? 0)
    const aciertos = valor('keyspace_hits')
    const fallos = valor('keyspace_misses')
    const total = aciertos + fallos
    return { aciertos, fallos, tasaAciertos: total ? Number((aciertos / total).toFixed(4)) : null }
  } catch {
    return { error: 'Redis no disponible' }
  }
}
