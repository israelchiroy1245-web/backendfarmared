import bcrypt from 'bcryptjs'
import { oracledb } from '../config/database.js'
import { setUsuario } from './sesion.js'
import { revocarTodas } from './sesionAuth.service.js'
import { num, nbind } from '../utils/oracle.js'
import { ejecutarPagina, terminoLike } from '../utils/paginacion.js'

/**
 * Consulta de empleados con JOIN a F_Usuarios y F_Roles (sin Password_hash)
 */
export async function consultarEmpleados({ sucursalId, estado, q, limit, offset }) {
    let conn
    try {
        conn = await oracledb.getConnection()
        let sql = `
            SELECT 
                e.ID AS "ID",
                e.Cargo AS "CARGO",
                e.Salario AS "SALARIO",
                TO_CHAR(e.Fecha_ingreso, 'YYYY-MM-DD') AS "FECHA_INGRESO",
                e.Estado AS "EMP_ESTADO",
                e.Sucursal_ID AS "SUCURSAL_ID",
                s.Nombre AS "SUCURSAL_NOMBRE",
                u.ID AS "USUARIO_ID",
                u.Nombre AS "NOMBRE",
                u.Apellido AS "APELLIDO",
                u.Email AS "EMAIL",
                u.DPI AS "DPI",
                u.Telefono AS "TELEFONO",
                u.Estado AS "USR_ESTADO",
                u.Roles_ID AS "ROLES_ID",
                r.Nombre AS "ROL"
            FROM F_Empleados e
            JOIN F_Usuarios u ON u.ID = e.Usuarios_ID
            JOIN F_Roles r ON r.ID = u.Roles_ID
            JOIN F_Sucursal s ON s.ID = e.Sucursal_ID
            WHERE 1 = 1
        `

        const binds = {}

        if (sucursalId) {
            sql += ` AND e.Sucursal_ID = :sucursalId`
            binds.sucursalId = nbind(sucursalId)
        }

        if (estado) {
            sql += ` AND UPPER(e.Estado) = UPPER(:estado)`
            binds.estado = String(estado).toUpperCase()
        }

        const busqueda = terminoLike(q)
        if (busqueda) {
            sql += ` AND (
                UPPER(u.Nombre) LIKE :q OR UPPER(u.Apellido) LIKE :q OR UPPER(u.Email) LIKE :q
                OR UPPER(e.Cargo) LIKE :q OR UPPER(s.Nombre) LIKE :q
            )`
            binds.q = busqueda
        }

        return await ejecutarPagina(conn, {
            sql,
            binds,
            orderBy: 'ORDER BY e.ID ASC',
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
 * Detalle de un empleado por ID (ID de empleado)
 */
export async function consultarEmpleadoPorId(id) {
    let conn
    try {
        conn = await oracledb.getConnection()
        const sql = `
            SELECT 
                e.ID AS "ID",
                e.Cargo AS "CARGO",
                e.Salario AS "SALARIO",
                TO_CHAR(e.Fecha_ingreso, 'YYYY-MM-DD') AS "FECHA_INGRESO",
                e.Estado AS "EMP_ESTADO",
                e.Sucursal_ID AS "SUCURSAL_ID",
                s.Nombre AS "SUCURSAL_NOMBRE",
                u.ID AS "USUARIO_ID",
                u.Nombre AS "NOMBRE",
                u.Apellido AS "APELLIDO",
                u.Email AS "EMAIL",
                u.DPI AS "DPI",
                u.Telefono AS "TELEFONO",
                u.Estado AS "USR_ESTADO",
                u.Roles_ID AS "ROLES_ID",
                r.Nombre AS "ROL"
            FROM F_Empleados e
            JOIN F_Usuarios u ON u.ID = e.Usuarios_ID
            JOIN F_Roles r ON r.ID = u.Roles_ID
            JOIN F_Sucursal s ON s.ID = e.Sucursal_ID
            WHERE e.ID = :id
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
 * Crear Usuario + Empleado en una sola transacción atómica
 */
export async function crearEmpleadoTransaccional({
    nombre,
    apellido,
    email,
    dpi,
    telefono,
    password,
    rolId,
    sucursalId,
    cargo,
    salario,
    adminId
}) {
    let conn
    try {
        conn = await oracledb.getConnection()

        // 1. Establecer usuario de auditoría
        await setUsuario(conn, adminId)

        // 2. Hashear password
        const passwordHash = await bcrypt.hash(password, 10)

        // 3. Insertar en F_Usuarios
        const resUsuario = await conn.execute(
            `INSERT INTO F_Usuarios (
                Nombre, Apellido, Email, DPI, Telefono, Estado, Roles_ID, Password_hash
            ) VALUES (
                :nombre, :apellido, :email, :dpi, :tel, 'ACTIVO', :rolId, :hash
            ) RETURNING ID INTO :usuarioId`,
            {
                nombre,
                apellido,
                email: email.toLowerCase(),
                dpi,
                tel: telefono || null,
                rolId: nbind(rolId),
                hash: passwordHash,
                usuarioId: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER }
            }
        )

        const usuarioId = Array.isArray(resUsuario.outBinds.usuarioId)
            ? resUsuario.outBinds.usuarioId[0]
            : resUsuario.outBinds.usuarioId

        // 4. Insertar en F_Empleados con el usuarioId recién generado
        const resEmpleado = await conn.execute(
            `INSERT INTO F_Empleados (
                Cargo, Salario, Fecha_ingreso, Estado, Usuarios_ID, Sucursal_ID
            ) VALUES (
                :cargo, :salario, TRUNC(SYSDATE), 'ACTIVO', :usuarioId, :sucursalId
            ) RETURNING ID INTO :empleadoId`,
            {
                cargo,
                salario: nbind(salario),
                usuarioId: nbind(usuarioId),
                sucursalId: nbind(sucursalId),
                empleadoId: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER }
            }
        )

        const empleadoId = Array.isArray(resEmpleado.outBinds.empleadoId)
            ? resEmpleado.outBinds.empleadoId[0]
            : resEmpleado.outBinds.empleadoId

        // 5. Confirmar transacción
        await conn.commit()

        return {
            empleadoId,
            usuarioId,
            nombre,
            apellido,
            email: email.toLowerCase(),
            cargo,
            salario,
            sucursalId
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
 * Actualizar datos de empleado y/o usuario (PATCH /:id)
 */
export async function actualizarEmpleado(id, {
    cargo,
    salario,
    sucursalId,
    nombre,
    apellido,
    telefono,
    rolId,
    adminId
}) {
    let conn
    try {
        conn = await oracledb.getConnection()
        await setUsuario(conn, adminId)

        // Buscar el empleado y su usuarioId
        const cur = await conn.execute(
            `SELECT ID, Cargo, Salario, Sucursal_ID, Usuarios_ID FROM F_Empleados WHERE ID = :id FOR UPDATE`,
            { id: nbind(id) }
        )
        const emp = cur.rows?.[0]
        if (!emp) {
            const err = new Error('No se encontró el empleado')
            err.statusCode = 404
            throw err
        }

        const usuarioId = emp.USUARIOS_ID

        // 1. Actualizar F_Empleados si hay campos laborales
        const empUpdates = []
        const empBinds = { id: nbind(id) }

        if (cargo !== undefined) {
            empUpdates.push('Cargo = :cargo')
            empBinds.cargo = String(cargo).trim()
        }
        if (salario !== undefined && num(salario) !== null) {
            empUpdates.push('Salario = :salario')
            empBinds.salario = nbind(num(salario))
        }
        if (sucursalId !== undefined && num(sucursalId) !== null) {
            empUpdates.push('Sucursal_ID = :sucursalId')
            empBinds.sucursalId = nbind(num(sucursalId))
        }

        if (empUpdates.length > 0) {
            await conn.execute(
                `UPDATE F_Empleados SET ${empUpdates.join(', ')} WHERE ID = :id`,
                empBinds
            )
        }

        // 2. Actualizar F_Usuarios si hay campos personales
        const usrUpdates = []
        const usrBinds = { usrId: nbind(usuarioId) }

        if (nombre !== undefined) {
            usrUpdates.push('Nombre = :nombre')
            usrBinds.nombre = String(nombre).trim()
        }
        if (apellido !== undefined) {
            usrUpdates.push('Apellido = :apellido')
            usrBinds.apellido = String(apellido).trim()
        }
        if (telefono !== undefined) {
            usrUpdates.push('Telefono = :telefono')
            usrBinds.telefono = String(telefono).trim() || null
        }
        if (rolId !== undefined && num(rolId) !== null) {
            usrUpdates.push('Roles_ID = :rolId')
            usrBinds.rolId = nbind(num(rolId))
        }

        if (usrUpdates.length > 0) {
            await conn.execute(
                `UPDATE F_Usuarios SET ${usrUpdates.join(', ')} WHERE ID = :usrId`,
                usrBinds
            )
        }

        await conn.commit()
        return { id, usuarioId, mensaje: 'Empleado y usuario actualizados correctamente' }
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
 * Cambiar estado en AMBAS tablas (F_Empleados y F_Usuarios)
 * Garantiza que si se da de baja no pueda loguearse ni vender.
 */
export async function cambiarEstadoEmpleado(id, nuevoEstado, adminId) {
    let conn
    try {
        conn = await oracledb.getConnection()
        await setUsuario(conn, adminId)

        const estadoUpper = String(nuevoEstado).toUpperCase()
        if (!['ACTIVO', 'INACTIVO'].includes(estadoUpper)) {
            const err = new Error('El estado debe ser ACTIVO o INACTIVO')
            err.statusCode = 400
            throw err
        }

        // Obtener usuarioId
        const cur = await conn.execute(
            `SELECT ID, Usuarios_ID, Estado FROM F_Empleados WHERE ID = :id FOR UPDATE`,
            { id: nbind(id) }
        )
        const emp = cur.rows?.[0]
        if (!emp) {
            const err = new Error('No se encontró el empleado')
            err.statusCode = 404
            throw err
        }

        const usuarioId = emp.USUARIOS_ID

        // Actualizar ambas tablas
        await conn.execute(
            `UPDATE F_Empleados SET Estado = :estado WHERE ID = :id`,
            { estado: estadoUpper, id: nbind(id) }
        )

        await conn.execute(
            `UPDATE F_Usuarios SET Estado = :estado WHERE ID = :usrId`,
            { estado: estadoUpper, usrId: nbind(usuarioId) }
        )

        if (estadoUpper === 'INACTIVO') await revocarTodas(conn, usuarioId)

        await conn.commit()
        return {
            id,
            usuarioId,
            estado: estadoUpper,
            mensaje: `Empleado y usuario pasaron a estado ${estadoUpper}`
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
