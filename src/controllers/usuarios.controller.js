import bcrypt from 'bcryptjs'
import { oracledb } from '../config/database.js'
import { num, nbind, errorOracle } from '../utils/oracle.js'
import { ejecutarPagina, leerPaginacion, respuestaPaginada, terminoLike } from '../utils/paginacion.js'
import { setUsuario } from '../services/sesion.js'
import { revocarTodas } from '../services/sesionAuth.service.js'

/**
 * GET /api/usuarios
 * Lista todos los usuarios con su rol, sucursal y empleado asociado.
 * Nunca proyecta Password_hash.
 */
export const listarUsuarios = async (req, res) => {
    const { limit, offset } = leerPaginacion(req.query)
    const q = terminoLike(req.query.q)
    const sucursalId = num(req.query.sucursalId)
    let sql = `
            SELECT u.ID, u.Nombre, u.Apellido, u.Email, u.DPI, u.Telefono, u.Estado,
                r.ID AS Rol_ID, r.Nombre AS Rol,
                e.ID AS Empleado_ID, e.Cargo, e.Salario, e.Fecha_ingreso,
                s.ID AS Sucursal_ID, s.Nombre AS Sucursal
            FROM F_Usuarios u
            JOIN F_Roles r ON r.ID = u.Roles_ID
            LEFT JOIN F_Empleados e ON e.Usuarios_ID = u.ID
            LEFT JOIN F_Sucursal s ON s.ID = e.Sucursal_ID
            WHERE 1 = 1`
    const binds = {}
    if (q) {
        sql += ` AND (
            UPPER(u.Nombre) LIKE :q OR UPPER(u.Apellido) LIKE :q OR UPPER(u.Email) LIKE :q
            OR UPPER(u.DPI) LIKE :q OR UPPER(u.Telefono) LIKE :q OR UPPER(r.Nombre) LIKE :q
            OR UPPER(e.Cargo) LIKE :q OR UPPER(s.Nombre) LIKE :q
        )`
        binds.q = q
    }
    if (sucursalId) {
        sql += ` AND e.Sucursal_ID = :sucursalId`
        binds.sucursalId = nbind(sucursalId)
    }

    let conn
    try {
        conn = await oracledb.getConnection()
        const pagina = await ejecutarPagina(conn, {
            sql,
            binds,
            orderBy: 'ORDER BY u.ID DESC',
            limit,
            offset,
            resumenSelect: `SUM(CASE WHEN ESTADO = 'ACTIVO' THEN 1 ELSE 0 END) AS ACTIVOS,
                COUNT(DISTINCT ROL) AS ROLES,
                SUM(CASE WHEN SUCURSAL IS NOT NULL THEN 1 ELSE 0 END) AS CON_SUCURSAL`,
        })

        return res.status(200).json({
            ok: true,
            usuarios: pagina.rows,
            total: pagina.total,
            resumen: {
                activos: Number(pagina.metrics?.ACTIVOS ?? 0),
                roles: Number(pagina.metrics?.ROLES ?? 0),
                conSucursal: Number(pagina.metrics?.CON_SUCURSAL ?? 0),
            },
            paginacion: respuestaPaginada({ total: pagina.total, limit, offset }),
        })
    } catch (error) {
        console.error('Error al obtener usuarios:', error.message)
        const mapped = errorOracle(error)
        return res.status(mapped.status).json({ ok: false, error: mapped.error })
    } finally {
        if (conn) try { await conn.close() } catch { /* ignore */ }
    }
}

/**
 * GET /api/usuarios/:id
 * Obtiene el detalle de un usuario específico por su ID.
 */
