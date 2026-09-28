import { oracledb } from '../config/database.js'
import { setUsuario } from './sesion.js'
import { num, nbind } from '../utils/oracle.js'

/**
 * Consulta de transferencias con filtros y paginación
 */
export async function consultarTransferencias({
    sucursalId,
    estado,
    limit = 50,
    offset = 0
}) {
    let conn
    try {
        conn = await oracledb.getConnection()

        let sql = `
            SELECT 
                t.ID AS "ID",
                t.Estado AS "ESTADO",
                t.Observacion AS "OBSERVACION",
                t.Sucursal_origen_ID AS "SUCURSAL_ORIGEN_ID",
                so.Nombre AS "SUCURSAL_ORIGEN_NOMBRE",
                so.Codigo AS "SUCURSAL_ORIGEN_CODIGO",
                t.Sucursal_destino_ID AS "SUCURSAL_DESTINO_ID",
                sd.Nombre AS "SUCURSAL_DESTINO_NOMBRE",
                sd.Codigo AS "SUCURSAL_DESTINO_CODIGO",
                t.Solicitado_por AS "SOLICITADO_POR_ID",
                u.Nombre || ' ' || u.Apellido AS "SOLICITADO_POR_NOMBRE",
                TO_CHAR(t.Fecha_solicitud, 'YYYY-MM-DD HH24:MI:SS') AS "FECHA_SOLICITUD",
                TO_CHAR(t.Fecha_envio, 'YYYY-MM-DD HH24:MI:SS') AS "FECHA_ENVIO",
                TO_CHAR(t.Fecha_recepcion, 'YYYY-MM-DD HH24:MI:SS') AS "FECHA_RECEPCION",
                (SELECT COUNT(*) FROM F_Transferencia_detalle d WHERE d.F_Transferencia_ID = t.ID) AS "TOTAL_LINEAS"
            FROM F_Transferencia t
            JOIN F_Sucursal so ON so.ID = t.Sucursal_origen_ID
            JOIN F_Sucursal sd ON sd.ID = t.Sucursal_destino_ID
            LEFT JOIN F_Usuarios u ON u.ID = t.Solicitado_por
            WHERE 1 = 1
        `

        const binds = {}

        if (sucursalId) {
            sql += ` AND (t.Sucursal_origen_ID = :sucursalId OR t.Sucursal_destino_ID = :sucursalId)`
            binds.sucursalId = nbind(sucursalId)
        }

        if (estado) {
            sql += ` AND t.Estado = :estado`
            binds.estado = String(estado).toUpperCase()
        }

        sql += ` ORDER BY t.Fecha_solicitud DESC, t.ID DESC`

        const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200)
        const safeOffset = Math.max(Number(offset) || 0, 0)

        sql += ` OFFSET :offset ROWS FETCH NEXT :limit ROWS ONLY`
        binds.offset = nbind(safeOffset)
        binds.limit = nbind(safeLimit)

        const result = await conn.execute(sql, binds)
        return result.rows || []
    } finally {
        if (conn) {
            try { await conn.close() } catch (_) {}
        }
    }
}

/**
 * Consulta de una transferencia específica con su detalle
 */
export async function consultarTransferenciaPorId(id) {
    let conn
    try {
        conn = await oracledb.getConnection()

        // 1. Cabecera
        const sqlCabecera = `
            SELECT 
                t.ID AS "ID",
                t.Estado AS "ESTADO",
                t.Observacion AS "OBSERVACION",
                t.Sucursal_origen_ID AS "SUCURSAL_ORIGEN_ID",
                so.Nombre AS "SUCURSAL_ORIGEN_NOMBRE",
                so.Codigo AS "SUCURSAL_ORIGEN_CODIGO",
                t.Sucursal_destino_ID AS "SUCURSAL_DESTINO_ID",
                sd.Nombre AS "SUCURSAL_DESTINO_NOMBRE",
                sd.Codigo AS "SUCURSAL_DESTINO_CODIGO",
                t.Solicitado_por AS "SOLICITADO_POR_ID",
                u.Nombre || ' ' || u.Apellido AS "SOLICITADO_POR_NOMBRE",
                u.Email AS "SOLICITADO_POR_EMAIL",
                TO_CHAR(t.Fecha_solicitud, 'YYYY-MM-DD HH24:MI:SS') AS "FECHA_SOLICITUD",
                TO_CHAR(t.Fecha_envio, 'YYYY-MM-DD HH24:MI:SS') AS "FECHA_ENVIO",
                TO_CHAR(t.Fecha_recepcion, 'YYYY-MM-DD HH24:MI:SS') AS "FECHA_RECEPCION"
            FROM F_Transferencia t
            JOIN F_Sucursal so ON so.ID = t.Sucursal_origen_ID
            JOIN F_Sucursal sd ON sd.ID = t.Sucursal_destino_ID
            LEFT JOIN F_Usuarios u ON u.ID = t.Solicitado_por
            WHERE t.ID = :id
        `
        const resCab = await conn.execute(sqlCabecera, { id: nbind(id) })
        const transf = resCab.rows?.[0]
        if (!transf) return null

        // 2. Líneas de detalle
        const sqlLineas = `
            SELECT 
                d.ID AS "ID",
                d.Cantidad AS "CANTIDAD",
                d.F_Medicamentos_ID AS "MEDICAMENTO_ID",
                m.Nombre_medic AS "NOMBRE_MEDICAMENTO",
                m.Codigo_barra AS "CODIGO_BARRA",
                m.Presentacion AS "PRESENTACION",
                m.Principio_activo AS "PRINCIPIO_ACTIVO"
            FROM F_Transferencia_detalle d
            JOIN F_Medicamentos m ON m.ID = d.F_Medicamentos_ID
            WHERE d.F_Transferencia_ID = :id
            ORDER BY d.ID ASC
        `
        const resLineas = await conn.execute(sqlLineas, { id: nbind(id) })
        transf.LINEAS = resLineas.rows || []

        return transf
    } finally {
        if (conn) {
            try { await conn.close() } catch (_) {}
        }
    }
}

