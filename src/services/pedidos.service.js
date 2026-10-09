import { oracledb } from '../config/database.js'
import { setUsuario } from './sesion.js'
import { num, nbind } from '../utils/oracle.js'

const ESTADOS_VALIDOS = ['NUEVO', 'CONFIRMADO', 'PREPARANDO', 'EN_RUTA', 'ENTREGADO', 'CANCELADO']
const METODOS_PAGO_VALIDOS = ['EFECTIVO', 'TARJETA', 'TRANSFERENCIA']

const COORDENADAS_DEPARTAMENTO = {
    'GUATEMALA': { latitud: 14.6349, longitud: -90.5069 },
    'SACATEPEQUEZ': { latitud: 14.5586, longitud: -90.7295 },
    'ANTIGUA': { latitud: 14.5586, longitud: -90.7295 },
    'QUETZALTENANGO': { latitud: 14.8347, longitud: -91.5181 },
    'ESCUINTLA': { latitud: 14.3009, longitud: -90.7850 }
}

/**
 * Fórmula de Haversine para cálculo de distancia en km entre dos coordenadas (en Node.js)
 */
export function calcularDistanciaHaversine(lat1, lon1, lat2, lon2) {
    const R = 6371 // Radio de la Tierra en km
    const dLat = (lat2 - lat1) * Math.PI / 180
    const dLon = (lon2 - lon1) * Math.PI / 180
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2)
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    return Math.round(R * c * 100) / 100
}

/**
 * Estimar tiempo de entrega (ETA) en minutos
 * Base: 15 min de empaque/preparación + 3 min por kilómetro en tráfico urbano
 */
export function estimarEtaMinutos(distanciaKm) {
    const dist = Math.max(0, Number(distanciaKm) || 0)
    return Math.max(20, 15 + Math.ceil(dist * 3))
}

/**
 * CU03: Operador consulta disponibilidad, distancia y ETA en la llamada
 * Busca sucursales con stock de los medicamentos pedidos, calcula distancia y sugiere la más cercana
 */