export const obtenerUsuario = async (req, res) => {
    const id = num(req.params.id)
    if (!id) {
        return res.status(400).json({ ok: false, error: 'ID de usuario inválido' })
    }

    let conn
    try {
        conn = await oracledb.getConnection()
        const result = await conn.execute(
            `SELECT u.ID, u.Nombre, u.Apellido, u.Email, u.DPI, u.Telefono, u.Estado,
                r.ID AS Rol_ID, r.Nombre AS Rol,
                e.ID AS Empleado_ID, e.Cargo, e.Salario, e.Fecha_ingreso,
                s.ID AS Sucursal_ID, s.Nombre AS Sucursal
            FROM F_Usuarios u
            JOIN F_Roles r ON r.ID = u.Roles_ID
            LEFT JOIN F_Empleados e ON e.Usuarios_ID = u.ID
            LEFT JOIN F_Sucursal s ON s.ID = e.Sucursal_ID
            WHERE u.ID = :id`,
            { id: { val: id, type: oracledb.NUMBER } }
        )

        if (!result.rows || result.rows.length === 0) {
            return res.status(404).json({ ok: false, error: 'Usuario no encontrado' })
        }

        return res.status(200).json({ ok: true, usuario: result.rows[0] })
    } catch (error) {
        console.error('Error al obtener detalle del usuario:', error.message)
        const mapped = errorOracle(error)
        return res.status(mapped.status).json({ ok: false, error: mapped.error })
    } finally {
        if (conn) try { await conn.close() } catch { /* ignore */ }
    }
}

/**
 * POST /api/usuarios
 * Alta transaccional de usuario y opcionalmente empleado vinculado.
 */
export const crearUsuario = async (req, res) => {
    const nombre = String(req.body.nombres || req.body.nombre || '').trim()
    const apellido = String(req.body.apellidos || req.body.apellido || '').trim()
    const email = String(req.body.correo || req.body.email || '').trim().toLowerCase()
    const dpi = String(req.body.DPI || req.body.dpi || '').trim()
    const telefono = req.body.telefono ? String(req.body.telefono).trim() : null
    const password = String(req.body.password || '')
    const rolId = num(req.body.rol ?? req.body.rolId)

    // Datos laborales opcionales para vincular empleado
    const cargo = req.body.cargo ? String(req.body.cargo).trim() : null
    const salario = num(req.body.salario)
    const sucursalId = num(req.body.sucursalId)

    if (!nombre || !apellido || !email || !dpi || !password || rolId == null) {
        return res.status(400).json({
            ok: false,
            error: 'nombre, apellido, email, dpi, rol y password son obligatorios'
        })
    }

    if (password.length < 6) {
        return res.status(400).json({
            ok: false,
            error: 'La contraseña debe tener al menos 6 caracteres'
        })
    }

    let conn
    try {
        conn = await oracledb.getConnection()

        // 1. Auditoría: registrar usuario actual en sesión de Oracle
        if (req.usuario?.id) {
            await setUsuario(conn, req.usuario.id)
        }

        // 2. Hash con bcrypt
        const passwordHash = await bcrypt.hash(password, 10)

        // 3. Insertar usuario
        const resultUsuario = await conn.execute(
            `INSERT INTO F_Usuarios (Nombre, Apellido, Email, DPI, Telefono, Estado, Roles_ID, Password_hash)
             VALUES (:nombre, :apellido, :email, :dpi, :telefono, 'ACTIVO', :rolId, :passwordHash)
             RETURNING ID INTO :id`,
            {
                nombre,
                apellido,
                email,
                dpi,
                telefono,
                rolId: { val: rolId, type: oracledb.NUMBER },
                passwordHash,
                id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER }
            }
        )

        const idUsuarioCreado = Array.isArray(resultUsuario.outBinds.id)
            ? resultUsuario.outBinds.id[0]
            : resultUsuario.outBinds.id

        // 4. Si se proporcionaron datos de empleado y sucursal, crear empleado
        let empleadoId = null
        if (cargo && salario != null && sucursalId != null) {
            const resultEmpleado = await conn.execute(
                `INSERT INTO F_Empleados (Cargo, Salario, Estado, Usuarios_ID, Sucursal_ID)
                 VALUES (:cargo, :salario, 'ACTIVO', :usuarioId, :sucursalId)
                 RETURNING ID INTO :empleadoId`,
                {
                    cargo,
                    salario: { val: salario, type: oracledb.NUMBER },
                    usuarioId: { val: idUsuarioCreado, type: oracledb.NUMBER },
                    sucursalId: { val: sucursalId, type: oracledb.NUMBER },
                    empleadoId: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER }
                }
            )
            empleadoId = Array.isArray(resultEmpleado.outBinds.empleadoId)
                ? resultEmpleado.outBinds.empleadoId[0]
                : resultEmpleado.outBinds.empleadoId
        }

        await conn.commit()

        return res.status(201).json({
            ok: true,
            mensaje: 'Usuario creado exitosamente',
            usuarioId: idUsuarioCreado,
            empleadoId
        })
    } catch (error) {
        if (conn) try { await conn.rollback() } catch { /* ignore */ }
        console.error('Error al crear usuario:', error.message)

        const msg = error.message || ''
        if (msg.includes('ORA-00001') || msg.includes('F_Usuarios_Email_UK') || msg.includes('F_Usuarios_DPI_UK')) {
            return res.status(409).json({
                ok: false,
                error: 'El correo electrónico o DPI ya se encuentra registrado'
            })
        }

        const mapped = errorOracle(error)
        return res.status(mapped.status).json({ ok: false, error: mapped.error })
    } finally {
        if (conn) try { await conn.close() } catch { /* ignore */ }
    }
}

