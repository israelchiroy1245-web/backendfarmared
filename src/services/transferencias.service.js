import { oracledb } from '../config/database.js'
import { empleadoActivoDeUsuario, setUsuario } from './sesion.js'
import { num, nbind } from '../utils/oracle.js'
import { ejecutarPagina, terminoLike } from '../utils/paginacion.js'

function esRolLocal(rol) {
    const r = String(rol || '').toUpperCase()
    return r === 'ENCARGADO' || r === 'QF'
}

async function sucursalDelEmpleado(conn, usuarioId, rol) {
    if (!esRolLocal(rol)) return null
    const empleado = await empleadoActivoDeUsuario(conn, usuarioId)
    const propia = num(empleado?.sucursalId)
    if (!propia) {
        const err = new Error('El usuario no tiene sucursal asignada')
        err.statusCode = 403
        throw err
    }
    return propia
}

async function sucursalesDeTransferencia(conn, id) {
    const cur = await conn.execute(
        `SELECT Sucursal_origen_ID AS "ORIGEN", Sucursal_destino_ID AS "DESTINO"
           FROM F_Transferencia
          WHERE ID = :id`,
        { id: nbind(id) }
    )
    return cur.rows?.[0] || null
}

/**
 * Consulta de transferencias con filtros y paginación estándar
 */
export async function consultarTransferencias({
    sucursalId,
    origenId,
    destinoId,
    estado,
    fechaDesde,
    fechaHasta,
    q,
    limit,
    offset
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
                (SELECT COUNT(*) FROM F_Transferencia_detalle d WHERE d.F_Transferencia_ID = t.ID) AS "TOTAL_LINEAS",
                (SELECT NVL(SUM(d.Cantidad), 0) FROM F_Transferencia_detalle d WHERE d.F_Transferencia_ID = t.ID) AS "TOTAL_UNIDADES"
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

        if (origenId) {
            sql += ` AND t.Sucursal_origen_ID = :origenId`
            binds.origenId = nbind(origenId)
        }

        if (destinoId) {
            sql += ` AND t.Sucursal_destino_ID = :destinoId`
            binds.destinoId = nbind(destinoId)
        }

        if (estado) {
            sql += ` AND t.Estado = :estado`
            binds.estado = String(estado).toUpperCase()
        }

        if (fechaDesde) {
            sql += ` AND t.Fecha_solicitud >= TO_DATE(:fechaDesde, 'YYYY-MM-DD')`
            binds.fechaDesde = String(fechaDesde).substring(0, 10)
        }

        if (fechaHasta) {
            sql += ` AND t.Fecha_solicitud < TO_DATE(:fechaHasta, 'YYYY-MM-DD') + 1`
            binds.fechaHasta = String(fechaHasta).substring(0, 10)
        }

        const busqueda = terminoLike(q)
        if (busqueda) {
            sql += ` AND (
                UPPER(so.Nombre) LIKE :q
                OR UPPER(sd.Nombre) LIKE :q
                OR UPPER(so.Codigo) LIKE :q
                OR UPPER(sd.Codigo) LIKE :q
                OR UPPER(NVL(t.Observacion, '')) LIKE :q
                OR UPPER(NVL(u.Nombre || ' ' || u.Apellido, '')) LIKE :q
            )`
            binds.q = busqueda
        }

        return await ejecutarPagina(conn, {
            sql,
            binds,
            orderBy: 'ORDER BY t.Fecha_solicitud DESC, t.ID DESC',
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
    usuarioId,
    rol
}) {
    let conn
    try {
        conn = await oracledb.getConnection()
        await setUsuario(conn, usuarioId)

        const propia = await sucursalDelEmpleado(conn, usuarioId, rol)
        if (propia && num(origenId) !== propia) {
            const err = new Error('Solo puede operar en su sucursal asignada')
            err.statusCode = 403
            throw err
        }

        if (Number(origenId) === Number(destinoId)) {
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
            const medId = num(item.medicamentoId || item.id)
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
                    medId: nbind(num(item.medicamentoId || item.id))
                }
            )
        }

        await conn.commit()

        return {
            transferenciaId,
            estado: 'SOLICITADA',
            origenId: num(origenId),
            destinoId: num(destinoId),
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
 * Enviar transferencia (Estado EN_TRANSITO): Descuenta de origen vía FEFO mediante procesar_transferencia_envio
 */
export async function enviarTransferencia(id, usuarioId, rol) {
    let conn
    try {
        conn = await oracledb.getConnection()
        await setUsuario(conn, usuarioId)

        const propia = await sucursalDelEmpleado(conn, usuarioId, rol)
        if (propia) {
            const fila = await sucursalesDeTransferencia(conn, id)
            if (!fila) {
                const err = new Error('No se encontró la transferencia')
                err.statusCode = 404
                throw err
            }
            if (num(fila.ORIGEN) !== propia) {
                const err = new Error('Solo el encargado del origen puede enviar')
                err.statusCode = 403
                throw err
            }
        }

        // Ejecutar Stored Procedure de Oracle
        await conn.execute(
            `BEGIN
                procesar_transferencia_envio(p_transferencia_id => :id);
            END;`,
            { id: nbind(id) }
        )

        await conn.commit()

        return {
            id: num(id),
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
 * Recibir transferencia (Estado RECIBIDA): Suma stock en destino mediante procesar_transferencia_recepcion
 */
export async function recibirTransferencia(id, usuarioId, rol) {
    let conn
    try {
        conn = await oracledb.getConnection()
        await setUsuario(conn, usuarioId)

        const propia = await sucursalDelEmpleado(conn, usuarioId, rol)
        if (propia) {
            const fila = await sucursalesDeTransferencia(conn, id)
            if (!fila) {
                const err = new Error('No se encontró la transferencia')
                err.statusCode = 404
                throw err
            }
            if (num(fila.DESTINO) !== propia) {
                const err = new Error('Solo el encargado del destino puede recibir')
                err.statusCode = 403
                throw err
            }
        }

        // Ejecutar Stored Procedure de Oracle
        await conn.execute(
            `BEGIN
                procesar_transferencia_recepcion(p_transferencia_id => :id);
            END;`,
            { id: nbind(id) }
        )

        await conn.commit()

        return {
            id: num(id),
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
export async function cancelarTransferencia(id, usuarioId, rol) {
    let conn
    try {
        conn = await oracledb.getConnection()
        await setUsuario(conn, usuarioId)

        const propia = await sucursalDelEmpleado(conn, usuarioId, rol)
        if (propia) {
            const fila = await sucursalesDeTransferencia(conn, id)
            if (!fila) {
                const err = new Error('No se encontró la transferencia')
                err.statusCode = 404
                throw err
            }
            if (num(fila.ORIGEN) !== propia) {
                const err = new Error('Solo el encargado del origen puede cancelar')
                err.statusCode = 403
                throw err
            }
        }

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
            id: num(id),
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
