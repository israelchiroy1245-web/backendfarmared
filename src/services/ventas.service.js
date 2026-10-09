import { oracledb } from '../config/database.js'
import { setUsuario, empleadoActivoDeUsuario } from './sesion.js'
import { num, nbind } from '../utils/oracle.js'
import { ejecutarPagina, terminoLike } from '../utils/paginacion.js'
import { assertMedicamentoActivo } from './medicamentos.service.js'

/**
 * Consulta listado de ventas con filtros y paginación
 */
export async function consultarVentas({
    sucursalId,
    empleadoId,
    clienteId,
    metodoPago,
    fechaDesde,
    fechaHasta,
    estado,
    tipoDoc,
    serie,
    numero,
    q,
    limit,
    offset,
}) {
    let conn
    try {
        conn = await oracledb.getConnection()

        let sql = `
            SELECT 
                v.ID AS "ID",
                v.Serie || '-' || v.Numero AS "FOLIO",
                v.Serie AS "SERIE",
                v.Numero AS "NUMERO",
                v.Tipo_doc AS "TIPO_DOC",
                TO_CHAR(v.Fecha, 'YYYY-MM-DD HH24:MI:SS') AS "FECHA",
                v.Subtotal AS "SUBTOTAL",
                v.Descuento AS "DESCUENTO",
                v.Iva AS "IVA",
                v.Total AS "TOTAL",
                v.Monto_recibido AS "MONTO_RECIBIDO",
                v.Vuelto AS "VUELTO",
                v.Nit AS "NIT",
                v.Nombre_factura AS "NOMBRE_FACTURA",
                v.Estado AS "ESTADO",
                v.F_Sucursal_ID AS "SUCURSAL_ID",
                s.Nombre AS "SUCURSAL_NOMBRE",
                v.F_Empleados_ID AS "EMPLEADO_ID",
                u.Nombre || ' ' || u.Apellido AS "CAJERO_NOMBRE",
                v.F_Clientes_ID AS "CLIENTE_ID",
                NVL(cli.Nombre || ' ' || NVL(cli.Apellido, ''), v.Nombre_factura) AS "CLIENTE_NOMBRE",
                v.F_Turno_caja_ID AS "TURNO_CAJA_ID",
                (SELECT COUNT(*) FROM F_Detalle_venta d WHERE d.F_Ventas_ID = v.ID) AS "TOTAL_ITEMS",
                (
                    SELECT LISTAGG(DISTINCT p.Metodo_pago, ', ') WITHIN GROUP (ORDER BY p.Metodo_pago)
                    FROM F_Venta_pago p
                    WHERE p.F_Ventas_ID = v.ID
                ) AS "METODOS_PAGO"
            FROM F_Ventas v
            JOIN F_Sucursal s ON s.ID = v.F_Sucursal_ID
            JOIN F_Empleados e ON e.ID = v.F_Empleados_ID
            JOIN F_Usuarios u ON u.ID = e.Usuarios_ID
            LEFT JOIN F_Clientes cli ON cli.ID = v.F_Clientes_ID
            WHERE 1 = 1
        `

        const binds = {}

        if (sucursalId) {
            sql += ` AND v.F_Sucursal_ID = :sucursalId`
            binds.sucursalId = nbind(sucursalId)
        }

        if (empleadoId) {
            sql += ` AND v.F_Empleados_ID = :empleadoId`
            binds.empleadoId = nbind(empleadoId)
        }

        if (clienteId) {
            sql += ` AND v.F_Clientes_ID = :clienteId`
            binds.clienteId = nbind(clienteId)
        }

        if (estado) {
            sql += ` AND v.Estado = :estado`
            binds.estado = String(estado).toUpperCase()
        }

        if (tipoDoc) {
            sql += ` AND v.Tipo_doc = :tipoDoc`
            binds.tipoDoc = String(tipoDoc).toUpperCase()
        }

        if (serie) {
            sql += ` AND v.Serie = :serie`
            binds.serie = String(serie).toUpperCase()
        }

        if (numero) {
            sql += ` AND v.Numero = :numero`
            binds.numero = String(numero).trim()
        }

        if (metodoPago) {
            sql += ` AND EXISTS (
                SELECT 1 FROM F_Venta_pago p 
                WHERE p.F_Ventas_ID = v.ID AND p.Metodo_pago = :metodoPago
            )`
            binds.metodoPago = String(metodoPago).toUpperCase()
        }

        if (fechaDesde) {
            sql += ` AND v.Fecha >= TO_DATE(:fechaDesde, 'YYYY-MM-DD')`
            binds.fechaDesde = String(fechaDesde).substring(0, 10)
        }

        if (fechaHasta) {
            sql += ` AND v.Fecha < TO_DATE(:fechaHasta, 'YYYY-MM-DD') + 1`
            binds.fechaHasta = String(fechaHasta).substring(0, 10)
        }

        const busqueda = terminoLike(q)
        if (busqueda) {
            sql += ` AND (
                UPPER(s.Nombre) LIKE :q
                OR UPPER(u.Nombre || ' ' || u.Apellido) LIKE :q
                OR UPPER(NVL(cli.Nombre || ' ' || NVL(cli.Apellido, ''), '')) LIKE :q
                OR UPPER(v.Numero) LIKE :q
                OR UPPER(v.Nit) LIKE :q
                OR UPPER(NVL(v.Nombre_factura, '')) LIKE :q
            )`
            binds.q = busqueda
        }

        return await ejecutarPagina(conn, {
            sql,
            binds,
            orderBy: 'ORDER BY "FECHA" DESC, "ID" DESC',
            limit,
            offset,
            resumenSelect: 'SUM("TOTAL") AS MONTO',
        })
    } finally {
        if (conn) {
            try { await conn.close() } catch (_) {}
        }
    }
}

