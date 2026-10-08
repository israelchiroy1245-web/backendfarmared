import { oracledb } from '../config/database.js'
import { setUsuario, empleadoActivoDeUsuario } from './sesion.js'
import { num, nbind } from '../utils/oracle.js'
import { ejecutarPagina, terminoLike } from '../utils/paginacion.js'

/**
 * Listado de turnos de caja con filtros y paginación
 */
export async function consultarTurnos({
    sucursalId,
    estado,
    cajeroId,
    q,
    limit,
    offset,
}) {
    let conn
    try {
        conn = await oracledb.getConnection()

        let sql = `
            SELECT 
                t.ID AS "ID",
                TO_CHAR(t.Fecha_apertura, 'YYYY-MM-DD HH24:MI:SS') AS "FECHA_APERTURA",
                TO_CHAR(t.Fecha_cierre, 'YYYY-MM-DD HH24:MI:SS') AS "FECHA_CIERRE",
                t.Monto_inicial AS "MONTO_INICIAL",
                t.Ventas_efectivo AS "VENTAS_EFECTIVO",
                t.Ventas_tarjeta AS "VENTAS_TARJETA",
                t.Gastos AS "GASTOS",
                t.Total_esperado AS "TOTAL_ESPERADO",
                t.Monto_contado AS "MONTO_CONTADO",
                t.Diferencia AS "DIFERENCIA",
                t.Estado AS "ESTADO",
                t.F_Sucursal_ID AS "SUCURSAL_ID",
                s.Nombre AS "SUCURSAL_NOMBRE",
                t.F_Empleados_ID AS "EMPLEADO_ID",
                u.Nombre || ' ' || u.Apellido AS "CAJERO_NOMBRE",
                t.Cerrado_por AS "CERRADO_POR_ID",
                uc.Nombre || ' ' || uc.Apellido AS "CERRADO_POR_NOMBRE",
                t.Auditor AS "AUDITOR_ID",
                ua.Nombre || ' ' || ua.Apellido AS "AUDITOR_NOMBRE",
                TO_CHAR(t.Fecha_auditoria, 'YYYY-MM-DD HH24:MI:SS') AS "FECHA_AUDITORIA",
                (SELECT COUNT(*) FROM F_Movimiento_caja m WHERE m.F_Turno_caja_ID = t.ID) AS "TOTAL_MOVIMIENTOS"
            FROM F_Turno_caja t
            JOIN F_Sucursal s ON s.ID = t.F_Sucursal_ID
            JOIN F_Empleados e ON e.ID = t.F_Empleados_ID
            JOIN F_Usuarios u ON u.ID = e.Usuarios_ID
            LEFT JOIN F_Empleados ec ON ec.ID = t.Cerrado_por
            LEFT JOIN F_Usuarios uc ON uc.ID = ec.Usuarios_ID
            LEFT JOIN F_Usuarios ua ON ua.ID = t.Auditor
            WHERE 1 = 1
        `

        const binds = {}

        if (sucursalId) {
            sql += ` AND t.F_Sucursal_ID = :sucursalId`
            binds.sucursalId = nbind(sucursalId)
        }

        if (estado) {
            sql += ` AND t.Estado = :estado`
            binds.estado = String(estado).toUpperCase()
        }

        if (cajeroId) {
            sql += ` AND e.Usuarios_ID = :cajeroId`
            binds.cajeroId = nbind(cajeroId)
        }

        const busqueda = terminoLike(q)
        if (busqueda) {
            sql += ` AND (
                UPPER(s.Nombre) LIKE :q
                OR UPPER(u.Nombre || ' ' || u.Apellido) LIKE :q
            )`
            binds.q = busqueda
        }

        return await ejecutarPagina(conn, {
            sql,
            binds,
            orderBy: 'ORDER BY "FECHA_APERTURA" DESC, "ID" DESC',
            limit,
            offset,
            resumenSelect: `SUM(CASE WHEN "ESTADO" = 'ABIERTA' THEN 1 ELSE 0 END) AS ABIERTOS`,
        })
    } finally {
        if (conn) {
            try { await conn.close() } catch (_) {}
        }
    }
}

/**
 * Consulta de un turno de caja específico con sus movimientos
 */
