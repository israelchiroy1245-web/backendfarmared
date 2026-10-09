import { oracledb } from '../config/database.js'
import { setUsuario } from './sesion.js'
import { num, nbind } from '../utils/oracle.js'

import { ejecutarPagina, terminoLike } from '../utils/paginacion.js'

const CATEGORIAS_VALIDAS = ['MOBILIARIO', 'EQUIPO', 'VEHICULO', 'INMUEBLE', 'TECNOLOGIA']
const ESTADOS_VALIDOS = ['EN_USO', 'BAJA', 'MANTENIMIENTO']

/**
 * Listado de activos fijos con filtros por sucursal, categoría, estado y término de búsqueda
 */
export async function consultarActivos({
    sucursalId,
    categoria,
    estado,
    q,
    limit,
    offset
}) {
    let conn
    try {
        conn = await oracledb.getConnection()

        let sql = `
            SELECT 
                a.ID AS "ID",
                a.Codigo AS "CODIGO",
                a.Nombre AS "NOMBRE",
                a.Categoria AS "CATEGORIA",
                a.Valor_adquisicion AS "VALOR_ADQUISICION",
                TO_CHAR(a.Fecha_adquisicion, 'YYYY-MM-DD') AS "FECHA_ADQUISICION",
                a.Vida_util_meses AS "VIDA_UTIL_MESES",
                a.Valor_residual AS "VALOR_RESIDUAL",
                a.Depreciacion_acumulada AS "DEPRECIACION_ACUMULADA",
                (a.Valor_adquisicion - a.Depreciacion_acumulada) AS "VALOR_LIBROS",
                a.Estado AS "ESTADO",
                a.F_Sucursal_ID AS "SUCURSAL_ID",
                s.Nombre AS "SUCURSAL_NOMBRE",
                s.Tipo AS "SUCURSAL_TIPO"
            FROM F_Activo_fijo a
            JOIN F_Sucursal s ON s.ID = a.F_Sucursal_ID
            WHERE 1 = 1
        `

        const binds = {}

        if (sucursalId) {
            sql += ` AND a.F_Sucursal_ID = :sucursalId`
            binds.sucursalId = nbind(sucursalId)
        }

        if (categoria) {
            sql += ` AND a.Categoria = :categoria`
            binds.categoria = String(categoria).toUpperCase().trim()
        }

        if (estado) {
            sql += ` AND a.Estado = :estado`
            binds.estado = String(estado).toUpperCase().trim()
        }

        const busqueda = terminoLike(q)
        if (busqueda) {
            sql += ` AND (
                UPPER(a.Codigo) LIKE :q ESCAPE '\\' 
                OR UPPER(a.Nombre) LIKE :q ESCAPE '\\'
                OR UPPER(s.Nombre) LIKE :q ESCAPE '\\'
                OR UPPER(a.Categoria) LIKE :q ESCAPE '\\'
            )`
            binds.q = busqueda
        }

        return await ejecutarPagina(conn, {
            sql,
            binds,
            orderBy: 'ORDER BY a.F_Sucursal_ID ASC, a.Categoria ASC, a.ID ASC',
            limit,
            offset,
            resumenSelect: 'SUM("VALOR_ADQUISICION") AS TOTAL_ADQUISICION, SUM("DEPRECIACION_ACUMULADA") AS TOTAL_DEPRECIACION, SUM("VALOR_LIBROS") AS TOTAL_LIBROS',
        })
    } finally {
        if (conn) {
            try { await conn.close() } catch (_) {}
        }
    }
}

/**
 * Consulta de un activo fijo individual por ID
 */
