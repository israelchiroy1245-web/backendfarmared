import { oracledb } from '../config/database.js'
import { num, errorOracle } from '../utils/oracle.js'
import { ejecutarPagina, leerPaginacion, respuestaPaginada, terminoLike } from '../utils/paginacion.js'
import { setUsuario } from '../services/sesion.js'

// Roles protegidos que no deben ser eliminados para no romper la lógica del sistema
const ROLES_PROTEGIDOS = ['ADMIN', 'CAJERO', 'AUDITOR', 'CALL_CENTER', 'QF']

/**
 * GET /api/roles
 * Lista todos los roles con el conteo de usuarios que tienen asignado cada rol.
 */
export const listarRoles = async (req, res) => {
    const { limit, offset } = leerPaginacion(req.query)
    const q = terminoLike(req.query.q)
    let sql = `
            SELECT r.ID, r.Nombre, r.Descripcion,
                    COUNT(u.ID) AS Total_Usuarios
             FROM F_Roles r
             LEFT JOIN F_Usuarios u ON u.Roles_ID = r.ID
             WHERE 1 = 1`
    const binds = {}
    if (q) {
        sql += ` AND (UPPER(r.Nombre) LIKE :q ESCAPE '\\' OR UPPER(NVL(r.Descripcion, '')) LIKE :q ESCAPE '\\')`
        binds.q = q
    }
    sql += ` GROUP BY r.ID, r.Nombre, r.Descripcion`

    let conn
    try {
        conn = await oracledb.getConnection()
        const pagina = await ejecutarPagina(conn, {
            sql,
            binds,
            orderBy: 'ORDER BY ID ASC',
            limit,
            offset,
            resumenSelect: `SUM(TOTAL_USUARIOS) AS USUARIOS,
                SUM(CASE WHEN NOMBRE IN ('ADMIN', 'CAJERO', 'AUDITOR', 'CALL_CENTER', 'QF') THEN 1 ELSE 0 END) AS PROTEGIDOS`,
        })

        return res.status(200).json({
            ok: true,
            roles: pagina.rows,
            total: pagina.total,
            resumen: {
                usuarios: Number(pagina.metrics?.USUARIOS ?? 0),
                protegidos: Number(pagina.metrics?.PROTEGIDOS ?? 0),
            },
            paginacion: respuestaPaginada({ total: pagina.total, limit, offset }),
        })
    } catch (error) {
        console.error('Error al listar roles:', error.message)
        const mapped = errorOracle(error)
        return res.status(mapped.status).json({ ok: false, error: mapped.error })
    } finally {
        if (conn) try { await conn.close() } catch { /* ignore */ }
    }
}

/**
 * GET /api/roles/permisos
 * Lista el catálogo de permisos disponibles en el sistema (F_Permisos).
 */
export const listarPermisos = async (req, res) => {
    let conn
    try {
        conn = await oracledb.getConnection()
        const result = await conn.execute(
            `SELECT ID, Nombre FROM F_Permisos ORDER BY ID ASC`
        )

        return res.status(200).json({ ok: true, permisos: result.rows })
    } catch (error) {
        console.error('Error al listar permisos:', error.message)
        const mapped = errorOracle(error)
        return res.status(mapped.status).json({ ok: false, error: mapped.error })
    } finally {
        if (conn) try { await conn.close() } catch { /* ignore */ }
    }
}

/**
 * GET /api/roles/:id
 * Detalle de un rol por ID junto con la lista de permisos asignados.
 */
export const obtenerRol = async (req, res) => {
    const id = num(req.params.id)
    if (!id) {
        return res.status(400).json({ ok: false, error: 'ID de rol inválido' })
    }

    let conn
    try {
        conn = await oracledb.getConnection()

        // 1. Obtener rol
        const resRol = await conn.execute(
            `SELECT ID, Nombre, Descripcion FROM F_Roles WHERE ID = :id`,
            { id: { val: id, type: oracledb.NUMBER } }
        )

        if (!resRol.rows || resRol.rows.length === 0) {
            return res.status(404).json({ ok: false, error: 'Rol no encontrado' })
        }

        const rol = resRol.rows[0]

        // 2. Obtener permisos asignados a este rol
        const resPermisos = await conn.execute(
            `SELECT p.ID, p.Nombre
             FROM F_rol_permiso rp
             JOIN F_Permisos p ON p.ID = rp.Permisos_ID
             WHERE rp.Roles_ID = :id
             ORDER BY p.ID ASC`,
            { id: { val: id, type: oracledb.NUMBER } }
        )

        return res.status(200).json({
            ok: true,
            rol: {
                ...rol,
                permisos: resPermisos.rows || []
            }
        })
    } catch (error) {
        console.error('Error al obtener rol:', error.message)
        const mapped = errorOracle(error)
        return res.status(mapped.status).json({ ok: false, error: mapped.error })
    } finally {
        if (conn) try { await conn.close() } catch { /* ignore */ }
    }
}

