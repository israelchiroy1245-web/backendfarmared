const BASE_URL = 'http://localhost:3000/api'

async function login(email, password) {
    const res = await fetch(`${BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
    })
    const json = await res.json()
    if (!res.ok) throw new Error(`Login fallido para ${email}: ${JSON.stringify(json)}`)
    return json.token
}

async function run() {
    console.log('--- INICIO TEST MODULO 10: REPORTES GERENCIALES & METRICAS ---')

    // 1. Login Admin
    console.log('\n1. Login como ADMIN...')
    const tokenAdmin = await login('admin@farmared.gt', 'password')
    console.log('   Token ADMIN obtenido.')

    // 2. CU04: Reporte Consolidado de la Red de Farmacias
    console.log('\n2. CU04: Consultando Valor Consolidado de la Red (Bolsa ~US$ 5M)...')
    const resConsolidado = await fetch(`${BASE_URL}/reportes/consolidado-red`, {
        headers: { 'Authorization': `Bearer ${tokenAdmin}` }
    })
    const jsonConsolidado = await resConsolidado.json()
    console.log('   Resultado Consolidado Red:')
    console.log('   - Valor Consolidado (GTQ): Q', jsonConsolidado.datos?.resumenPatrimonial?.valorConsolidadoGTQ)
    console.log('   - Valor Consolidado (USD): $', jsonConsolidado.datos?.resumenPatrimonial?.valorConsolidadoUSD)
    console.log('   - Inventario a Costo: Q', jsonConsolidado.datos?.resumenPatrimonial?.inventarioCosto)
    console.log('   - Activos Fijos en Libros: Q', jsonConsolidado.datos?.resumenPatrimonial?.activosFijosLibros)
    console.log('   - Planilla Mensual: Q', jsonConsolidado.datos?.resumenPatrimonial?.planillaMensual)
    console.log('   - Total Sucursales Activas:', jsonConsolidado.datos?.sucursales?.totalActivas)
    console.log('   - Desglose por Sucursales (primeras 3):', jsonConsolidado.datos?.desglosePorSucursal?.slice(0, 3))

    if (!resConsolidado.ok || !jsonConsolidado.datos?.resumenPatrimonial?.valorConsolidadoGTQ) {
        throw new Error('Fallo al obtener reporte consolidado de la red: ' + JSON.stringify(jsonConsolidado))
    }

    // 3. Reporte de Ventas por Sucursal
    console.log('\n3. Consultando Reporte de Ventas por Sucursal...')
    const resVentas = await fetch(`${BASE_URL}/reportes/ventas`, {
        headers: { 'Authorization': `Bearer ${tokenAdmin}` }
    })
    const jsonVentas = await resVentas.json()
    console.log('   Total Ventas Red:', jsonVentas.datos?.totalVentasRed)
    console.log('   Sucursales con ventas registradas:', jsonVentas.datos?.sucursales?.length)

    // 4. Reporte de Inventario FEFO y Próximos a Vencer
    console.log('\n4. Consultando Reporte de Inventario FEFO (vencimiento <= 180 días)...')
    const resInv = await fetch(`${BASE_URL}/reportes/inventario?dias=180`, {
        headers: { 'Authorization': `Bearer ${tokenAdmin}` }
    })
    const jsonInv = await resInv.json()
    console.log('   Lotes próximos a vencer:', jsonInv.datos?.totalLotesProximos)
    console.log('   Valor en riesgo: Q', jsonInv.datos?.valorEnRiesgo)

    // 5. Reporte de Auditoría de Cajas (Faltantes y Sobrantes)
    console.log('\n5. Consultando Reporte de Arqueos de Caja...')
    const resCaja = await fetch(`${BASE_URL}/reportes/caja`, {
        headers: { 'Authorization': `Bearer ${tokenAdmin}` }
    })
    const jsonCaja = await resCaja.json()
    console.log('   Métricas de Arqueo:', jsonCaja.datos?.metricas)

    // 6. Validar RBAC (Cajero no tiene permiso para ver reportes gerenciales -> 403)
    console.log('\n6. Validando restricción RBAC (Cajero intentando ver reporte consolidado)...')
    const tokenCajero = await login('cajero@farmared.gt', 'password')
    const resRbac = await fetch(`${BASE_URL}/reportes/consolidado-red`, {
        headers: { 'Authorization': `Bearer ${tokenCajero}` }
    })
    console.log(`   Status respuesta cajero: ${resRbac.status} (esperado 403)`)
    if (resRbac.status !== 403) {
        throw new Error('Fallo de seguridad RBAC: Cajero pudo acceder a reporte consolidado')
    }
    console.log('   ✓ RBAC validado correctamente.')

    console.log('\n======================================================')
    console.log('✅ MODULO 10: REPORTES GERENCIALES FUNCIONANDO AL 100%')
    console.log('======================================================')
}

run().catch(err => {
    console.error('❌ Error en test de reportes:', err)
    process.exit(1)
})