export async function consultarDisponibilidad({
    latitud,
    longitud,
    departamento,
    depto,
    items,
    medicamentos
}) {
    let latCliente = num(latitud)
    let lonCliente = num(longitud)

    // Fallback de coordenadas si envían departamento
    if (latCliente === null || lonCliente === null) {
        const depKey = String(departamento || depto || 'GUATEMALA').toUpperCase().trim()
        const coords = COORDENADAS_DEPARTAMENTO[depKey] || COORDENADAS_DEPARTAMENTO['GUATEMALA']
        latCliente = coords.latitud
        lonCliente = coords.longitud
    }

    const itemsAProcesar = items || medicamentos || []
    if (!Array.isArray(itemsAProcesar) || itemsAProcesar.length === 0) {
        const err = new Error('Se requiere al menos un medicamento en la lista de items o medicamentos')
        err.statusCode = 400
        throw err
    }

    let conn
    try {
        conn = await oracledb.getConnection()

        // 1. Obtener todas las sucursales activas con coordenadas
        const resSuc = await conn.execute(
            `SELECT ID, Codigo, Nombre, Tipo, Direccion, Latitud, Longitud, Telefono
             FROM F_Sucursal
             WHERE Estado = 'ACTIVA' AND Latitud IS NOT NULL AND Longitud IS NOT NULL`
        )
        const sucursales = resSuc.rows || []

        // 2. Extraer IDs de medicamentos a consultar
        const medIds = itemsAProcesar.map(it => num(it.medicamentoId || it.id)).filter(Boolean)
        if (medIds.length === 0) {
            const err = new Error('IDs de medicamentos inválidos en items')
            err.statusCode = 400
            throw err
        }

        // Consultar información y precio de los medicamentos solicitados
        const sqlMeds = `
            SELECT ID, Nombre_medic, Codigo_barra, Precio_venta
            FROM F_Medicamentos
            WHERE ID IN (${medIds.join(',')})
        `
        const resMeds = await conn.execute(sqlMeds)
        const medsMap = new Map()
        for (const m of resMeds.rows || []) {
            medsMap.set(m.ID, m)
        }

        // 3. Consultar stock no vencido por sucursal para cada medicamento solicitado
        const sqlStock = `
            SELECT F_Sucursal_ID, F_Medicamentos_ID, NVL(SUM(Cantidad), 0) AS STOCK_DISPONIBLE
            FROM F_Inventario
            WHERE F_Medicamentos_ID IN (${medIds.join(',')})
              AND (Fecha_vencimiento IS NULL OR Fecha_vencimiento > TRUNC(SYSDATE))
            GROUP BY F_Sucursal_ID, F_Medicamentos_ID
        `
        const resStock = await conn.execute(sqlStock)
        const stockMap = new Map() // key: `${sucursalId}-${medId}` -> stock
        for (const r of resStock.rows || []) {
            stockMap.set(`${r.F_SUCURSAL_ID}-${r.F_MEDICAMENTOS_ID}`, Number(r.STOCK_DISPONIBLE) || 0)
        }

        // 4. Evaluar cada sucursal
        const opciones = []

        for (const suc of sucursales) {
            const latSuc = Number(suc.LATITUD)
            const lonSuc = Number(suc.LONGITUD)
            const distanciaKm = calcularDistanciaHaversine(latCliente, lonCliente, latSuc, lonSuc)
            const etaMinutos = estimarEtaMinutos(distanciaKm)

            const ahora = new Date()
            const fechaPromesa = new Date(ahora.getTime() + etaMinutos * 60000)

            let tieneStockCompleto = true
            let subtotalEstimado = 0
            const detalleStock = []

            for (const item of itemsAProcesar) {
                const medId = num(item.medicamentoId || item.id)
                const cantPedida = num(item.cantidad) || 1
                const medInfo = medsMap.get(medId)
                const stockDisponible = stockMap.get(`${suc.ID}-${medId}`) || 0
                const precio = Number(medInfo?.PRECIO_VENTA) || 0

                const cumple = stockDisponible >= cantPedida
                if (!cumple) {
                    tieneStockCompleto = false
                }

                subtotalEstimado += Math.round(precio * cantPedida * 100) / 100

                detalleStock.push({
                    medicamentoId: medId,
                    nombre: medInfo?.NOMBRE_MEDIC || `Medicamento #${medId}`,
                    cantidadPedida: cantPedida,
                    stockDisponible,
                    precioUnitario: precio,
                    subtotal: Math.round(precio * cantPedida * 100) / 100,
                    disponible: cumple
                })
            }

            opciones.push({
                sucursalId: suc.ID,
                codigo: suc.CODIGO,
                nombre: suc.NOMBRE,
                tipo: suc.TIPO,
                direccion: suc.DIRECCION,
                telefono: suc.TELEFONO,
                latitud: latSuc,
                longitud: lonSuc,
                distanciaKm,
                etaMinutos,
                fechaPromesa: fechaPromesa.toISOString(),
                tieneStockCompleto,
                subtotalEstimado: Math.round(subtotalEstimado * 100) / 100,
                medicamentos: detalleStock
            })
        }

        // Ordenar: primero las que tienen stock 100% completo, luego por menor distancia en km
        opciones.sort((a, b) => {
            if (a.tieneStockCompleto && !b.tieneStockCompleto) return -1
            if (!a.tieneStockCompleto && b.tieneStockCompleto) return 1
            return a.distanciaKm - b.distanciaKm
        })

        const mejorOpcion = opciones.length > 0 && opciones[0].tieneStockCompleto ? opciones[0] : (opciones[0] || null)
        const mensaje = mejorOpcion
            ? `Sucursal asignada: ${mejorOpcion.nombre} (${mejorOpcion.distanciaKm} km, ETA: ${mejorOpcion.etaMinutos} min)`
            : 'No hay sucursales disponibles'

        return {
            mensaje,
            clienteCoordenadas: { latitud: latCliente, longitud: lonCliente },
            mejorOpcion,
            opciones
        }
    } finally {
        if (conn) {
            try { await conn.close() } catch (_) {}
        }
    }
}

import { ejecutarPagina, terminoLike } from '../utils/paginacion.js'

/**
 * Listado de pedidos con filtros por estado, sucursal, cliente, fechas y paginación
 */