/**
 * POST /api/roles
 * Crea un nuevo rol y opcionalmente le asigna permisos en F_rol_permiso.
 */
export const crearRol = async (req, res) => {
    const nombre = String(req.body.nombre || '').trim().toUpperCase()
    const descripcion = req.body.descripcion ? String(req.body.descripcion).trim() : null
    const permisosIds = Array.isArray(req.body.permisos) ? req.body.permisos.map(num).filter((p) => p != null) : []

    if (!nombre) {
        return res.status(400).json({ ok: false, error: 'El nombre del rol es obligatorio' })
    }

    let conn
    try {
        conn = await oracledb.getConnection()

        if (req.usuario?.id) {
            await setUsuario(conn, req.usuario.id)
        }

        // 1. Insertar el rol
        const resRol = await conn.execute(
            `INSERT INTO F_Roles (Nombre, Descripcion)
             VALUES (:nombre, :descripcion)
             RETURNING ID INTO :id`,
            {
                nombre,
                descripcion,
                id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER }
            }
        )

        const rolId = Array.isArray(resRol.outBinds.id) ? resRol.outBinds.id[0] : resRol.outBinds.id

        // 2. Insertar permisos en F_rol_permiso si se enviaron
        for (const permisoId of permisosIds) {
            await conn.execute(
                `INSERT INTO F_rol_permiso (Roles_ID, Permisos_ID)
                 VALUES (:rolId, :permisoId)`,
                {
                    rolId: { val: rolId, type: oracledb.NUMBER },
                    permisoId: { val: permisoId, type: oracledb.NUMBER }
                }
            )
        }

        await conn.commit()

        return res.status(201).json({
            ok: true,
            mensaje: 'Rol creado exitosamente',
            id: rolId
        })
    } catch (error) {
        if (conn) try { await conn.rollback() } catch { /* ignore */ }
        console.error('Error al crear rol:', error.message)

        const msg = error.message || ''
        if (msg.includes('ORA-00001')) {
            return res.status(409).json({ ok: false, error: `El rol '${nombre}' ya existe en el sistema` })
        }

        const mapped = errorOracle(error)
        return res.status(mapped.status).json({ ok: false, error: mapped.error })
    } finally {
        if (conn) try { await conn.close() } catch { /* ignore */ }
    }
}

/**
 * PUT /api/roles/:id
 * Actualiza nombre, descripción y/o permisos de un rol.
 */
