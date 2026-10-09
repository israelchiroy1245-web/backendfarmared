import { oracledb } from '../config/database.js'
import { setUsuario } from './sesion.js'
import { num, nbind } from '../utils/oracle.js'
import { ejecutarPagina, terminoLike } from '../utils/paginacion.js'

const SELECT_MED = `
    m.ID AS "ID",
    m.Nombre_medic AS "NOMBRE",
    m.Codigo_barra AS "CODIGO_BARRA",
    m.Principio_activo AS "PRINCIPIO_ACTIVO",
    m.Presentacion AS "PRESENTACION",
    m.Laboratorio AS "LABORATORIO",
    m.Receta_requerida AS "RECETA_REQUERIDA",
    m.Precio_venta AS "PRECIO_VENTA",
    m.Costo AS "COSTO",
    m.Descripcion AS "DESCRIPCION",
    m.Estado AS "ESTADO"
`

function codigoOcupado(codigo) {
    const err = new Error(`El código de barras ${codigo} ya existe en el sistema`)
    err.statusCode = 409
    return err
}

export async function assertMedicamentoActivo(conn, medicamentoId) {
    const r = await conn.execute(
        `SELECT ID, Estado AS "ESTADO" FROM F_Medicamentos WHERE ID = :id`,
        { id: nbind(medicamentoId) },
    )
    const row = r.rows?.[0]
    if (!row) {
        const err = new Error(`El medicamento con ID ${medicamentoId} no existe`)
        err.statusCode = 404
        throw err
    }
    if (String(row.ESTADO || '').toUpperCase() !== 'ACTIVO') {
        const err = new Error('El medicamento está inactivo')
        err.statusCode = 409
        throw err
    }
}

export async function consultarMedicamentos({ q, estado, limit, offset }) {
    let conn
    try {
        conn = await oracledb.getConnection()
        let sql = `
            SELECT ${SELECT_MED}
            FROM F_Medicamentos m
            WHERE 1 = 1
        `
        const binds = {}
        const estadoFiltro = String(estado || '').trim().toUpperCase()
        if (estadoFiltro === 'ACTIVO' || estadoFiltro === 'INACTIVO') {
            sql += ` AND m.Estado = :estado`
            binds.estado = estadoFiltro
        }
        const busqueda = terminoLike(q)
        if (busqueda) {
            sql += ` AND (
                UPPER(m.Nombre_medic) LIKE :q OR UPPER(m.Codigo_barra) LIKE :q
                OR UPPER(m.Principio_activo) LIKE :q OR UPPER(m.Laboratorio) LIKE :q
            )`
            binds.q = busqueda
        }
        return await ejecutarPagina(conn, {
            sql,
            binds,
            orderBy: 'ORDER BY m.Nombre_medic ASC',
            limit,
            offset,
        })
    } finally {
        if (conn) {
            try { await conn.close() } catch (_) {}
        }
    }
}

export async function consultarMedicamentoPorId(id) {
    let conn
    try {
        conn = await oracledb.getConnection()
        const res = await conn.execute(
            `SELECT ${SELECT_MED} FROM F_Medicamentos m WHERE m.ID = :id`,
            { id: nbind(id) },
        )
        const med = res.rows?.[0]
        if (!med) return null

        const lotes = await conn.execute(
            `SELECT i.ID AS "ID",
                    i.Lote AS "LOTE",
                    i.Cantidad AS "CANTIDAD",
                    TO_CHAR(i.Fecha_vencimiento, 'YYYY-MM-DD') AS "FECHA_VENCIMIENTO",
                    s.Nombre AS "SUCURSAL_NOMBRE"
               FROM F_Inventario i
               JOIN F_Sucursal s ON s.ID = i.F_Sucursal_ID
              WHERE i.F_Medicamentos_ID = :id
              ORDER BY i.ID DESC
              FETCH FIRST 5 ROWS ONLY`,
            { id: nbind(id) },
        )
        med.LOTES_RECIENTES = lotes.rows || []
        return med
    } finally {
        if (conn) {
            try { await conn.close() } catch (_) {}
        }
    }
}