export async function consultarPedidos({
    estado,
    sucursalId,
    clienteId,
    canal,
    q,
    limit,
    offset
}) {
    let conn
    try {
        conn = await oracledb.getConnection()

        let sql = `
            SELECT 
                p.ID AS "ID",
                p.Canal AS "CANAL",
                p.Estado AS "ESTADO",
                p.Metodo_pago AS "METODO_PAGO",
                p.Direccion_entrega AS "DIRECCION_ENTREGA",
                p.Departamento AS "DEPARTAMENTO",
                p.Municipio AS "MUNICIPIO",
                p.Latitud AS "LATITUD",
                p.Longitud AS "LONGITUD",
                p.Eta_minutos AS "ETA_MINUTOS",
                TO_CHAR(p.Fecha_promesa, 'YYYY-MM-DD HH24:MI:SS') AS "FECHA_PROMESA",
                TO_CHAR(p.Fecha_entrega, 'YYYY-MM-DD HH24:MI:SS') AS "FECHA_ENTREGA",
                TO_CHAR(p.Creado_en, 'YYYY-MM-DD HH24:MI:SS') AS "CREADO_EN",
                p.F_Clientes_ID AS "CLIENTE_ID",
                c.Nombre || ' ' || NVL(c.Apellido, '') AS "CLIENTE_NOMBRE",
                c.Telefono AS "CLIENTE_TELEFONO",
                c.NIT AS "CLIENTE_NIT",
                p.F_Sucursal_ID AS "SUCURSAL_ID",
                s.Nombre AS "SUCURSAL_NOMBRE",
                p.F_Usuarios_ID AS "OPERADOR_ID",
                u.Nombre || ' ' || u.Apellido AS "OPERADOR_NOMBRE",
                (SELECT NVL(SUM(d.Cantidad * d.Precio), 0) FROM F_Pedido_detalle d WHERE d.F_Pedido_ID = p.ID) AS "TOTAL_PEDIDO",
                (SELECT COUNT(*) FROM F_Pedido_detalle d WHERE d.F_Pedido_ID = p.ID) AS "TOTAL_ITEMS"
            FROM F_Pedido p
            JOIN F_Clientes c ON c.ID = p.F_Clientes_ID
            LEFT JOIN F_Sucursal s ON s.ID = p.F_Sucursal_ID
            LEFT JOIN F_Usuarios u ON u.ID = p.F_Usuarios_ID
            WHERE 1 = 1
        `

        const binds = {}

        if (estado) {
            sql += ` AND p.Estado = :estado`
            binds.estado = String(estado).toUpperCase().trim()
        }

        if (sucursalId) {
            sql += ` AND p.F_Sucursal_ID = :sucursalId`
            binds.sucursalId = nbind(sucursalId)
        }

        if (clienteId) {
            sql += ` AND p.F_Clientes_ID = :clienteId`
            binds.clienteId = nbind(clienteId)
        }

        if (canal) {
            sql += ` AND p.Canal = :canal`
            binds.canal = String(canal).toUpperCase().trim()
        }

        const busqueda = terminoLike(q)
        if (busqueda) {
            sql += ` AND (
                UPPER(c.Nombre || ' ' || NVL(c.Apellido, '')) LIKE :q ESCAPE '\\'
                OR UPPER(c.NIT) LIKE :q ESCAPE '\\'
                OR UPPER(p.Direccion_entrega) LIKE :q ESCAPE '\\'
                OR UPPER(s.Nombre) LIKE :q ESCAPE '\\'
                OR UPPER(u.Nombre || ' ' || u.Apellido) LIKE :q ESCAPE '\\'
            )`
            binds.q = busqueda
        }

        return await ejecutarPagina(conn, {
            sql,
            binds,
            orderBy: 'ORDER BY p.Creado_en DESC, p.ID DESC',
            limit,
            offset,
        })
    } finally {
        if (conn) {
            try { await conn.close() } catch (_) {}
        }
    }
}

/**
 * Detalle completo de un pedido con sus líneas de medicamento
 */
