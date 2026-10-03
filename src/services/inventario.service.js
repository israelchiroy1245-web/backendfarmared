import { oracledb } from '../config/database.js'
import { setUsuario } from './sesion.js'
import { num, nbind } from '../utils/oracle.js'
import { ejecutarPagina, terminoLike } from '../utils/paginacion.js'

/**
 * Consulta de inventario/lotes con detalles de medicamento y sucursal
 */
export async function consultarInventario({ sucursalId, medicamentoId, alertaBajo, lote, laboratorio, q, limit, offset }) {
    let conn
    try {
        conn = await oracledb.getConnection()

        let sql = `
            SELECT 
                i.ID,
                i.Cantidad,
                i.Stock_minimo AS "STOCK_MINIMO",
                TO_CHAR(i.Fecha_vencimiento, 'YYYY-MM-DD') AS "FECHA_VENCIMIENTO",
                i.Lote,
                i.F_Sucursal_ID AS "SUCURSAL_ID",
                s.Nombre AS "SUCURSAL_NOMBRE",
                s.Codigo AS "SUCURSAL_CODIGO",
                i.F_Medicamentos_ID AS "MEDICAMENTO_ID",
                m.Nombre_medic AS "NOMBRE_MEDICAMENTO",
                m.Codigo_barra AS "CODIGO_BARRA",
                m.Principio_activo AS "PRINCIPIO_ACTIVO",
                m.Presentacion AS "PRESENTACION",
                m.Laboratorio AS "LABORATORIO",
                m.Precio_venta AS "PRECIO_VENTA",
                m.Costo AS "COSTO",
                CASE 
                    WHEN i.Fecha_vencimiento < TRUNC(SYSDATE) THEN 1 
                    ELSE 0 
                END AS "VENCIDO",
                CASE 
                    WHEN i.Cantidad <= i.Stock_minimo THEN 1 
                    ELSE 0 
                END AS "STOCK_BAJO"
            FROM F_Inventario i
            JOIN F_Medicamentos m ON m.ID = i.F_Medicamentos_ID
            JOIN F_Sucursal s ON s.ID = i.F_Sucursal_ID
            WHERE 1 = 1
        `

        const binds = {}

        if (sucursalId) {
            sql += ` AND i.F_Sucursal_ID = :sucursalId`
            binds.sucursalId = nbind(sucursalId)
        }

        if (medicamentoId) {
            sql += ` AND i.F_Medicamentos_ID = :medicamentoId`
            binds.medicamentoId = nbind(medicamentoId)
        }

        if (lote) {
            sql += ` AND UPPER(i.Lote) LIKE :lote`
            binds.lote = `%${String(lote).toUpperCase()}%`
        }

        if (laboratorio) {
            sql += ` AND UPPER(m.Laboratorio) LIKE :laboratorio`
            binds.laboratorio = `%${String(laboratorio).toUpperCase()}%`
        }

        if (alertaBajo === true || alertaBajo === 'true' || alertaBajo === '1') {
            sql += ` AND i.Cantidad <= i.Stock_minimo`
        }

        const busqueda = terminoLike(q)
        if (busqueda) {
            sql += ` AND (
                UPPER(i.Lote) LIKE :q
                OR UPPER(m.Nombre_medic) LIKE :q
                OR UPPER(m.Codigo_barra) LIKE :q
                OR UPPER(s.Nombre) LIKE :q
                OR UPPER(s.Codigo) LIKE :q
            )`
            binds.q = busqueda
        }

        return await ejecutarPagina(conn, {
            sql,
            binds,
            orderBy: 'ORDER BY s.ID ASC, m.Nombre_medic ASC, i.Fecha_vencimiento ASC NULLS LAST',
            limit,
            offset,
            resumenSelect: 'SUM("STOCK_BAJO") AS BAJOS, SUM("VENCIDO") AS VENCIDOS',
        })
    } finally {
        if (conn) {
            try { await conn.close() } catch (_) {}
        }
    }
}

/**
 * Obtener detalle de un único lote por ID
 */
