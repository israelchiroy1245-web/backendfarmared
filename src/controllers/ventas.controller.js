import * as ventasService from '../services/ventas.service.js'
import { errorOracle, num } from '../utils/oracle.js'
import { leerPaginacion, respuestaPaginada } from '../utils/paginacion.js'

/**
 * GET /api/ventas
 * Lista ventas registradas con filtros opcionales y paginación
 */
export async function listarVentas(req, res) {
    try {
        const sucursalId = num(req.query.sucursalId)
        const empleadoId = num(req.query.empleadoId)
        const clienteId = num(req.query.clienteId)
        const metodoPago = req.query.metodoPago
        const fechaDesde = req.query.fechaDesde
        const fechaHasta = req.query.fechaHasta
        const estado = req.query.estado
        const tipoDoc = req.query.tipoDoc
        const serie = req.query.serie
        const numero = req.query.numero
        const { limit, offset } = leerPaginacion(req.query)

        const pagina = await ventasService.consultarVentas({
            sucursalId,
            empleadoId,
            clienteId,
            metodoPago,
            fechaDesde,
            fechaHasta,
            estado,
            tipoDoc,
            serie,
            numero,
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
 * Detalle completo de una venta con sus ítems (F_Detalle_venta) y sus pagos (F_Venta_pago)
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
 * Registrar y emitir ticket POS con:
 * - Validación de turno de caja abierto
 * - Folio atómico (fn_siguiente_folio)
 * - Descuento FEFO e IVA (procesar_venta)
 * - N pagos en F_Venta_pago (3FN)
 * - Aplicación a caja y cálculo de vuelto (aplicar_venta_a_caja)
 */
export async function registrarVenta(req, res) {
    try {
        const sucursalId = num(req.body.sucursalId)
        const turnoId = num(req.body.turnoId)
        const serie = req.body.serie || 'A'
        const tipoDoc = req.body.tipoDoc || 'TICKET'
        const nit = req.body.nit || 'CF'
        const nombreFactura = req.body.nombreFactura
        const clienteId = num(req.body.clienteId)

        const medicamentoId = num(req.body.medicamentoId)
        const cantidad = num(req.body.cantidad)
        const precio = req.body.precio !== undefined ? num(req.body.precio) : undefined
        const lineas = req.body.lineas || req.body.items

        const pagos = req.body.pagos
        const metodoPago = req.body.metodoPago || 'EFECTIVO'
        const montoRecibido = req.body.montoRecibido !== undefined ? num(req.body.montoRecibido) : undefined

        const usuarioId = num(req.usuario?.id ?? req.body.cajeroId ?? process.env.CAJERO_ID_PRUEBA)

        if (!sucursalId) {
            return res.status(400).json({ ok: false, error: 'sucursalId es obligatorio' })
        }

        if (!medicamentoId && (!Array.isArray(lineas) || lineas.length === 0)) {
            return res.status(400).json({
                ok: false,
                error: 'Debe especificar medicamentoId y cantidad (> 0), o una lista en "lineas" o "items"'
            })
        }

        if (medicamentoId && (!cantidad || cantidad <= 0)) {
            return res.status(400).json({ ok: false, error: 'La cantidad debe ser mayor a 0' })
        }

        if (!usuarioId) {
            return res.status(401).json({
                ok: false,
                error: 'No hay usuario autenticado en la sesión'
            })
        }

        const resultado = await ventasService.emitirVenta({
            sucursalId,
            turnoId,
            serie,
            tipoDoc,
            nit,
            nombreFactura,
            clienteId,
            medicamentoId,
            cantidad,
            precio,
            lineas,
            pagos,
            metodoPago,
            montoRecibido,
            usuarioId
        })

        return res.status(201).json({
            ok: true,
            ...resultado
        })
    } catch (error) {
        if (error.statusCode) {
            return res.status(error.statusCode).json({ ok: false, error: error.message })
        }
        console.error('Error al emitir ticket POS:', error.message)
        const err = errorOracle(error)
        return res.status(err.status).json({ ok: false, error: err.error })
    }
}

/**
 * POST /api/ventas/:id/anular
 * Anula ticket EMITIDA:
 * - Restaura existencias en F_Inventario
 * - Registra ENTRADA en kardex F_Movimiento_inventario (ANULA-<id>)
 * - Registra contra-movimiento de caja y revierte acumulados en F_Turno_caja
 * - Pasa estado a ANULADA
 */
export async function anularVenta(req, res) {
    try {
        const id = num(req.params.id)
        if (!id) {
            return res.status(400).json({ ok: false, error: 'ID de venta inválido' })
        }

        const usuarioId = num(req.usuario?.id ?? req.body.cajeroId ?? process.env.CAJERO_ID_PRUEBA)
        if (!usuarioId) {
            return res.status(401).json({ ok: false, error: 'No hay usuario autenticado en la sesión' })
        }

        const resultado = await ventasService.anularVenta(id, usuarioId)

        return res.json({
            ok: true,
            ...resultado
        })
    } catch (error) {
        if (error.statusCode) {
            return res.status(error.statusCode).json({ ok: false, error: error.message })
        }
        console.error('Error al anular venta:', error.message)
        const err = errorOracle(error)
        return res.status(err.status).json({ ok: false, error: err.error })
    }
}
