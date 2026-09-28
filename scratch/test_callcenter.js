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
    console.log('--- INICIO TEST MODULO 9: CALL CENTER & PEDIDOS ---')

    // 1. Login Call Center
    console.log('\n1. Login como CALL_CENTER (callcenter@farmared.gt)...')
    const tokenCC = await login('callcenter@farmared.gt', 'password')
    console.log('   Token CALL_CENTER obtenido.')

    // 2. CU03: Consulta en vivo de cobertura, stock, distancia Haversine y ETA
    console.log('\n2. CU03: Consultando disponibilidad para cliente en Zona 10 (14.598, -90.514)...')
    const resConsulta = await fetch(`${BASE_URL}/call-center/consultar`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${tokenCC}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            latitud: 14.598,
            longitud: -90.514,
            items: [
                { medicamentoId: 1, cantidad: 2 } // Paracetamol 500mg
            ]
        })
    })
    const jsonConsulta = await resConsulta.json()
    console.log('   Resultado consulta cobertura:', {
        mejorOpcion: {
            sucursal: jsonConsulta.mejorOpcion?.nombre,
            distanciaKm: jsonConsulta.mejorOpcion?.distanciaKm,
            etaMinutos: jsonConsulta.mejorOpcion?.etaMinutos,
            tieneStockCompleto: jsonConsulta.mejorOpcion?.tieneStockCompleto,
            fechaPromesa: jsonConsulta.mejorOpcion?.fechaPromesa
        },
        totalOpcionesEvaluadas: jsonConsulta.opciones?.length
    })

    if (!resConsulta.ok || !jsonConsulta.mejorOpcion) {
        throw new Error('Fallo al consultar cobertura en Call Center: ' + JSON.stringify(jsonConsulta))
    }

    const sucursalElegida = jsonConsulta.mejorOpcion

    // 3. Crear pedido formal confirmado en la llamada
    console.log(`\n3. Creando pedido confirmado asignado a ${sucursalElegida.nombre}...`)
    const resPedido = await fetch(`${BASE_URL}/pedidos`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${tokenCC}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            clienteId: 1, // Rosa Elena Juárez
            direccionEntrega: '12 calle 3-20 zona 10',
            departamento: 'Guatemala',
            municipio: 'Guatemala',
            latitud: 14.598,
            longitud: -90.514,
            sucursalId: sucursalElegida.sucursalId,
            metodoPago: 'EFECTIVO',
            canal: 'CALL_CENTER',
            items: [
                { medicamentoId: 1, cantidad: 2, precio: 18.50 }
            ]
        })
    })
    const jsonPedido = await resPedido.json()
    console.log('   Resultado creación pedido:', jsonPedido)
    if (!resPedido.ok) throw new Error('Fallo al crear pedido: ' + JSON.stringify(jsonPedido))
    const pedidoId = jsonPedido.id

    // 4. Consultar detalle del pedido
    console.log(`\n4. Consultando detalle de pedido #${pedidoId}...`)
    const resDet = await fetch(`${BASE_URL}/pedidos/${pedidoId}`, {
        headers: { 'Authorization': `Bearer ${tokenCC}` }
    })
    const jsonDet = await resDet.json()
    console.log('   Detalle pedido:', {
        ID: jsonDet.datos.ID,
        ESTADO: jsonDet.datos.ESTADO,
        CLIENTE: jsonDet.datos.CLIENTE_NOMBRE,
        SUCURSAL: jsonDet.datos.SUCURSAL_NOMBRE,
        ETA_MINUTOS: jsonDet.datos.ETA_MINUTOS,
        METODO_PAGO: jsonDet.datos.METODO_PAGO,
        TOTAL: jsonDet.datos.TOTAL,
        ITEMS_COUNT: jsonDet.datos.ITEMS?.length
    })

    // 5. Flujo de entrega: CONFIRMADO -> PREPARANDO -> EN_RUTA -> ENTREGADO
    console.log(`\n5. Avanzando ciclo logístico del pedido #${pedidoId}...`)
    
    // 5a. PREPARANDO
    const resPrep = await fetch(`${BASE_URL}/pedidos/${pedidoId}/estado`, {
        method: 'PATCH',
        headers: {
            'Authorization': `Bearer ${tokenCC}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ estado: 'PREPARANDO' })
    })
    const jsonPrep = await resPrep.json()
    console.log('   Paso 1 (PREPARANDO):', jsonPrep.mensaje)

    // 5b. EN_RUTA
    const resRuta = await fetch(`${BASE_URL}/pedidos/${pedidoId}/estado`, {
        method: 'PATCH',
        headers: {
            'Authorization': `Bearer ${tokenCC}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ estado: 'EN_RUTA' })
    })
    const jsonRuta = await resRuta.json()
    console.log('   Paso 2 (EN_RUTA):', jsonRuta.mensaje)

    // 5c. ENTREGADO
    const resEntregado = await fetch(`${BASE_URL}/pedidos/${pedidoId}/estado`, {
        method: 'PATCH',
        headers: {
            'Authorization': `Bearer ${tokenCC}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ estado: 'ENTREGADO' })
    })
    const jsonEntregado = await resEntregado.json()
    console.log('   Paso 3 (ENTREGADO):', jsonEntregado.mensaje)

    // 6. Consultar pedido final con Fecha_entrega registrada
    console.log(`\n6. Verificando pedido final #${pedidoId}...`)
    const resFinal = await fetch(`${BASE_URL}/pedidos/${pedidoId}`, {
        headers: { 'Authorization': `Bearer ${tokenCC}` }
    })
    const jsonFinal = await resFinal.json()
    console.log('   Pedido final:', {
        ID: jsonFinal.datos.ID,
        ESTADO: jsonFinal.datos.ESTADO,
        FECHA_ENTREGA: jsonFinal.datos.FECHA_ENTREGA
    })

    if (jsonFinal.datos.ESTADO !== 'ENTREGADO' || !jsonFinal.datos.FECHA_ENTREGA) {
        throw new Error('El pedido no registró correctamente el estado ENTREGADO o la fecha de entrega')
    }

    console.log('\n======================================================')
    console.log('✅ MODULO 9: CALL CENTER & PEDIDOS FUNCIONANDO AL 100%')
    console.log('======================================================')
}

run().catch(err => {
    console.error('❌ Error en test de call center:', err)
    process.exit(1)
})