export async function crearMedicamento({
    nombre,
    codigoBarra,
    principioActivo,
    presentacion,
    laboratorio,
    recetaRequerida,
    precioVenta,
    costo,
    descripcion,
    usuarioId,
}) {
    let conn
    try {
        conn = await oracledb.getConnection()
        await setUsuario(conn, usuarioId)

        const codigo = String(codigoBarra).trim()
        const nombreLimpio = String(nombre).trim()
        const ocupado = await conn.execute(
            `SELECT ID FROM F_Medicamentos WHERE UPPER(Codigo_barra) = UPPER(:codigo)`,
            { codigo },
        )
        if (ocupado.rows?.length) throw codigoOcupado(codigo)

        const alta = await conn.execute(
            `INSERT INTO F_Medicamentos (
                Nombre_medic, Codigo_barra, Principio_activo, Presentacion, Laboratorio,
                Receta_requerida, Precio_venta, Costo, Descripcion, Estado
            ) VALUES (
                :nombre, :codigo, :principio, :presentacion, :laboratorio,
                :receta, :precio, :costo, :descripcion, 'ACTIVO'
            ) RETURNING ID INTO :id`,
            {
                nombre: nombreLimpio,
                codigo,
                principio: principioActivo ? String(principioActivo).trim() : null,
                presentacion: presentacion ? String(presentacion).trim() : null,
                laboratorio: laboratorio ? String(laboratorio).trim() : null,
                receta: nbind(recetaRequerida),
                precio: nbind(precioVenta),
                costo: nbind(costo),
                descripcion: descripcion ? String(descripcion).trim() : null,
                id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
            },
        )
        const id = Array.isArray(alta.outBinds.id) ? alta.outBinds.id[0] : alta.outBinds.id
        await conn.commit()
        return {
            id,
            nombre: nombreLimpio,
            codigoBarra: codigo,
            principioActivo: principioActivo || null,
            presentacion: presentacion || null,
            laboratorio: laboratorio || null,
            recetaRequerida,
            precioVenta,
            costo,
            descripcion: descripcion || null,
            estado: 'ACTIVO',
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

export async function actualizarMedicamento(id, campos, usuarioId) {
    let conn
    try {
        conn = await oracledb.getConnection()
        await setUsuario(conn, usuarioId)

        const cur = await conn.execute(
            `SELECT ${SELECT_MED} FROM F_Medicamentos m WHERE m.ID = :id FOR UPDATE`,
            { id: nbind(id) },
        )
        const actual = cur.rows?.[0]
        if (!actual) {
            const err = new Error('No se encontró el medicamento')
            err.statusCode = 404
            throw err
        }

        const {
            nombre,
            codigoBarra,
            principioActivo,
            presentacion,
            laboratorio,
            recetaRequerida,
            precioVenta,
            costo,
            descripcion,
            estado,
        } = campos

        if (codigoBarra !== undefined) {
            const codigo = String(codigoBarra).trim()
            if (codigo.toUpperCase() !== String(actual.CODIGO_BARRA || '').toUpperCase()) {
                const ocupado = await conn.execute(
                    `SELECT ID FROM F_Medicamentos WHERE UPPER(Codigo_barra) = UPPER(:codigo) AND ID <> :id`,
                    { codigo, id: nbind(id) },
                )
                if (ocupado.rows?.length) throw codigoOcupado(codigo)
            }
        }

        const updates = []
        const binds = { id: nbind(id) }
        if (nombre !== undefined) {
            updates.push('Nombre_medic = :nombre')
            binds.nombre = String(nombre).trim()
        }
        if (codigoBarra !== undefined) {
            updates.push('Codigo_barra = :codigo')
            binds.codigo = String(codigoBarra).trim()
        }
        if (principioActivo !== undefined) {
            updates.push('Principio_activo = :principio')
            binds.principio = principioActivo ? String(principioActivo).trim() : null
        }
        if (presentacion !== undefined) {
            updates.push('Presentacion = :presentacion')
            binds.presentacion = presentacion ? String(presentacion).trim() : null
        }
        if (laboratorio !== undefined) {
            updates.push('Laboratorio = :laboratorio')
            binds.laboratorio = laboratorio ? String(laboratorio).trim() : null
        }
        if (recetaRequerida !== undefined) {
            updates.push('Receta_requerida = :receta')
            binds.receta = nbind(recetaRequerida)
        }
        if (precioVenta !== undefined) {
            updates.push('Precio_venta = :precio')
            binds.precio = nbind(precioVenta)
        }
        if (costo !== undefined) {
            updates.push('Costo = :costo')
            binds.costo = nbind(costo)
        }
        if (descripcion !== undefined) {
            updates.push('Descripcion = :descripcion')
            binds.descripcion = descripcion ? String(descripcion).trim() : null
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
                        ? 'El medicamento ya está activo'
                        : 'El medicamento ya está inactivo',
                )
                err.statusCode = 409
                throw err
            }
            updates.push('Estado = :estado')
            binds.estado = nuevoEstado
        }

        if (updates.length > 0) {
            await conn.execute(
                `UPDATE F_Medicamentos SET ${updates.join(', ')} WHERE ID = :id`,
                binds,
            )
        }
        await conn.commit()
        return {
            id,
            estado: estado !== undefined ? String(estado).trim().toUpperCase() : actual.ESTADO,
            mensaje: 'Medicamento actualizado correctamente',
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

export async function eliminarMedicamento(id, usuarioId) {
    let conn
    try {
        conn = await oracledb.getConnection()
        await setUsuario(conn, usuarioId)
        const cur = await conn.execute(
            `SELECT ID, Estado AS "ESTADO"
               FROM F_Medicamentos
              WHERE ID = :id
              FOR UPDATE`,
            { id: nbind(id) },
        )
        const med = cur.rows?.[0]
        if (!med) {
            const err = new Error('No se encontró el medicamento')
            err.statusCode = 404
            throw err
        }
        if (med.ESTADO === 'INACTIVO') {
            const err = new Error('El medicamento ya está inactivo')
            err.statusCode = 409
            throw err
        }
        await conn.execute(
            `UPDATE F_Medicamentos SET Estado = 'INACTIVO' WHERE ID = :id`,
            { id: nbind(id) },
        )
        await conn.commit()
        return { id, estado: 'INACTIVO', eliminado: false }
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