/**
 * PUT /api/usuarios/:id
 * Actualiza los datos generales del usuario y/o empleado asociado.
 */
export const actualizarUsuario = async (req, res) => {
    const id = num(req.params.id)
    if (!id) {
        return res.status(400).json({ ok: false, error: 'ID de usuario inválido' })
    }

    const nombre = req.body.nombre ? String(req.body.nombre).trim() : null
    const apellido = req.body.apellido ? String(req.body.apellido).trim() : null
    const email = req.body.email ? String(req.body.email).trim().toLowerCase() : null
    const dpi = req.body.dpi ? String(req.body.dpi).trim() : null
    const telefono = req.body.telefono !== undefined ? (req.body.telefono ? String(req.body.telefono).trim() : null) : null
    const rolId = req.body.rolId !== undefined ? num(req.body.rolId) : null
    const estado = req.body.estado ? String(req.body.estado).trim().toUpperCase() : null

    // Datos laborales opcionales
    const cargo = req.body.cargo ? String(req.body.cargo).trim() : null
    const salario = req.body.salario !== undefined ? num(req.body.salario) : null
    const sucursalId = req.body.sucursalId !== undefined ? num(req.body.sucursalId) : null

    if (estado && !['ACTIVO', 'INACTIVO'].includes(estado)) {
        return res.status(400).json({ ok: false, error: "El estado debe ser 'ACTIVO' o 'INACTIVO'" })
    }

    let conn
    try {
        conn = await oracledb.getConnection()

        // 1. Auditoría
        if (req.usuario?.id) {
            await setUsuario(conn, req.usuario.id)
        }

        // 2. Verificar existencia del usuario
        const existeU = await conn.execute(
            `SELECT ID, Nombre, Apellido, Email, DPI, Telefono, Estado, Roles_ID 
             FROM F_Usuarios WHERE ID = :id`,
            { id: { val: id, type: oracledb.NUMBER } }
        )

        if (!existeU.rows || existeU.rows.length === 0) {
            return res.status(404).json({ ok: false, error: 'Usuario no encontrado' })
        }

        const actual = existeU.rows[0]

        // 3. Actualizar F_Usuarios
        await conn.execute(
            `UPDATE F_Usuarios
             SET Nombre = :nombre,
                 Apellido = :apellido,
                 Email = :email,
                 DPI = :dpi,
                 Telefono = :telefono,
                 Estado = :estado,
                 Roles_ID = :rolId
             WHERE ID = :id`,
            {
                nombre: nombre ?? actual.NOMBRE,
                apellido: apellido ?? actual.APELLIDO,
                email: email ?? actual.EMAIL,
                dpi: dpi ?? actual.DPI,
                telefono: req.body.telefono !== undefined ? telefono : actual.TELEFONO,
                estado: estado ?? actual.ESTADO,
                rolId: { val: rolId ?? actual.ROLES_ID, type: oracledb.NUMBER },
                id: { val: id, type: oracledb.NUMBER }
            }
        )

        // 4. Actualizar o crear F_Empleados si aplica
        const existeE = await conn.execute(
            `SELECT ID, Cargo, Salario, Sucursal_ID, Estado 
             FROM F_Empleados WHERE Usuarios_ID = :id`,
            { id: { val: id, type: oracledb.NUMBER } }
        )

        if (existeE.rows && existeE.rows.length > 0) {
            const actualEmp = existeE.rows[0]
            await conn.execute(
                `UPDATE F_Empleados
                 SET Cargo = :cargo,
                     Salario = :salario,
                     Sucursal_ID = :sucursalId,
                     Estado = :estado
                 WHERE Usuarios_ID = :id`,
                {
                    cargo: cargo ?? actualEmp.CARGO,
                    salario: { val: salario ?? actualEmp.SALARIO, type: oracledb.NUMBER },
                    sucursalId: { val: sucursalId ?? actualEmp.SUCURSAL_ID, type: oracledb.NUMBER },
                    estado: estado ?? actualEmp.ESTADO,
                    id: { val: id, type: oracledb.NUMBER }
                }
            )
        } else if (cargo && salario != null && sucursalId != null) {
            await conn.execute(
                `INSERT INTO F_Empleados (Cargo, Salario, Estado, Usuarios_ID, Sucursal_ID)
                 VALUES (:cargo, :salario, :estadoEmp, :usuarioId, :sucursalId)`,
                {
                    cargo,
                    salario: { val: salario, type: oracledb.NUMBER },
                    estadoEmp: estado ?? 'ACTIVO',
                    usuarioId: { val: id, type: oracledb.NUMBER },
                    sucursalId: { val: sucursalId, type: oracledb.NUMBER }
                }
            )
        }

        if (estado === 'INACTIVO') await revocarTodas(conn, id)

        await conn.commit()

        return res.status(200).json({
            ok: true,
            mensaje: 'Usuario actualizado exitosamente'
        })
    } catch (error) {
        if (conn) try { await conn.rollback() } catch { /* ignore */ }
        console.error('Error al actualizar usuario:', error.message)

        const msg = error.message || ''
        if (msg.includes('ORA-00001') || msg.includes('F_Usuarios_Email_UK') || msg.includes('F_Usuarios_DPI_UK')) {
            return res.status(409).json({
                ok: false,
                error: 'El correo electrónico o DPI ya pertenece a otro usuario'
            })
        }

        const mapped = errorOracle(error)
        return res.status(mapped.status).json({ ok: false, error: mapped.error })
    } finally {
        if (conn) try { await conn.close() } catch { /* ignore */ }
    }
}

