# Redis + k6: conductores disponibles por zona

Demo integrada del Grupo 17 · Desarrollo de Software 2026 · UTN FRRe.
Temas: **1 · Redis: caché y datos efímeros** y **30 · Pruebas de carga y análisis de rendimiento (k6)**.

Una API de viajes devuelve los conductores libres de una zona. En hora pico, cientos de pasajeros de la
misma zona hacen la misma consulta. **k6** simula esa carga y mide; **Redis** evita repetir la consulta
y maneja datos que vencen solos. Entre una ronda y la siguiente cambia **una sola cosa**, y k6 aplica
**exactamente la misma carga** para poder comparar.

```
k6 (pasajeros y conductores simulados)
        │ HTTP
        ▼
API de conductores (Node.js + Fastify) ──── 1. GET clave · 3. SET con TTL · 4. DEL tras el cambio ───▶ Redis
        │                                                                                         (caché + datos efímeros)
        └──── 2. si no está en Redis: consulta ──▶ PostgreSQL (fuente de verdad, 200.000 conductores)
```

## Requisitos

- Docker con Docker Compose v2 (`docker compose version`).
- `bash` y `curl` para el script de rondas. En Windows: WSL o Git Bash.
- No hace falta instalar Node, k6 ni PostgreSQL: todo corre en contenedores.

## Levantar

```bash
./scripts/ronda.sh levantar      # equivale a: docker compose up -d --build --wait
curl -i localhost:3000/zonas/centro/conductores-disponibles
```

La primera vez PostgreSQL carga 200.000 conductores en 50 zonas (tarda unos segundos). La respuesta trae
el encabezado `X-Cache`:

| `X-Cache` | Significado |
| --- | --- |
| `HIT` | Estaba en Redis: no se tocó la base |
| `MISS` | No estaba: se consultó PostgreSQL y se guardó en Redis con su TTL |
| `DESACTIVADA` | La caché está apagada (rondas R0 a R2) |
| `REDIS-CAIDO` | Redis no respondió: se usó PostgreSQL (ronda R6) |

## Rondas de la demo

```bash
./scripts/ronda.sh smoke         # prueba de humo: ¿funciona lo básico?
./scripts/ronda.sh r0            # línea base
./scripts/ronda.sh r1            # diagnóstico
./scripts/ronda.sh r2            # índice
./scripts/ronda.sh r3            # índice + Redis
./scripts/ronda.sh r4            # invalidación ON
./scripts/ronda.sh r4-sin        # invalidación OFF
./scripts/ronda.sh r5            # datos efímeros
./scripts/ronda.sh r6            # Redis se cae durante la carga
./scripts/ronda.sh todo          # todas en orden
./scripts/ronda.sh r3-sin-indice # control opcional: Redis sin índice
```

| Ronda | Qué cambia | Qué se espera ver |
| --- | --- | --- |
| R0 · Línea base | Sin índice, sin Redis | La API no sostiene la carga: p95 alto, iteraciones perdidas, umbrales en rojo |
| R1 · Diagnóstico | Nada: se mira la base | `pg_stat_statements` señala la consulta; `EXPLAIN` muestra *Seq Scan* sobre 200.000 filas |
| R2 · Índice | `CREATE INDEX (zona, estado, calificacion DESC)` | *Index Scan*; misma carga con todos los umbrales en verde |
| R3 · Redis | Caché por zona, TTL 30 s ± 10 % | Las consultas a la base caen casi a cero; ~99 % de aciertos |
| R4 · Invalidación | Conductores cambian de estado durante la carga | Con invalidación el ocupado desaparece al instante (100 %); sin ella sigue apareciendo (0 %) |
| R5 · Datos efímeros | Un conductor deja de mandar su señal | Desaparece solo cuando vence `vivo:<id>`, sin escribir en la base |
| R6 · Redis caído | Se apaga Redis a los 45 s y se enciende a los 80 s | Cero errores: la API responde desde PostgreSQL y vuelve a usar Redis sola |

### Ajustar la carga a tu máquina

```bash
MAX_RPS=300 PASO=20s ./scripts/ronda.sh r0
```