export async function consultarActivoPorId(id) {
    let conn
    try {
        conn = await oracledb.getConnection()

        const sql = `
            SELECT 
                a.ID AS "ID",
                a.Codigo AS "CODIGO",
                a.Nombre AS "NOMBRE",
                a.Categoria AS "CATEGORIA",
                a.Valor_adquisicion AS "VALOR_ADQUISICION",
                TO_CHAR(a.Fecha_adquisicion, 'YYYY-MM-DD') AS "FECHA_ADQUISICION",
                a.Vida_util_meses AS "VIDA_UTIL_MESES",
                a.Valor_residual AS "VALOR_RESIDUAL",
                a.Depreciacion_acumulada AS "DEPRECIACION_ACUMULADA",
                (a.Valor_adquisicion - a.Depreciacion_acumulada) AS "VALOR_LIBROS",
                a.Estado AS "ESTADO",
                a.F_Sucursal_ID AS "SUCURSAL_ID",
                s.Nombre AS "SUCURSAL_NOMBRE",
                s.Tipo AS "SUCURSAL_TIPO",
                s.Direccion AS "SUCURSAL_DIRECCION"
            FROM F_Activo_fijo a
            JOIN F_Sucursal s ON s.ID = a.F_Sucursal_ID
            WHERE a.ID = :id
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
 * Crear un nuevo activo fijo
 */
export async function crearActivo({
    codigo,
    nombre,
    categoria,
    valorAdquisicion,
    fechaAdquisicion,
    vidaUtilMeses,
    valorResidual = 0,
    depreciacionAcumulada = 0,
    estado = 'EN_USO',
    sucursalId,
    usuarioId
}) {
    if (!codigo || !String(codigo).trim()) {
        const err = new Error('El código del activo es requerido')
        err.statusCode = 400
        throw err
    }
    if (!nombre || !String(nombre).trim()) {
        const err = new Error('El nombre del activo es requerido')
        err.statusCode = 400
        throw err
    }

    const catUpper = String(categoria || '').toUpperCase().trim()
    if (!CATEGORIAS_VALIDAS.includes(catUpper)) {
        const err = new Error(`Categoría inválida. Debe ser una de: ${CATEGORIAS_VALIDAS.join(', ')}`)
        err.statusCode = 400
        throw err
    }

    const estUpper = String(estado || 'EN_USO').toUpperCase().trim()
    if (!ESTADOS_VALIDOS.includes(estUpper)) {
        const err = new Error(`Estado inválido. Debe ser uno de: ${ESTADOS_VALIDOS.join(', ')}`)
        err.statusCode = 400
        throw err
    }

    const vAdq = num(valorAdquisicion)
    if (vAdq === null || vAdq <= 0) {
        const err = new Error('El valor de adquisición debe ser mayor a 0')
        err.statusCode = 400
        throw err
    }

    const vidaMeses = num(vidaUtilMeses)
    if (!vidaMeses || vidaMeses <= 0) {
        const err = new Error('La vida útil en meses debe ser mayor a 0')
        err.statusCode = 400
        throw err
    }

    const vRes = num(valorResidual) ?? 0
    if (vRes < 0) {
        const err = new Error('El valor residual debe ser >= 0')
        err.statusCode = 400
        throw err
    }

    const depAcum = num(depreciacionAcumulada) ?? 0
    if (depAcum < 0) {
        const err = new Error('La depreciación acumulada debe ser >= 0')
        err.statusCode = 400
        throw err
    }

    const sucId = num(sucursalId)
    if (!sucId) {
        const err = new Error('sucursalId es requerido')
        err.statusCode = 400
        throw err
    }

    const fAdq = fechaAdquisicion ? String(fechaAdquisicion).trim() : null
    if (!fAdq || !/^\d{4}-\d{2}-\d{2}$/.test(fAdq)) {
        const err = new Error('fechaAdquisicion es requerida con formato YYYY-MM-DD')
        err.statusCode = 400
        throw err
    }

    let conn
    try {
        conn = await oracledb.getConnection()
        await setUsuario(conn, usuarioId)

        // Validar unicidad del código
        const checkCod = await conn.execute(
            `SELECT ID FROM F_Activo_fijo WHERE Codigo = :codigo`,
            { codigo: String(codigo).trim().toUpperCase() }
        )
        if (checkCod.rows && checkCod.rows.length > 0) {
            const err = new Error(`Ya existe un activo con el código ${codigo}`)
            err.statusCode = 409
            throw err
        }

        // Insertar en F_Activo_fijo
        const sqlInsert = `
            INSERT INTO F_Activo_fijo (
                Codigo,
                Nombre,
                Categoria,
                Valor_adquisicion,
                Fecha_adquisicion,
                Vida_util_meses,
                Valor_residual,
                Depreciacion_acumulada,
                Estado,
                F_Sucursal_ID
            ) VALUES (
                :codigo,
                :nombre,
                :categoria,
                :vAdq,
                TO_DATE(:fAdq, 'YYYY-MM-DD'),
                :vidaMeses,
                :vRes,
                :depAcum,
                :estado,
                :sucursalId
            ) RETURNING ID INTO :id
        `

        const resIns = await conn.execute(sqlInsert, {
            codigo: String(codigo).trim().toUpperCase(),
            nombre: String(nombre).trim(),
            categoria: catUpper,
            vAdq: nbind(vAdq),
            fAdq,
            vidaMeses: nbind(vidaMeses),
            vRes: nbind(vRes),
            depAcum: nbind(depAcum),
            estado: estUpper,
            sucursalId: nbind(sucId),
            id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER }
        })

        const nuevoId = Array.isArray(resIns.outBinds.id) ? resIns.outBinds.id[0] : resIns.outBinds.id
        await conn.commit()

        return {
            id: nuevoId,
            codigo: String(codigo).trim().toUpperCase(),
            nombre: String(nombre).trim(),
            categoria: catUpper,
            valorAdquisicion: vAdq,
            valorLibros: Math.round((vAdq - depAcum) * 100) / 100,
            estado: estUpper,
            sucursalId: sucId,
            mensaje: 'Activo fijo registrado exitosamente'
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
 * Actualizar activo fijo completo (PUT / PATCH)
 */
export async function actualizarActivo(id, {
    nombre,
    categoria,
    valorAdquisicion,
    fechaAdquisicion,
    vidaUtilMeses,
    valorResidual,
    depreciacionAcumulada,
    estado,
    sucursalId,
    usuarioId
}) {
    let conn
    try {
        conn = await oracledb.getConnection()
        await setUsuario(conn, usuarioId)

        const cur = await conn.execute(
            `SELECT * FROM F_Activo_fijo WHERE ID = :id FOR UPDATE`,
            { id: nbind(id) }
        )
        const act = cur.rows?.[0]
        if (!act) {
            const err = new Error('No se encontró el activo fijo especificado')
            err.statusCode = 404
            throw err
        }

        const nuevoNombre = nombre !== undefined ? String(nombre).trim() : act.NOMBRE
        const nuevaCat = categoria !== undefined ? String(categoria).toUpperCase().trim() : act.CATEGORIA
        if (!CATEGORIAS_VALIDAS.includes(nuevaCat)) {
            const err = new Error(`Categoría inválida. Debe ser una de: ${CATEGORIAS_VALIDAS.join(', ')}`)
            err.statusCode = 400
            throw err
        }

        const nuevoEstado = estado !== undefined ? String(estado).toUpperCase().trim() : act.ESTADO
        if (!ESTADOS_VALIDOS.includes(nuevoEstado)) {
            const err = new Error(`Estado inválido. Debe ser uno de: ${ESTADOS_VALIDOS.join(', ')}`)
            err.statusCode = 400
            throw err
        }

        const vAdq = num(valorAdquisicion) !== null ? num(valorAdquisicion) : Number(act.VALOR_ADQUISICION)
        const vidaMeses = num(vidaUtilMeses) !== null ? num(vidaUtilMeses) : Number(act.VIDA_UTIL_MESES)
        const vRes = num(valorResidual) !== null ? num(valorResidual) : Number(act.VALOR_RESIDUAL)
        const depAcum = num(depreciacionAcumulada) !== null ? num(depreciacionAcumulada) : Number(act.DEPRECIACION_ACUMULADA)
        const sucId = num(sucursalId) !== null ? num(sucursalId) : Number(act.F_SUCURSAL_ID)

        let sqlDate = `a.Fecha_adquisicion`
        const binds = {
            nombre: nuevoNombre,
            categoria: nuevaCat,
            vAdq: nbind(vAdq),
            vidaMeses: nbind(vidaMeses),
            vRes: nbind(vRes),
            depAcum: nbind(depAcum),
            estado: nuevoEstado,
            sucursalId: nbind(sucId),
            id: nbind(id)
        }

        if (fechaAdquisicion && /^\d{4}-\d{2}-\d{2}$/.test(String(fechaAdquisicion).trim())) {
            sqlDate = `TO_DATE(:fAdq, 'YYYY-MM-DD')`
            binds.fAdq = String(fechaAdquisicion).trim()
        }

        const sqlUpdate = `
            UPDATE F_Activo_fijo a
            SET a.Nombre = :nombre,
                a.Categoria = :categoria,
                a.Valor_adquisicion = :vAdq,
                a.Fecha_adquisicion = ${sqlDate},
                a.Vida_util_meses = :vidaMeses,
                a.Valor_residual = :vRes,
                a.Depreciacion_acumulada = :depAcum,
                a.Estado = :estado,
                a.F_Sucursal_ID = :sucursalId
            WHERE a.ID = :id
        `

        await conn.execute(sqlUpdate, binds)
        await conn.commit()

        return {
            id,
            nombre: nuevoNombre,
            categoria: nuevaCat,
            valorAdquisicion: vAdq,
            depreciacionAcumulada: depAcum,
            valorLibros: Math.round((vAdq - depAcum) * 100) / 100,
            estado: nuevoEstado,
            sucursalId: sucId,
            mensaje: 'Activo fijo actualizado exitosamente'
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
 * Eliminar activo fijo o dar de baja
 */
export async function eliminarActivo(id, usuarioId) {
    let conn
    try {
        conn = await oracledb.getConnection()
        await setUsuario(conn, usuarioId)

        const cur = await conn.execute(
            `SELECT ID, Codigo, Nombre, Estado FROM F_Activo_fijo WHERE ID = :id`,
            { id: nbind(id) }
        )
        const act = cur.rows?.[0]
        if (!act) {
            const err = new Error('No se encontró el activo fijo')
            err.statusCode = 404
            throw err
        }

        // Si ya está en BAJA o se solicita eliminación directa
        await conn.execute(
            `DELETE FROM F_Activo_fijo WHERE ID = :id`,
            { id: nbind(id) }
        )
        await conn.commit()

        return {
            id,
            codigo: act.CODIGO,
            mensaje: `Activo fijo ${act.CODIGO} eliminado permanentemente`
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
 * Depreciación lineal mensual acumulada automática
 * Calcula y actualiza la depreciación según los meses transcurridos
 */
export async function depreciarActivosLineal({ sucursalId, usuarioId }) {
    let conn
    try {
        conn = await oracledb.getConnection()
        await setUsuario(conn, usuarioId)

        let sql = `
            SELECT 
                ID,
                Valor_adquisicion,
                Valor_residual,
                Vida_util_meses,
                MONTHS_BETWEEN(TRUNC(SYSDATE), TRUNC(Fecha_adquisicion)) AS MESES_TRANSCURRIDOS
            FROM F_Activo_fijo
            WHERE Estado = 'EN_USO'
        `
        const binds = {}
        if (sucursalId) {
            sql += ` AND F_Sucursal_ID = :sucId`
            binds.sucId = nbind(sucursalId)
        }

        const res = await conn.execute(sql, binds)
        const activos = res.rows || []
        let actualizados = 0

        for (const a of activos) {
            const vAdq = Number(a.VALOR_ADQUISICION) || 0
            const vRes = Number(a.VALOR_RESIDUAL) || 0
            const vida = Number(a.VIDA_UTIL_MESES) || 1
            const meses = Math.max(0, Math.floor(Number(a.MESES_TRANSCURRIDOS) || 0))

            // Cuota mensual = (Adquisición - Residual) / Vida Útil Meses
            const deprMensual = (vAdq - vRes) / vida
            const deprTotal = Math.min(vAdq - vRes, Math.round(deprMensual * meses * 100) / 100)

            await conn.execute(
                `UPDATE F_Activo_fijo SET Depreciacion_acumulada = :depr WHERE ID = :id`,
                { depr: nbind(deprTotal), id: nbind(a.ID) }
            )
            actualizados++
        }

        await conn.commit()

        return {
            sucursalId: sucursalId || null,
            activosActualizados: actualizados,
            mensaje: `Depreciación lineal actualizada para ${actualizados} activos en uso`
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
