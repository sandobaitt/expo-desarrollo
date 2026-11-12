// Prueba de carga escalonada (rondas R0, R2, R3 y R6).
// Mismo script y misma curva en todas las rondas: lo único que cambia es el sistema.
//
// Variables (con -e):
//   RONDA     nombre de la ronda, para el archivo de resultados (r0, r2, r3...)
//   MAX_RPS   pedidos por segundo del último escalón (por defecto 400)
//   PASO      duración de cada escalón (por defecto 1m; para la demo en vivo, 20s)
import http from 'k6/http'
import { check } from 'k6'
import { Rate } from 'k6/metrics'
import { BASE_URL, elegirZona, reiniciarEstadisticas, mostrarEstadisticasServidor, resumen } from './comun.js'

const MAX = Number(__ENV.MAX_RPS || 400)
const PASO = __ENV.PASO || '1m'
const CALENTAMIENTO = __ENV.CALENTAMIENTO || '30s'
const RAMPA = __ENV.RAMPA || '10s'

// Métrica propia: porcentaje de respuestas que vinieron de Redis (encabezado X-Cache: HIT).
const cacheHit = new Rate('cache_hit')

export const options = {
  scenarios: {
    // Calentamiento: no se evalúa. El sistema recién arranca (conexiones, caché vacía).
    calentamiento: {
      executor: 'constant-arrival-rate',
      rate: Math.round(MAX / 8),
      timeUnit: '1s',
      duration: CALENTAMIENTO,
      preAllocatedVUs: 20,
      maxVUs: 100
    },
    // Carga escalonada con MODELO ABIERTO: llegan N pedidos por segundo tarde lo que tarde
    // el servidor. Si se pone lento, se forma fila y se nota (evita la omisión coordinada).
    carga: {
      executor: 'ramping-arrival-rate',
      startTime: CALENTAMIENTO,
      startRate: Math.round(MAX / 8),
      timeUnit: '1s',
      preAllocatedVUs: 50,
      maxVUs: 400,
      stages: [
        { target: Math.round(MAX / 8), duration: PASO },
        { target: Math.round(MAX / 4), duration: RAMPA },
        { target: Math.round(MAX / 4), duration: PASO },
        { target: Math.round(MAX / 2), duration: RAMPA },
        { target: Math.round(MAX / 2), duration: PASO },
        { target: MAX, duration: RAMPA },
        { target: MAX, duration: PASO }
      ]
    }
  },
  // Umbrales = criterio de aprobado. Solo se evalúa el escenario "carga".
  thresholds: {
    'http_req_duration{endpoint:disponibles,scenario:carga}': ['p(95)<200'],
    'http_req_failed{scenario:carga}': ['rate<0.01'],
    'checks{scenario:carga}': ['rate>0.99'],
    dropped_iterations: ['count==0'],
    // Sin umbral: solo para que el resumen muestre p95 y p99 del endpoint.
    'http_req_duration{endpoint:disponibles}': ['max>=0']
  },
  summaryTrendStats: ['avg', 'med', 'p(95)', 'p(99)', 'max']
}

export function setup () {
  reiniciarEstadisticas()
}

export default function () {
  const r = http.get(`${BASE_URL}/zonas/${elegirZona()}/conductores-disponibles`, {
    tags: { endpoint: 'disponibles' }
  })
  check(r, {
    'responde 200': res => res.status === 200,
    'trae conductores': res => res.status === 200 && res.json('cantidad') > 0
  })
  cacheHit.add(r.headers['X-Cache'] === 'HIT')
}

export function teardown () {
  mostrarEstadisticasServidor()
}

export const handleSummary = resumen
