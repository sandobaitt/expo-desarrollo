// Prueba de humo (smoke): 1 usuario durante 10 s. ¿Funciona lo básico? Se corre antes de cada ronda.
import http from 'k6/http'
import { check, sleep } from 'k6'
import { BASE_URL, elegirZona } from './comun.js'

export const options = {
  vus: 1,
  duration: '10s',
  thresholds: { checks: ['rate==1'], http_req_failed: ['rate==0'] }
}

export default function () {
  const r = http.get(`${BASE_URL}/zonas/${elegirZona()}/conductores-disponibles`)
  check(r, {
    'responde 200': res => res.status === 200,
    'trae una lista de conductores': res => Array.isArray(res.json('conductores')),
    'informa X-Cache': res => res.headers['X-Cache'] !== undefined
  })
  sleep(0.5)
}