- `MAX_RPS` es el último escalón (por defecto 200). Los escalones son 1/8, 1/4, 1/2 y el total.
- **Calibración:** R0 tiene que saturarse (umbrales en rojo). Si en tu máquina R0 pasa todo, subí `MAX_RPS`.
- `PASO` es la duración de cada escalón: `20s` para la demo en vivo (≈ 2,5 min por ronda), `1m` para la medición completa.
- Se usa siempre la misma `MAX_RPS` en todas las rondas: si cambia la carga, la comparación no vale.

## Resultados de referencia

Medidos el 2026-11-12 en una máquina Linux de 2 núcleos, con PostgreSQL 16, Redis 7, Node 22 y k6 1.3.0
corriendo en el mismo equipo. **Los números absolutos cambian en cada máquina; lo que se repite es la
diferencia entre rondas.** Los JSON completos están en `resultados/referencia/`.

| Ronda | Carga | p95 | p99 | Errores | Consultas a PostgreSQL | Aciertos Redis | Umbrales |
| --- | --- | --- | --- | --- | --- | --- | --- |
| R0 · Sin índice ni Redis | hasta 400/s | **3.160 ms** | 3.224 ms | 0 % | 93/s (techo) · 8.407 iteraciones perdidas | — | ✘ |
| R2 · Índice | hasta 400/s | 1,4 ms | 2,6 ms | 0 % | 155/s | — | ✔ |
| R3 · Índice + Redis | hasta 400/s | 1,2 ms | 2,8 ms | 0 % | **1,7/s** | 98,9 % | ✔ |
| Control · Redis sin índice | hasta 400/s | 1,0 ms | **11,9 ms** | 0 % | 1,7/s | 98,9 % | ✔ |
| R4 · Con invalidación | 150 lecturas/s + 5 cambios/s | 1,5 ms | 2,3 ms | 0 % | 22/s | 95,1 % | ✔ lista actualizada 100 % |
| R4 · Sin invalidación | 150 lecturas/s + 5 cambios/s | 1,0 ms | 3,2 ms | 0 % | 12,5/s | 98,4 % | ✘ lista actualizada 0 % |
| R6 · Redis cae 35 s | hasta 200/s | 1,8 ms | 3,1 ms | **0 %** | 17/s | 77,2 % | ✔ |

`EXPLAIN ANALYZE` de la consulta de la zona centro: **10,6 ms** con *Parallel Seq Scan* (99.793 filas
descartadas por proceso) → **0,16 ms** con *Index Scan* (lee 20 filas).

**Cómo leer la tabla:**

- **R0 → R2:** el cuello de botella era la consulta. k6 mostró el síntoma (p95 de 3 s, iteraciones perdidas); `EXPLAIN` mostró la causa.
- **R2 → R3:** con el índice la latencia ya era buena; Redis le saca a la base el 99 % del trabajo (155 → 1,7 consultas por segundo). Es capacidad libre para más usuarios.
- **Control:** Redis solo también "arregla" el p95, pero el p99 sube a 11,9 ms porque cada fallo paga la consulta lenta. Por eso primero el índice y después la caché.
- **R4:** el TTL solo no alcanza para no mostrar datos viejos; hace falta invalidar. El TTL queda como red de seguridad.
- **R6:** la caché nunca es imprescindible.

## Endpoints

| Método y ruta | Para qué |
| --- | --- |
| `GET /zonas/:zona/conductores-disponibles` | Lista de hasta 20 conductores libres (`?soloConectados=true` filtra por presencia) |
| `PATCH /conductores/:id/estado` | `{"estado":"OCUPADO"}`: guarda en la base y después borra la copia de su zona |
| `POST /viajes` | `{"conductorId":123}`: asigna con un `UPDATE` atómico; si ya está ocupado, 409 |
| `PUT /conductores/:id/presencia` | Señal "sigo conectado": `SET vivo:<id> ... EX 30` |
| `GET /conductores/:id/presencia` | Segundos que le quedan a la señal |
| `GET /estadisticas` | Consultas a la base por segundo y aciertos de Redis |
| `POST /estadisticas/reiniciar` | Pone en cero los contadores (k6 lo llama al empezar) |
| `GET /salud` | Chequeo de vida |

Zonas: `centro`, `terminal`, `universidad`, `costanera`, `hospital` (las calientes) y `barrio-06` a `barrio-50`.

## Comandos útiles para mostrar en vivo

