// Ronda R5 · Datos efímeros.
// Simula las apps de los conductores de una zona mandando su señal cada 10 s.
// Pasados 20 s, el primero "se queda sin señal" (deja de mandarla) y se muestra
// cómo desaparece solo de la lista a los ~30 s, sin ninguna escritura en la base.
//
// Uso: node scripts/presencia.js [zona] [urlApi]
const zona = process.argv[2] ?? 'centro'
const api = process.argv[3] ?? process.env.API_URL ?? 'http://localhost:3000'
const esperar = ms => new Promise(resolver => setTimeout(resolver, ms))

const listar = async () => {
  const respuesta = await fetch(`${api}/zonas/${zona}/conductores-disponibles?soloConectados=true`)
  return (await respuesta.json()).conductores
}
const latido = id => fetch(`${api}/conductores/${id}/presencia`, { method: 'PUT' })
const ttl = async id => (await (await fetch(`${api}/conductores/${id}/presencia`)).json()).segundosRestantes

const { conductores } = await (await fetch(`${api}/zonas/${zona}/conductores-disponibles`)).json()
const ids = conductores.map(c => c.id)
const sinSenal = ids[0]
console.log(`Zona ${zona}: ${ids.length} conductores disponibles. El conductor ${sinSenal} va a perder la señal a los 20 s.\n`)

const inicio = Date.now()
let ultimoLatido = -Infinity
while ((Date.now() - inicio) / 1000 < 75) {
  const t = Math.round((Date.now() - inicio) / 1000)
  if (Date.now() - ultimoLatido >= 10_000) {
    // cada 10 s, todos mandan su señal... salvo el que perdió la señal después de los 20 s
    await Promise.all(ids.filter(id => !(id === sinSenal && t >= 20)).map(latido))
    ultimoLatido = Date.now()
  }
  const visibles = await listar()
  const aparece = visibles.some(c => c.id === sinSenal)
  console.log(
    `t=${String(t).padStart(2)} s · conectados en la lista: ${String(visibles.length).padStart(2)}` +
    ` · conductor ${sinSenal}: ${aparece ? 'APARECE   ' : 'NO APARECE'} · TTL de vivo:${sinSenal} = ${await ttl(sinSenal)} s`
  )
  await esperar(5000)
}
console.log('\nEl conductor desapareció cuando venció su clave vivo:<id>. No se escribió nada en PostgreSQL.')
