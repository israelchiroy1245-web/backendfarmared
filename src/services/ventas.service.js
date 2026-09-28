import { oracledb } from '../config/database.js'
import { setUsuario, empleadoActivoDeUsuario } from './sesion.js'
import { num, nbind } from '../utils/oracle.js'
import { ejecutarPagina, terminoLike } from '../utils/paginacion.js'

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
                TO_CHAR(v.Fecha, 'YYYY-MM-DD HH24:MI:SS') AS "FECHA",
                v.Total AS "TOTAL",
                v.Metodo_pago AS "METODO_PAGO",
                v.Estado AS "ESTADO",
                v.F_Sucursal_ID AS "SUCURSAL_ID",
                s.Nombre AS "SUCURSAL_NOMBRE",
                v.F_Empleados_ID AS "EMPLEADO_ID",
                u.Nombre || ' ' || u.Apellido AS "CAJERO_NOMBRE",
                v.F_Clientes_ID AS "CLIENTE_ID",
                NVL(cli.Nombre || ' ' || NVL(cli.Apellido, ''), 'Consumidor Final') AS "CLIENTE_NOMBRE",
                (SELECT COUNT(*) FROM F_Detalle_venta d WHERE d.F_Ventas_ID = v.ID) AS "TOTAL_ITEMS"
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

        if (metodoPago) {
            sql += ` AND v.Metodo_pago = :metodoPago`
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
                OR UPPER(NVL(cli.Nombre || ' ' || NVL(cli.Apellido, ''), 'CONSUMIDOR FINAL')) LIKE :q
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
 * Consulta detalle de una venta por ID con sus líneas de detalle
 */
export async function consultarVentaPorId(id) {
    let conn
    try {
        conn = await oracledb.getConnection()

        // 1. Cabecera
        const sqlCabecera = `
            SELECT 
                v.ID AS "ID",
                TO_CHAR(v.Fecha, 'YYYY-MM-DD HH24:MI:SS') AS "FECHA",
                v.Total AS "TOTAL",
                v.Metodo_pago AS "METODO_PAGO",
                v.Estado AS "ESTADO",
                v.F_Sucursal_ID AS "SUCURSAL_ID",
                s.Nombre AS "SUCURSAL_NOMBRE",
                v.F_Empleados_ID AS "EMPLEADO_ID",
                u.Nombre || ' ' || u.Apellido AS "CAJERO_NOMBRE",
                u.Email AS "CAJERO_EMAIL",
                v.F_Clientes_ID AS "CLIENTE_ID",
                NVL(cli.Nombre || ' ' || NVL(cli.Apellido, ''), 'Consumidor Final') AS "CLIENTE_NOMBRE",
                cli.NIT AS "CLIENTE_NIT"
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

        return venta
    } finally {
        if (conn) {
            try { await conn.close() } catch (_) {}
        }
    }
}

/**
 * Emitir venta y descontar stock automáticamente por FEFO vía Stored Procedure procesar_venta
 */
export async function emitirVenta({
    sucursalId,
    medicamentoId,
    cantidad,
    lineas,
    clienteId,
    metodoPago = 'EFECTIVO',
    usuarioId
}) {
    let conn
    try {
        conn = await oracledb.getConnection()

        // 1. Establecer usuario de auditoría
        await setUsuario(conn, usuarioId)

        // 2. Validar que el usuario tenga empleado activo
        const empleadoId = await empleadoActivoDeUsuario(conn, usuarioId)
        if (!empleadoId) {
            const err = new Error('El usuario no tiene empleado activo')
            err.statusCode = 403
            throw err
        }

        // 3. Normalizar líneas a procesar (acepta medicamentoId+cantidad directo o array lineas/items)
        const itemsAProcesar = []
        if (medicamentoId && cantidad) {
            itemsAProcesar.push({ medicamentoId: num(medicamentoId), cantidad: num(cantidad) })
        } else if (Array.isArray(lineas) && lineas.length > 0) {
            for (const item of lineas) {
                itemsAProcesar.push({
                    medicamentoId: num(item.medicamentoId),
                    cantidad: num(item.cantidad)
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

        // 4. Insertar cabecera en F_Ventas
        const resVenta = await conn.execute(
            `INSERT INTO F_Ventas (
                F_Empleados_ID,
                F_Sucursal_ID,
                F_Clientes_ID,
                Metodo_pago,
                Estado
            ) VALUES (
                :emp,
                :suc,
                :cli,
                :pago,
                'EMITIDA'
            ) RETURNING ID INTO :id`,
            {
                emp: nbind(empleadoId),
                suc: nbind(sucursalId),
                cli: clienteId ? nbind(clienteId) : null,
                pago: metodoPago,
                id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER }
            }
        )

        const ventaId = Array.isArray(resVenta.outBinds.id)
            ? resVenta.outBinds.id[0]
            : resVenta.outBinds.id

        // 5. Procesar descuento FEFO por cada ítem usando procesar_venta
        for (const item of itemsAProcesar) {
            await conn.execute(
                `BEGIN
                    procesar_venta(
                        p_sucursal_id    => :s,
                        p_medicamento_id => :m,
                        p_cantidad       => :c,
                        p_venta_id       => :v
                    );
                END;`,
                {
                    s: nbind(sucursalId),
                    m: nbind(item.medicamentoId),
                    c: nbind(item.cantidad),
                    v: nbind(ventaId)
                }
            )
        }

        // 6. Consultar total calculado por el SP
        const tot = await conn.execute(
            `SELECT Total FROM F_Ventas WHERE ID = :id`,
            { id: nbind(ventaId) }
        )
        const totalVenta = tot.rows?.[0]?.TOTAL ?? 0

        // 7. Confirmar transacción
        await conn.commit()

        return {
            ventaId,
            total: totalVenta,
            mensaje: 'Venta emitida, stock descontado por FEFO y kardex registrado'
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