export async function consultarPedidoPorId(id) {
    let conn
    try {
        conn = await oracledb.getConnection()

        const sqlCabecera = `
            SELECT 
                p.ID AS "ID",
                p.Canal AS "CANAL",
                p.Estado AS "ESTADO",
                p.Metodo_pago AS "METODO_PAGO",
                p.Direccion_entrega AS "DIRECCION_ENTREGA",
                p.Departamento AS "DEPARTAMENTO",
                p.Municipio AS "MUNICIPIO",
                p.Latitud AS "LATITUD",
                p.Longitud AS "LONGITUD",
                p.Eta_minutos AS "ETA_MINUTOS",
                TO_CHAR(p.Fecha_promesa, 'YYYY-MM-DD HH24:MI:SS') AS "FECHA_PROMESA",
                TO_CHAR(p.Fecha_entrega, 'YYYY-MM-DD HH24:MI:SS') AS "FECHA_ENTREGA",
                TO_CHAR(p.Creado_en, 'YYYY-MM-DD HH24:MI:SS') AS "CREADO_EN",
                p.F_Clientes_ID AS "CLIENTE_ID",
                c.Nombre || ' ' || NVL(c.Apellido, '') AS "CLIENTE_NOMBRE",
                c.Telefono AS "CLIENTE_TELEFONO",
                c.NIT AS "CLIENTE_NIT",
                c.Direccion AS "CLIENTE_DIRECCION",
                p.F_Sucursal_ID AS "SUCURSAL_ID",
                s.Nombre AS "SUCURSAL_NOMBRE",
                s.Telefono AS "SUCURSAL_TELEFONO",
                p.F_Usuarios_ID AS "OPERADOR_ID",
                u.Nombre || ' ' || u.Apellido AS "OPERADOR_NOMBRE"
            FROM F_Pedido p
            JOIN F_Clientes c ON c.ID = p.F_Clientes_ID
            LEFT JOIN F_Sucursal s ON s.ID = p.F_Sucursal_ID
            LEFT JOIN F_Usuarios u ON u.ID = p.F_Usuarios_ID
            WHERE p.ID = :id
        `
        const resCab = await conn.execute(sqlCabecera, { id: nbind(id) })
        const pedido = resCab.rows?.[0]
        if (!pedido) return null

        // Consultar líneas del detalle
        const sqlLineas = `
            SELECT 
                d.ID AS "ID",
                d.Cantidad AS "CANTIDAD",
                d.Precio AS "PRECIO",
                (d.Cantidad * d.Precio) AS "SUBTOTAL",
                d.F_Medicamentos_ID AS "MEDICAMENTO_ID",
                m.Nombre_medic AS "MEDICAMENTO_NOMBRE",
                m.Codigo_barra AS "CODIGO_BARRA"
            FROM F_Pedido_detalle d
            JOIN F_Medicamentos m ON m.ID = d.F_Medicamentos_ID
            WHERE d.F_Pedido_ID = :id
            ORDER BY d.ID ASC
        `
        const resLineas = await conn.execute(sqlLineas, { id: nbind(id) })
        pedido.ITEMS = resLineas.rows || []
        pedido.TOTAL = pedido.ITEMS.reduce((sum, it) => sum + (Number(it.SUBTOTAL) || 0), 0)
        pedido.TOTAL = Math.round(pedido.TOTAL * 100) / 100

        return pedido
    } finally {
        if (conn) {
            try { await conn.close() } catch (_) {}
        }
    }
}

/**
 * Crear un nuevo pedido de Call Center (con cliente existente o nuevo)
 */