/**
 * Crear solicitud de transferencia (Estado SOLICITADA, aún no mueve inventario)
 */
export async function crearTransferencia({
    origenId,
    destinoId,
    observacion,
    lineas,
    usuarioId
}) {
    let conn
    try {
        conn = await oracledb.getConnection()
        await setUsuario(conn, usuarioId)

        if (origenId === destinoId) {
            const err = new Error('La sucursal de origen debe ser diferente a la sucursal de destino')
            err.statusCode = 400
            throw err
        }

        // Normalizar líneas (soporta lineas o items)
        const items = lineas || []
        if (!Array.isArray(items) || items.length === 0) {
            const err = new Error('Debe incluir al menos una línea con medicamentoId y cantidad (> 0)')
            err.statusCode = 400
            throw err
        }

        for (const item of items) {
            const medId = num(item.medicamentoId)
            const cant = num(item.cantidad)
            if (!medId || !cant || cant <= 0) {
                const err = new Error('Cada línea debe tener medicamentoId y cantidad (> 0) válidos')
                err.statusCode = 400
                throw err
            }
        }

        // 1. Insertar cabecera en F_Transferencia
        const resTransf = await conn.execute(
            `INSERT INTO F_Transferencia (
                Estado,
                Observacion,
                Sucursal_origen_ID,
                Sucursal_destino_ID,
                Solicitado_por,
                Fecha_solicitud
            ) VALUES (
                'SOLICITADA',
                :obs,
                :origen,
                :destino,
                :solicitadoPor,
                SYSTIMESTAMP
            ) RETURNING ID INTO :id`,
            {
                obs: observacion ? String(observacion).trim() : null,
                origen: nbind(origenId),
                destino: nbind(destinoId),
                solicitadoPor: usuarioId ? nbind(usuarioId) : null,
                id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER }
            }
        )

        const transferenciaId = Array.isArray(resTransf.outBinds.id)
            ? resTransf.outBinds.id[0]
            : resTransf.outBinds.id

        // 2. Insertar líneas en F_Transferencia_detalle
        for (const item of items) {
            await conn.execute(
                `INSERT INTO F_Transferencia_detalle (
                    Cantidad,
                    F_Transferencia_ID,
                    F_Medicamentos_ID
                ) VALUES (
                    :cant,
                    :transfId,
                    :medId
                )`,
                {
                    cant: nbind(num(item.cantidad)),
                    transfId: nbind(transferenciaId),
                    medId: nbind(num(item.medicamentoId))
                }
            )
        }

        await conn.commit()

        return {
            transferenciaId,
            estado: 'SOLICITADA',
            origenId,
            destinoId,
            lineas: items.length,
            mensaje: 'Transferencia creada en estado SOLICITADA (stock aún no descontado)'
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
 * Enviar transferencia (Estado EN_TRANSITO): Descuenta de origen vía FEFO
 */
export async function enviarTransferencia(id, usuarioId) {
    let conn
    try {
        conn = await oracledb.getConnection()
        await setUsuario(conn, usuarioId)

        // Ejecutar Stored Procedure de Oracle
        await conn.execute(
            `BEGIN
                procesar_transferencia_envio(p_transferencia_id => :id);
            END;`,
            { id: nbind(id) }
        )

        await conn.commit()

        return {
            id,
            estado: 'EN_TRANSITO',
            mensaje: 'Transferencia despachada con éxito: stock descontado de origen por FEFO y pasada a EN_TRANSITO'
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
 * Recibir transferencia (Estado RECIBIDA): Suma stock en destino
 */
export async function recibirTransferencia(id, usuarioId) {
    let conn
    try {
        conn = await oracledb.getConnection()
        await setUsuario(conn, usuarioId)

        // Ejecutar Stored Procedure de Oracle
        await conn.execute(
            `BEGIN
                procesar_transferencia_recepcion(p_transferencia_id => :id);
            END;`,
            { id: nbind(id) }
        )

        await conn.commit()

        return {
            id,
            estado: 'RECIBIDA',
            mensaje: 'Transferencia recibida con éxito: stock ingresado en sucursal destino y pasada a RECIBIDA'
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
 * Cancelar transferencia: Solo permitido si sigue en estado SOLICITADA
 */
export async function cancelarTransferencia(id, usuarioId) {
    let conn
    try {
        conn = await oracledb.getConnection()
        await setUsuario(conn, usuarioId)

        const cur = await conn.execute(
            `SELECT Estado FROM F_Transferencia WHERE ID = :id FOR UPDATE`,
            { id: nbind(id) }
        )
        const transf = cur.rows?.[0]
        if (!transf) {
            const err = new Error('No se encontró la transferencia')
            err.statusCode = 404
            throw err
        }

        if (transf.ESTADO !== 'SOLICITADA') {
            const err = new Error(`Solo se pueden cancelar transferencias en estado SOLICITADA (Estado actual: ${transf.ESTADO})`)
            err.statusCode = 409
            throw err
        }

        await conn.execute(
            `UPDATE F_Transferencia SET Estado = 'CANCELADA' WHERE ID = :id`,
            { id: nbind(id) }
        )

        await conn.commit()

        return {
            id,
            estado: 'CANCELADA',
            mensaje: 'Transferencia cancelada exitosamente'
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