/**
 * Consulta detalle de una venta por ID con sus líneas de detalle y sus pagos (3FN)
 */
export async function consultarVentaPorId(id) {
    let conn
    try {
        conn = await oracledb.getConnection()

        // 1. Cabecera
        const sqlCabecera = `
            SELECT 
                v.ID AS "ID",
                v.Serie || '-' || v.Numero AS "FOLIO",
                v.Serie AS "SERIE",
                v.Numero AS "NUMERO",
                v.Tipo_doc AS "TIPO_DOC",
                TO_CHAR(v.Fecha, 'YYYY-MM-DD HH24:MI:SS') AS "FECHA",
                v.Subtotal AS "SUBTOTAL",
                v.Descuento AS "DESCUENTO",
                v.Iva AS "IVA",
                v.Total AS "TOTAL",
                v.Monto_recibido AS "MONTO_RECIBIDO",
                v.Vuelto AS "VUELTO",
                v.Nit AS "NIT",
                v.Nombre_factura AS "NOMBRE_FACTURA",
                v.Estado AS "ESTADO",
                v.F_Sucursal_ID AS "SUCURSAL_ID",
                s.Nombre AS "SUCURSAL_NOMBRE",
                v.F_Empleados_ID AS "EMPLEADO_ID",
                u.Nombre || ' ' || u.Apellido AS "CAJERO_NOMBRE",
                u.Email AS "CAJERO_EMAIL",
                v.F_Clientes_ID AS "CLIENTE_ID",
                NVL(cli.Nombre || ' ' || NVL(cli.Apellido, ''), v.Nombre_factura) AS "CLIENTE_NOMBRE",
                cli.NIT AS "CLIENTE_NIT",
                v.F_Turno_caja_ID AS "TURNO_CAJA_ID"
            FROM F_Ventas v
            JOIN F_Sucursal s ON s.ID = v.F_Sucursal_ID
            JOIN F_Empleados e ON e.ID = v.F_Empleados_ID
            JOIN F_Usuarios u ON u.ID = e.Usuarios_ID
            LEFT JOIN F_Clientes cli ON cli.ID = v.F_Clientes_ID
            WHERE v.ID = :id
        `
        const resCab = await conn.execute(sqlCabecera, { id: nbind(id) })
        const venta = resCab.rows?.[0]
        if (!venta) return null

        // 2. Líneas de detalle
        const sqlLineas = `
            SELECT 
                d.ID AS "ID",
                d.Cantidad AS "CANTIDAD",
                d.Precio AS "PRECIO",
                d.Descuento AS "DESCUENTO",
                d.Subtotal AS "SUBTOTAL",
                d.Lote AS "LOTE",
                d.F_Medicamentos_ID AS "MEDICAMENTO_ID",
                m.Nombre_medic AS "NOMBRE_MEDICAMENTO",
                m.Codigo_barra AS "CODIGO_BARRA",
                m.Presentacion AS "PRESENTACION",
                d.F_Inventario_ID AS "INVENTARIO_ID"
            FROM F_Detalle_venta d
            JOIN F_Medicamentos m ON m.ID = d.F_Medicamentos_ID
            WHERE d.F_Ventas_ID = :id
            ORDER BY d.ID ASC
        `
        const resLineas = await conn.execute(sqlLineas, { id: nbind(id) })
        venta.ITEMS = resLineas.rows || []

        // 3. Pagos registrados (3FN)
        const sqlPagos = `
            SELECT 
                p.ID AS "ID",
                p.Metodo_pago AS "METODO_PAGO",
                p.Monto AS "MONTO",
                p.Referencia AS "REFERENCIA"
            FROM F_Venta_pago p
            WHERE p.F_Ventas_ID = :id
            ORDER BY p.ID ASC
        `
        const resPagos = await conn.execute(sqlPagos, { id: nbind(id) })
        venta.PAGOS = resPagos.rows || []

        return venta
    } finally {
        if (conn) {
            try { await conn.close() } catch (_) {}
        }
    }
}