export async function consultarLotePorId(id) {
    let conn
    try {
        conn = await oracledb.getConnection()
        const sql = `
            SELECT 
                i.ID,
                i.Cantidad,
                i.Stock_minimo AS "STOCK_MINIMO",
                TO_CHAR(i.Fecha_vencimiento, 'YYYY-MM-DD') AS "FECHA_VENCIMIENTO",
                i.Lote,
                i.F_Sucursal_ID AS "SUCURSAL_ID",
                s.Nombre AS "SUCURSAL_NOMBRE",
                s.Codigo AS "SUCURSAL_CODIGO",
                i.F_Medicamentos_ID AS "MEDICAMENTO_ID",
                m.Nombre_medic AS "NOMBRE_MEDICAMENTO",
                m.Codigo_barra AS "CODIGO_BARRA",
                m.Principio_activo AS "PRINCIPIO_ACTIVO",
                m.Presentacion AS "PRESENTACION",
                m.Laboratorio AS "LABORATORIO",
                m.Precio_venta AS "PRECIO_VENTA",
                m.Costo AS "COSTO",
                CASE 
                    WHEN i.Fecha_vencimiento < TRUNC(SYSDATE) THEN 1 
                    ELSE 0 
                END AS "VENCIDO",
                CASE 
                    WHEN i.Cantidad <= i.Stock_minimo THEN 1 
                    ELSE 0 
                END AS "STOCK_BAJO"
            FROM F_Inventario i
            JOIN F_Medicamentos m ON m.ID = i.F_Medicamentos_ID
            JOIN F_Sucursal s ON s.ID = i.F_Sucursal_ID
            WHERE i.ID = :id
        `
        const result = await conn.execute(sql, { id: nbind(id) })
        return result.rows?.[0] || null
    } finally {
        if (conn) {
            try { await conn.close() } catch (_) {}
        }
    }
}

/**
 * Consulta de movimientos de Kardex
 */