export const actualizarRol = async (req, res) => {
    const id = num(req.params.id)
    if (!id) {
        return res.status(400).json({ ok: false, error: 'ID de rol inválido' })
    }

    const nombre = req.body.nombre ? String(req.body.nombre).trim().toUpperCase() : null
    const descripcion = req.body.descripcion !== undefined ? (req.body.descripcion ? String(req.body.descripcion).trim() : null) : null
    const permisosIds = Array.isArray(req.body.permisos) ? req.body.permisos.map(num).filter((p) => p != null) : null

    let conn
    try {
        conn = await oracledb.getConnection()

        if (req.usuario?.id) {
            await setUsuario(conn, req.usuario.id)
        }

        // 1. Verificar existencia
        const check = await conn.execute(
            `SELECT ID, Nombre, Descripcion FROM F_Roles WHERE ID = :id`,
            { id: { val: id, type: oracledb.NUMBER } }
        )

        if (!check.rows || check.rows.length === 0) {
            return res.status(404).json({ ok: false, error: 'Rol no encontrado' })
        }

        const rolActual = check.rows[0]

        // 2. Actualizar datos en F_Roles
        await conn.execute(
            `UPDATE F_Roles
             SET Nombre = :nombre,
                 Descripcion = :descripcion
             WHERE ID = :id`,
            {
                nombre: nombre ?? rolActual.NOMBRE,
                descripcion: descripcion !== null ? descripcion : rolActual.DESCRIPCION,
                id: { val: id, type: oracledb.NUMBER }
            }
        )

        // 3. Si se envió el arreglo de permisos, actualizar la tabla intermedia F_rol_permiso
        if (permisosIds !== null) {
            await conn.execute(
                `DELETE FROM F_rol_permiso WHERE Roles_ID = :id`,
                { id: { val: id, type: oracledb.NUMBER } }
            )

            for (const permisoId of permisosIds) {
                await conn.execute(
                    `INSERT INTO F_rol_permiso (Roles_ID, Permisos_ID)
                     VALUES (:rolId, :permisoId)`,
                    {
                        rolId: { val: id, type: oracledb.NUMBER },
                        permisoId: { val: permisoId, type: oracledb.NUMBER }
                    }
                )
            }
        }

        await conn.commit()

        return res.status(200).json({
            ok: true,
            mensaje: 'Rol actualizado exitosamente'
        })
    } catch (error) {
        if (conn) try { await conn.rollback() } catch { /* ignore */ }
        console.error('Error al actualizar rol:', error.message)

        const msg = error.message || ''
        if (msg.includes('ORA-00001')) {
            return res.status(409).json({ ok: false, error: 'Ya existe otro rol con ese nombre' })
        }

        const mapped = errorOracle(error)
        return res.status(mapped.status).json({ ok: false, error: mapped.error })
    } finally {
        if (conn) try { await conn.close() } catch { /* ignore */ }
    }
}

/**
 * DELETE /api/roles/:id
 * Elimina un rol si no es un rol del sistema y no tiene usuarios asignados.
 */
export const eliminarRol = async (req, res) => {
    const id = num(req.params.id)
    if (!id) {
        return res.status(400).json({ ok: false, error: 'ID de rol inválido' })
    }

    let conn
    try {
        conn = await oracledb.getConnection()

        if (req.usuario?.id) {
            await setUsuario(conn, req.usuario.id)
        }

        // 1. Obtener rol para validación
        const check = await conn.execute(
            `SELECT ID, Nombre FROM F_Roles WHERE ID = :id`,
            { id: { val: id, type: oracledb.NUMBER } }
        )

        if (!check.rows || check.rows.length === 0) {
            return res.status(404).json({ ok: false, error: 'Rol no encontrado' })
        }

        const rol = check.rows[0]

        // 2. Impedir eliminación de roles protegidos del sistema
        if (ROLES_PROTEGIDOS.includes(rol.NOMBRE.toUpperCase())) {
            return res.status(403).json({
                ok: false,
                error: `El rol '${rol.NOMBRE}' es fundamental para el sistema y no puede ser eliminado`
            })
        }

        // 3. Verificar si hay usuarios vinculados a este rol
        const usuariosConRol = await conn.execute(
            `SELECT COUNT(*) AS Total FROM F_Usuarios WHERE Roles_ID = :id`,
            { id: { val: id, type: oracledb.NUMBER } }
        )

        const totalUsuarios = usuariosConRol.rows?.[0]?.TOTAL ?? 0
        if (totalUsuarios > 0) {
            return res.status(409).json({
                ok: false,
                error: `No se puede eliminar el rol porque tiene ${totalUsuarios} usuario(s) asignado(s)`
            })
        }

        // 4. Eliminar asociaciones en F_rol_permiso
        await conn.execute(
            `DELETE FROM F_rol_permiso WHERE Roles_ID = :id`,
            { id: { val: id, type: oracledb.NUMBER } }
        )

        // 5. Eliminar el rol
        await conn.execute(
            `DELETE FROM F_Roles WHERE ID = :id`,
            { id: { val: id, type: oracledb.NUMBER } }
        )

        await conn.commit()

        return res.status(200).json({
            ok: true,
            mensaje: 'Rol eliminado exitosamente'
        })
    } catch (error) {
        if (conn) try { await conn.rollback() } catch { /* ignore */ }
        console.error('Error al eliminar rol:', error.message)
        const mapped = errorOracle(error)
        return res.status(mapped.status).json({ ok: false, error: mapped.error })
    } finally {
        if (conn) try { await conn.close() } catch { /* ignore */ }
    }
}

// =============================================================================
// ASIGNACIÓN Y GESTIÓN DE PERMISOS PARA UN ROL
// =============================================================================

/**
 * GET /api/roles/:id/permisos
 * Lista los permisos asignados a un rol específico.
 */
