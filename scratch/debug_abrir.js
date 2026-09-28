import { abrirTurno } from '../src/services/caja.service.js'
import { initializePool, closePool } from '../src/config/database.js'

async function test() {
    await initializePool()
    try {
        const res = await abrirTurno({ sucursalId: 1, montoInicial: 500, usuarioId: 1 })
        console.log('Result:', res)
    } catch (err) {
        console.error('Stack trace:', err)
    } finally {
        await closePool()
    }
}
test()
