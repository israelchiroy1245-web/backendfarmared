import { oracledb } from '../config/database.js'
import { setUsuario, empleadoActivoDeUsuario } from './sesion.js'
import { num, nbind } from '../utils/oracle.js'
import { ejecutarPagina, terminoLike } from '../utils/paginacion.js'
import { assertMedicamentoActivo } from './medicamentos.service.js'

/**
 * Listado de compras con filtros
 */
export async function consultarCompras({ sucursalId, proveedorId, fechaDesde, fechaHasta, q, limit, offset }) {
    let conn
    try {
        conn = await oracledb.getConnection()

        let sql = `
            SELECT 
                c.ID AS "ID",
                c.Numero_Factura AS "NUMERO_FACTURA",
                TO_CHAR(c.Fecha_compra, 'YYYY-MM-DD') AS "FECHA_COMPRA",
                c.Total_compra AS "TOTAL_COMPRA",
                c.F_Proveedores_Id AS "PROVEEDOR_ID",
                p.Nombre AS "PROVEEDOR_NOMBRE",
                p.NIT AS "PROVEEDOR_NIT",
                c.F_Sucursal_ID AS "SUCURSAL_ID",
                s.Nombre AS "SUCURSAL_NOMBRE",
                c.F_Empleados_ID AS "EMPLEADO_ID",
                u.Nombre || ' ' || u.Apellido AS "EMPLEADO_NOMBRE",
                (SELECT COUNT(*) FROM F_Detalle_compra d WHERE d.F_Compras_ID = c.ID) AS "TOTAL_LINEAS"
            FROM F_Compras c
            JOIN F_Proveedores p ON p.ID = c.F_Proveedores_Id
            JOIN F_Sucursal s ON s.ID = c.F_Sucursal_ID
            JOIN F_Empleados e ON e.ID = c.F_Empleados_ID
            JOIN F_Usuarios u ON u.ID = e.Usuarios_ID
            WHERE 1 = 1
        `

        const binds = {}

        if (sucursalId) {
            sql += ` AND c.F_Sucursal_ID = :sucursalId`
            binds.sucursalId = nbind(sucursalId)
        }

        if (proveedorId) {
            sql += ` AND c.F_Proveedores_Id = :proveedorId`
            binds.proveedorId = nbind(proveedorId)
        }

        if (fechaDesde) {
            sql += ` AND c.Fecha_compra >= TO_DATE(:fechaDesde, 'YYYY-MM-DD')`
            binds.fechaDesde = String(fechaDesde).substring(0, 10)
        }

        if (fechaHasta) {
            sql += ` AND c.Fecha_compra <= TO_DATE(:fechaHasta, 'YYYY-MM-DD')`
            binds.fechaHasta = String(fechaHasta).substring(0, 10)
        }

        const busqueda = terminoLike(q)
        if (busqueda) {
            sql += ` AND (
                UPPER(c.Numero_Factura) LIKE :q
                OR UPPER(p.Nombre) LIKE :q
                OR UPPER(s.Nombre) LIKE :q
            )`
            binds.q = busqueda
        }

        return await ejecutarPagina(conn, {
            sql,
            binds,
            orderBy: 'ORDER BY "FECHA_COMPRA" DESC, "ID" DESC',
            limit,
            offset,
            resumenSelect: 'SUM("TOTAL_COMPRA") AS MONTO',
        })
    } finally {
        if (conn) {
            try { await conn.close() } catch (_) {}
        }
    }
}

/**
 * Consulta de una compra específica con su detalle de líneas
 */
export async function consultarCompraPorId(id) {
    let conn
    try {
        conn = await oracledb.getConnection()

        // 1. Cabecera
        const sqlCabecera = `
            SELECT 
                c.ID AS "ID",
                c.Numero_Factura AS "NUMERO_FACTURA",
                TO_CHAR(c.Fecha_compra, 'YYYY-MM-DD') AS "FECHA_COMPRA",
                c.Total_compra AS "TOTAL_COMPRA",
                c.F_Proveedores_Id AS "PROVEEDOR_ID",
                p.Nombre AS "PROVEEDOR_NOMBRE",
                p.NIT AS "PROVEEDOR_NIT",
                p.Telefono AS "PROVEEDOR_TELEFONO",
                c.F_Sucursal_ID AS "SUCURSAL_ID",
                s.Nombre AS "SUCURSAL_NOMBRE",
                s.Codigo AS "SUCURSAL_CODIGO",
                c.F_Empleados_ID AS "EMPLEADO_ID",
                u.Nombre || ' ' || u.Apellido AS "EMPLEADO_NOMBRE",
                u.Email AS "EMPLEADO_EMAIL"
            FROM F_Compras c
            JOIN F_Proveedores p ON p.ID = c.F_Proveedores_Id
            JOIN F_Sucursal s ON s.ID = c.F_Sucursal_ID
            JOIN F_Empleados e ON e.ID = c.F_Empleados_ID
            JOIN F_Usuarios u ON u.ID = e.Usuarios_ID
            WHERE c.ID = :id
        `
        const resCab = await conn.execute(sqlCabecera, { id: nbind(id) })
        const compra = resCab.rows?.[0]
        if (!compra) return null

        // 2. Líneas de detalle
        const sqlLineas = `
            SELECT 
                d.ID AS "ID",
                d.Cantidad AS "CANTIDAD",
                d.Precio_Costo AS "PRECIO_COSTO",
                d.Lote AS "LOTE",
                TO_CHAR(d.Fecha_vencimiento, 'YYYY-MM-DD') AS "FECHA_VENCIMIENTO",
                d.F_Medicamentos_ID AS "MEDICAMENTO_ID",
                m.Nombre_medic AS "NOMBRE_MEDICAMENTO",
                m.Codigo_barra AS "CODIGO_BARRA",
                m.Principio_activo AS "PRINCIPIO_ACTIVO",
                m.Presentacion AS "PRESENTACION",
                ROUND(d.Cantidad * d.Precio_Costo, 2) AS "SUBTOTAL"
            FROM F_Detalle_compra d
            JOIN F_Medicamentos m ON m.ID = d.F_Medicamentos_ID
            WHERE d.F_Compras_ID = :id
            ORDER BY d.ID ASC
        `
        const resLineas = await conn.execute(sqlLineas, { id: nbind(id) })
        compra.LINEAS = resLineas.rows || []

        return compra
    } finally {
        if (conn) {
            try { await conn.close() } catch (_) {}
        }
    }
}

