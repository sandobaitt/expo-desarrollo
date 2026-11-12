// Endpoints de la API.
import { config } from './config.js'
import { buscarDisponibles, cambiarEstado, asignarConductor, contarConsultas, reiniciarContador } from './db.js'
import { leerConCache, invalidar, claveZona, estadisticasRedis } from './cache.js'
import { registrarLatido, filtrarConectados, segundosRestantes } from './presencia.js'
import { redis } from './redis.js'

const ESTADOS = ['DISPONIBLE', 'OCUPADO', 'DESCONECTADO']
const idValido = { type: 'object', properties: { id: { type: 'integer', minimum: 1 } }, required: ['id'] }

let inicioMedicion = Date.now()

export async function rutas (app) {
  // App del pasajero: conductores libres de su zona.
  // ?soloConectados=true además filtra por la señal de presencia (ronda R5).
  app.get('/zonas/:zona/conductores-disponibles', {
    schema: {
      params: { type: 'object', properties: { zona: { type: 'string', pattern: '^[a-z0-9-]{1,40}$' } } },
      querystring: { type: 'object', properties: { soloConectados: { type: 'boolean', default: false } } }
    }
  }, async (pedido, respuesta) => {
    const { zona } = pedido.params
    const { datos, origen } = await leerConCache(claveZona(zona), () => buscarDisponibles(zona))
    const conductores = pedido.query.soloConectados ? await filtrarConectados(datos) : datos
    respuesta.header('X-Cache', origen)
    return { zona, cantidad: conductores.length, conductores }
  })

  // App del conductor: cambia su estado. Primero se guarda en la base y DESPUÉS se borra la copia.
  app.patch('/conductores/:id/estado', {
    schema: {
      params: idValido,
      body: { type: 'object', properties: { estado: { enum: ESTADOS } }, required: ['estado'] }
    }
  }, async (pedido, respuesta) => {
    const resultado = await cambiarEstado(pedido.params.id, pedido.body.estado) // 1) base (confirmado)
    if (!resultado) return respuesta.code(404).send({ error: 'No existe ese conductor' })
    const invalidada = await invalidar(claveZona(resultado.zona))               // 2) borrar la copia
    return { id: pedido.params.id, zona: resultado.zona, estado: resultado.estado, cacheInvalidada: invalidada }
  })

  // App del pasajero: pide un viaje con un conductor de la lista.
  // "Caché para mostrar, base para decidir": la lista pudo estar unos segundos vieja,
  // pero la asignación se valida en PostgreSQL.
  app.post('/viajes', {
    schema: {
      body: { type: 'object', properties: { conductorId: { type: 'integer', minimum: 1 } }, required: ['conductorId'] }
    }
  }, async (pedido, respuesta) => {
    const asignado = await asignarConductor(pedido.body.conductorId)
    if (!asignado) {
      return respuesta.code(409).send({ error: 'El conductor ya no está disponible; elegí otro de la lista' })
    }
    await invalidar(claveZona(asignado.zona))
    return respuesta.code(201).send({ conductorId: pedido.body.conductorId, zona: asignado.zona, estado: 'ASIGNADO' })
  })

  // App del conductor: señal "sigo conectado" (dato efímero, vence solo).
  app.put('/conductores/:id/presencia', { schema: { params: idValido } }, async (pedido, respuesta) => {
    await registrarLatido(pedido.params.id)
    return respuesta.code(204).send()
  })

  app.get('/conductores/:id/presencia', { schema: { params: idValido } }, async pedido => {
    const segundos = await segundosRestantes(pedido.params.id)
    return { id: pedido.params.id, conectado: segundos > 0, segundosRestantes: Math.max(segundos, 0) }
  })

  // Evidencia para la demo: cuántas consultas recibió la base y cuántos aciertos tuvo Redis.
  app.get('/estadisticas', async () => {
    const segundos = (Date.now() - inicioMedicion) / 1000
    const consultas = contarConsultas()
    return {
      configuracion: {
        cacheHabilitada: config.cacheHabilitada,
        invalidacionHabilitada: config.invalidacionHabilitada,
        cacheTtlSegundos: config.cacheTtlSegundos
      },
      segundosMedidos: Number(segundos.toFixed(1)),
      consultasBase: consultas,
      consultasBasePorSegundo: Number((consultas / Math.max(segundos, 1)).toFixed(1)),
      redis: await estadisticasRedis()
    }
  })

  // k6 lo llama al empezar cada ronda, para medir desde cero.
  app.post('/estadisticas/reiniciar', async () => {
    reiniciarContador()
    inicioMedicion = Date.now()
    try { await redis.config('RESETSTAT') } catch { /* Redis caído: no hay nada que reiniciar */ }
    return { reiniciado: true }
  })

  app.get('/salud', async () => ({ estado: 'ok' }))
}
