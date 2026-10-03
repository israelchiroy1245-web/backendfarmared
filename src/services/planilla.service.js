import { oracledb } from '../config/database.js'
import { setUsuario } from './sesion.js'
import { num, nbind } from '../utils/oracle.js'

import { ejecutarPagina, terminoLike } from '../utils/paginacion.js'

const TASA_IGSS = 0.0483 // 4.83% IGSS laboral en Guatemala

/**
 * Consulta listado de planillas con filtros y paginación
 */
export async function consultarPlanillas({
    periodo,
    sucursalId,
    estado,
    empleadoId,
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
                p.Periodo AS "PERIODO",
                p.Salario_base AS "SALARIO_BASE",
                p.Bonificaciones AS "BONIFICACIONES",
                p.Descuentos AS "DESCUENTOS",
                p.Igss AS "IGSS",
                p.Total AS "TOTAL",
                TO_CHAR(p.Fecha_pago, 'YYYY-MM-DD HH24:MI:SS') AS "FECHA_PAGO",
                p.Estado AS "ESTADO",
                p.F_Empleados_ID AS "EMPLEADO_ID",
                e.Cargo AS "EMPLEADO_CARGO",
                u.Nombre || ' ' || u.Apellido AS "EMPLEADO_NOMBRE",
                u.Email AS "EMPLEADO_EMAIL",
                s.ID AS "SUCURSAL_ID",
                s.Nombre AS "SUCURSAL_NOMBRE"
            FROM F_Planilla p
            JOIN F_Empleados e ON e.ID = p.F_Empleados_ID
            JOIN F_Usuarios u ON u.ID = e.Usuarios_ID
            JOIN F_Sucursal s ON s.ID = e.Sucursal_ID
            WHERE 1 = 1
        `

        const binds = {}

        if (periodo) {
            sql += ` AND p.Periodo = :periodo`
            binds.periodo = String(periodo).trim()
        }

        if (sucursalId) {
            sql += ` AND e.Sucursal_ID = :sucursalId`
            binds.sucursalId = nbind(sucursalId)
        }

        if (estado) {
            sql += ` AND p.Estado = :estado`
            binds.estado = String(estado).toUpperCase().trim()
        }

        if (empleadoId) {
            sql += ` AND p.F_Empleados_ID = :empleadoId`
            binds.empleadoId = nbind(empleadoId)
        }

        const busqueda = terminoLike(q)
        if (busqueda) {
            sql += ` AND (
                UPPER(u.Nombre || ' ' || u.Apellido) LIKE :q
                OR UPPER(u.Email) LIKE :q
                OR UPPER(e.Cargo) LIKE :q
                OR UPPER(s.Nombre) LIKE :q
                OR UPPER(p.Periodo) LIKE :q
            )`
            binds.q = busqueda
        }

        return await ejecutarPagina(conn, {
            sql,
            binds,
            orderBy: 'ORDER BY p.Periodo DESC, s.Nombre ASC, u.Nombre ASC',
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
 * Consulta detalle de una planilla individual por ID
 */
export async function consultarPlanillaPorId(id) {
    let conn
    try {
        conn = await oracledb.getConnection()

        const sql = `
            SELECT 
                p.ID AS "ID",
                p.Periodo AS "PERIODO",
                p.Salario_base AS "SALARIO_BASE",
                p.Bonificaciones AS "BONIFICACIONES",
                p.Descuentos AS "DESCUENTOS",
                p.Igss AS "IGSS",
                p.Total AS "TOTAL",
                TO_CHAR(p.Fecha_pago, 'YYYY-MM-DD HH24:MI:SS') AS "FECHA_PAGO",
                p.Estado AS "ESTADO",
                p.F_Empleados_ID AS "EMPLEADO_ID",
                e.Cargo AS "EMPLEADO_CARGO",
                u.Nombre || ' ' || u.Apellido AS "EMPLEADO_NOMBRE",
                u.Email AS "EMPLEADO_EMAIL",
                s.ID AS "SUCURSAL_ID",
                s.Nombre AS "SUCURSAL_NOMBRE"
            FROM F_Planilla p
            JOIN F_Empleados e ON e.ID = p.F_Empleados_ID
            JOIN F_Usuarios u ON u.ID = e.Usuarios_ID
            JOIN F_Sucursal s ON s.ID = e.Sucursal_ID
            WHERE p.ID = :id
        `

        const res = await conn.execute(sql, { id: nbind(id) })
        return res.rows?.[0] || null
    } finally {
        if (conn) {
            try { await conn.close() } catch (_) {}
        }
    }
}

/**
 * Genera la nómina/planilla para un periodo 'YYYY-MM'
 * Calcula automáticamente Salario_base, IGSS (4.83%), Bonificación de ley y Total
 */
export async function generarPlanillaPeriodo({
    periodo,
    sucursalId,
    bonificacion = 250.00,
    usuarioId
}) {
    if (!periodo || !/^\d{4}-\d{2}$/.test(String(periodo).trim())) {
        const err = new Error('El periodo debe tener el formato YYYY-MM (ej: 2026-10)')
        err.statusCode = 400
        throw err
    }

    const periodoStr = String(periodo).trim()
    const bonifNum = num(bonificacion) !== null ? num(bonificacion) : 250.00

    let conn
    try {
        conn = await oracledb.getConnection()
        await setUsuario(conn, usuarioId)

        // Consultar empleados activos (en sucursal específica o todas)
        let sqlEmp = `
            SELECT e.ID, e.Salario, e.Cargo, e.Sucursal_ID, u.Nombre, u.Apellido
            FROM F_Empleados e
            JOIN F_Usuarios u ON u.ID = e.Usuarios_ID
            WHERE e.Estado = 'ACTIVO' AND u.Estado = 'ACTIVO'
        `
        const bindsEmp = {}
        if (sucursalId) {
            sqlEmp += ` AND e.Sucursal_ID = :sucursalId`
            bindsEmp.sucursalId = nbind(sucursalId)
        }

        const resEmp = await conn.execute(sqlEmp, bindsEmp)
        const empleados = resEmp.rows || []

        if (empleados.length === 0) {
            return {
                periodo: periodoStr,
                generados: 0,
                omitidos: 0,
                totalPlanilla: 0,
                mensaje: 'No se encontraron empleados activos para procesar'
            }
        }

        let generados = 0
        let omitidos = 0
        let totalPlanilla = 0

        for (const emp of empleados) {
            // Verificar si ya existe planilla para este empleado y periodo
            const resCheck = await conn.execute(
                `SELECT ID FROM F_Planilla WHERE F_Empleados_ID = :empId AND Periodo = :periodo`,
                { empId: nbind(emp.ID), periodo: periodoStr }
            )

            if (resCheck.rows && resCheck.rows.length > 0) {
                omitidos++
                continue
            }

            const salarioBase = Number(emp.SALARIO) || 0
            const igss = Math.round(salarioBase * TASA_IGSS * 100) / 100
            const descuentos = 0
            const total = Math.round((salarioBase + bonifNum - descuentos - igss) * 100) / 100

            await conn.execute(
                `INSERT INTO F_Planilla (
                    Periodo,
                    Salario_base,
                    Bonificaciones,
                    Descuentos,
                    Igss,
                    Total,
                    Estado,
                    F_Empleados_ID
                ) VALUES (
                    :periodo,
                    :salarioBase,
                    :bonif,
                    :descuentos,
                    :igss,
                    :total,
                    'PENDIENTE',
                    :empId
                )`,
                {
                    periodo: periodoStr,
                    salarioBase: nbind(salarioBase),
                    bonif: nbind(bonifNum),
                    descuentos: nbind(descuentos),
                    igss: nbind(igss),
                    total: nbind(total),
                    empId: nbind(emp.ID)
                }
            )

            generados++
            totalPlanilla += total
        }

        await conn.commit()

        return {
            periodo: periodoStr,
            generados,
            omitidos,
            totalPlanilla: Math.round(totalPlanilla * 100) / 100,
            mensaje: `Planilla de periodo ${periodoStr} generada exitosamente. ${generados} registros creados, ${omitidos} ya existían previamente.`
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
 * Crear o recalcular registro de planilla de un empleado individual
 */
export async function registrarPlanillaEmpleado({
    empleadoId,
    periodo,
    salarioBase,
    bonificaciones = 0,
    descuentos = 0,
    usuarioId
}) {
    if (!empleadoId) {
        const err = new Error('empleadoId es requerido')
        err.statusCode = 400
        throw err
    }
    if (!periodo || !/^\d{4}-\d{2}$/.test(String(periodo).trim())) {
        const err = new Error('El periodo debe tener el formato YYYY-MM (ej: 2026-10)')
        err.statusCode = 400
        throw err
    }

    const periodoStr = String(periodo).trim()

    let conn
    try {
        conn = await oracledb.getConnection()
        await setUsuario(conn, usuarioId)

        // Obtener salario del empleado si no se envía salarioBase explícito
        let sBase = num(salarioBase)
        if (sBase === null) {
            const resEmp = await conn.execute(
                `SELECT Salario FROM F_Empleados WHERE ID = :id`,
                { id: nbind(empleadoId) }
            )
            if (!resEmp.rows || resEmp.rows.length === 0) {
                const err = new Error('Empleado no encontrado')
                err.statusCode = 404
                throw err
            }
            sBase = Number(resEmp.rows[0].SALARIO) || 0
        }

        const bonif = num(bonificaciones) || 0
        const desc = num(descuentos) || 0
        const igss = Math.round(sBase * TASA_IGSS * 100) / 100
        const total = Math.round((sBase + bonif - desc - igss) * 100) / 100

        // Verificar si ya existe registro para este periodo
        const resCheck = await conn.execute(
            `SELECT ID, Estado FROM F_Planilla WHERE F_Empleados_ID = :empId AND Periodo = :periodo`,
            { empId: nbind(empleadoId), periodo: periodoStr }
        )

        let planillaId
        if (resCheck.rows && resCheck.rows.length > 0) {
            const actual = resCheck.rows[0]
            if (actual.ESTADO === 'PAGADA') {
                const err = new Error('La planilla para este empleado y periodo ya fue pagada y no puede modificarse')
                err.statusCode = 409
                throw err
            }
            planillaId = actual.ID
            await conn.execute(
                `UPDATE F_Planilla
                 SET Salario_base = :sBase,
                     Bonificaciones = :bonif,
                     Descuentos = :descuentos,
                     Igss = :igss,
                     Total = :total
                 WHERE ID = :id`,
                {
                    sBase: nbind(sBase),
                    bonif: nbind(bonif),
                    descuentos: nbind(desc),
                    igss: nbind(igss),
                    total: nbind(total),
                    id: nbind(planillaId)
                }
            )
        } else {
            const resIns = await conn.execute(
                `INSERT INTO F_Planilla (
                    Periodo,
                    Salario_base,
                    Bonificaciones,
                    Descuentos,
                    Igss,
                    Total,
                    Estado,
                    F_Empleados_ID
                ) VALUES (
                    :periodo,
                    :sBase,
                    :bonif,
                    :descuentos,
                    :igss,
                    :total,
                    'PENDIENTE',
                    :empId
                ) RETURNING ID INTO :id`,
                {
                    periodo: periodoStr,
                    sBase: nbind(sBase),
                    bonif: nbind(bonif),
                    descuentos: nbind(desc),
                    igss: nbind(igss),
                    total: nbind(total),
                    empId: nbind(empleadoId),
                    id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER }
                }
            )
            planillaId = Array.isArray(resIns.outBinds.id) ? resIns.outBinds.id[0] : resIns.outBinds.id
        }

        await conn.commit()

        return {
            id: planillaId,
            empleadoId,
            periodo: periodoStr,
            salarioBase: sBase,
            bonificaciones: bonif,
            descuentos: desc,
            igss,
            total,
            estado: 'PENDIENTE',
            mensaje: 'Registro de planilla procesado exitosamente'
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
 * Actualizar ajustes de una planilla PENDIENTE (bonificaciones, descuentos, etc.)
 */
export async function actualizarAjustesPlanilla(id, {
    bonificaciones,
    descuentos,
    salarioBase,
    usuarioId
}) {
    let conn
    try {
        conn = await oracledb.getConnection()
        await setUsuario(conn, usuarioId)

        const resCur = await conn.execute(
            `SELECT ID, Salario_base, Bonificaciones, Descuentos, Estado, F_Empleados_ID
             FROM F_Planilla
             WHERE ID = :id
             FOR UPDATE`,
            { id: nbind(id) }
        )
        const plan = resCur.rows?.[0]
        if (!plan) {
            const err = new Error('No se encontró el registro de planilla')
            err.statusCode = 404
            throw err
        }

        if (plan.ESTADO !== 'PENDIENTE') {
            const err = new Error(`No se puede modificar una planilla en estado ${plan.ESTADO}`)
            err.statusCode = 409
            throw err
        }

        const sBase = num(salarioBase) !== null ? num(salarioBase) : Number(plan.SALARIO_BASE)
        const bonif = num(bonificaciones) !== null ? num(bonificaciones) : Number(plan.BONIFICACIONES)
        const desc = num(descuentos) !== null ? num(descuentos) : Number(plan.DESCUENTOS)

        const igss = Math.round(sBase * TASA_IGSS * 100) / 100
        const total = Math.round((sBase + bonif - desc - igss) * 100) / 100

        await conn.execute(
            `UPDATE F_Planilla
             SET Salario_base = :sBase,
                 Bonificaciones = :bonif,
                 Descuentos = :descuentos,
                 Igss = :igss,
                 Total = :total
             WHERE ID = :id`,
            {
                sBase: nbind(sBase),
                bonif: nbind(bonif),
                descuentos: nbind(desc),
                igss: nbind(igss),
                total: nbind(total),
                id: nbind(id)
            }
        )

        await conn.commit()

        return {
            id,
            salarioBase: sBase,
            bonificaciones: bonif,
            descuentos: desc,
            igss,
            total,
            estado: 'PENDIENTE',
            mensaje: 'Ajustes de planilla actualizados exitosamente'
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
 * Pagar una planilla individual (Estado -> 'PAGADA', Fecha_pago -> SYSDATE)
 */
export async function pagarPlanilla(id, usuarioId) {
    let conn
    try {
        conn = await oracledb.getConnection()
        await setUsuario(conn, usuarioId)

        const resCur = await conn.execute(
            `SELECT ID, Estado, Total, Periodo, F_Empleados_ID FROM F_Planilla WHERE ID = :id FOR UPDATE`,
            { id: nbind(id) }
        )
        const plan = resCur.rows?.[0]
        if (!plan) {
            const err = new Error('No se encontró el registro de planilla')
            err.statusCode = 404
            throw err
        }

        if (plan.ESTADO === 'PAGADA') {
            const err = new Error('La planilla ya se encuentra PAGADA')
            err.statusCode = 409
            throw err
        }

        await conn.execute(
            `UPDATE F_Planilla
             SET Estado = 'PAGADA',
                 Fecha_pago = SYSDATE
             WHERE ID = :id`,
            { id: nbind(id) }
        )

        await conn.commit()

        return {
            id,
            periodo: plan.PERIODO,
            empleadoId: plan.F_EMPLEADOS_ID,
            total: plan.TOTAL,
            estado: 'PAGADA',
            mensaje: 'Planilla pagada y dispersada exitosamente'
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
 * Dispersar/pagar todas las planillas PENDIENTES de un periodo y sucursal
 */
export async function pagarPlanillaPeriodo({ periodo, sucursalId, usuarioId }) {
    if (!periodo) {
        const err = new Error('El periodo YYYY-MM es obligatorio')
        err.statusCode = 400
        throw err
    }

    let conn
    try {
        conn = await oracledb.getConnection()
        await setUsuario(conn, usuarioId)

        let sql = `
            UPDATE F_Planilla p
            SET p.Estado = 'PAGADA',
                p.Fecha_pago = SYSDATE
            WHERE p.Periodo = :periodo
              AND p.Estado = 'PENDIENTE'
        `
        const binds = { periodo: String(periodo).trim() }

        if (sucursalId) {
            sql += ` AND p.F_Empleados_ID IN (SELECT e.ID FROM F_Empleados e WHERE e.Sucursal_ID = :sucursalId)`
            binds.sucursalId = nbind(sucursalId)
        }

        const res = await conn.execute(sql, binds)
        await conn.commit()

        return {
            periodo: String(periodo).trim(),
            sucursalId: sucursalId || null,
            registrosPagados: res.rowsAffected || 0,
            mensaje: `Se dispersaron exitosamente ${res.rowsAffected || 0} pagos de planilla del periodo ${periodo}`
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