/**
 * PATCH /api/usuarios/:id/password
 * Permite cambiar/resetear la contraseña de un usuario.
 */
export const cambiarPassword = async (req, res) => {
    const id = num(req.params.id)
    const password = String(req.body.password || req.body.nuevaPassword || '')

    if (!id) {
        return res.status(400).json({ ok: false, error: 'ID de usuario inválido' })
    }

    if (!password || password.length < 6) {
        return res.status(400).json({
            ok: false,
            error: 'La nueva contraseña debe tener al menos 6 caracteres'
        })
    }

    let conn
    try {
        conn = await oracledb.getConnection()

        // 1. Auditoría
        if (req.usuario?.id) {
            await setUsuario(conn, req.usuario.id)
        }

        // 2. Hash con bcrypt
        const passwordHash = await bcrypt.hash(password, 10)

        // 3. Actualizar contraseña
        const result = await conn.execute(
            `UPDATE F_Usuarios SET Password_hash = :hash WHERE ID = :id`,
            {
                hash: passwordHash,
                id: { val: id, type: oracledb.NUMBER }
            }
        )

        if (result.rowsAffected === 0) {
            return res.status(404).json({ ok: false, error: 'Usuario no encontrado' })
        }

        await revocarTodas(conn, id)
        await conn.commit()

        return res.status(200).json({
            ok: true,
            mensaje: 'Contraseña actualizada exitosamente'
        })
    } catch (error) {
        if (conn) try { await conn.rollback() } catch { /* ignore */ }
        console.error('Error al cambiar contraseña:', error.message)
        const mapped = errorOracle(error)
        return res.status(mapped.status).json({ ok: false, error: mapped.error })
    } finally {
        if (conn) try { await conn.close() } catch { /* ignore */ }
    }
}