```bash
# Redis
docker compose exec redis redis-cli KEYS 'disponibles:*'
docker compose exec redis redis-cli TTL disponibles:zona:centro
docker compose exec redis redis-cli INFO stats | grep keyspace
docker compose exec redis redis-cli MONITOR                # ver en vivo cada GET, SET y DEL

# Invalidación a mano
curl -i localhost:3000/zonas/centro/conductores-disponibles                       # MISS y después HIT
curl -X PATCH localhost:3000/conductores/123800/estado -H 'content-type: application/json' -d '{"estado":"OCUPADO"}'
curl -i localhost:3000/zonas/centro/conductores-disponibles                       # MISS otra vez: la copia se borró

# "Caché para mostrar, base para decidir"
curl -X POST localhost:3000/viajes -H 'content-type: application/json' -d '{"conductorId":123800}'   # 409 si ya está ocupado

# PostgreSQL
docker compose exec db psql -U demo -d demo -f /consultas/diagnostico.sql

# Volver a dejar todo como al principio
./scripts/ronda.sh semilla
```

## Estructura y quién explica cada archivo

| Archivo | Qué hace | Lo explica |
| --- | --- | --- |
| `docker-compose.yml` | Levanta API, PostgreSQL, Redis y k6 | Mateo |
| `docker-compose.yml` → servicio `redis` | `maxmemory 64mb`, `allkeys-lru`, sin persistencia | Pablo |
| `api/src/redis.js` | Cliente que falla rápido para degradar a PostgreSQL (R6) | Pablo |
| `api/src/cache.js` → `leerConCache` | Cache-aside, TTL con jitter, candado anti-estampida | Drazen |
| `api/src/cache.js` → `invalidar` | Borrado de la copia después del cambio | Lucho |
| `api/src/rutas.js` → `PATCH /estado` y `POST /viajes` | Orden base → DEL; asignación atómica | Lucho |
| `api/src/presencia.js` y `api/scripts/presencia.js` | Datos efímeros: latido con TTL, `MGET` | Renzo |
| `k6/carga.js` → `scenarios` | Modelo abierto, calentamiento, escalones | More |
| `k6/comun.js` → `elegirZona` | `SharedArray` y zonas calientes (80/20) | More |
| `k6/carga.js` → `thresholds`, `cache_hit`; `k6/comun.js` → `resumen` | Umbrales, métrica propia, `handleSummary` | Agustín |
| `k6/mixto.js` | R4: lecturas y escrituras en paralelo, check de consistencia | Agustín y Lucho |
| `db/init/*.sql`, `db/consultas/*.sql` | Semilla fija, índice, `EXPLAIN`, `pg_stat_statements` | Pagno |
| `api/src/db.js` | Pool de 10 conexiones, consultas, contador | Pagno y Mateo |
| `scripts/ronda.sh` | Una ronda = un cambio | Mateo |
| `resultados/referencia/` | Evidencia de cada corrida | Emi |

## Decisiones de diseño (para el coloquio)

- **Cache-aside y no write-through:** Redis no lo trae incorporado; solo se guarda lo que alguien pidió; PostgreSQL sigue siendo la fuente de verdad.
- **Clave por zona y no por pasajero:** todos los pasajeros de una zona reciben la misma lista; una clave por zona se reutiliza cientos de veces.
- **Primero la base, después `DEL`:** si se borra antes, otro pedido puede releer el dato viejo y volver a guardarlo.
- **`DEL` y no `SET` con el valor nuevo:** borrar es idempotente; reescribir puede dejar un valor viejo si dos cambios llegan desordenados.
- **TTL aunque haya invalidación:** cubre carreras raras y fallos al borrar. El dato viejo nunca dura más de 30 s.
- **Jitter en el TTL:** evita que muchas claves venzan en el mismo segundo.
- **Candado `SET NX PX`:** cuando vence la clave del centro, va a la base un solo pedido y no cientos.
- **Asignación en la base:** la lista puede estar unos segundos vieja; el `UPDATE ... WHERE estado = 'DISPONIBLE'` decide.
- **Modelo abierto en k6:** con usuarios fijos, un servidor lento recibe menos carga y la lentitud se esconde (omisión coordinada).
- **Redis que falla rápido:** sin cola de comandos y con 200 ms de límite; un error de Redis es un fallo de caché, no un error para el usuario.