export const obtenerPermisosDeRol = async (req, res) => {
    const id = num(req.params.id)
    if (!id) {
        return res.status(400).json({ ok: false, error: 'ID de rol inválido' })
    }

    let conn
    try {
        conn = await oracledb.getConnection()
        const resRol = await conn.execute(
            `SELECT ID, Nombre FROM F_Roles WHERE ID = :id`,
            { id: { val: id, type: oracledb.NUMBER } }
        )
        if (!resRol.rows || resRol.rows.length === 0) {
            return res.status(404).json({ ok: false, error: 'Rol no encontrado' })
        }

        const result = await conn.execute(
            `SELECT p.ID, p.Nombre
             FROM F_rol_permiso rp
             JOIN F_Permisos p ON p.ID = rp.Permisos_ID
             WHERE rp.Roles_ID = :id
             ORDER BY p.ID ASC`,
            { id: { val: id, type: oracledb.NUMBER } }
        )

        return res.status(200).json({
            ok: true,
            rolId: id,
            rolNombre: resRol.rows[0].NOMBRE,
            permisos: result.rows || []
        })
    } catch (error) {
        console.error('Error al obtener permisos del rol:', error.message)
        const mapped = errorOracle(error)
        return res.status(mapped.status).json({ ok: false, error: mapped.error })
    } finally {
        if (conn) try { await conn.close() } catch { /* ignore */ }
    }
}

/**
 * POST /api/roles/:id/permisos
 * Asigna uno o más permisos a un rol.
 * Body: { permisos: [1, 2] } o { permisoId: 1 }
 */
export const asignarPermisosARol = async (req, res) => {
    const id = num(req.params.id)
    if (!id) {
        return res.status(400).json({ ok: false, error: 'ID de rol inválido' })
    }

    // Acepta { permisoId: 1 } o { permisos: [1, 2, 3] }
    let permisosIds = []
    if (req.body.permisoId) {
        const p = num(req.body.permisoId)
        if (p) permisosIds.push(p)
    } else if (Array.isArray(req.body.permisos)) {
        permisosIds = req.body.permisos.map(num).filter((p) => p != null)
    }

    if (permisosIds.length === 0) {
        return res.status(400).json({
            ok: false,
            error: 'Debe especificar al menos un permiso (permisoId o array permisos)'
        })
    }

    let conn
    try {
        conn = await oracledb.getConnection()

        if (req.usuario?.id) {
            await setUsuario(conn, req.usuario.id)
        }

        // Verificar existencia del rol
        const checkRol = await conn.execute(
            `SELECT ID, Nombre FROM F_Roles WHERE ID = :id`,
            { id: { val: id, type: oracledb.NUMBER } }
        )
        if (!checkRol.rows || checkRol.rows.length === 0) {
            return res.status(404).json({ ok: false, error: 'Rol no encontrado' })
        }

        let asignados = 0
        for (const permisoId of permisosIds) {
            // Verificar si el permiso existe en F_Permisos
            const checkPermiso = await conn.execute(
                `SELECT ID FROM F_Permisos WHERE ID = :pid`,
                { pid: { val: permisoId, type: oracledb.NUMBER } }
            )
            if (!checkPermiso.rows || checkPermiso.rows.length === 0) {
                continue // Salta si el ID de permiso no existe
            }

            // Insertar evitando duplicados
            const checkExiste = await conn.execute(
                `SELECT 1 FROM F_rol_permiso WHERE Roles_ID = :rid AND Permisos_ID = :pid`,
                {
                    rid: { val: id, type: oracledb.NUMBER },
                    pid: { val: permisoId, type: oracledb.NUMBER }
                }
            )

            if (!checkExiste.rows || checkExiste.rows.length === 0) {
                await conn.execute(
                    `INSERT INTO F_rol_permiso (Roles_ID, Permisos_ID) VALUES (:rid, :pid)`,
                    {
                        rid: { val: id, type: oracledb.NUMBER },
                        pid: { val: permisoId, type: oracledb.NUMBER }
                    }
                )
                asignados++
            }
        }

        await conn.commit()

        return res.status(200).json({
            ok: true,
            mensaje: `Se asignaron ${asignados} permiso(s) al rol exitosamente`
        })
    } catch (error) {
        if (conn) try { await conn.rollback() } catch { /* ignore */ }
        console.error('Error al asignar permisos al rol:', error.message)
        const mapped = errorOracle(error)
        return res.status(mapped.status).json({ ok: false, error: mapped.error })
    } finally {
        if (conn) try { await conn.close() } catch { /* ignore */ }
    }
}

