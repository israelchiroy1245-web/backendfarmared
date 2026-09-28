import { oracledb } from '../config/database.js'
import { errorOracle } from '../utils/oracle.js'

/**
 * GET /api/catalogos/sucursales
 * Lista simplificada de sucursales activas para combos y selectores
 */
export async function catalogoSucursales(_req, res) {
    let conn
    try {
        conn = await oracledb.getConnection()
        const result = await conn.execute(
            `SELECT ID, Codigo, Nombre, Tipo, Departamento, Municipio, Estado 
             FROM F_Sucursal 
             WHERE Estado = 'ACTIVA' 
             ORDER BY ID ASC`
        )
        return res.json({ ok: true, total: result.rows?.length || 0, datos: result.rows || [] })
    } catch (error) {
        console.error('Error al obtener catálogo de sucursales:', error.message)
        const err = errorOracle(error)
        return res.status(err.status).json({ ok: false, error: err.error })
    } finally {
        if (conn) {
            try { await conn.close() } catch (_) {}
        }
    }
}

/**
 * GET /api/catalogos/medicamentos
 * Lista de medicamentos disponibles para catálogo
 */
export async function catalogoMedicamentos(_req, res) {
    let conn
    try {
        conn = await oracledb.getConnection()
        const result = await conn.execute(
            `SELECT 
                ID, 
                Nombre_medic AS "NOMBRE_MEDICAMENTO", 
                Codigo_barra AS "CODIGO_BARRA", 
                Principio_activo AS "PRINCIPIO_ACTIVO", 
                Presentacion AS "PRESENTACION", 
                Laboratorio AS "LABORATORIO", 
                Receta_requerida AS "RECETA_REQUERIDA", 
                Precio_venta AS "PRECIO_VENTA", 
                Costo AS "COSTO"
             FROM F_Medicamentos 
             ORDER BY Nombre_medic ASC`
        )
        return res.json({ ok: true, total: result.rows?.length || 0, datos: result.rows || [] })
    } catch (error) {
        console.error('Error al obtener catálogo de medicamentos:', error.message)
        const err = errorOracle(error)
        return res.status(err.status).json({ ok: false, error: err.error })
    } finally {
        if (conn) {
            try { await conn.close() } catch (_) {}
        }
    }
}

/** GET /api/catalogos/roles — lista corta para selects, sin paginar. */
export async function catalogoRoles(_req, res) {
    let conn
    try {
        conn = await oracledb.getConnection()
        const result = await conn.execute(
            `SELECT ID, Nombre, Descripcion FROM F_Roles ORDER BY Nombre ASC`
        )
        return res.json({ ok: true, total: result.rows?.length || 0, datos: result.rows || [] })
    } catch (error) {
        console.error('Error al obtener catálogo de roles:', error.message)
        const err = errorOracle(error)
        return res.status(err.status).json({ ok: false, error: err.error })
    } finally {
        if (conn) {
            try { await conn.close() } catch (_) {}
        }
    }
}

/** GET /api/catalogos/permisos — lista corta para checkboxes, sin paginar. */
export async function catalogoPermisos(_req, res) {
    let conn
    try {
        conn = await oracledb.getConnection()
        const result = await conn.execute(
            `SELECT ID, Nombre FROM F_Permisos ORDER BY Nombre ASC`
        )
        return res.json({ ok: true, total: result.rows?.length || 0, datos: result.rows || [] })
    } catch (error) {
        console.error('Error al obtener catálogo de permisos:', error.message)
        const err = errorOracle(error)
        return res.status(err.status).json({ ok: false, error: err.error })
    } finally {
        if (conn) {
            try { await conn.close() } catch (_) {}
        }
    }
}

/** GET /api/catalogos/proveedores — lista para selects de compras */
export async function catalogoProveedores(_req, res) {
    let conn
    try {
        conn = await oracledb.getConnection()
        const result = await conn.execute(
            `SELECT ID, Nombre, NIT, Telefono, Email FROM F_Proveedores ORDER BY Nombre ASC`
        )
        return res.json({ ok: true, total: result.rows?.length || 0, datos: result.rows || [] })
    } catch (error) {
        console.error('Error al obtener catálogo de proveedores:', error.message)
        const err = errorOracle(error)
        return res.status(err.status).json({ ok: false, error: err.error })
    } finally {
        if (conn) {
            try { await conn.close() } catch (_) {}
        }
    }
}