/**
 * Registrar compra ejecutando el Stored Procedure procesar_compra por cada línea
 */
export async function registrarCompra({
    sucursalId,
    proveedorId,
    numeroFactura,
    lineas,
    usuarioId
}) {
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

        // 3. Validar existencia del proveedor y sucursal
        const provCheck = await conn.execute(
            `SELECT ID, Nombre, Estado FROM F_Proveedores WHERE ID = :p`,
            { p: nbind(proveedorId) }
        )
        if (!provCheck.rows || provCheck.rows.length === 0) {
            const err = new Error(`El proveedor con ID ${proveedorId} no existe`)
            err.statusCode = 404
            throw err
        }
        if (String(provCheck.rows[0].ESTADO || '').toUpperCase() !== 'ACTIVO') {
            const err = new Error('El proveedor está inactivo')
            err.statusCode = 409
            throw err
        }

        // 4. Validar unicidad de número de factura por proveedor
        const factCheck = await conn.execute(
            `SELECT ID FROM F_Compras WHERE F_Proveedores_Id = :p AND UPPER(Numero_Factura) = UPPER(:f)`,
            { p: nbind(proveedorId), f: String(numeroFactura).trim() }
        )
        if (factCheck.rows && factCheck.rows.length > 0) {
            const err = new Error(`La factura ${numeroFactura} ya fue registrada para este proveedor`)
            err.statusCode = 409
            throw err
        }

        // 5. Calcular total de la compra
        let totalCalculado = 0
        for (const linea of lineas) {
            const cant = num(linea.cantidad)
            const costo = num(linea.costo ?? linea.precioCosto)
            if (!cant || cant <= 0 || costo === null || costo < 0) {
                const err = new Error('Cada línea debe tener cantidad > 0 y costo >= 0 válidos')
                err.statusCode = 400
                throw err
            }
            totalCalculado += cant * costo
        }
        totalCalculado = Math.round(totalCalculado * 100) / 100

        // 6. Insertar cabecera en F_Compras
        const resCabecera = await conn.execute(
            `INSERT INTO F_Compras (
                Numero_Factura,
                Fecha_compra,
                Total_compra,
                F_Proveedores_Id,
                F_Sucursal_ID,
                F_Empleados_ID
            ) VALUES (
                :numFactura,
                TRUNC(SYSDATE),
                :total,
                :provId,
                :sucId,
                :empId
            ) RETURNING ID INTO :compraId`,
            {
                numFactura: String(numeroFactura).trim(),
                total: nbind(totalCalculado),
                provId: nbind(proveedorId),
                sucId: nbind(sucursalId),
                empId: nbind(empleadoId),
                compraId: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER }
            }
        )

        const compraId = Array.isArray(resCabecera.outBinds.compraId)
            ? resCabecera.outBinds.compraId[0]
            : resCabecera.outBinds.compraId

        // 7. Por cada línea, ejecutar el Stored Procedure procesar_compra
        for (const linea of lineas) {
            const medId = num(linea.medicamentoId)
            const cant = num(linea.cantidad)
            const lote = String(linea.lote).trim()
            const vence = String(linea.vencimiento ?? linea.fechaVencimiento).substring(0, 10)
            const costo = num(linea.costo ?? linea.precioCosto)

            if (!medId || !lote || !vence) {
                const err = new Error('medicamentoId, lote y vencimiento (YYYY-MM-DD) son obligatorios en cada línea')
                err.statusCode = 400
                throw err
            }
            await assertMedicamentoActivo(conn, medId)

            // Llamar al procedimiento almacenado de Oracle
            await conn.execute(
                `BEGIN
                    procesar_compra(
                        p_compra_id      => :compra,
                        p_sucursal_id    => :suc,
                        p_medicamento_id => :med,
                        p_cantidad       => :cant,
                        p_lote           => :lote,
                        p_vencimiento    => TO_DATE(:vence, 'YYYY-MM-DD'),
                        p_costo          => :costo
                    );
                END;`,
                {
                    compra: nbind(compraId),
                    suc: nbind(sucursalId),
                    med: nbind(medId),
                    cant: nbind(cant),
                    lote,
                    vence,
                    costo: nbind(costo)
                }
            )
        }

        // 8. Confirmar transacción atómica
        await conn.commit()

        return {
            compraId,
            numeroFactura: String(numeroFactura).trim(),
            sucursalId,
            proveedorId,
            total: totalCalculado,
            lineasProcesadas: lineas.length,
            mensaje: 'Compra registrada exitosamente; inventario incrementado y kardex registrado vía SP'
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
