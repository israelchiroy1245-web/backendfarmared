import { nbind } from './oracle.js'

/** Solo 50 o 100 filas. Cualquier otro valor vuelve a 50. */
export function leerPaginacion(query = {}) {
    const limit = Number(query.limit) === 100 ? 100 : 50
    const offsetRaw = Number(query.offset)
    const offset = Number.isFinite(offsetRaw) && offsetRaw > 0 ? Math.floor(offsetRaw) : 0
    return { limit, offset }
}

export function respuestaPaginada({ total, limit, offset }) {
    const safeTotal = Number(total) || 0
    const pages = Math.max(1, Math.ceil(safeTotal / limit))
    return {
        total: safeTotal,
        limit,
        offset,
        page: Math.floor(offset / limit) + 1,
        pages,
    }
}

/** Texto de búsqueda para LIKE. Vacío si no hay término. */
export function terminoLike(q) {
    const clean = String(q || '').trim().toUpperCase()
        .replace(/\\/g, '\\\\')
        .replace(/%/g, '\\%')
        .replace(/_/g, '\\_')
    if (!clean) return null
    return `%${clean}%`
}

/**
 * Ejecuta el conteo del SQL (sin ORDER BY) y la página con OFFSET/FETCH.
 * `resumenSelect` suma columnas del subquery, por ejemplo `SUM("STOCK_BAJO") AS BAJOS`.
 */
export async function ejecutarPagina(conn, { sql, binds = {}, orderBy, limit, offset, resumenSelect = '', fetchInfo } = {}) {
    const extra = resumenSelect ? `, ${resumenSelect}` : ''
    const countResult = await conn.execute(
        `SELECT COUNT(*) AS TOTAL${extra} FROM (${sql}) pagina_src`,
        binds,
    )
    const metrics = countResult.rows?.[0] || {}
    const total = Number(metrics.TOTAL ?? 0)

    const pageResult = await conn.execute(
        `${sql} ${orderBy} OFFSET :paginaOffset ROWS FETCH NEXT :paginaLimit ROWS ONLY`,
        {
            ...binds,
            paginaOffset: nbind(offset),
            paginaLimit: nbind(limit),
        },
        fetchInfo ? { fetchInfo } : {},
    )

    return { rows: pageResult.rows || [], total, metrics }
}
