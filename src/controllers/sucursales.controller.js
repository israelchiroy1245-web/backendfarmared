import { oracledb } from '../config/database.js'
import { num, errorOracle } from '../utils/oracle.js'
import { ejecutarPagina, leerPaginacion, respuestaPaginada, terminoLike } from '../utils/paginacion.js'
import { setUsuario } from '../services/sesion.js'

const TIPOS_VALIDOS = ['MALL', 'GASOLINERA', 'TRADICIONAL']
const ESTADOS_VALIDOS = ['ACTIVA', 'INACTIVA']

/**
 * GET /api/sucursales
 * Lista todas las sucursales con filtros opcionales (?estado, ?tipo, ?departamento).
 * Accesible para cualquier usuario autenticado.
 */
export const listarSucursales = async (req, res) => {
    const { limit, offset } = leerPaginacion(req.query)
    const estado = req.query.estado ? String(req.query.estado).trim().toUpperCase() : null
    const tipo = req.query.tipo ? String(req.query.tipo).trim().toUpperCase() : null
    const departamento = req.query.departamento ? String(req.query.departamento).trim().toUpperCase() : null
    const q = terminoLike(req.query.q)

    let sql = `
        SELECT s.ID, s.Codigo, s.Nombre, s.Tipo, s.Departamento, s.Municipio,
               s.Direccion, s.Latitud, s.Longitud, s.Telefono, s.Horario,
               s.Estado, TO_CHAR(s.Fecha_apertura, 'YYYY-MM-DD') AS Fecha_Apertura,
               COUNT(e.ID) AS Total_Empleados
        FROM F_Sucursal s
        LEFT JOIN F_Empleados e ON e.Sucursal_ID = s.ID AND e.Estado = 'ACTIVO'
        WHERE 1 = 1
    `
    const binds = {}

    if (estado) {
        sql += ` AND s.Estado = :estado`
        binds.estado = estado
    }
    if (tipo) {
        sql += ` AND s.Tipo = :tipo`
        binds.tipo = tipo
    }
    if (departamento) {
        sql += ` AND UPPER(s.Departamento) LIKE '%' || :departamento || '%'`
        binds.departamento = departamento
    }
    if (q) {
        sql += ` AND (
            UPPER(s.Nombre) LIKE :q ESCAPE '\\' OR UPPER(s.Codigo) LIKE :q ESCAPE '\\' OR UPPER(s.Departamento) LIKE :q ESCAPE '\\'
            OR UPPER(s.Municipio) LIKE :q ESCAPE '\\' OR UPPER(NVL(s.Direccion, '')) LIKE :q ESCAPE '\\'
            OR UPPER(s.Tipo) LIKE :q ESCAPE '\\' OR UPPER(NVL(s.Telefono, '')) LIKE :q ESCAPE '\\'
        )`
        binds.q = q
    }

    sql += ` GROUP BY s.ID, s.Codigo, s.Nombre, s.Tipo, s.Departamento, s.Municipio,
                     s.Direccion, s.Latitud, s.Longitud, s.Telefono, s.Horario,
                     s.Estado, s.Fecha_apertura`

    let conn
    try {
        conn = await oracledb.getConnection()
        const pagina = await ejecutarPagina(conn, {
            sql,
            binds,
            orderBy: 'ORDER BY ID ASC',
            limit,
            offset,
            resumenSelect: `SUM(CASE WHEN TIPO = 'MALL' THEN 1 ELSE 0 END) AS MALL,
                SUM(CASE WHEN TIPO = 'TRADICIONAL' THEN 1 ELSE 0 END) AS TRADICIONAL,
                SUM(CASE WHEN TIPO = 'GASOLINERA' THEN 1 ELSE 0 END) AS GASOLINERA`,
        })
        return res.status(200).json({
            ok: true,
            sucursales: pagina.rows,
            total: pagina.total,
            conteos: {
                MALL: Number(pagina.metrics?.MALL ?? 0),
                TRADICIONAL: Number(pagina.metrics?.TRADICIONAL ?? 0),
                GASOLINERA: Number(pagina.metrics?.GASOLINERA ?? 0),
            },
            paginacion: respuestaPaginada({ total: pagina.total, limit, offset }),
        })
    } catch (error) {
        console.error('Error al listar sucursales:', error.message)
        const mapped = errorOracle(error)
        return res.status(mapped.status).json({ ok: false, error: mapped.error })
    } finally {
        if (conn) try { await conn.close() } catch { /* ignore */ }
    }
}