/**
 * Emitir venta POS:
 * 1. Valida turno abierto en la sucursal (RN03/RN04)
 * 2. Genera folio correlativo atómico con fn_siguiente_folio
 * 3. Inserta cabecera en F_Ventas
 * 4. Descuenta lotes por FEFO y calcula IVA con procesar_venta
 * 5. Registra los pagos en F_Venta_pago (3FN)
 * 6. Aplica venta a caja (movimiento de caja, acumulación en turno, cálculo de vuelto) con aplicar_venta_a_caja
 */
function normalizarPagos(pagos) {
    if (!Array.isArray(pagos) || pagos.length === 0) {
        const err = new Error('Indique efectivo, tarjeta o transferencia')
        err.statusCode = 400
        throw err
    }
    const lista = []
    for (const p of pagos) {
        const metodo = String(p.metodoPago || p.metodo || '').toUpperCase().trim()
        const monto = num(p.monto)
        if (!['EFECTIVO', 'TARJETA', 'TRANSFERENCIA'].includes(metodo)) {
            const err = new Error('Indique efectivo, tarjeta o transferencia')
            err.statusCode = 400
            throw err
        }
        if (!monto || monto <= 0) {
            const err = new Error('El monto de cada pago debe ser mayor a 0')
            err.statusCode = 400
            throw err
        }
        lista.push({
            metodo,
            monto,
            referencia: p.referencia ? String(p.referencia).trim() : null,
        })
    }
    return lista
}

