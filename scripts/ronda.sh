#!/usr/bin/env bash
# Ejecuta cada ronda de la demo con docker compose.
# Uso: ./scripts/ronda.sh <comando>
#   levantar | semilla | smoke | r0 | r1 | r2 | r3 | r3-sin-indice | r4 | r4-sin | r5 | r6 | estadisticas | todo | bajar
#
# Variables opcionales:
#   MAX_RPS=200   pedidos por segundo del último escalón (subilo si R0 no se satura en tu máquina)
#   PASO=20s      duración de cada escalón (1m para la medición "oficial", 20s para la demo en vivo)
set -euo pipefail
cd "$(dirname "$0")/.."

MAX_RPS="${MAX_RPS:-200}"
PASO="${PASO:-20s}"
DC="docker compose"

titulo () { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }
sql ()    { $DC exec -T db psql -U demo -d demo -q -f "$1"; }
api ()    { # api <cache true|false> <invalidacion true|false>
  CACHE_HABILITADA="$1" INVALIDACION_HABILITADA="$2" $DC up -d --force-recreate --wait api >/dev/null
  echo "API reiniciada: caché=$1 · invalidación=$2"
}
vaciar_redis () { $DC exec -T redis redis-cli FLUSHALL >/dev/null; echo "Redis vaciado"; }
k6 ()     { # k6 <script> <ronda> [más -e]
  local script="$1" ronda="$2"; shift 2
  $DC run --rm k6 run -q -e RONDA="$ronda" -e MAX_RPS="$MAX_RPS" -e PASO="$PASO" "$@" "k6/$script"
}

case "${1:-}" in
  levantar)
    titulo "Levantando PostgreSQL, Redis y la API (la primera vez carga 200.000 conductores)"
    $DC up -d --build --wait
    ;;
  semilla)
    titulo "Volviendo a cargar los 200.000 conductores (mismos datos siempre)"
    sql /docker-entrypoint-initdb.d/02-semilla.sql
    ;;
  smoke)
    titulo "Prueba de humo: ¿funciona lo básico?"
    k6 smoke.js smoke
    ;;
  r0)
    titulo "R0 · Línea base: sin índice y sin Redis"
    sql /consultas/indice-borrar.sql
    sql /consultas/reiniciar-estadisticas.sql
    api false true
    k6 carga.js r0 || true   # se espera que NO cumpla los umbrales
    ;;
  r1)
    titulo "R1 · Diagnóstico: ¿qué consulta es lenta y por qué?"
    sql /consultas/diagnostico.sql
    ;;
  r2)
    titulo "R2 · Se agrega el índice (sin Redis)"
    sql /consultas/indice-crear.sql
    sql /consultas/reiniciar-estadisticas.sql
    api false true
    sql /consultas/diagnostico.sql | tail -n 8
    k6 carga.js r2 || true
    ;;
  r3)
    titulo "R3 · Índice + Redis (cache-aside por zona)"
    sql /consultas/indice-crear.sql
    api true true
    vaciar_redis
    k6 carga.js r3 || true
    ;;
  r3-sin-indice)
    titulo "Control · Redis SIN índice: la caché tapa el problema, pero los fallos siguen pagando la consulta lenta"
    sql /consultas/indice-borrar.sql
    api true true
    vaciar_redis
    k6 carga.js r3-sin-indice || true
    sql /consultas/indice-crear.sql
    ;;
  r4)
    titulo "R4 · Invalidación bajo escritura: CON invalidación"
    sql /consultas/indice-crear.sql
    api true true
    vaciar_redis
    k6 mixto.js r4-con-invalidacion -e DURACION=40s || true
    ;;
  r4-sin)
    titulo "R4 · Invalidación bajo escritura: SIN invalidación (el ocupado sigue apareciendo hasta 30 s)"
    api true false
    vaciar_redis
    k6 mixto.js r4-sin-invalidacion -e DURACION=40s || true
    api true true
    ;;
  r5)
    titulo "R5 · Datos efímeros: un conductor deja de mandar su señal y desaparece solo"
    api true true
    $DC exec api node scripts/presencia.js centro http://localhost:3000
    ;;
  r6)
    titulo "R6 · Redis se cae en medio de la carga"
    api true true
    vaciar_redis
    k6 carga.js r6 &
    PID=$!
    sleep 45; titulo "Apagando Redis..."; $DC stop redis >/dev/null
    curl -si localhost:3000/zonas/centro/conductores-disponibles | grep -i '^x-cache' || true
    sleep 35; titulo "Encendiendo Redis..."; $DC start redis >/dev/null
    sleep 3; curl -si localhost:3000/zonas/centro/conductores-disponibles | grep -i '^x-cache' || true
    wait $PID || true
    ;;
  estadisticas)
    curl -s localhost:3000/estadisticas; echo
    ;;
  todo)
    for r in smoke r0 r1 r2 r3 r4 r4-sin r5 r6; do "$0" "$r"; done
    ;;
  bajar)
    $DC down -v
    ;;
  *)
    sed -n '2,10p' "$0"; exit 1
    ;;
esac