export async function consultarKardex({ sucursalId, medicamentoId, tipo, q, limit, offset }) {
    let conn
    try {
        conn = await oracledb.getConnection()

        let sql = `
            SELECT 
                k.ID,
                k.Tipo,
                k.Cantidad,
                k.Lote,
                k.Referencia,
                k.F_Sucursal_ID AS "SUCURSAL_ID",
                s.Nombre AS "SUCURSAL_NOMBRE",
                k.F_Medicamentos_ID AS "MEDICAMENTO_ID",
                m.Nombre_medic AS "NOMBRE_MEDICAMENTO",
                k.F_Usuarios_ID AS "USUARIO_ID",
                u.Nombre || ' ' || u.Apellido AS "USUARIO_NOMBRE",
                TO_CHAR(k.Fecha, 'YYYY-MM-DD HH24:MI:SS') AS "FECHA"
            FROM F_Movimiento_inventario k
            JOIN F_Sucursal s ON s.ID = k.F_Sucursal_ID
            JOIN F_Medicamentos m ON m.ID = k.F_Medicamentos_ID
            LEFT JOIN F_Usuarios u ON u.ID = k.F_Usuarios_ID
            WHERE 1 = 1
        `

        const binds = {}

        if (sucursalId) {
            sql += ` AND k.F_Sucursal_ID = :sucursalId`
            binds.sucursalId = nbind(sucursalId)
        }

        if (medicamentoId) {
            sql += ` AND k.F_Medicamentos_ID = :medicamentoId`
            binds.medicamentoId = nbind(medicamentoId)
        }

        if (tipo) {
            sql += ` AND k.Tipo = :tipo`
            binds.tipo = String(tipo).toUpperCase()
        }

        const busqueda = terminoLike(q)
        if (busqueda) {
            sql += ` AND (
                UPPER(k.Lote) LIKE :q
                OR UPPER(k.Tipo) LIKE :q
                OR UPPER(k.Referencia) LIKE :q
                OR UPPER(m.Nombre_medic) LIKE :q
                OR UPPER(s.Nombre) LIKE :q
            )`
            binds.q = busqueda
        }

        return await ejecutarPagina(conn, {
            sql,
            binds,
            orderBy: 'ORDER BY k.Fecha DESC, k.ID DESC',
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
 * Crear nuevo lote e insertar movimiento inicial en Kardex (Transaccional)
 */
export async function crearLote({
    sucursalId,
    medicamentoId,
    lote,
    cantidad = 0,
    fechaVencimiento,
    stockMinimo = 6,
    usuarioId
}) {
    let conn
    try {
        conn = await oracledb.getConnection()
        await setUsuario(conn, usuarioId)

        // Verificar existencia previa del lote en la sucursal
        const check = await conn.execute(
            `SELECT ID FROM F_Inventario 
             WHERE F_Sucursal_ID = :suc AND F_Medicamentos_ID = :med AND UPPER(Lote) = UPPER(:lote)`,
            {
                suc: nbind(sucursalId),
                med: nbind(medicamentoId),
                lote: String(lote).trim()
            }
        )

        if (check.rows && check.rows.length > 0) {
            const err = new Error(`El lote ${lote} ya existe en esta sucursal para este medicamento`)
            err.statusCode = 409
            throw err
        }

        // Insertar registro en F_Inventario
        const insertSql = `
            INSERT INTO F_Inventario (
                Cantidad,
                Stock_minimo,
                Fecha_vencimiento,
                Lote,
                F_Sucursal_ID,
                F_Medicamentos_ID
            ) VALUES (
                :cantidad,
                :stockMinimo,
                ${fechaVencimiento ? "TO_DATE(:fechaVencimiento, 'YYYY-MM-DD')" : 'NULL'},
                :lote,
                :sucursalId,
                :medicamentoId
            ) RETURNING ID INTO :id
        `

        const binds = {
            cantidad: nbind(cantidad),
            stockMinimo: nbind(stockMinimo),
            lote: String(lote).trim(),
            sucursalId: nbind(sucursalId),
            medicamentoId: nbind(medicamentoId),
            id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER }
        }

        if (fechaVencimiento) {
            binds.fechaVencimiento = String(fechaVencimiento).substring(0, 10)
        }

        const resInsert = await conn.execute(insertSql, binds)
        const loteId = Array.isArray(resInsert.outBinds.id) ? resInsert.outBinds.id[0] : resInsert.outBinds.id

        // Si ingresa con cantidad > 0, registrar kardex ENTRADA
        if (cantidad > 0) {
            await conn.execute(
                `INSERT INTO F_Movimiento_inventario (
                    Tipo, Cantidad, Lote, Referencia, F_Sucursal_ID, F_Medicamentos_ID, F_Usuarios_ID
                ) VALUES (
                    'ENTRADA', :cantidad, :lote, 'ALTA-INICIAL', :sucursalId, :medicamentoId, :usuarioId
                )`,
                {
                    cantidad: nbind(cantidad),
                    lote: String(lote).trim(),
                    sucursalId: nbind(sucursalId),
                    medicamentoId: nbind(medicamentoId),
                    usuarioId: usuarioId ? nbind(usuarioId) : null
                }
            )
        }

        await conn.commit()
        return { id: loteId, lote: String(lote).trim(), cantidad, stockMinimo }
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
 * Reemplazar datos completos del lote (PUT)
 */
export async function reemplazarLote(id, {
    cantidad,
    stockMinimo,
    fechaVencimiento,
    lote,
    usuarioId
}) {
    let conn
    try {
        conn = await oracledb.getConnection()
        await setUsuario(conn, usuarioId)

        // Bloquear y consultar estado actual
        const cur = await conn.execute(
            `SELECT ID, Cantidad, Stock_minimo, TO_CHAR(Fecha_vencimiento, 'YYYY-MM-DD') AS FECHA_VENCIMIENTO,
                    Lote, F_Sucursal_ID, F_Medicamentos_ID
             FROM F_Inventario
             WHERE ID = :id
             FOR UPDATE`,
            { id: nbind(id) }
        )

        const actual = cur.rows?.[0]
        if (!actual) {
            const err = new Error('No se encontró el lote especificado')
            err.statusCode = 404
            throw err
        }

        const nuevaCantidad = num(cantidad) !== null ? num(cantidad) : actual.CANTIDAD
        if (nuevaCantidad < 0) {
            const err = new Error('La cantidad no puede ser negativa')
            err.statusCode = 400
            throw err
        }

        const nuevoMinimo = num(stockMinimo) !== null ? num(stockMinimo) : actual.STOCK_MINIMO
        const nuevoLote = lote ? String(lote).trim() : actual.LOTE
        const fechaStr = fechaVencimiento ? String(fechaVencimiento).substring(0, 10) : actual.FECHA_VENCIMIENTO

        const updateSql = `
            UPDATE F_Inventario
            SET Cantidad = :cant,
                Stock_minimo = :min,
                Fecha_vencimiento = ${fechaStr ? "TO_DATE(:fec, 'YYYY-MM-DD')" : 'NULL'},
                Lote = :lote
            WHERE ID = :id
        `

        const binds = {
            cant: nbind(nuevaCantidad),
            min: nbind(nuevoMinimo),
            lote: nuevoLote,
            id: nbind(id)
        }
        if (fechaStr) binds.fec = fechaStr

        await conn.execute(updateSql, binds)

        // Registrar kardex si varió la cantidad
        const diff = nuevaCantidad - actual.CANTIDAD
        if (diff !== 0) {
            const tipo = diff > 0 ? 'AJUSTE' : 'AJUSTE'
            const ref = `PUT-REEMPLAZO (${diff > 0 ? '+' : ''}${diff})`
            await conn.execute(
                `INSERT INTO F_Movimiento_inventario (
                    Tipo, Cantidad, Lote, Referencia, F_Sucursal_ID, F_Medicamentos_ID, F_Usuarios_ID
                ) VALUES (
                    :tipo, :cant, :lote, :ref, :suc, :med, :usr
                )`,
                {
                    tipo,
                    cant: nbind(Math.abs(diff)),
                    lote: nuevoLote,
                    ref,
                    suc: nbind(actual.F_SUCURSAL_ID),
                    med: nbind(actual.F_MEDICAMENTOS_ID),
                    usr: usuarioId ? nbind(usuarioId) : null
                }
            )
        }

        await conn.commit()
        return {
            id,
            lote: nuevoLote,
            cantidadAnterior: actual.CANTIDAD,
            nuevaCantidad,
            diferencia: diff
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
 * Ajustar stock de lote con PATCH (ya sea valor absoluto 'cantidad' o incremento/decremento 'ajuste')
 */
export async function ajustarStockLote(id, { cantidad, ajuste, usuarioId }) {
    let conn
    try {
        conn = await oracledb.getConnection()
        await setUsuario(conn, usuarioId)

        // Bloquear y consultar estado actual
        const cur = await conn.execute(
            `SELECT ID, Cantidad, Lote, F_Sucursal_ID, F_Medicamentos_ID
             FROM F_Inventario
             WHERE ID = :id
             FOR UPDATE`,
            { id: nbind(id) }
        )

        const actual = cur.rows?.[0]
        if (!actual) {
            const err = new Error('No se encontró el lote especificado')
            err.statusCode = 404
            throw err
        }

        let nuevaCantidad
        let diferencia

        if (num(ajuste) !== null) {
            // Ajuste relativo: e.g. -2, +5
            diferencia = num(ajuste)
            nuevaCantidad = actual.CANTIDAD + diferencia
        } else if (num(cantidad) !== null) {
            // Valor absoluto: e.g. cantidad = 10
            nuevaCantidad = num(cantidad)
            diferencia = nuevaCantidad - actual.CANTIDAD
        } else {
            const err = new Error('Debe proporcionar "cantidad" o "ajuste"')
            err.statusCode = 400
            throw err
        }

        if (nuevaCantidad < 0) {
            const err = new Error(`Stock insuficiente para aplicar el ajuste. Cantidad actual: ${actual.CANTIDAD}, resultante: ${nuevaCantidad}`)
            err.statusCode = 400
            throw err
        }

        // Actualizar registro
        await conn.execute(
            `UPDATE F_Inventario SET Cantidad = :nuevaCantidad WHERE ID = :id`,
            {
                nuevaCantidad: nbind(nuevaCantidad),
                id: nbind(id)
            }
        )

        // Si hubo cambio de existencias, registrar en F_Movimiento_inventario
        if (diferencia !== 0) {
            const ref = `AJUSTE-MANUAL (${diferencia > 0 ? '+' : ''}${diferencia})`
            await conn.execute(
                `INSERT INTO F_Movimiento_inventario (
                    Tipo, Cantidad, Lote, Referencia, F_Sucursal_ID, F_Medicamentos_ID, F_Usuarios_ID
                ) VALUES (
                    'AJUSTE', :cant, :lote, :ref, :suc, :med, :usr
                )`,
                {
                    cant: nbind(Math.abs(diferencia)),
                    lote: actual.LOTE,
                    ref,
                    suc: nbind(actual.F_SUCURSAL_ID),
                    med: nbind(actual.F_MEDICAMENTOS_ID),
                    usr: usuarioId ? nbind(usuarioId) : null
                }
            )
        }

        await conn.commit()
        return {
            id,
            lote: actual.LOTE,
            cantidadAnterior: actual.CANTIDAD,
            nuevaCantidad,
            diferencia
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
 * Eliminar lote vacío (DELETE)
 * Regla: Solo si Cantidad == 0 y nunca fue utilizado en ventas, compras o traslados.
 * En farmacia, los lotes agotados se conservan con cantidad 0 para mantener la trazabilidad,
 * permitir anulaciones de venta (F_Detalle_venta.F_Inventario_ID) y conservar el histórico FEFO.
 * Este DELETE se reserva exclusivamente para corregir errores de captura (typo, alta duplicada).
 */
export async function eliminarLoteVacio(id, usuarioId) {
    let conn
    try {
        conn = await oracledb.getConnection()
        await setUsuario(conn, usuarioId)

        const cur = await conn.execute(
            `SELECT ID, Cantidad, Lote, F_Sucursal_ID, F_Medicamentos_ID 
             FROM F_Inventario 
             WHERE ID = :id 
             FOR UPDATE`,
            { id: nbind(id) }
        )

        const actual = cur.rows?.[0]
        if (!actual) {
            const err = new Error('No se encontró el lote especificado')
            err.statusCode = 404
            throw err
        }

        // 1. Validar que no tenga existencias físicas
        if (actual.CANTIDAD > 0) {
            const err = new Error(`No se puede eliminar el lote ${actual.LOTE} porque tiene existencias (${actual.CANTIDAD} unidades). La cantidad debe ser 0.`)
            err.statusCode = 409
            throw err
        }

        // 2. Validar que no existan tickets de venta apuntando a este lote (integridad referencial y anulaciones)
        const checkVentas = await conn.execute(
            `SELECT COUNT(*) AS CNT FROM F_Detalle_venta WHERE F_Inventario_ID = :id`,
            { id: nbind(id) }
        )
        const totalVentas = checkVentas.rows?.[0]?.CNT || 0
        if (totalVentas > 0) {
            const err = new Error(
                `No se puede eliminar el lote ${actual.LOTE} porque tiene ${totalVentas} venta(s) asociada(s). ` +
                `En farmacia los lotes agotados deben permanecer en 0 para trazabilidad y posibles anulaciones.`
            )
            err.statusCode = 409
            throw err
        }

        // 3. Validar que no posea movimientos transaccionales reales en Kardex (ventas, compras, transferencias)
        const checkKardex = await conn.execute(
            `SELECT COUNT(*) AS CNT 
             FROM F_Movimiento_inventario 
             WHERE F_Sucursal_ID = :suc 
               AND F_Medicamentos_ID = :med 
               AND Lote = :lote 
               AND Tipo IN ('VENTA', 'COMPRA', 'TRANSFERENCIA_IN', 'TRANSFERENCIA_OUT')`,
            {
                suc: nbind(actual.F_SUCURSAL_ID),
                med: nbind(actual.F_MEDICAMENTOS_ID),
                lote: actual.LOTE
            }
        )
        const totalKardex = checkKardex.rows?.[0]?.CNT || 0
        if (totalKardex > 0) {
            const err = new Error(
                `No se puede eliminar el lote ${actual.LOTE} porque tiene historial comercial registrado en Kardex. ` +
                `Solo se permite eliminar lotes erróneos sin historial transaccional.`
            )
            err.statusCode = 409
            throw err
        }

        // 4. Si fue un lote creado por error (sin transacciones comerciales), limpiar movimientos de alta inicial si existiesen
        await conn.execute(
            `DELETE FROM F_Movimiento_inventario 
             WHERE F_Sucursal_ID = :suc 
               AND F_Medicamentos_ID = :med 
               AND Lote = :lote 
               AND Referencia = 'ALTA-INICIAL'`,
            {
                suc: nbind(actual.F_SUCURSAL_ID),
                med: nbind(actual.F_MEDICAMENTOS_ID),
                lote: actual.LOTE
            }
        )

        // 5. Proceder al borrado físico en F_Inventario
        await conn.execute(`DELETE FROM F_Inventario WHERE ID = :id`, { id: nbind(id) })
        await conn.commit()

        return { id, lote: actual.LOTE, eliminado: true }
    } catch (error) {
        if (conn) {
            try { await conn.rollback() } catch (_) {}
        }
        if (error.message?.includes('ORA-02292')) {
            const err = new Error(`No se puede eliminar el lote ${actual?.LOTE || id} porque tiene registros relacionados en otras tablas de la base de datos (integridad referencial).`)
            err.statusCode = 409
            throw err
        }
        throw error
    } finally {
        if (conn) {
            try { await conn.close() } catch (_) {}
        }
    }
}
