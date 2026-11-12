// Código compartido por los scripts de k6.
import http from 'k6/http'
import { SharedArray } from 'k6/data'

export const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000'
export const RONDA = __ENV.RONDA || 'sin-nombre'

// SharedArray: la lista se carga una vez y la comparten todos los usuarios virtuales.
const zonas = new SharedArray('zonas', () => {
  const calientes = ['centro', 'terminal', 'universidad', 'costanera', 'hospital']
  const resto = Array.from({ length: 45 }, (_, i) => `barrio-${String(i + 6).padStart(2, '0')}`)
  return [{ calientes, resto }]
})

// Distribución realista: el 80 % de los pedidos va a 5 zonas calientes, el 20 % a las otras 45.
// Si todos pidieran siempre la misma zona, Redis acertaría casi el 100 % y el resultado sería engañoso.
export function elegirZona () {
  const { calientes, resto } = zonas[0]
  const lista = Math.random() < 0.8 ? calientes : resto
  return lista[Math.floor(Math.random() * lista.length)]
}

export function reiniciarEstadisticas () {
  http.post(`${BASE_URL}/estadisticas/reiniciar`)
}

// Al terminar: lo que vio el servidor (consultas a la base y aciertos de Redis).
export function mostrarEstadisticasServidor () {
  const e = http.get(`${BASE_URL}/estadisticas`).json()
  const tasa = e.redis && e.redis.tasaAciertos !== null && e.redis.tasaAciertos !== undefined
    ? `${(e.redis.tasaAciertos * 100).toFixed(1)} %`
    : 'sin datos'
  console.log(
    `[servidor] consultas a PostgreSQL: ${e.consultasBase} (${e.consultasBasePorSegundo}/s)` +
    ` · aciertos según Redis: ${tasa} · caché ${e.configuracion.cacheHabilitada ? 'ON' : 'OFF'}` +
    ` · invalidación ${e.configuracion.invalidacionHabilitada ? 'ON' : 'OFF'}`
  )
}

// Resumen propio en castellano + archivo JSON en resultados/ (evidencia de cada corrida).
export function resumen (datos) {
  const m = datos.metrics
  const valor = (metrica, campo) => (m[metrica] && m[metrica].values[campo] !== undefined ? m[metrica].values[campo] : null)
  const ms = v => (v === null ? '—' : `${v.toFixed(1)} ms`)
  const pct = v => (v === null ? '—' : `${(v * 100).toFixed(2)} %`)
  const duracion = datos.state.testRunDurationMs / 1000

  const lineas = [
    '',
    `══ Ronda ${RONDA} ══════════════════════════════════════`,
    `Pedidos totales ........ ${valor('http_reqs', 'count')} (${(valor('http_reqs', 'rate') || 0).toFixed(1)} por segundo)`,
    `Latencia p95 ........... ${ms(valor('http_req_duration{endpoint:disponibles}', 'p(95)') ?? valor('http_req_duration', 'p(95)'))}`,
    `Latencia p99 ........... ${ms(valor('http_req_duration{endpoint:disponibles}', 'p(99)') ?? valor('http_req_duration', 'p(99)'))}`,
    `Latencia promedio ...... ${ms(valor('http_req_duration', 'avg'))}`,
    `Pedidos con error ...... ${pct(valor('http_req_failed', 'rate'))}`,
    `Verificaciones OK ...... ${pct(valor('checks', 'rate'))}`,
    `Aciertos de caché ...... ${pct(valor('cache_hit', 'rate'))}`,
    ...(m.lista_actualizada
      ? [`Lista actualizada ...... ${pct(valor('lista_actualizada', 'rate'))} (el conductor ocupado ya no aparece)`]
      : []),
    `Iteraciones perdidas ... ${valor('dropped_iterations', 'count') || 0}`,
    `Duración ............... ${duracion.toFixed(0)} s`,
    '',
    'Umbrales:'
  ]
  for (const [nombre, metrica] of Object.entries(m)) {
    if (!metrica.thresholds) continue
    for (const [regla, r] of Object.entries(metrica.thresholds)) {
      lineas.push(`  ${r.ok ? '✔ cumple   ' : '✘ NO cumple'}  ${nombre}: ${regla}`)
    }
  }
  lineas.push('')

  const fecha = new Date().toISOString().replace(/[:.]/g, '-')
  const carpeta = __ENV.CARPETA_RESULTADOS || 'resultados'
  return {
    stdout: lineas.join('\n'),
    [`${carpeta}/${RONDA}-${fecha}.json`]: JSON.stringify(datos, null, 2)
  }
}
