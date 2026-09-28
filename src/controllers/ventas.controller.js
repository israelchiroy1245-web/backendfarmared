import * as ventasService from '../services/ventas.service.js'
import { errorOracle, num } from '../utils/oracle.js'
import { leerPaginacion, respuestaPaginada } from '../utils/paginacion.js'

/**
 * GET /api/ventas
 * Lista ventas registradas con filtros opcionales
 */
export async function listarVentas(req, res) {
    try {
        const sucursalId = num(req.query.sucursalId)
        const empleadoId = num(req.query.empleadoId)
        const clienteId = num(req.query.clienteId)
        const metodoPago = req.query.metodoPago
        const fechaDesde = req.query.fechaDesde
        const fechaHasta = req.query.fechaHasta
        const { limit, offset } = leerPaginacion(req.query)

        const pagina = await ventasService.consultarVentas({
            sucursalId,
            empleadoId,
            clienteId,
            metodoPago,
            fechaDesde,
            fechaHasta,
            q: req.query.q,
            limit,
            offset,
        })

        return res.json({
            ok: true,
            datos: pagina.rows,
            total: pagina.total,
            resumen: { monto: Number(pagina.metrics?.MONTO ?? 0) },
            paginacion: respuestaPaginada({ total: pagina.total, limit, offset }),
        })
    } catch (error) {
        console.error('Error al listar ventas:', error.message)
        const err = errorOracle(error)
        return res.status(err.status).json({ ok: false, error: err.error })
    }
}

/**
 * GET /api/ventas/:id
 * Detalle de una venta con sus líneas de medicamento y lotes
 */
export async function obtenerVenta(req, res) {
    try {
        const id = num(req.params.id)
        if (!id) {
            return res.status(400).json({ ok: false, error: 'ID de venta inválido' })
        }

        const venta = await ventasService.consultarVentaPorId(id)
        if (!venta) {
            return res.status(404).json({ ok: false, error: 'Venta no encontrada' })
        }

        return res.json({ ok: true, datos: venta })
    } catch (error) {
        console.error('Error al obtener venta:', error.message)
        const err = errorOracle(error)
        return res.status(err.status).json({ ok: false, error: err.error })
    }
}

/**
 * POST /api/ventas
 * Registrar y emitir venta con descuento de stock FEFO vía SP procesar_venta
 */
export async function registrarVenta(req, res) {
    try {
        const sucursalId = num(req.body.sucursalId)
        const medicamentoId = num(req.body.medicamentoId)
        const cantidad = num(req.body.cantidad)
        const lineas = req.body.lineas || req.body.items
        const clienteId = num(req.body.clienteId)
        const metodoPago = req.body.metodoPago || 'EFECTIVO'
        const usuarioId = num(req.usuario?.id ?? req.body.cajeroId ?? process.env.CAJERO_ID_PRUEBA)

        if (!sucursalId) {
            return res.status(400).json({ ok: false, error: 'sucursalId es obligatorio' })
        }

        if (!medicamentoId && (!Array.isArray(lineas) || lineas.length === 0)) {
            return res.status(400).json({
                ok: false,
                error: 'Debe especificar medicamentoId y cantidad (> 0), o una lista de "lineas"'
            })
        }

        if (medicamentoId && (!cantidad || cantidad <= 0)) {
            return res.status(400).json({ ok: false, error: 'La cantidad debe ser mayor a 0' })
        }

        if (!usuarioId) {
            return res.status(401).json({
                ok: false,
                error: 'No hay usuario en sesión. En pruebas mande cajeroId o CAJERO_ID_PRUEBA=1'
            })
        }

        if (!['EFECTIVO', 'TARJETA', 'TRANSFERENCIA'].includes(metodoPago)) {
            return res.status(400).json({ ok: false, error: 'metodoPago inválido (EFECTIVO, TARJETA, TRANSFERENCIA)' })
        }

        const resultado = await ventasService.emitirVenta({
            sucursalId,
            medicamentoId,
            cantidad,
            lineas,
            clienteId,
            metodoPago,
            usuarioId
        })

        return res.status(201).json({
            ok: true,
            ventaId: resultado.ventaId,
            total: resultado.total,
            mensaje: resultado.mensaje
        })
    } catch (error) {
        if (error.statusCode) {
            return res.status(error.statusCode).json({ ok: false, error: error.message })
        }
        console.error('Error al procesar la venta:', error.message)
        const err = errorOracle(error)
        return res.status(err.status).json({ ok: false, error: err.error })
    }
}