export async function emitirVenta({
    sucursalId,
    turnoId,
    serie = 'A',
    tipoDoc = 'TICKET',
    nit = 'CF',
    nombreFactura,
    clienteId,
    medicamentoId,
    cantidad,
    precio,
    lineas,
    pagos,
    montoRecibido,
    usuarioId,
    rol
}) {
    const listaPagos = normalizarPagos(pagos)
    let conn
    try {
        conn = await oracledb.getConnection()

        // 1. Establecer usuario de auditoría
        await setUsuario(conn, usuarioId)

        // 2. Validar que el usuario tenga empleado activo
        const empleado = await empleadoActivoDeUsuario(conn, usuarioId)
        if (!empleado) {
            const err = new Error('El usuario no tiene un empleado activo asignado')
            err.statusCode = 403
            throw err
        }
        const empleadoId = empleado.id
        if (String(rol || '').toUpperCase() === 'CAJERO' && num(empleado.sucursalId) !== num(sucursalId)) {
            const err = new Error('El cajero solo puede cobrar en su sucursal asignada')
            err.statusCode = 403
            throw err
        }

        // 3. Resolver y validar Turno de Caja Abierto en la sucursal
        let turnoCajaId = num(turnoId)
        if (!turnoCajaId) {
            const resTurno = await conn.execute(
                `SELECT ID 
                 FROM F_Turno_caja 
                 WHERE F_Sucursal_ID = :sucursalId 
                   AND Estado = 'ABIERTA' 
                 ORDER BY Fecha_apertura DESC 
                 FETCH FIRST 1 ROWS ONLY`,
                { sucursalId: nbind(sucursalId) }
            )
            turnoCajaId = resTurno.rows?.[0]?.ID
        }

        if (!turnoCajaId) {
            const err = new Error('La venta POS requiere un turno de caja abierto en la sucursal')
            err.statusCode = 409
            throw err
        }

        const resTurnoLock = await conn.execute(
            `SELECT ID, Estado, F_Sucursal_ID
               FROM F_Turno_caja
              WHERE ID = :turnoCajaId
                FOR UPDATE`,
            { turnoCajaId: nbind(turnoCajaId) }
        )
        const turnoRow = resTurnoLock.rows?.[0]
        if (!turnoRow) {
            const err = new Error('No se encontró el turno de caja')
            err.statusCode = 404
            throw err
        }
        if (String(turnoRow.ESTADO || '').toUpperCase() !== 'ABIERTA') {
            const err = new Error('La venta POS requiere un turno de caja abierto')
            err.statusCode = 409
            throw err
        }
        if (num(turnoRow.F_SUCURSAL_ID) !== num(sucursalId)) {
            const err = new Error('El turno no pertenece a la sucursal de la venta')
            err.statusCode = 409
            throw err
        }

        // 4. Normalizar líneas/items a vender
        const itemsAProcesar = []
        if (medicamentoId && cantidad) {
            itemsAProcesar.push({
                medicamentoId: num(medicamentoId),
                cantidad: num(cantidad),
                precio: precio !== undefined ? num(precio) : null
            })
        } else if (Array.isArray(lineas) && lineas.length > 0) {
            for (const item of lineas) {
                itemsAProcesar.push({
                    medicamentoId: num(item.medicamentoId || item.id),
                    cantidad: num(item.cantidad),
                    precio: item.precio !== undefined ? num(item.precio) : null
                })
            }
        }

        if (itemsAProcesar.length === 0) {
            const err = new Error('Debe especificar al menos un medicamento y cantidad (> 0) a vender')
            err.statusCode = 400
            throw err
        }

        for (const item of itemsAProcesar) {
            if (!item.medicamentoId || !item.cantidad || item.cantidad <= 0) {
                const err = new Error('Cada ítem a vender debe tener medicamentoId y cantidad (> 0) válidos')
                err.statusCode = 400
                throw err
            }
        }

        // 5. Obtener correlativo atómico con la función PL/SQL fn_siguiente_folio
        const serieDoc = String(serie || 'A').toUpperCase().trim()
        const resFolio = await conn.execute(
            `BEGIN
                :folio := fn_siguiente_folio(
                    p_sucursal_id => :sucursalId,
                    p_serie       => :serie
                );
            END;`,
            {
                sucursalId: nbind(sucursalId),
                serie: serieDoc,
                folio: { dir: oracledb.BIND_OUT, type: oracledb.STRING, maxSize: 30 }
            }
        )
        const numeroFolio = resFolio.outBinds.folio

        // 6. Resolver nombre de facturación si no fue provisto
        let nombreFact = nombreFactura ? String(nombreFactura).trim() : null
        if (!nombreFact) {
            if (clienteId) {
                const resCli = await conn.execute(
                    `SELECT Nombre || ' ' || NVL(Apellido, '') AS NOMBRE, NIT FROM F_Clientes WHERE ID = :id`,
                    { id: nbind(clienteId) }
                )
                if (resCli.rows?.[0]) {
                    nombreFact = resCli.rows[0].NOMBRE?.trim()
                    if ((!nit || nit === 'CF') && resCli.rows[0].NIT) {
                        nit = resCli.rows[0].NIT
                    }
                }
            }
            if (!nombreFact) {
                nombreFact = 'Consumidor Final'
            }
        }

        // 7. Insertar cabecera en F_Ventas
        const resVenta = await conn.execute(
            `INSERT INTO F_Ventas (
                Numero,
                Serie,
                Tipo_doc,
                Nit,
                Nombre_factura,
                Monto_recibido,
                F_Empleados_ID,
                F_Sucursal_ID,
                F_Clientes_ID,
                F_Turno_caja_ID,
                Estado
            ) VALUES (
                :numero,
                :serie,
                :tipoDoc,
                :nit,
                :nombreFactura,
                :montoRecibido,
                :emp,
                :suc,
                :cli,
                :turno,
                'EMITIDA'
            ) RETURNING ID INTO :id`,
            {
                numero: numeroFolio,
                serie: serieDoc,
                tipoDoc: ['FACTURA', 'TICKET'].includes(String(tipoDoc).toUpperCase()) ? String(tipoDoc).toUpperCase() : 'TICKET',
                nit: String(nit || 'CF').trim().toUpperCase(),
                nombreFactura: nombreFact,
                montoRecibido: montoRecibido !== undefined && montoRecibido !== null ? num(montoRecibido) : null,
                emp: nbind(empleadoId),
                suc: nbind(sucursalId),
                cli: clienteId ? nbind(clienteId) : null,
                turno: nbind(turnoCajaId),
                id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER }
            }
        )

        const ventaId = Array.isArray(resVenta.outBinds.id)
            ? resVenta.outBinds.id[0]
            : resVenta.outBinds.id

        // 8. Procesar descuento FEFO por cada ítem usando procesar_venta
        for (const item of itemsAProcesar) {
            await assertMedicamentoActivo(conn, item.medicamentoId)
            await conn.execute(
                `BEGIN
                    procesar_venta(
                        p_sucursal_id    => :s,
                        p_medicamento_id => :m,
                        p_cantidad       => :c,
                        p_venta_id       => :v,
                        p_precio         => :p
                    );
                END;`,
                {
                    s: nbind(sucursalId),
                    m: nbind(item.medicamentoId),
                    c: nbind(item.cantidad),
                    v: nbind(ventaId),
                    p: item.precio !== null ? nbind(item.precio) : null
                }
            )
        }

        // 9. Consultar Total y Subtotal calculados por el SP procesar_venta
        const resTotalVenta = await conn.execute(
            `SELECT Subtotal, Iva, Total FROM F_Ventas WHERE ID = :id`,
            { id: nbind(ventaId) }
        )
        const cabeceraCalculada = resTotalVenta.rows?.[0] || { SUBTOTAL: 0, IVA: 0, TOTAL: 0 }
        const totalVenta = Number(cabeceraCalculada.TOTAL)

        // 10. Insertar formas de pago en F_Venta_pago (3FN). Sin pagos no se cobra.
        if (listaPagos.reduce((suma, p) => suma + p.monto, 0) + 0.001 < totalVenta) {
            const err = new Error('Los pagos no cubren el total del ticket')
            err.statusCode = 400
            throw err
        }

        // Insertar cada pago en F_Venta_pago
        for (const p of listaPagos) {
            await conn.execute(
                `INSERT INTO F_Venta_pago (
                    Metodo_pago,
                    Monto,
                    Referencia,
                    F_Ventas_ID
                ) VALUES (
                    :metodo,
                    :monto,
                    :ref,
                    :ventaId
                )`,
                {
                    metodo: p.metodo,
                    monto: p.monto,
                    ref: p.referencia,
                    ventaId: nbind(ventaId)
                }
            )
        }

        // 11. Aplicar la venta a caja mediante el SP aplicar_venta_a_caja
        await conn.execute(
            `BEGIN
                aplicar_venta_a_caja(p_venta_id => :ventaId);
            END;`,
            { ventaId: nbind(ventaId) }
        )

        // 12. Consultar datos consolidados finales de la venta
        const resFinal = await conn.execute(
            `SELECT 
                v.ID,
                v.Serie || '-' || v.Numero AS FOLIO,
                v.Subtotal,
                v.Descuento,
                v.Iva,
                v.Total,
                v.Monto_recibido,
                v.Vuelto,
                v.Estado,
                v.F_Turno_caja_ID
             FROM F_Ventas v
             WHERE v.ID = :id`,
            { id: nbind(ventaId) }
        )
        const ventaFinal = resFinal.rows?.[0]

        // 13. Confirmar la transacción atómica
        await conn.commit()

        return {
            ventaId,
            folio: ventaFinal?.FOLIO,
            subtotal: Number(ventaFinal?.SUBTOTAL ?? 0),
            descuento: Number(ventaFinal?.DESCUENTO ?? 0),
            iva: Number(ventaFinal?.IVA ?? 0),
            total: Number(ventaFinal?.TOTAL ?? 0),
            montoRecibido: ventaFinal?.MONTO_RECIBIDO !== null ? Number(ventaFinal?.MONTO_RECIBIDO) : null,
            vuelto: Number(ventaFinal?.VUELTO ?? 0),
            estado: ventaFinal?.ESTADO,
            turnoId: ventaFinal?.F_TURNO_CAJA_ID,
            mensaje: 'Ticket emitido exitosamente, stock descontado por FEFO y venta aplicada a caja'
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
 * Anulación de ticket POS mediante procesar_anulacion_venta:
 * - Valida estado EMITIDA (ORA-20007)
 * - Reintegra el stock a los lotes físicos originales en F_Inventario
 * - Registra movimiento de inventario ENTRADA (ref ANULA-<id>)
 * - Registra contra-movimiento en F_Movimiento_caja (ANULACION) y descuenta acumulados de F_Turno_caja
 * - Pasa estado de la venta a ANULADA
 */
export async function anularVenta(ventaId, usuarioId) {
    let conn
    try {
        conn = await oracledb.getConnection()

        // 1. Establecer usuario de auditoría
        await setUsuario(conn, usuarioId)

        // 2. Validar que el usuario tenga empleado activo
        const empleado = await empleadoActivoDeUsuario(conn, usuarioId)
        if (!empleado) {
            const err = new Error('El usuario no tiene un empleado activo asignado')
            err.statusCode = 403
            throw err
        }

        // 3. Ejecutar SP procesar_anulacion_venta
        await conn.execute(
            `BEGIN
                procesar_anulacion_venta(p_venta_id => :v);
            END;`,
            { v: nbind(ventaId) }
        )

        // 4. Confirmar la transacción
        await conn.commit()

        return {
            ventaId,
            estado: 'ANULADA',
            mensaje: 'Venta anulada correctamente, stock restituido a lotes originales y caja ajustada'
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