export async function crearPedido({
    clienteId,
    cliente,
    direccionEntrega,
    departamento = 'Guatemala',
    municipio = 'Guatemala',
    latitud,
    longitud,
    sucursalId,
    metodoPago = 'EFECTIVO',
    canal = 'CALL_CENTER',
    items = [],
    usuarioId
}) {
    if (!Array.isArray(items) || items.length === 0) {
        const err = new Error('El pedido debe incluir al menos un producto en items')
        err.statusCode = 400
        throw err
    }

    const metodoUpper = String(metodoPago).toUpperCase().trim()
    if (!METODOS_PAGO_VALIDOS.includes(metodoUpper)) {
        const err = new Error(`Método de pago inválido. Permitidos: ${METODOS_PAGO_VALIDOS.join(', ')}`)
        err.statusCode = 400
        throw err
    }

    let conn
    try {
        conn = await oracledb.getConnection()
        await setUsuario(conn, usuarioId)

        // 1. Resolver Cliente (ID existente o crear nuevo)
        let resolvedClienteId = num(clienteId)

        if (!resolvedClienteId && cliente) {
            const nom = String(cliente.nombre || '').trim()
            if (!nom) {
                const err = new Error('El nombre del cliente es obligatorio para registrar un nuevo cliente')
                err.statusCode = 400
                throw err
            }

            const resInsCli = await conn.execute(
                `INSERT INTO F_Clientes (
                    Nombre, Apellido, NIT, Telefono, Direccion, Departamento, Municipio, Latitud, Longitud
                 ) VALUES (
                    :nom, :ape, :nit, :tel, :dir, :depto, :muni, :lat, :lon
                 ) RETURNING ID INTO :id`,
                {
                    nom,
                    ape: cliente.apellido ? String(cliente.apellido).trim() : null,
                    nit: cliente.nit ? String(cliente.nit).trim().toUpperCase() : 'CF',
                    tel: cliente.telefono ? String(cliente.telefono).trim() : null,
                    dir: cliente.direccion ? String(cliente.direccion).trim() : direccionEntrega,
                    depto: cliente.departamento ? String(cliente.departamento).trim() : departamento,
                    muni: cliente.municipio ? String(cliente.municipio).trim() : municipio,
                    lat: num(cliente.latitud ?? latitud),
                    lon: num(cliente.longitud ?? longitud),
                    id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER }
                }
            )
            resolvedClienteId = Array.isArray(resInsCli.outBinds.id) ? resInsCli.outBinds.id[0] : resInsCli.outBinds.id
        }

        if (!resolvedClienteId) {
            const err = new Error('clienteId o datos de cliente son requeridos para procesar el pedido')
            err.statusCode = 400
            throw err
        }

        // 2. Si no se especificó sucursal, buscar la más cercana y con stock mediante Haversine
        let resolvedSucursalId = num(sucursalId)
        let etaMinutos = 30

        if (latitud && longitud) {
            const resSuc = await conn.execute(
                `SELECT ID, Latitud, Longitud FROM F_Sucursal WHERE Estado = 'ACTIVA' AND Latitud IS NOT NULL`
            )
            let mejorDist = Infinity
            for (const s of resSuc.rows || []) {
                const d = calcularDistanciaHaversine(Number(latitud), Number(longitud), Number(s.LATITUD), Number(s.LONGITUD))
                if (!resolvedSucursalId && d < mejorDist) {
                    mejorDist = d
                    resolvedSucursalId = s.ID
                    etaMinutos = estimarEtaMinutos(d)
                } else if (resolvedSucursalId && s.ID === resolvedSucursalId) {
                    etaMinutos = estimarEtaMinutos(d)
                }
            }
        }

        if (!resolvedSucursalId) {
            resolvedSucursalId = 1 // Fallback sucursal principal
        }

        // 3. Crear cabecera F_Pedido
        const sqlInsPed = `
            INSERT INTO F_Pedido (
                Canal,
                Estado,
                Metodo_pago,
                Direccion_entrega,
                Departamento,
                Municipio,
                Latitud,
                Longitud,
                Eta_minutos,
                Fecha_promesa,
                Creado_en,
                F_Clientes_ID,
                F_Sucursal_ID,
                F_Usuarios_ID
            ) VALUES (
                :canal,
                'CONFIRMADO',
                :metodoPago,
                :dirEntrega,
                :depto,
                :muni,
                :lat,
                :lon,
                :eta,
                SYSTIMESTAMP + NUMTODSINTERVAL(:eta, 'MINUTE'),
                SYSTIMESTAMP,
                :clienteId,
                :sucursalId,
                :usuarioId
            ) RETURNING ID INTO :id
        `

        const resInsPed = await conn.execute(sqlInsPed, {
            canal: String(canal).toUpperCase().trim(),
            metodoPago: metodoUpper,
            dirEntrega: direccionEntrega ? String(direccionEntrega).trim() : null,
            depto: departamento ? String(departamento).trim() : 'Guatemala',
            muni: municipio ? String(municipio).trim() : 'Guatemala',
            lat: num(latitud),
            lon: num(longitud),
            eta: nbind(etaMinutos),
            clienteId: nbind(resolvedClienteId),
            sucursalId: nbind(resolvedSucursalId),
            usuarioId: nbind(usuarioId),
            id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER }
        })

        const pedidoId = Array.isArray(resInsPed.outBinds.id) ? resInsPed.outBinds.id[0] : resInsPed.outBinds.id

        // 4. Insertar líneas en F_Pedido_detalle
        let totalCalculado = 0
        for (const item of items) {
            const medId = num(item.medicamentoId || item.id)
            const cant = num(item.cantidad) || 1

            let precio = num(item.precio)
            if (precio === null) {
                // Obtener precio de F_Medicamentos
                const resMed = await conn.execute(
                    `SELECT Precio_venta FROM F_Medicamentos WHERE ID = :id`,
                    { id: nbind(medId) }
                )
                precio = Number(resMed.rows?.[0]?.PRECIO_VENTA) || 0
            }

            await conn.execute(
                `INSERT INTO F_Pedido_detalle (
                    Cantidad,
                    Precio,
                    F_Pedido_ID,
                    F_Medicamentos_ID
                 ) VALUES (
                    :cant,
                    :precio,
                    :pedidoId,
                    :medId
                 )`,
                {
                    cant: nbind(cant),
                    precio: nbind(precio),
                    pedidoId: nbind(pedidoId),
                    medId: nbind(medId)
                }
            )

            totalCalculado += Math.round(precio * cant * 100) / 100
        }

        await conn.commit()

        return {
            id: pedidoId,
            canal,
            estado: 'CONFIRMADO',
            metodoPago: metodoUpper,
            clienteId: resolvedClienteId,
            sucursalId: resolvedSucursalId,
            etaMinutos,
            total: Math.round(totalCalculado * 100) / 100,
            mensaje: `Pedido #${pedidoId} creado y confirmado con promesa de entrega en ${etaMinutos} minutos.`
        }
    } catch (error) {
        if (conn) {
            try { await conn.rollback() } catch (_) {}
        }
        throw error
    } finally {
        if (conn) {
            try { await conn.close() } catch (_) {}
        }
    }
}

