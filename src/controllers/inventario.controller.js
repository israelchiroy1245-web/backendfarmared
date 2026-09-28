import * as inventarioService from '../services/inventario.service.js'
import { errorOracle, num } from '../utils/oracle.js'
import { leerPaginacion, respuestaPaginada } from '../utils/paginacion.js'

/**
 * GET /api/inventario
 * Lista lotes de inventario con opción de filtrado por sucursal, medicamento y alerta de stock bajo
 */
export async function listarInventario(req, res) {
    try {
        const sucursalId = num(req.query.sucursalId)
        const medicamentoId = num(req.query.medicamentoId)
        const alertaBajo = req.query.alertaBajo
        const lote = req.query.lote
        const { limit, offset } = leerPaginacion(req.query)

        const pagina = await inventarioService.consultarInventario({
            sucursalId,
            medicamentoId,
            alertaBajo,
            lote,
            q: req.query.q,
            limit,
            offset,
        })

        return res.json({
            ok: true,
            datos: pagina.rows,
            total: pagina.total,
            resumen: {
                bajos: Number(pagina.metrics?.BAJOS ?? 0),
                vencidos: Number(pagina.metrics?.VENCIDOS ?? 0),
            },
            paginacion: respuestaPaginada({ total: pagina.total, limit, offset }),
        })
    } catch (error) {
        console.error('Error al listar inventario:', error.message)
        const err = errorOracle(error)
        return res.status(err.status).json({ ok: false, error: err.error })
    }
}

/**
 * GET /api/inventario/kardex
 * Lista historial de movimientos de kardex
 */
export async function listarKardex(req, res) {
    try {
        const sucursalId = num(req.query.sucursalId)
        const medicamentoId = num(req.query.medicamentoId)
        const tipo = req.query.tipo
        const { limit, offset } = leerPaginacion(req.query)

        const pagina = await inventarioService.consultarKardex({
            sucursalId,
            medicamentoId,
            tipo,
            q: req.query.q,
            limit,
            offset,
        })

        return res.json({
            ok: true,
            datos: pagina.rows,
            total: pagina.total,
            paginacion: respuestaPaginada({ total: pagina.total, limit, offset }),
        })
    } catch (error) {
        console.error('Error al consultar kardex:', error.message)
        const err = errorOracle(error)
        return res.status(err.status).json({ ok: false, error: err.error })
    }
}

/**
 * GET /api/inventario/:id
 * Detalle de un lote específico
 */
export async function obtenerLote(req, res) {
    try {
        const id = num(req.params.id)
        if (!id) {
            return res.status(400).json({ ok: false, error: 'ID de lote inválido' })
        }

        const lote = await inventarioService.consultarLotePorId(id)
        if (!lote) {
            return res.status(404).json({ ok: false, error: 'Lote no encontrado' })
        }

        return res.json({ ok: true, datos: lote })
    } catch (error) {
        console.error('Error al obtener lote:', error.message)
        const err = errorOracle(error)
        return res.status(err.status).json({ ok: false, error: err.error })
    }
}

/**
 * POST /api/inventario
 * Crear nuevo lote e insertar movimiento inicial en kardex
 */
export async function crearLote(req, res) {
    try {
        const sucursalId = num(req.body.sucursalId)
        const medicamentoId = num(req.body.medicamentoId)
        const lote = req.body.lote ? String(req.body.lote).trim() : ''
        const cantidad = num(req.body.cantidad) ?? 0
        const stockMinimo = num(req.body.stockMinimo) ?? 6
        const fechaVencimiento = req.body.fechaVencimiento || null
        const usuarioId = req.usuario?.id

        if (!sucursalId || !medicamentoId || !lote) {
            return res.status(400).json({
                ok: false,
                error: 'sucursalId, medicamentoId y lote son obligatorios'
            })
        }

        if (cantidad < 0) {
            return res.status(400).json({ ok: false, error: 'La cantidad no puede ser negativa' })
        }

        const nuevo = await inventarioService.crearLote({
            sucursalId,
            medicamentoId,
            lote,
            cantidad,
            fechaVencimiento,
            stockMinimo,
            usuarioId
        })

        return res.status(201).json({
            ok: true,
            mensaje: 'Lote creado exitosamente y registrado en kardex',
            datos: nuevo
        })
    } catch (error) {
        if (error.statusCode) {
            return res.status(error.statusCode).json({ ok: false, error: error.message })
        }
        console.error('Error al crear lote:', error.message)
        const err = errorOracle(error)
        return res.status(err.status).json({ ok: false, error: err.error })
    }
}

/**
 * PUT /api/inventario/:id
 * Reemplazar lote completo
 */
export async function actualizarLote(req, res) {
    try {
        const id = num(req.params.id)
        if (!id) {
            return res.status(400).json({ ok: false, error: 'ID de lote inválido' })
        }

        const { cantidad, stockMinimo, fechaVencimiento, lote } = req.body
        const usuarioId = req.usuario?.id

        const resultado = await inventarioService.reemplazarLote(id, {
            cantidad,
            stockMinimo,
            fechaVencimiento,
            lote,
            usuarioId
        })

        return res.json({
            ok: true,
            mensaje: 'Lote actualizado correctamente',
            datos: resultado
        })
    } catch (error) {
        if (error.statusCode) {
            return res.status(error.statusCode).json({ ok: false, error: error.message })
        }
        console.error('Error al actualizar lote:', error.message)
        const err = errorOracle(error)
        return res.status(err.status).json({ ok: false, error: err.error })
    }
}

/**
 * PATCH /api/inventario/:id
 * Ajuste de cantidad de stock de lote (absoluta o relativa) + Kardex AJUSTE
 */
export async function ajustarStock(req, res) {
    try {
        const id = num(req.params.id)
        if (!id) {
            return res.status(400).json({ ok: false, error: 'ID de lote inválido' })
        }

        const { cantidad, ajuste } = req.body
        const usuarioId = req.usuario?.id

        if (cantidad === undefined && ajuste === undefined) {
            return res.status(400).json({
                ok: false,
                error: 'Debe especificar "cantidad" (valor nuevo) o "ajuste" (diferencia a sumar/restar)'
            })
        }

        const resultado = await inventarioService.ajustarStockLote(id, {
            cantidad,
            ajuste,
            usuarioId
        })

        return res.json({
            ok: true,
            mensaje: 'Stock de lote ajustado correctamente y registrado en kardex',
            datos: resultado
        })
    } catch (error) {
        if (error.statusCode) {
            return res.status(error.statusCode).json({ ok: false, error: error.message })
        }
        console.error('Error al ajustar stock de lote:', error.message)
        const err = errorOracle(error)
        return res.status(err.status).json({ ok: false, error: err.error })
    }
}

/**
 * DELETE /api/inventario/:id
 * Eliminar lote (Regla de negocio: solo si cantidad = 0; si tiene stock -> 409)
 */
export async function eliminarLote(req, res) {
    try {
        const id = num(req.params.id)
        if (!id) {
            return res.status(400).json({ ok: false, error: 'ID de lote inválido' })
        }

        const usuarioId = req.usuario?.id
        const resultado = await inventarioService.eliminarLoteVacio(id, usuarioId)

        return res.json({
            ok: true,
            mensaje: 'Lote vacío eliminado exitosamente',
            datos: resultado
        })
    } catch (error) {
        if (error.statusCode) {
            return res.status(error.statusCode).json({ ok: false, error: error.message })
        }
        console.error('Error al eliminar lote:', error.message)
        const err = errorOracle(error)
        return res.status(err.status).json({ ok: false, error: err.error })
    }
}