export async function consultarTurnoPorId(id) {
    let conn
    try {
        conn = await oracledb.getConnection()

        const sqlCabecera = `
            SELECT 
                t.ID AS "ID",
                TO_CHAR(t.Fecha_apertura, 'YYYY-MM-DD HH24:MI:SS') AS "FECHA_APERTURA",
                TO_CHAR(t.Fecha_cierre, 'YYYY-MM-DD HH24:MI:SS') AS "FECHA_CIERRE",
                t.Monto_inicial AS "MONTO_INICIAL",
                t.Ventas_efectivo AS "VENTAS_EFECTIVO",
                t.Ventas_tarjeta AS "VENTAS_TARJETA",
                t.Gastos AS "GASTOS",
                t.Total_esperado AS "TOTAL_ESPERADO",
                t.Monto_contado AS "MONTO_CONTADO",
                t.Diferencia AS "DIFERENCIA",
                t.Estado AS "ESTADO",
                t.F_Sucursal_ID AS "SUCURSAL_ID",
                s.Nombre AS "SUCURSAL_NOMBRE",
                s.Codigo AS "SUCURSAL_CODIGO",
                t.F_Empleados_ID AS "EMPLEADO_ID",
                u.Nombre || ' ' || u.Apellido AS "CAJERO_NOMBRE",
                u.Email AS "CAJERO_EMAIL",
                t.Cerrado_por AS "CERRADO_POR_ID",
                uc.Nombre || ' ' || uc.Apellido AS "CERRADO_POR_NOMBRE",
                t.Auditor AS "AUDITOR_ID",
                ua.Nombre || ' ' || ua.Apellido AS "AUDITOR_NOMBRE",
                TO_CHAR(t.Fecha_auditoria, 'YYYY-MM-DD HH24:MI:SS') AS "FECHA_AUDITORIA"
            FROM F_Turno_caja t
            JOIN F_Sucursal s ON s.ID = t.F_Sucursal_ID
            JOIN F_Empleados e ON e.ID = t.F_Empleados_ID
            JOIN F_Usuarios u ON u.ID = e.Usuarios_ID
            LEFT JOIN F_Empleados ec ON ec.ID = t.Cerrado_por
            LEFT JOIN F_Usuarios uc ON uc.ID = ec.Usuarios_ID
            LEFT JOIN F_Usuarios ua ON ua.ID = t.Auditor
            WHERE t.ID = :id
        `
        const resCab = await conn.execute(sqlCabecera, { id: nbind(id) })
        const turno = resCab.rows?.[0]
        if (!turno) return null

        // Movimientos del turno
        const sqlMovs = `
            SELECT 
                m.ID AS "ID",
                m.Tipo AS "TIPO",
                m.Monto AS "MONTO",
                m.Metodo_pago AS "METODO_PAGO",
                m.Descripcion AS "DESCRIPCION",
                TO_CHAR(m.Fecha, 'YYYY-MM-DD HH24:MI:SS') AS "FECHA"
            FROM F_Movimiento_caja m
            WHERE m.F_Turno_caja_ID = :id
            ORDER BY m.Fecha ASC, m.ID ASC
        `
        const resMovs = await conn.execute(sqlMovs, { id: nbind(id) })
        turno.MOVIMIENTOS = resMovs.rows || []

        return turno
    } finally {
        if (conn) {
            try { await conn.close() } catch (_) {}
        }
    }
}

/**
 * Consulta de turno abierto por sucursal (GET /api/caja/abierta?sucursalId=1)
 */
export async function consultarTurnoAbiertoPorSucursal(sucursalId) {
    let conn
    try {
        conn = await oracledb.getConnection()
        const res = await conn.execute(
            `SELECT ID FROM F_Turno_caja WHERE F_Sucursal_ID = :suc AND Estado = 'ABIERTA'`,
            { suc: nbind(sucursalId) }
        )
        const id = res.rows?.[0]?.ID
        if (!id) return null

        return await consultarTurnoPorId(id)
    } finally {
        if (conn) {
            try { await conn.close() } catch (_) {}
        }
    }
}

/**
 * Consulta del turno activo (ABIERTA) de un usuario/cajero
 */