/**
 * PUT /api/roles/:id/permisos
 * Sincroniza (reemplaza) todos los permisos del rol con la lista enviada.
 * Body: { permisos: [1, 2, 4] }
 */
export const sincronizarPermisosDeRol = async (req, res) => {
    const id = num(req.params.id)
    if (!id) {
        return res.status(400).json({ ok: false, error: 'ID de rol inválido' })
    }

    if (!Array.isArray(req.body.permisos)) {
        return res.status(400).json({ ok: false, error: "El campo 'permisos' debe ser un arreglo de IDs" })
    }

    const permisosIds = req.body.permisos.map(num).filter((p) => p != null)

    let conn
    try {
        conn = await oracledb.getConnection()

        if (req.usuario?.id) {
            await setUsuario(conn, req.usuario.id)
        }

        // Verificar que el rol existe
        const checkRol = await conn.execute(
            `SELECT ID, Nombre FROM F_Roles WHERE ID = :id`,
            { id: { val: id, type: oracledb.NUMBER } }
        )
        if (!checkRol.rows || checkRol.rows.length === 0) {
            return res.status(404).json({ ok: false, error: 'Rol no encontrado' })
        }

        // Eliminar permisos actuales de este rol
        await conn.execute(
            `DELETE FROM F_rol_permiso WHERE Roles_ID = :id`,
            { id: { val: id, type: oracledb.NUMBER } }
        )

        // Insertar los nuevos permisos válidos
        let insertados = 0
        for (const permisoId of permisosIds) {
            const checkPermiso = await conn.execute(
                `SELECT ID FROM F_Permisos WHERE ID = :pid`,
                { pid: { val: permisoId, type: oracledb.NUMBER } }
            )
            if (checkPermiso.rows && checkPermiso.rows.length > 0) {
                await conn.execute(
                    `INSERT INTO F_rol_permiso (Roles_ID, Permisos_ID) VALUES (:rid, :pid)`,
                    {
                        rid: { val: id, type: oracledb.NUMBER },
                        pid: { val: permisoId, type: oracledb.NUMBER }
                    }
                )
                insertados++
            }
        }

        await conn.commit()

        return res.status(200).json({
            ok: true,
            mensaje: `Permisos del rol sincronizados exitosamente (${insertados} asignados)`
        })
    } catch (error) {
        if (conn) try { await conn.rollback() } catch { /* ignore */ }
        console.error('Error al sincronizar permisos del rol:', error.message)
        const mapped = errorOracle(error)
        return res.status(mapped.status).json({ ok: false, error: mapped.error })
    } finally {
        if (conn) try { await conn.close() } catch { /* ignore */ }
    }
}

/**
 * DELETE /api/roles/:id/permisos/:permisoId
 * Quita (revoca) un permiso específico de un rol.
 */
export const removerPermisoDeRol = async (req, res) => {
    const id = num(req.params.id)
    const permisoId = num(req.params.permisoId)

    if (!id || !permisoId) {
        return res.status(400).json({ ok: false, error: 'ID de rol o ID de permiso inválido' })
    }

    let conn
    try {
        conn = await oracledb.getConnection()

        if (req.usuario?.id) {
            await setUsuario(conn, req.usuario.id)
        }

        const result = await conn.execute(
            `DELETE FROM F_rol_permiso
             WHERE Roles_ID = :rid AND Permisos_ID = :pid`,
            {
                rid: { val: id, type: oracledb.NUMBER },
                pid: { val: permisoId, type: oracledb.NUMBER }
            }
        )

        if (result.rowsAffected === 0) {
            return res.status(404).json({
                ok: false,
                error: 'Ese permiso no estaba asignado a este rol'
            })
        }

        await conn.commit()

        return res.status(200).json({
            ok: true,
            mensaje: 'Permiso revocado del rol exitosamente'
        })
    } catch (error) {
        if (conn) try { await conn.rollback() } catch { /* ignore */ }
        console.error('Error al remover permiso del rol:', error.message)
        const mapped = errorOracle(error)
        return res.status(mapped.status).json({ ok: false, error: mapped.error })
    } finally {
        if (conn) try { await conn.close() } catch { /* ignore */ }
    }
}