/**
 * GET /api/sucursales/:id
 * Detalle de una sucursal específica con su conteo de empleados activos.
 */
export const obtenerSucursal = async (req, res) => {
    const id = num(req.params.id)
    if (!id) {
        return res.status(400).json({ ok: false, error: 'ID de sucursal inválido' })
    }

    let conn
    try {
        conn = await oracledb.getConnection()
        const result = await conn.execute(
            `SELECT s.ID, s.Codigo, s.Nombre, s.Tipo, s.Departamento, s.Municipio,
                    s.Direccion, s.Latitud, s.Longitud, s.Telefono, s.Horario,
                    s.Estado, TO_CHAR(s.Fecha_apertura, 'YYYY-MM-DD') AS Fecha_Apertura,
                    COUNT(e.ID) AS Total_Empleados
             FROM F_Sucursal s
             LEFT JOIN F_Empleados e ON e.Sucursal_ID = s.ID AND e.Estado = 'ACTIVO'
             WHERE s.ID = :id
             GROUP BY s.ID, s.Codigo, s.Nombre, s.Tipo, s.Departamento, s.Municipio,
                      s.Direccion, s.Latitud, s.Longitud, s.Telefono, s.Horario,
                      s.Estado, s.Fecha_apertura`,
            { id: { val: id, type: oracledb.NUMBER } }
        )

        if (!result.rows || result.rows.length === 0) {
            return res.status(404).json({ ok: false, error: 'Sucursal no encontrada' })
        }

        return res.status(200).json({ ok: true, sucursal: result.rows[0] })
    } catch (error) {
        console.error('Error al obtener sucursal:', error.message)
        const mapped = errorOracle(error)
        return res.status(mapped.status).json({ ok: false, error: mapped.error })
    } finally {
        if (conn) try { await conn.close() } catch { /* ignore */ }
    }
}

/**
 * POST /api/sucursales
 * Crea una nueva sucursal (Solo ADMIN).
 */
export const crearSucursal = async (req, res) => {
    const codigo = String(req.body.codigo || '').trim().toUpperCase()
    const nombre = String(req.body.nombre || '').trim()
    const tipo = String(req.body.tipo || '').trim().toUpperCase()
    const departamento = String(req.body.departamento || '').trim()
    const municipio = String(req.body.municipio || '').trim()
    const direccion = req.body.direccion ? String(req.body.direccion).trim() : null
    const latitud = req.body.latitud !== undefined && req.body.latitud !== null ? num(req.body.latitud) : null
    const longitud = req.body.longitud !== undefined && req.body.longitud !== null ? num(req.body.longitud) : null
    const telefono = req.body.telefono ? String(req.body.telefono).trim() : null
    const horario = req.body.horario ? String(req.body.horario).trim() : null
    const fechaApertura = req.body.fechaApertura ? String(req.body.fechaApertura).trim() : null

    // Validaciones obligatorias
    if (!codigo || !nombre || !tipo || !departamento || !municipio) {
        return res.status(400).json({
            ok: false,
            error: 'codigo, nombre, tipo, departamento y municipio son obligatorios'
        })
    }

    if (!TIPOS_VALIDOS.includes(tipo)) {
        return res.status(400).json({
            ok: false,
            error: `El tipo de sucursal debe ser uno de: ${TIPOS_VALIDOS.join(', ')}`
        })
    }

    let conn
    try {
        conn = await oracledb.getConnection()

        // Auditoría obligatoria
        if (req.usuario?.id) {
            await setUsuario(conn, req.usuario.id)
        }

        const sql = `
            INSERT INTO F_Sucursal (
                Codigo, Nombre, Tipo, Departamento, Municipio,
                Direccion, Latitud, Longitud, Telefono, Horario,
                Estado, Fecha_apertura
            ) VALUES (
                :codigo, :nombre, :tipo, :departamento, :municipio,
                :direccion, :latitud, :longitud, :telefono, :horario,
                'ACTIVA',
                ${fechaApertura ? "TO_DATE(:fechaApertura, 'YYYY-MM-DD')" : "TRUNC(SYSDATE)"}
            )
            RETURNING ID INTO :id
        `

        const binds = {
            codigo,
            nombre,
            tipo,
            departamento,
            municipio,
            direccion,
            latitud: latitud !== null ? { val: latitud, type: oracledb.NUMBER } : null,
            longitud: longitud !== null ? { val: longitud, type: oracledb.NUMBER } : null,
            telefono,
            horario,
            id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER }
        }

        if (fechaApertura) {
            binds.fechaApertura = fechaApertura
        }

        const result = await conn.execute(sql, binds)
        await conn.commit()

        const idSucursal = Array.isArray(result.outBinds.id)
            ? result.outBinds.id[0]
            : result.outBinds.id

        return res.status(201).json({
            ok: true,
            mensaje: 'Sucursal creada exitosamente',
            id: idSucursal
        })
    } catch (error) {
        if (conn) try { await conn.rollback() } catch { /* ignore */ }
        console.error('Error al crear sucursal:', error.message)

        const msg = error.message || ''
        if (msg.includes('ORA-00001')) {
            return res.status(409).json({
                ok: false,
                error: `El código de sucursal '${codigo}' ya existe en el sistema`
            })
        }

        const mapped = errorOracle(error)
        return res.status(mapped.status).json({ ok: false, error: mapped.error })
    } finally {
        if (conn) try { await conn.close() } catch { /* ignore */ }
    }
}

