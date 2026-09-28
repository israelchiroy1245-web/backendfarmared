const BASE_URL = 'http://localhost:3000/api'

async function login(email, password) {
    const res = await fetch(`${BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
    })
    const json = await res.json()
    if (!res.ok) throw new Error(`Login failed for ${email}: ${JSON.stringify(json)}`)
    return json.token
}

async function run() {
    console.log('--- INICIO TEST MODULO 6: CAJA & TURNOS ---')

    // 1. Login Cajero
    console.log('\n1. Login como CAJERO...')
    const tokenCajero = await login('cajero@farmared.gt', 'password')
    console.log('   Token cajero obtenido.')

    // Verificar si ya tiene turno activo y cerrarlo para arrancar limpio
    console.log('\n2. Verificando si existe turno activo para el cajero...')
    const resActivo = await fetch(`${BASE_URL}/caja/activo`, {
        headers: { 'Authorization': `Bearer ${tokenCajero}` }
    })
    const jsonActivo = await resActivo.json()
    if (resActivo.ok && jsonActivo.datos) {
        console.log(`   Se encontró turno previo #${jsonActivo.datos.ID} en estado ${jsonActivo.datos.ESTADO}. Cerrándolo...`)
        const resCierrePrev = await fetch(`${BASE_URL}/caja/${jsonActivo.datos.ID}/cerrar`, {
            method: 'PATCH',
            headers: {
                'Authorization': `Bearer ${tokenCajero}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                montoContado: jsonActivo.datos.MONTO_INICIAL || 500
            })
        })
        const jsonCierrePrev = await resCierrePrev.json()
        console.log('   Turno previo cerrado:', jsonCierrePrev.mensaje || jsonCierrePrev)
    } else {
        console.log('   No hay turnos abiertos previos.')
    }

    // 3. Apertura de Turno con Q500 de fondo inicial
    console.log('\n3. Abriendo nuevo turno de caja (Fondo inicial: Q500.00)...')
    const resAbrir = await fetch(`${BASE_URL}/caja/apertura`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${tokenCajero}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            sucursalId: 1,
            montoInicial: 500.00
        })
    })
    const jsonAbrir = await resAbrir.json()
    console.log('   Respuesta apertura:', jsonAbrir)
    if (!resAbrir.ok) throw new Error('Fallo al abrir turno: ' + JSON.stringify(jsonAbrir))
    const turnoId = jsonAbrir.turnoId

    // 4. Registrar Gasto menor en caja (Q35.00 agua / limpieza)
    console.log(`\n4. Registrando movimiento menor GASTO de Q35.00 en turno #${turnoId}...`)
    const resGasto = await fetch(`${BASE_URL}/caja/${turnoId}/movimiento`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${tokenCajero}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            tipo: 'GASTO',
            monto: 35.00,
            metodoPago: 'EFECTIVO',
            descripcion: 'Compra de agua purificada y suministros de limpieza'
        })
    })
    const jsonGasto = await resGasto.json()
    console.log('   Respuesta gasto:', jsonGasto)
    if (!resGasto.ok) throw new Error('Fallo al registrar gasto: ' + JSON.stringify(jsonGasto))

    // 5. Consultar Detalle del Turno
    console.log(`\n5. Consultando detalle del turno #${turnoId}...`)
    const resDetalle = await fetch(`${BASE_URL}/caja/${turnoId}`, {
        headers: { 'Authorization': `Bearer ${tokenCajero}` }
    })
    const jsonDetalle = await resDetalle.json()
    console.log('   Turno:', {
        ID: jsonDetalle.datos.ID,
        ESTADO: jsonDetalle.datos.ESTADO,
        MONTO_INICIAL: jsonDetalle.datos.MONTO_INICIAL,
        GASTOS: jsonDetalle.datos.GASTOS,
        MOVIMIENTOS_COUNT: jsonDetalle.datos.MOVIMIENTOS?.length
    })

    // 6. Cierre de Turno por el cajero
    // Inicial = 500, Gastos = 35. Esperado = 465.
    // Si cuenta Q465.00 -> diferencia 0
    console.log(`\n6. Cerrando turno #${turnoId} con arqueo físico de Q465.00 (esperado Q465.00)...`)
    const resCierre = await fetch(`${BASE_URL}/caja/${turnoId}/cerrar`, {
        method: 'PATCH',
        headers: {
            'Authorization': `Bearer ${tokenCajero}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            montoContado: 465.00,
            ventasEfectivo: 0,
            ventasTarjeta: 0,
            gastos: 35.00
        })
    })
    const jsonCierre = await resCierre.json()
    console.log('   Respuesta cierre:', jsonCierre)
    if (!resCierre.ok) throw new Error('Fallo al cerrar turno: ' + JSON.stringify(jsonCierre))

    // 7. Login como AUDITOR
    console.log('\n7. Login como AUDITOR (CU01)...')
    const tokenAuditor = await login('auditor@farmared.gt', 'password')
    console.log('   Token auditor obtenido.')

    // 8. Auditar turno
    console.log(`\n8. Auditando turno #${turnoId} por Auditor...`)
    const resAuditar = await fetch(`${BASE_URL}/caja/${turnoId}/auditar`, {
        method: 'PATCH',
        headers: {
            'Authorization': `Bearer ${tokenAuditor}`
        }
    })
    const jsonAuditar = await resAuditar.json()
    console.log('   Respuesta auditoría:', jsonAuditar)
    if (!resAuditar.ok) throw new Error('Fallo al auditar turno: ' + JSON.stringify(jsonAuditar))

    // 9. Listar turnos auditados
    console.log('\n9. Listando turnos auditados de sucursal 1...')
    const resLista = await fetch(`${BASE_URL}/caja?sucursalId=1&estado=AUDITADA`, {
        headers: { 'Authorization': `Bearer ${tokenAuditor}` }
    })
    const jsonLista = await resLista.json()
    console.log(`   Total turnos auditados encontrados: ${jsonLista.total}`)
    const auditado = jsonLista.datos.find(t => t.ID === turnoId)
    console.log('   Turno auditado en lista:', auditado)

    console.log('\n========================================')
    console.log('✅ MODULO 6: CAJA & TURNOS FUNCIONANDO AL 100%')
    console.log('========================================')
}

run().catch(err => {
    console.error('❌ Error en test de caja:', err)
    process.exit(1)
})
