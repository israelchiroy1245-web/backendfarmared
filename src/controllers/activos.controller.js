import * as activosService from '../services/activos.service.js'
import { errorOracle, num } from '../utils/oracle.js'

/**
 * GET /api/activos
 * Listado de activos fijos con filtros por sucursal, categoría, estado y término de búsqueda
 */
export async function listarActivos(req, res) {
    try {
        const sucursalId = num(req.query.sucursalId)
        const categoria = req.query.categoria
        const estado = req.query.estado
        const q = req.query.q
        const limit = num(req.query.limit) || 50
        const offset = num(req.query.offset) || 0

        const activos = await activosService.consultarActivos({
            sucursalId,
            categoria,
            estado,
            q,
            limit,
            offset
        })

        // Totales agregados útiles para el balance gerencial
        const totalAdquisicion = activos.reduce((sum, a) => sum + (Number(a.VALOR_ADQUISICION) || 0), 0)
        const totalDepreciacion = activos.reduce((sum, a) => sum + (Number(a.DEPRECIACION_ACUMULADA) || 0), 0)
        const totalLibros = activos.reduce((sum, a) => sum + (Number(a.VALOR_LIBROS) || 0), 0)

        return res.json({
            ok: true,
            total: activos.length,
            balance: {
                totalAdquisicion: Math.round(totalAdquisicion * 100) / 100,
                totalDepreciacion: Math.round(totalDepreciacion * 100) / 100,
                totalLibros: Math.round(totalLibros * 100) / 100
            },
            datos: activos
        })
    } catch (error) {
        console.error('Error al listar activos:', error.message)
        const err = errorOracle(error)
        return res.status(err.status).json({ ok: false, error: err.error })
    }
}

/**
 * GET /api/activos/:id
 * Consulta de un activo fijo individual
 */
export async function obtenerActivo(req, res) {
    try {
        const id = num(req.params.id)
        if (!id) {
            return res.status(400).json({ ok: false, error: 'ID de activo inválido' })
        }

        const activo = await activosService.consultarActivoPorId(id)
        if (!activo) {
            return res.status(404).json({ ok: false, error: 'Activo fijo no encontrado' })
        }

        return res.json({ ok: true, datos: activo })
    } catch (error) {
        console.error('Error al obtener activo:', error.message)
        const err = errorOracle(error)
        return res.status(err.status).json({ ok: false, error: err.error })
    }
}

/**
 * POST /api/activos
 * Registra un nuevo activo fijo
 */
export async function crearActivo(req, res) {
    try {
        const {
            codigo,
            nombre,
            categoria,
            valorAdquisicion,
            fechaAdquisicion,
            vidaUtilMeses,
            valorResidual,
            depreciacionAcumulada,
            estado,
            sucursalId
        } = req.body

        const resultado = await activosService.crearActivo({
            codigo,
            nombre,
            categoria,
            valorAdquisicion,
            fechaAdquisicion,
            vidaUtilMeses,
            valorResidual,
            depreciacionAcumulada,
            estado,
            sucursalId: num(sucursalId ?? (req.usuario || req.user)?.sucursalId),
            usuarioId: (req.usuario || req.user)?.id
        })

        return res.status(201).json({ ok: true, ...resultado })
    } catch (error) {
        console.error('Error al crear activo:', error.message)
        const err = errorOracle(error)
        return res.status(err.status).json({ ok: false, error: err.error })
    }
}

/**
 * PUT /api/activos/:id o PATCH /api/activos/:id
 * Actualiza los datos de un activo fijo
 */
export async function actualizarActivo(req, res) {
    try {
        const id = num(req.params.id)
        if (!id) {
            return res.status(400).json({ ok: false, error: 'ID de activo inválido' })
        }

        const {
            nombre,
            categoria,
            valorAdquisicion,
            fechaAdquisicion,
            vidaUtilMeses,
            valorResidual,
            depreciacionAcumulada,
            estado,
            sucursalId
        } = req.body

        const resultado = await activosService.actualizarActivo(id, {
            nombre,
            categoria,
            valorAdquisicion,
            fechaAdquisicion,
            vidaUtilMeses,
            valorResidual,
            depreciacionAcumulada,
            estado,
            sucursalId,
            usuarioId: (req.usuario || req.user)?.id
        })

        return res.json({ ok: true, ...resultado })
    } catch (error) {
        console.error('Error al actualizar activo:', error.message)
        const err = errorOracle(error)
        return res.status(err.status).json({ ok: false, error: err.error })
    }
}

/**
 * DELETE /api/activos/:id
 * Elimina un activo fijo
 */
export async function eliminarActivo(req, res) {
    try {
        const id = num(req.params.id)
        if (!id) {
            return res.status(400).json({ ok: false, error: 'ID de activo inválido' })
        }

        const resultado = await activosService.eliminarActivo(id, (req.usuario || req.user)?.id)

        return res.json({ ok: true, ...resultado })
    } catch (error) {
        console.error('Error al eliminar activo:', error.message)
        const err = errorOracle(error)
        return res.status(err.status).json({ ok: false, error: err.error })
    }
}

/**
 * POST /api/activos/depreciar
 * Recalcula la depreciación lineal acumulada de todos los activos en uso
 */
export async function depreciarActivos(req, res) {
    try {
        const sucursalId = num(req.body.sucursalId)

        const resultado = await activosService.depreciarActivosLineal({
            sucursalId,
            usuarioId: (req.usuario || req.user)?.id
        })

        return res.json({ ok: true, ...resultado })
    } catch (error) {
        console.error('Error al depreciar activos:', error.message)
        const err = errorOracle(error)
        return res.status(err.status).json({ ok: false, error: err.error })
    }
}