/**
 * Transición de estado del pedido (CONFIRMADO -> PREPARANDO -> EN_RUTA -> ENTREGADO / CANCELADO)
 */
export async function actualizarEstadoPedido(id, nuevoEstado, usuarioId) {
    const estUpper = String(nuevoEstado || '').toUpperCase().trim()
    if (!ESTADOS_VALIDOS.includes(estUpper)) {
        const err = new Error(`Estado inválido. Debe ser uno de: ${ESTADOS_VALIDOS.join(', ')}`)
        err.statusCode = 400
        throw err
    }

    let conn
    try {
        conn = await oracledb.getConnection()
        await setUsuario(conn, usuarioId)

        const cur = await conn.execute(
            `SELECT ID, Estado FROM F_Pedido WHERE ID = :id FOR UPDATE`,
            { id: nbind(id) }
        )
        const ped = cur.rows?.[0]
        if (!ped) {
            const err = new Error('No se encontró el pedido')
            err.statusCode = 404
            throw err
        }

        if (['ENTREGADO', 'CANCELADO'].includes(ped.ESTADO)) {
            const err = new Error(`El pedido ya se encuentra en estado terminal ${ped.ESTADO} y no puede modificarse`)
            err.statusCode = 409
            throw err
        }

        let sqlUpdate = `UPDATE F_Pedido SET Estado = :estado`
        if (estUpper === 'ENTREGADO') {
            sqlUpdate += `, Fecha_entrega = SYSTIMESTAMP`
        }
        sqlUpdate += ` WHERE ID = :id`

        await conn.execute(sqlUpdate, {
            estado: estUpper,
            id: nbind(id)
        })

        await conn.commit()

        return {
            id,
            estadoAnterior: ped.ESTADO,
            estadoNuevo: estUpper,
            mensaje: `Pedido #${id} actualizado a estado ${estUpper}`
        }
    } catch (error) {
        if (conn) {
            try { await conn.rollback() } catch (_) {}
        }
        throw error
    } finally {
        if (conn) {
            try { await conn.close() } catch (_) {}
        }
    }
}
