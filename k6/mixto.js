// Ronda R4 · Invalidación bajo escritura.
// Dos escenarios al mismo tiempo:
//   pasajeros:   leen la lista de su zona (como en carga.js), a ritmo fijo.
//   conductores: uno de la lista pasa a OCUPADO y enseguida se vuelve a pedir la lista.
//                Un check verifica que el conductor ocupado YA NO aparece.
// Se corre dos veces: con INVALIDACION_HABILITADA=true y con false.
//
// Variables: RONDA, LECTURAS_RPS (por defecto 150), CAMBIOS_POR_S (por defecto 5), DURACION (por defecto 1m)
import http from 'k6/http'
import { check } from 'k6'
import { Rate } from 'k6/metrics'
import { BASE_URL, elegirZona, reiniciarEstadisticas, mostrarEstadisticasServidor, resumen } from './comun.js'

const cacheHit = new Rate('cache_hit')
const listaActualizada = new Rate('lista_actualizada')
const DURACION = __ENV.DURACION || '1m'
const ZONAS_ESCRITURA = ['centro', 'terminal', 'universidad', 'costanera', 'hospital']
const JSON_HEADERS = { headers: { 'Content-Type': 'application/json' } }

export const options = {
  scenarios: {
    pasajeros: {
      executor: 'constant-arrival-rate',
      exec: 'pasajero',
      rate: Number(__ENV.LECTURAS_RPS || 150),
      timeUnit: '1s',
      duration: DURACION,
      preAllocatedVUs: 30,
      maxVUs: 200
    },
    conductores: {
      executor: 'constant-arrival-rate',
      exec: 'conductor',
      rate: Number(__ENV.CAMBIOS_POR_S || 5),
      timeUnit: '1s',
      duration: DURACION,
      preAllocatedVUs: 10,
      maxVUs: 50
    }
  },
  thresholds: {
    // Con invalidación, el conductor ocupado desaparece de inmediato: debería cumplirse casi siempre.
    // Sin invalidación sigue apareciendo hasta que vence el TTL: este umbral falla, y es lo que se quiere mostrar.
    lista_actualizada: ['rate>0.99'],
    http_req_failed: ['rate<0.01'],
    'http_req_duration{endpoint:disponibles}': ['p(95)<200']
  },
  summaryTrendStats: ['avg', 'med', 'p(95)', 'p(99)', 'max']
}

export function setup () {
  reiniciarEstadisticas()
}

export function pasajero () {
  const r = http.get(`${BASE_URL}/zonas/${elegirZona()}/conductores-disponibles`, { tags: { endpoint: 'disponibles' } })
  check(r, { 'lectura 200': res => res.status === 200 })
  cacheHit.add(r.headers['X-Cache'] === 'HIT')
}

export function conductor () {
  const zona = ZONAS_ESCRITURA[Math.floor(Math.random() * ZONAS_ESCRITURA.length)]
  const antes = http.get(`${BASE_URL}/zonas/${zona}/conductores-disponibles`, { tags: { endpoint: 'disponibles' } })
  const lista = antes.json('conductores') || []
  if (lista.length === 0) return
  const elegido = lista[Math.floor(Math.random() * lista.length)].id

  // 1) El conductor acepta un viaje: pasa a OCUPADO (la API guarda en la base y borra la copia).
  const cambio = http.patch(`${BASE_URL}/conductores/${elegido}/estado`, JSON.stringify({ estado: 'OCUPADO' }), JSON_HEADERS)
  check(cambio, { 'cambio de estado 200': res => res.status === 200 })

  // 2) Otro pasajero de la misma zona pide la lista enseguida: ¿todavía lo ve libre?
  const despues = http.get(`${BASE_URL}/zonas/${zona}/conductores-disponibles`, { tags: { endpoint: 'disponibles' } })
  const sigueApareciendo = (despues.json('conductores') || []).some(c => c.id === elegido)
  listaActualizada.add(!sigueApareciendo)

  // 3) Termina el viaje: vuelve a DISPONIBLE, para que los datos no se desgasten durante la prueba.
  http.patch(`${BASE_URL}/conductores/${elegido}/estado`, JSON.stringify({ estado: 'DISPONIBLE' }), JSON_HEADERS)
}

export function teardown () {
  mostrarEstadisticasServidor()
}

export const handleSummary = resumen
