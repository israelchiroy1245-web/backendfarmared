import { oracledb } from '../config/database.js'
import { setUsuario } from './sesion.js'
import { num, nbind } from '../utils/oracle.js'
import { ejecutarPagina, terminoLike } from '../utils/paginacion.js'

/**
 * Consulta de proveedores con paginación y búsqueda
 */
export async function consultarProveedores({ q, estado, limit, offset }) {
    let conn
    try {
        conn = await oracledb.getConnection()

        let sql = `
            SELECT 
                p.ID AS "ID",
                p.Nombre AS "NOMBRE",
                p.NIT AS "NIT",
                p.Telefono AS "TELEFONO",
                p.Direccion AS "DIRECCION",
                p.Email AS "EMAIL",
                p.Estado AS "ESTADO",
                (SELECT COUNT(*) FROM F_Compras c WHERE c.F_Proveedores_Id = p.ID) AS "TOTAL_COMPRAS"
            FROM F_Proveedores p
            WHERE 1 = 1
        `

        const binds = {}
        const estadoFiltro = String(estado || '').trim().toUpperCase()
        if (estadoFiltro === 'ACTIVO' || estadoFiltro === 'INACTIVO') {
            sql += ` AND p.Estado = :estado`
            binds.estado = estadoFiltro
        }
        const busqueda = terminoLike(q)
        if (busqueda) {
            sql += ` AND (
                UPPER(p.Nombre) LIKE :q OR UPPER(p.NIT) LIKE :q OR UPPER(p.Email) LIKE :q
            )`
            binds.q = busqueda
        }

        return await ejecutarPagina(conn, {
            sql,
            binds,
            orderBy: 'ORDER BY p.Nombre ASC',
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
 * Consulta de un proveedor por ID con sus compras recientes
 */
export async function consultarProveedorPorId(id) {
    let conn
    try {
        conn = await oracledb.getConnection()

        const sql = `
            SELECT 
                p.ID AS "ID",
                p.Nombre AS "NOMBRE",
                p.NIT AS "NIT",
                p.Telefono AS "TELEFONO",
                p.Direccion AS "DIRECCION",
                p.Email AS "EMAIL",
                p.Estado AS "ESTADO",
                (SELECT COUNT(*) FROM F_Compras c WHERE c.F_Proveedores_Id = p.ID) AS "TOTAL_COMPRAS"
            FROM F_Proveedores p
            WHERE p.ID = :id
        `
        const res = await conn.execute(sql, { id: nbind(id) })
        const prov = res.rows?.[0]
        if (!prov) return null

        // Compras recientes del proveedor
        const sqlCompras = `
            SELECT 
                c.ID AS "ID",
                c.Numero_Factura AS "NUMERO_FACTURA",
                TO_CHAR(c.Fecha_compra, 'YYYY-MM-DD') AS "FECHA_COMPRA",
                c.Total_compra AS "TOTAL_COMPRA",
                s.Nombre AS "SUCURSAL_NOMBRE"
            FROM F_Compras c
            JOIN F_Sucursal s ON s.ID = c.F_Sucursal_ID
            WHERE c.F_Proveedores_Id = :id
            ORDER BY c.Fecha_compra DESC, c.ID DESC
            FETCH FIRST 5 ROWS ONLY
        `
        const resCompras = await conn.execute(sqlCompras, { id: nbind(id) })
        prov.COMPRAS_RECIENTES = resCompras.rows || []

        return prov
    } finally {
        if (conn) {
            try { await conn.close() } catch (_) {}
        }
    }
}

/**
 * Crear un nuevo proveedor (Transaccional)
 */
export async function crearProveedor({
    nombre,
    nit,
    telefono,
    direccion,
    email,
    usuarioId
}) {
    let conn
    try {
        conn = await oracledb.getConnection()
        await setUsuario(conn, usuarioId)

        const nitLimpio = String(nit).trim().toUpperCase()
        const nombreLimpio = String(nombre).trim()

        // Validar unicidad de NIT
        const check = await conn.execute(
            `SELECT ID FROM F_Proveedores WHERE UPPER(NIT) = :nit`,
            { nit: nitLimpio }
        )
        if (check.rows && check.rows.length > 0) {
            const err = new Error(`El proveedor con NIT ${nitLimpio} ya existe en el sistema`)
            err.statusCode = 409
            throw err
        }

        const sql = `
            INSERT INTO F_Proveedores (
                Nombre, NIT, Telefono, Direccion, Email, Estado
            ) VALUES (
                :nombre, :nit, :telefono, :direccion, :email, 'ACTIVO'
            ) RETURNING ID INTO :id
        `
        const res = await conn.execute(sql, {
            nombre: nombreLimpio,
            nit: nitLimpio,
            telefono: telefono ? String(telefono).trim() : null,
            direccion: direccion ? String(direccion).trim() : null,
            email: email ? String(email).trim().toLowerCase() : null,
            id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER }
        })

        const nuevoId = Array.isArray(res.outBinds.id) ? res.outBinds.id[0] : res.outBinds.id
        await conn.commit()

        return {
            id: nuevoId,
            nombre: nombreLimpio,
            nit: nitLimpio,
            telefono: telefono || null,
            direccion: direccion || null,
            email: email || null,
            estado: 'ACTIVO'
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
 * Actualizar proveedor (PUT completo o PATCH parcial)
 */
export async function actualizarProveedor(id, {
    nombre,
    nit,
    telefono,
    direccion,
    email,
    estado,
    usuarioId
}) {
    let conn
    try {
        conn = await oracledb.getConnection()
        await setUsuario(conn, usuarioId)

        // Consultar estado actual
        const cur = await conn.execute(
            `SELECT ID, Nombre, NIT, Telefono, Direccion, Email, Estado FROM F_Proveedores WHERE ID = :id FOR UPDATE`,
            { id: nbind(id) }
        )
        const actual = cur.rows?.[0]
        if (!actual) {
            const err = new Error('No se encontró el proveedor')
            err.statusCode = 404
            throw err
        }

        // Si se cambia el NIT, verificar que no esté duplicado
        if (nit !== undefined) {
            const nuevoNit = String(nit).trim().toUpperCase()
            if (nuevoNit !== actual.NIT) {
                const check = await conn.execute(
                    `SELECT ID FROM F_Proveedores WHERE UPPER(NIT) = :nit AND ID <> :id`,
                    { nit: nuevoNit, id: nbind(id) }
                )
                if (check.rows && check.rows.length > 0) {
                    const err = new Error(`El NIT ${nuevoNit} ya está registrado para otro proveedor`)
                    err.statusCode = 409
                    throw err
                }
            }
        }

        const updates = []
        const binds = { id: nbind(id) }

        if (nombre !== undefined) {
            updates.push('Nombre = :nombre')
            binds.nombre = String(nombre).trim()
        }
        if (nit !== undefined) {
            updates.push('NIT = :nit')
            binds.nit = String(nit).trim().toUpperCase()
        }
        if (telefono !== undefined) {
            updates.push('Telefono = :telefono')
            binds.telefono = telefono ? String(telefono).trim() : null
        }
        if (direccion !== undefined) {
            updates.push('Direccion = :direccion')
            binds.direccion = direccion ? String(direccion).trim() : null
        }
        if (email !== undefined) {
            updates.push('Email = :email')
            binds.email = email ? String(email).trim().toLowerCase() : null
        }
        if (estado !== undefined) {
            const nuevoEstado = String(estado).trim().toUpperCase()
            if (nuevoEstado !== 'ACTIVO' && nuevoEstado !== 'INACTIVO') {
                const err = new Error('El estado debe ser ACTIVO o INACTIVO')
                err.statusCode = 400
                throw err
            }
            if (nuevoEstado === String(actual.ESTADO || '').toUpperCase()) {
                const err = new Error(
                    nuevoEstado === 'ACTIVO'
                        ? 'El proveedor ya está activo'
                        : 'El proveedor ya está inactivo'
                )
                err.statusCode = 409
                throw err
            }
            updates.push('Estado = :estado')
            binds.estado = nuevoEstado
        }

        if (updates.length > 0) {
            await conn.execute(
                `UPDATE F_Proveedores SET ${updates.join(', ')} WHERE ID = :id`,
                binds
            )
        }

        await conn.commit()

        return {
            id,
            nombre: nombre !== undefined ? String(nombre).trim() : actual.NOMBRE,
            nit: nit !== undefined ? String(nit).trim().toUpperCase() : actual.NIT,
            telefono: telefono !== undefined ? telefono : actual.TELEFONO,
            direccion: direccion !== undefined ? direccion : actual.DIRECCION,
            email: email !== undefined ? email : actual.EMAIL,
            estado: estado !== undefined ? String(estado).trim().toUpperCase() : actual.ESTADO,
            mensaje: 'Proveedor actualizado correctamente'
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
 * Baja lógica: Estado = INACTIVO. La fila y las facturas se quedan.
 */
export async function eliminarProveedor(id, usuarioId) {
    let conn
    try {
        conn = await oracledb.getConnection()
        await setUsuario(conn, usuarioId)

        const cur = await conn.execute(
            `SELECT ID, Nombre AS "NOMBRE", Estado AS "ESTADO"
               FROM F_Proveedores
              WHERE ID = :id
              FOR UPDATE`,
            { id: nbind(id) }
        )
        const prov = cur.rows?.[0]
        if (!prov) {
            const err = new Error('No se encontró el proveedor')
            err.statusCode = 404
            throw err
        }

        if (prov.ESTADO === 'INACTIVO') {
            const err = new Error('El proveedor ya está inactivo')
            err.statusCode = 409
            throw err
        }

        await conn.execute(
            `UPDATE F_Proveedores SET Estado = 'INACTIVO' WHERE ID = :id`,
            { id: nbind(id) }
        )
        await conn.commit()

        return { id, nombre: prov.NOMBRE, estado: 'INACTIVO', eliminado: false }
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