/**
 * PUT /api/sucursales/:id
 * Actualiza los datos de una sucursal existente (Solo ADMIN).
 */
export const actualizarSucursal = async (req, res) => {
    const id = num(req.params.id)
    if (!id) {
        return res.status(400).json({ ok: false, error: 'ID de sucursal inválido' })
    }

    const codigo = req.body.codigo ? String(req.body.codigo).trim().toUpperCase() : null
    const nombre = req.body.nombre ? String(req.body.nombre).trim() : null
    const tipo = req.body.tipo ? String(req.body.tipo).trim().toUpperCase() : null
    const departamento = req.body.departamento ? String(req.body.departamento).trim() : null
    const municipio = req.body.municipio ? String(req.body.municipio).trim() : null
    const direccion = req.body.direccion !== undefined ? (req.body.direccion ? String(req.body.direccion).trim() : null) : undefined
    const latitud = req.body.latitud !== undefined ? (req.body.latitud !== null ? num(req.body.latitud) : null) : undefined
    const longitud = req.body.longitud !== undefined ? (req.body.longitud !== null ? num(req.body.longitud) : null) : undefined
    const telefono = req.body.telefono !== undefined ? (req.body.telefono ? String(req.body.telefono).trim() : null) : undefined
    const horario = req.body.horario !== undefined ? (req.body.horario ? String(req.body.horario).trim() : null) : undefined
    const estado = req.body.estado ? String(req.body.estado).trim().toUpperCase() : null

    if (tipo && !TIPOS_VALIDOS.includes(tipo)) {
        return res.status(400).json({
            ok: false,
            error: `El tipo de sucursal debe ser uno de: ${TIPOS_VALIDOS.join(', ')}`
        })
    }

    if (estado && !ESTADOS_VALIDOS.includes(estado)) {
        return res.status(400).json({
            ok: false,
            error: `El estado debe ser 'ACTIVA' o 'INACTIVA'`
        })
    }

    let conn
    try {
        conn = await oracledb.getConnection()

        if (req.usuario?.id) {
            await setUsuario(conn, req.usuario.id)
        }

        // 1. Verificar existencia
        const check = await conn.execute(
            `SELECT ID, Codigo, Nombre, Tipo, Departamento, Municipio,
                    Direccion, Latitud, Longitud, Telefono, Horario, Estado
             FROM F_Sucursal WHERE ID = :id`,
            { id: { val: id, type: oracledb.NUMBER } }
        )

        if (!check.rows || check.rows.length === 0) {
            return res.status(404).json({ ok: false, error: 'Sucursal no encontrada' })
        }

        const actual = check.rows[0]

        // 2. Actualizar campos
        await conn.execute(
            `UPDATE F_Sucursal
             SET Codigo = :codigo,
                 Nombre = :nombre,
                 Tipo = :tipo,
                 Departamento = :departamento,
                 Municipio = :municipio,
                 Direccion = :direccion,
                 Latitud = :latitud,
                 Longitud = :longitud,
                 Telefono = :telefono,
                 Horario = :horario,
                 Estado = :estado
             WHERE ID = :id`,
            {
                codigo: codigo ?? actual.CODIGO,
                nombre: nombre ?? actual.NOMBRE,
                tipo: tipo ?? actual.TIPO,
                departamento: departamento ?? actual.DEPARTAMENTO,
                municipio: municipio ?? actual.MUNICIPIO,
                direccion: direccion !== undefined ? direccion : actual.DIRECCION,
                latitud: latitud !== undefined
                    ? (latitud !== null ? { val: latitud, type: oracledb.NUMBER } : null)
                    : (actual.LATITUD !== null ? { val: actual.LATITUD, type: oracledb.NUMBER } : null),
                longitud: longitud !== undefined
                    ? (longitud !== null ? { val: longitud, type: oracledb.NUMBER } : null)
                    : (actual.LONGITUD !== null ? { val: actual.LONGITUD, type: oracledb.NUMBER } : null),
                telefono: telefono !== undefined ? telefono : actual.TELEFONO,
                horario: horario !== undefined ? horario : actual.HORARIO,
                estado: estado ?? actual.ESTADO,
                id: { val: id, type: oracledb.NUMBER }
            }
        )

        await conn.commit()

        return res.status(200).json({
            ok: true,
            mensaje: 'Sucursal actualizada exitosamente'
        })
    } catch (error) {
        if (conn) try { await conn.rollback() } catch { /* ignore */ }
        console.error('Error al actualizar sucursal:', error.message)

        const msg = error.message || ''
        if (msg.includes('ORA-00001')) {
            return res.status(409).json({
                ok: false,
                error: 'El código de sucursal ya pertenece a otra sucursal'
            })
        }

        const mapped = errorOracle(error)
        return res.status(mapped.status).json({ ok: false, error: mapped.error })
    } finally {
        if (conn) try { await conn.close() } catch { /* ignore */ }
    }
}

