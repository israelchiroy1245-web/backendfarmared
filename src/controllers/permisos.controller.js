import { oracledb } from '../config/database.js'
import { num, errorOracle } from '../utils/oracle.js'
import { ejecutarPagina, leerPaginacion, respuestaPaginada, terminoLike } from '../utils/paginacion.js'
import { setUsuario } from '../services/sesion.js'

/**
 * GET /api/permisos
 * Lista todos los permisos del sistema junto con los roles que lo tienen asignado.
 */
export const listarPermisos = async (req, res) => {
    const { limit, offset } = leerPaginacion(req.query)
    const q = terminoLike(req.query.q)
    let sql = `
            SELECT p.ID, p.Nombre,
                    COUNT(rp.Roles_ID) AS Total_Roles
             FROM F_Permisos p
             LEFT JOIN F_rol_permiso rp ON rp.Permisos_ID = p.ID
             WHERE 1 = 1`
    const binds = {}
    if (q) {
        sql += ` AND UPPER(p.Nombre) LIKE :q`
        binds.q = q
    }
    sql += ` GROUP BY p.ID, p.Nombre`

    let conn
    try {
        conn = await oracledb.getConnection()
        const pagina = await ejecutarPagina(conn, {
            sql,
            binds,
            orderBy: 'ORDER BY ID ASC',
            limit,
            offset,
            resumenSelect: 'SUM(CASE WHEN TOTAL_ROLES > 0 THEN 1 ELSE 0 END) AS EN_USO',
        })

        return res.status(200).json({
            ok: true,
            permisos: pagina.rows,
            total: pagina.total,
            resumen: { enUso: Number(pagina.metrics?.EN_USO ?? 0) },
            paginacion: respuestaPaginada({ total: pagina.total, limit, offset }),
        })
    } catch (error) {
        console.error('Error al listar permisos:', error.message)
        const mapped = errorOracle(error)
        return res.status(mapped.status).json({ ok: false, error: mapped.error })
    } finally {
        if (conn) try { await conn.close() } catch { /* ignore */ }
    }
}

/**
 * POST /api/permisos
 * Crea un nuevo permiso en el catálogo del sistema (F_Permisos).
 */
export const crearPermiso = async (req, res) => {
    const nombre = String(req.body.nombre || '').trim().toUpperCase()

    if (!nombre) {
        return res.status(400).json({ ok: false, error: 'El nombre del permiso es obligatorio' })
    }

    let conn
    try {
        conn = await oracledb.getConnection()

        if (req.usuario?.id) {
            await setUsuario(conn, req.usuario.id)
        }

        const result = await conn.execute(
            `INSERT INTO F_Permisos (Nombre)
             VALUES (:nombre)
             RETURNING ID INTO :id`,
            {
                nombre,
                id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER }
            }
        )

        await conn.commit()

        const idCreado = Array.isArray(result.outBinds.id)
            ? result.outBinds.id[0]
            : result.outBinds.id

        return res.status(201).json({
            ok: true,
            mensaje: 'Permiso creado exitosamente',
            id: idCreado,
            nombre
        })
    } catch (error) {
        if (conn) try { await conn.rollback() } catch { /* ignore */ }
        console.error('Error al crear permiso:', error.message)

        const msg = error.message || ''
        if (msg.includes('ORA-00001')) {
            return res.status(409).json({ ok: false, error: `El permiso '${nombre}' ya existe en el sistema` })
        }

        const mapped = errorOracle(error)
        return res.status(mapped.status).json({ ok: false, error: mapped.error })
    } finally {
        if (conn) try { await conn.close() } catch { /* ignore */ }
    }
}

/**
 * DELETE /api/permisos/:id
 * Elimina un permiso si no está siendo usado por ningún rol.
 */
export const eliminarPermiso = async (req, res) => {
    const id = num(req.params.id)
    if (!id) {
        return res.status(400).json({ ok: false, error: 'ID de permiso inválido' })
    }

    let conn
    try {
        conn = await oracledb.getConnection()

        if (req.usuario?.id) {
            await setUsuario(conn, req.usuario.id)
        }

        // Verificar si algún rol lo tiene asignado
        const check = await conn.execute(
            `SELECT COUNT(*) AS Total FROM F_rol_permiso WHERE Permisos_ID = :id`,
            { id: { val: id, type: oracledb.NUMBER } }
        )

        const totalRoles = check.rows?.[0]?.TOTAL ?? 0
        if (totalRoles > 0) {
            return res.status(409).json({
                ok: false,
                error: `No se puede eliminar el permiso porque está asignado a ${totalRoles} rol(es)`
            })
        }

        const resDelete = await conn.execute(
            `DELETE FROM F_Permisos WHERE ID = :id`,
            { id: { val: id, type: oracledb.NUMBER } }
        )

        if (resDelete.rowsAffected === 0) {
            return res.status(404).json({ ok: false, error: 'Permiso no encontrado' })
        }

        await conn.commit()

        return res.status(200).json({
            ok: true,
            mensaje: 'Permiso eliminado exitosamente'
        })
    } catch (error) {
        if (conn) try { await conn.rollback() } catch { /* ignore */ }
        console.error('Error al eliminar permiso:', error.message)
        const mapped = errorOracle(error)
        return res.status(mapped.status).json({ ok: false, error: mapped.error })
    } finally {
        if (conn) try { await conn.close() } catch { /* ignore */ }
    }
}