export async function consultarTurnoActivo(usuarioId) {
    let conn
    try {
        conn = await oracledb.getConnection()
        const empleado = await empleadoActivoDeUsuario(conn, usuarioId)
        if (!empleado) return null
        const empleadoId = empleado.id

        const res = await conn.execute(
            `SELECT ID FROM F_Turno_caja WHERE F_Empleados_ID = :emp AND Estado = 'ABIERTA'`,
            { emp: nbind(empleadoId) }
        )
        const id = res.rows?.[0]?.ID
        if (!id) return null

        return await consultarTurnoPorId(id)
    } finally {
        if (conn) {
            try { await conn.close() } catch (_) {}
        }
    }
}

/**
 * Apertura de turno de caja (Fondo inicial)
 */
export async function abrirTurno({
    sucursalId,
    montoInicial,
    usuarioId,
    rol
}) {
    let conn
    try {
        conn = await oracledb.getConnection()
        await setUsuario(conn, usuarioId)

        // Validar empleado activo
        const empleado = await empleadoActivoDeUsuario(conn, usuarioId)
        if (!empleado) {
            const err = new Error('El usuario no tiene un empleado activo asignado')
            err.statusCode = 403
            throw err
        }
        const empleadoId = empleado.id

        const rolTurno = String(rol || '').toUpperCase()
        if ((rolTurno === 'CAJERO' || rolTurno === 'ENCARGADO')
            && num(empleado.sucursalId) !== num(sucursalId)) {
            const err = new Error(
                rolTurno === 'CAJERO'
                    ? 'El cajero solo puede abrir caja en su sucursal asignada'
                    : 'Solo puede abrir caja en su sucursal asignada'
            )
            err.statusCode = 403
            throw err
        }

        const monto = num(montoInicial)
        if (monto === null || monto < 0) {
            const err = new Error('El monto inicial debe ser mayor o igual a 0')
            err.statusCode = 400
            throw err
        }

        // Validar que la sucursal no tenga ya un turno abierto (Regla: 1 sucursal = 1 turno ABIERTA a la vez)
        const checkSucursal = await conn.execute(
            `SELECT ID, F_Empleados_ID FROM F_Turno_caja WHERE F_Sucursal_ID = :suc AND Estado = 'ABIERTA'`,
            { suc: nbind(sucursalId) }
        )
        if (checkSucursal.rows && checkSucursal.rows.length > 0) {
            const err = new Error(`La sucursal ya tiene un turno de caja abierto (Turno ID #${checkSucursal.rows[0].ID}). Debe cerrarse antes de abrir uno nuevo.`)
            err.statusCode = 409
            throw err
        }

        // Validar que el cajero no tenga ya un turno abierto
        const checkAbierto = await conn.execute(
            `SELECT ID FROM F_Turno_caja WHERE F_Empleados_ID = :emp AND Estado = 'ABIERTA'`,
            { emp: nbind(empleadoId) }
        )
        if (checkAbierto.rows && checkAbierto.rows.length > 0) {
            const err = new Error(`El cajero ya tiene un turno abierto (Turno ID #${checkAbierto.rows[0].ID}). Debe cerrarlo antes de abrir uno nuevo.`)
            err.statusCode = 409
            throw err
        }

        // 1. Insertar turno en F_Turno_caja
        const resTurno = await conn.execute(
            `INSERT INTO F_Turno_caja (
                Monto_inicial,
                Ventas_efectivo,
                Ventas_tarjeta,
                Gastos,
                Estado,
                F_Sucursal_ID,
                F_Empleados_ID,
                Fecha_apertura
            ) VALUES (
                :monto,
                0,
                0,
                0,
                'ABIERTA',
                :sucursalId,
                :empleadoId,
                SYSTIMESTAMP
            ) RETURNING ID INTO :id`,
            {
                monto: nbind(monto),
                sucursalId: nbind(sucursalId),
                empleadoId: nbind(empleadoId),
                id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER }
            }
        )

        const turnoId = Array.isArray(resTurno.outBinds.id) ? resTurno.outBinds.id[0] : resTurno.outBinds.id

        // 2. Insertar movimiento de apertura en F_Movimiento_caja
        await conn.execute(
            `INSERT INTO F_Movimiento_caja (
                Tipo,
                Monto,
                Metodo_pago,
                Descripcion,
                F_Turno_caja_ID,
                Fecha
            ) VALUES (
                'DEPOSITO',
                :monto,
                'EFECTIVO',
                'FONDO INICIAL DE APERTURA',
                :turnoId,
                SYSTIMESTAMP
            )`,
            {
                monto: nbind(monto),
                turnoId: nbind(turnoId)
            }
        )

        await conn.commit()

        return {
            turnoId,
            estado: 'ABIERTA',
            sucursalId,
            empleadoId,
            montoInicial: monto,
            mensaje: 'Turno de caja abierto exitosamente con fondo inicial declarado'
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
 * Registrar movimiento menor de caja (GASTO, RETIRO, DEPOSITO)
 */
export async function registrarMovimientoCaja(turnoId, {
    tipo,
    monto,
    metodoPago = 'EFECTIVO',
    descripcion,
    usuarioId
}) {
    let conn
    try {
        conn = await oracledb.getConnection()
        await setUsuario(conn, usuarioId)

        const tipoUpper = String(tipo).toUpperCase()
        if (!['GASTO', 'RETIRO', 'DEPOSITO'].includes(tipoUpper)) {
            const err = new Error('Tipo de movimiento inválido. Use GASTO, RETIRO o DEPOSITO. La venta la registra el POS.')
            err.statusCode = 400
            throw err
        }

        const montoNum = num(monto)
        if (!montoNum || montoNum <= 0) {
            const err = new Error('El monto debe ser positivo mayor a 0')
            err.statusCode = 400
            throw err
        }

        // Validar estado del turno
        const cur = await conn.execute(
            `SELECT ID, Estado, Gastos FROM F_Turno_caja WHERE ID = :id FOR UPDATE`,
            { id: nbind(turnoId) }
        )
        const turno = cur.rows?.[0]
        if (!turno) {
            const err = new Error('No se encontró el turno de caja')
            err.statusCode = 404
            throw err
        }

        if (turno.ESTADO !== 'ABIERTA') {
            const err = new Error(`No se pueden registrar movimientos en un turno en estado ${turno.ESTADO}`)
            err.statusCode = 409
            throw err
        }

        // Insertar en F_Movimiento_caja
        await conn.execute(
            `INSERT INTO F_Movimiento_caja (
                Tipo,
                Monto,
                Metodo_pago,
                Descripcion,
                F_Turno_caja_ID,
                Fecha
            ) VALUES (
                :tipo,
                :monto,
                :metodoPago,
                :descripcion,
                :id,
                SYSTIMESTAMP
            )`,
            {
                tipo: tipoUpper,
                monto: nbind(montoNum),
                metodoPago: String(metodoPago).toUpperCase(),
                descripcion: descripcion ? String(descripcion).trim() : null,
                id: nbind(turnoId)
            }
        )

        // Si es GASTO, acumular en el campo Gastos de F_Turno_caja
        if (tipoUpper === 'GASTO') {
            await conn.execute(
                `UPDATE F_Turno_caja SET Gastos = NVL(Gastos, 0) + :monto WHERE ID = :id`,
                { monto: nbind(montoNum), id: nbind(turnoId) }
            )
        }

        await conn.commit()

        return {
            turnoId,
            tipo: tipoUpper,
            monto: montoNum,
            descripcion,
            mensaje: 'Movimiento de caja registrado exitosamente'
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
 * Cierre de turno de caja (Arqueo físico y cálculo de diferencia)
 * Diferencia = contado - (inicial + ventas_efectivo - gastos)
 */
export async function cerrarTurno(turnoId, {
    montoContado,
    usuarioId
}) {
    let conn
    try {
        conn = await oracledb.getConnection()
        await setUsuario(conn, usuarioId)

        const contado = num(montoContado)
        if (contado === null || contado < 0) {
            const err = new Error('El monto contado físico es obligatorio y debe ser >= 0')
            err.statusCode = 400
            throw err
        }

        // Bloquear y consultar turno actual
        const cur = await conn.execute(
            `SELECT ID, Monto_inicial, Ventas_efectivo, Ventas_tarjeta, Gastos, Estado,
                    F_Sucursal_ID, F_Empleados_ID, Fecha_apertura
             FROM F_Turno_caja
             WHERE ID = :id
             FOR UPDATE`,
            { id: nbind(turnoId) }
        )
        const turno = cur.rows?.[0]
        if (!turno) {
            const err = new Error('No se encontró el turno de caja')
            err.statusCode = 404
            throw err
        }

        if (turno.ESTADO !== 'ABIERTA') {
            const err = new Error(`El turno ya se encuentra en estado ${turno.ESTADO}. Solo se pueden cerrar turnos en estado ABIERTA.`)
            err.statusCode = 409
            throw err
        }

        const inicial = Number(turno.MONTO_INICIAL) || 0
        const vEfectivo = Number(turno.VENTAS_EFECTIVO) || 0
        const vTarjeta = Number(turno.VENTAS_TARJETA) || 0
        const gsts = Number(turno.GASTOS) || 0

        // Obtener ID del empleado que está cerrando
        const empleado = await empleadoActivoDeUsuario(conn, usuarioId)
        const empleadoId = empleado?.id

        // Fórmula rectora de arqueo:
        // esperadoEnCaja = inicial + ventas_efectivo - gastos
        // diferencia = contado - esperadoEnCaja
        const esperadoEnCaja = Math.round((inicial + vEfectivo - gsts) * 100) / 100
        const diferencia = Math.round((contado - esperadoEnCaja) * 100) / 100

        // Actualizar turno a CERRADA con foto de auditoría
        await conn.execute(
            `UPDATE F_Turno_caja
             SET Fecha_cierre = SYSTIMESTAMP,
                 Cerrado_por = :cerrador,
                 Total_esperado = Monto_inicial + Ventas_efectivo - Gastos,
                 Monto_contado = :contado,
                 Diferencia = :contado - (Monto_inicial + Ventas_efectivo - Gastos),
                 Estado = 'CERRADA'
             WHERE ID = :id AND Estado = 'ABIERTA'`,
            {
                contado: nbind(contado),
                cerrador: empleadoId ? nbind(empleadoId) : null,
                id: nbind(turnoId)
            }
        )

        await conn.commit()

        return {
            id: turnoId,
            estado: 'CERRADA',
            montoInicial: inicial,
            ventasEfectivo: vEfectivo,
            ventasTarjeta: vTarjeta,
            gastos: gsts,
            totalEsperado: esperadoEnCaja,
            esperadoEnCaja,
            montoContado: contado,
            diferencia,
            cerradoPor: empleadoId,
            mensaje: diferencia === 0
                ? 'Turno cerrado con cuadre exacto (diferencia 0)'
                : diferencia > 0
                    ? `Turno cerrado con sobrante de Q${diferencia}`
                    : `Turno cerrado con faltante de Q${Math.abs(diferencia)}`
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
 * Auditoría de turno de caja (CU01: Rol AUDITOR o ADMIN pasa a AUDITADA)
 */
export async function auditarTurno(turnoId, usuarioId) {
    let conn
    try {
        conn = await oracledb.getConnection()
        await setUsuario(conn, usuarioId)

        const cur = await conn.execute(
            `SELECT ID, Estado, Monto_contado, Diferencia FROM F_Turno_caja WHERE ID = :id FOR UPDATE`,
            { id: nbind(turnoId) }
        )
        const turno = cur.rows?.[0]
        if (!turno) {
            const err = new Error('No se encontró el turno de caja')
            err.statusCode = 404
            throw err
        }

        if (turno.ESTADO === 'ABIERTA') {
            const err = new Error('El turno aún está en estado ABIERTA. Debe ser cerrado por el cajero antes de ser auditado.')
            err.statusCode = 409
            throw err
        }

        if (turno.ESTADO === 'AUDITADA') {
            const err = new Error('El turno ya fue auditado previamente')
            err.statusCode = 409
            throw err
        }

        // Marcar como AUDITADA
        await conn.execute(
            `UPDATE F_Turno_caja
             SET Estado = 'AUDITADA',
                 Auditor = :auditor,
                 Fecha_auditoria = SYSTIMESTAMP
             WHERE ID = :id`,
            {
                auditor: nbind(usuarioId),
                id: nbind(turnoId)
            }
        )

        await conn.commit()

        return {
            id: turnoId,
            estado: 'AUDITADA',
            auditorId: usuarioId,
            montoContado: turno.MONTO_CONTADO,
            diferencia: turno.DIFERENCIA,
            mensaje: 'Turno de caja auditado exitosamente'
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