/**
 * DELETE /api/sucursales/:id
 * Baja lógica: Desactiva la sucursal (Estado = 'INACTIVA').
 * Nunca hace DELETE físico para preservar el historial de ventas, inventario y empleados.
 */
export const desactivarSucursal = async (req, res) => {
    const id = num(req.params.id)
    if (!id) {
        return res.status(400).json({ ok: false, error: 'ID de sucursal inválido' })
    }

    let conn
    try {
        conn = await oracledb.getConnection()

        if (req.usuario?.id) {
            await setUsuario(conn, req.usuario.id)
        }

        const result = await conn.execute(
            `UPDATE F_Sucursal SET Estado = 'INACTIVA' WHERE ID = :id`,
            { id: { val: id, type: oracledb.NUMBER } }
        )

        if (result.rowsAffected === 0) {
            return res.status(404).json({ ok: false, error: 'Sucursal no encontrada' })
        }

        await conn.commit()

        return res.status(200).json({
            ok: true,
            mensaje: 'Sucursal desactivada exitosamente'
        })
    } catch (error) {
        if (conn) try { await conn.rollback() } catch { /* ignore */ }
        console.error('Error al desactivar sucursal:', error.message)
        const mapped = errorOracle(error)
        return res.status(mapped.status).json({ ok: false, error: mapped.error })
    } finally {
        if (conn) try { await conn.close() } catch { /* ignore */ }
    }
}

/**
 * PATCH /api/sucursales/:id/reactivar
 * Reactiva una sucursal inactiva (Estado = 'ACTIVA').
 */
export const reactivarSucursal = async (req, res) => {
    const id = num(req.params.id)
    if (!id) {
        return res.status(400).json({ ok: false, error: 'ID de sucursal inválido' })
    }

    let conn
    try {
        conn = await oracledb.getConnection()

        if (req.usuario?.id) {
            await setUsuario(conn, req.usuario.id)
        }

        const result = await conn.execute(
            `UPDATE F_Sucursal SET Estado = 'ACTIVA' WHERE ID = :id`,
            { id: { val: id, type: oracledb.NUMBER } }
        )

        if (result.rowsAffected === 0) {
            return res.status(404).json({ ok: false, error: 'Sucursal no encontrada' })
        }

        await conn.commit()

        return res.status(200).json({
            ok: true,
            mensaje: 'Sucursal reactivada exitosamente'
        })
    } catch (error) {
        if (conn) try { await conn.rollback() } catch { /* ignore */ }
        console.error('Error al reactivar sucursal:', error.message)
        const mapped = errorOracle(error)
        return res.status(mapped.status).json({ ok: false, error: mapped.error })
    } finally {
        if (conn) try { await conn.close() } catch { /* ignore */ }
    }
}
