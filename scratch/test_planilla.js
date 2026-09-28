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
    console.log('--- INICIO TEST MODULO 7: PLANILLA ---')

    // 1. Login Admin
    console.log('\n1. Login como ADMIN...')
    const tokenAdmin = await login('admin@farmared.gt', 'password')
    console.log('   Token ADMIN obtenido.')

    // 2. Consultar listado de planillas existentes
    console.log('\n2. Consultando planillas del periodo 2026-09...')
    const resLista = await fetch(`${BASE_URL}/planilla?periodo=2026-09`, {
        headers: { 'Authorization': `Bearer ${tokenAdmin}` }
    })
    const jsonLista = await resLista.json()
    console.log(`   Total planillas encontradas en 2026-09: ${jsonLista.total}`)
    if (jsonLista.datos?.length > 0) {
        console.log('   Ejemplo de registro existente:', {
            ID: jsonLista.datos[0].ID,
            PERIODO: jsonLista.datos[0].PERIODO,
            EMPLEADO: jsonLista.datos[0].EMPLEADO_NOMBRE,
            SALARIO_BASE: jsonLista.datos[0].SALARIO_BASE,
            IGSS: jsonLista.datos[0].IGSS,
            TOTAL: jsonLista.datos[0].TOTAL,
            ESTADO: jsonLista.datos[0].ESTADO
        })
    }

    // 3. Generar Planilla consolidada para periodo nuevo (2026-10)
    console.log('\n3. Generando nómina consolidada para periodo 2026-10...')
    const resGen = await fetch(`${BASE_URL}/planilla/generar`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${tokenAdmin}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            periodo: '2026-10',
            bonificacion: 250.00
        })
    })
    const jsonGen = await resGen.json()
    console.log('   Resultado generación:', jsonGen)
    if (!resGen.ok) throw new Error('Fallo al generar planilla: ' + JSON.stringify(jsonGen))

    // 4. Listar planillas generadas en 2026-10
    console.log('\n4. Verificando planillas generadas en 2026-10...')
    const resGenList = await fetch(`${BASE_URL}/planilla?periodo=2026-10`, {
        headers: { 'Authorization': `Bearer ${tokenAdmin}` }
    })
    const jsonGenList = await resGenList.json()
    console.log(`   Total registros en 2026-10: ${jsonGenList.total}`)
    if (jsonGenList.total === 0) throw new Error('No se generaron registros en 2026-10')

    const primera = jsonGenList.datos[0]
    console.log('   Planilla de prueba:', {
        ID: primera.ID,
        EMPLEADO: primera.EMPLEADO_NOMBRE,
        SALARIO_BASE: primera.SALARIO_BASE,
        BONIFICACIONES: primera.BONIFICACIONES,
        IGSS: primera.IGSS,
        TOTAL: primera.TOTAL,
        ESTADO: primera.ESTADO
    })

    // Validar fórmula de IGSS (4.83%)
    const expectedIgss = Math.round(primera.SALARIO_BASE * 0.0483 * 100) / 100
    if (Math.abs(primera.IGSS - expectedIgss) > 0.05) {
        throw new Error(`Cálculo de IGSS incorrecto: obtenido ${primera.IGSS}, esperado ${expectedIgss}`)
    }
    console.log(`   ✓ Verificación de cálculo IGSS laboral correcta: ${primera.IGSS} (4.83% de ${primera.SALARIO_BASE})`)

    // 5. Aplicar ajuste individual (Bonificación adicional o descuento)
    console.log(`\n5. Aplicando ajuste a planilla #${primera.ID} (bonif Q350.00 y descuento Q50.00)...`)
    const resAjuste = await fetch(`${BASE_URL}/planilla/${primera.ID}`, {
        method: 'PATCH',
        headers: {
            'Authorization': `Bearer ${tokenAdmin}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            bonificaciones: 350.00,
            descuentos: 50.00
        })
    })
    const jsonAjuste = await resAjuste.json()
    console.log('   Resultado ajuste:', jsonAjuste)
    if (!resAjuste.ok) throw new Error('Fallo al ajustar planilla: ' + JSON.stringify(jsonAjuste))

    // 6. Pagar planilla individual
    console.log(`\n6. Pagando planilla individual #${primera.ID}...`)
    const resPago = await fetch(`${BASE_URL}/planilla/${primera.ID}/pagar`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${tokenAdmin}` }
    })
    const jsonPago = await resPago.json()
    console.log('   Resultado pago individual:', jsonPago)
    if (!resPago.ok) throw new Error('Fallo al pagar planilla: ' + JSON.stringify(jsonPago))

    // 7. Dispersar pago masivo del periodo restante
    console.log('\n7. Dispersando pago masivo del periodo 2026-10...')
    const resPagoMasivo = await fetch(`${BASE_URL}/planilla/pagar-periodo`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${tokenAdmin}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ periodo: '2026-10' })
    })
    const jsonPagoMasivo = await resPagoMasivo.json()
    console.log('   Resultado pago masivo:', jsonPagoMasivo)
    if (!resPagoMasivo.ok) throw new Error('Fallo al dispersar pago masivo: ' + JSON.stringify(jsonPagoMasivo))

    // 8. Validar RBAC: Cajero intentando generar planilla (debe responder 403 Forbidden)
    console.log('\n8. Validando restricción RBAC (Cajero intentando generar planilla)...')
    const tokenCajero = await login('cajero@farmared.gt', 'password')
    const resRbac = await fetch(`${BASE_URL}/planilla/generar`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${tokenCajero}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ periodo: '2026-11' })
    })
    console.log(`   Status respuesta cajero: ${resRbac.status} (esperado 403)`)
    if (resRbac.status !== 403) {
        throw new Error('Fallo de seguridad RBAC: Cajero pudo acceder a generar planilla')
    }
    console.log('   ✓ RBAC validado correctamente.')

    console.log('\n========================================')
    console.log('✅ MODULO 7: PLANILLA FUNCIONANDO AL 100%')
    console.log('========================================')
}

run().catch(err => {
    console.error('❌ Error en test de planilla:', err)
    process.exit(1)
})
