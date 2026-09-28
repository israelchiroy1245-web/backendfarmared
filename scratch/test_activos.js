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
    console.log('--- INICIO TEST MODULO 8: ACTIVOS FIJOS ---')

    // 1. Login Admin
    console.log('\n1. Login como ADMIN...')
    const tokenAdmin = await login('admin@farmared.gt', 'password')
    console.log('   Token ADMIN obtenido.')

    // 2. Consultar listado y balance de activos
    console.log('\n2. Consultando activos de sucursal 1...')
    const resLista = await fetch(`${BASE_URL}/activos?sucursalId=1`, {
        headers: { 'Authorization': `Bearer ${tokenAdmin}` }
    })
    const jsonLista = await resLista.json()
    console.log(`   Total activos en sucursal 1: ${jsonLista.total}`)
    console.log('   Balance gerencial en libros:', jsonLista.balance)
    if (!resLista.ok) throw new Error('Fallo al listar activos')

    // 3. Crear nuevo activo fijo
    const codigoTest = 'AF-TEST-' + Date.now().toString().slice(-4)
    console.log(`\n3. Creando nuevo activo fijo (${codigoTest})...`)
    const resCrear = await fetch(`${BASE_URL}/activos`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${tokenAdmin}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            codigo: codigoTest,
            nombre: 'Generador Eléctrico de Emergencia 15kVA',
            categoria: 'EQUIPO',
            valorAdquisicion: 25000.00,
            fechaAdquisicion: '2024-01-15',
            vidaUtilMeses: 120,
            valorResidual: 2500.00,
            depreciacionAcumulada: 1500.00,
            estado: 'EN_USO',
            sucursalId: 1
        })
    })
    const jsonCrear = await resCrear.json()
    console.log('   Resultado creación:', jsonCrear)
    if (!resCrear.ok) throw new Error('Fallo al crear activo: ' + JSON.stringify(jsonCrear))
    const activoId = jsonCrear.id

    // 4. Consultar detalle del activo creado
    console.log(`\n4. Consultando detalle de activo #${activoId}...`)
    const resDet = await fetch(`${BASE_URL}/activos/${activoId}`, {
        headers: { 'Authorization': `Bearer ${tokenAdmin}` }
    })
    const jsonDet = await resDet.json()
    console.log('   Detalle activo:', {
        ID: jsonDet.datos.ID,
        CODIGO: jsonDet.datos.CODIGO,
        NOMBRE: jsonDet.datos.NOMBRE,
        CATEGORIA: jsonDet.datos.CATEGORIA,
        VALOR_ADQUISICION: jsonDet.datos.VALOR_ADQUISICION,
        DEPRECIACION_ACUMULADA: jsonDet.datos.DEPRECIACION_ACUMULADA,
        VALOR_LIBROS: jsonDet.datos.VALOR_LIBROS,
        ESTADO: jsonDet.datos.ESTADO,
        SUCURSAL: jsonDet.datos.SUCURSAL_NOMBRE
    })

    // 5. Actualizar estado y nombre del activo
    console.log(`\n5. Actualizando activo #${activoId} a estado MANTENIMIENTO...`)
    const resAct = await fetch(`${BASE_URL}/activos/${activoId}`, {
        method: 'PATCH',
        headers: {
            'Authorization': `Bearer ${tokenAdmin}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            nombre: 'Generador Eléctrico Diésel 15kVA Insonorizado',
            estado: 'MANTENIMIENTO'
        })
    })
    const jsonAct = await resAct.json()
    console.log('   Resultado actualización:', jsonAct)
    if (!resAct.ok) throw new Error('Fallo al actualizar activo: ' + JSON.stringify(jsonAct))

    // 6. Recalcular depreciación lineal
    console.log('\n6. Ejecutando recálculo de depreciación lineal para sucursal 1...')
    const resDepr = await fetch(`${BASE_URL}/activos/depreciar`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${tokenAdmin}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ sucursalId: 1 })
    })
    const jsonDepr = await resDepr.json()
    console.log('   Resultado depreciación:', jsonDepr)
    if (!resDepr.ok) throw new Error('Fallo al depreciar activos: ' + JSON.stringify(jsonDepr))

    // 7. Eliminar activo de prueba
    console.log(`\n7. Eliminando activo de prueba #${activoId}...`)
    const resDel = await fetch(`${BASE_URL}/activos/${activoId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${tokenAdmin}` }
    })
    const jsonDel = await resDel.json()
    console.log('   Resultado eliminación:', jsonDel)
    if (!resDel.ok) throw new Error('Fallo al eliminar activo: ' + JSON.stringify(jsonDel))

    // 8. Validar RBAC (Cajero intentando registrar activo -> 403)
    console.log('\n8. Validando restricción RBAC (Cajero intentando crear activo)...')
    const tokenCajero = await login('cajero@farmared.gt', 'password')
    const resRbac = await fetch(`${BASE_URL}/activos`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${tokenCajero}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            codigo: 'FAIL-01',
            nombre: 'Intento no autorizado',
            categoria: 'EQUIPO',
            valorAdquisicion: 1000,
            fechaAdquisicion: '2024-01-01',
            vidaUtilMeses: 12,
            sucursalId: 1
        })
    })
    console.log(`   Status respuesta cajero: ${resRbac.status} (esperado 403)`)
    if (resRbac.status !== 403) {
        throw new Error('Fallo de seguridad RBAC: Cajero pudo acceder a crear activo')
    }
    console.log('   ✓ RBAC validado correctamente.')

    console.log('\n========================================')
    console.log('✅ MODULO 8: ACTIVOS FIJOS FUNCIONANDO AL 100%')
    console.log('========================================')
}

run().catch(err => {
    console.error('❌ Error en test de activos:', err)
    process.exit(1)
})
