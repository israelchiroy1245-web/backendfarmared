import * as pedidosService from '../services/pedidos.service.js'
import { errorOracle, num } from '../utils/oracle.js'
import { leerPaginacion, respuestaPaginada } from '../utils/paginacion.js'

/**
 * POST /api/call-center/consulta o POST /api/call-center/consultar
 * CU03: Consulta en vivo de disponibilidad de stock, cálculo de distancia Haversine y ETA
 */
export async function consultarCobertura(req, res) {
    try {
        const { latitud, longitud, departamento, depto, items, medicamentos } = req.body

        const resultado = await pedidosService.consultarDisponibilidad({
            latitud,
            longitud,
            departamento,
            depto,
            items,
            medicamentos
        })

        return res.json({ ok: true, ...resultado })
    } catch (error) {
        if (error.statusCode) {
            return res.status(error.statusCode).json({ ok: false, error: error.message })
        }
        console.error('Error al consultar cobertura de call center:', error.message)
        const err = errorOracle(error)
        return res.status(err.status).json({ ok: false, error: err.error })
    }
}

/**
 * GET /api/pedidos o GET /api/call-center/pedidos
 * Listado de pedidos con filtros y paginación estándar
 */
export async function listarPedidos(req, res) {
    try {
        const estado = req.query.estado
        const sucursalId = num(req.query.sucursalId)
        const clienteId = num(req.query.clienteId)
        const canal = req.query.canal
        const { limit, offset } = leerPaginacion(req.query)

        const pagina = await pedidosService.consultarPedidos({
            estado,
            sucursalId,
            clienteId,
            canal,
            q: req.query.q,
            limit,
            offset
        })

        return res.json({
            ok: true,
            datos: pagina.rows,
            total: pagina.total,
            paginacion: respuestaPaginada({ total: pagina.total, limit, offset })
        })
    } catch (error) {
        console.error('Error al listar pedidos:', error.message)
        const err = errorOracle(error)
        return res.status(err.status).json({ ok: false, error: err.error })
    }
}

/**
 * GET /api/pedidos/:id
 * Detalle completo de un pedido con sus medicamentos y tiempos
 */
export async function obtenerPedido(req, res) {
    try {
        const id = num(req.params.id)
        if (!id) {
            return res.status(400).json({ ok: false, error: 'ID de pedido inválido' })
        }

        const pedido = await pedidosService.consultarPedidoPorId(id)
        if (!pedido) {
            return res.status(404).json({ ok: false, error: 'Pedido no encontrado' })
        }

        return res.json({ ok: true, datos: pedido })
    } catch (error) {
        console.error('Error al obtener pedido:', error.message)
        const err = errorOracle(error)
        return res.status(err.status).json({ ok: false, error: err.error })
    }
}

/**
 * POST /api/pedidos o POST /api/call-center/pedido
 * Creación de pedido a domicilio / call center
 */
export async function crearPedido(req, res) {
    try {
        const {
            clienteId,
            cliente,
            direccionEntrega,
            departamento,
            municipio,
            latitud,
            longitud,
            sucursalId,
            metodoPago,
            canal,
            items,
            medicamentos
        } = req.body

        const resultado = await pedidosService.crearPedido({
            clienteId,
            cliente,
            direccionEntrega,
            departamento,
            municipio,
            latitud,
            longitud,
            sucursalId,
            metodoPago,
            canal: canal || 'CALL_CENTER',
            items: items || medicamentos,
            usuarioId: req.usuario?.id
        })

        return res.status(201).json({ ok: true, ...resultado })
    } catch (error) {
        if (error.statusCode) {
            return res.status(error.statusCode).json({ ok: false, error: error.message })
        }
        console.error('Error al crear pedido:', error.message)
        const err = errorOracle(error)
        return res.status(err.status).json({ ok: false, error: err.error })
    }
}

/**
 * PATCH /api/pedidos/:id o PATCH /api/pedidos/:id/estado
 * Actualización del ciclo de vida del pedido (CONFIRMADO -> PREPARANDO -> EN_RUTA -> ENTREGADO / CANCELADO)
 */
export async function cambiarEstadoPedido(req, res) {
    try {
        const id = num(req.params.id)
        if (!id) {
            return res.status(400).json({ ok: false, error: 'ID de pedido inválido' })
        }

        const nuevoEstado = typeof req.body === 'string' ? req.body : req.body.estado
        if (!nuevoEstado) {
            return res.status(400).json({ ok: false, error: 'El campo estado es requerido' })
        }

        const resultado = await pedidosService.actualizarEstadoPedido(
            id,
            nuevoEstado,
            req.usuario?.id
        )

        return res.json({ ok: true, ...resultado })
    } catch (error) {
        if (error.statusCode) {
            return res.status(error.statusCode).json({ ok: false, error: error.message })
        }
        console.error('Error al cambiar estado de pedido:', error.message)
        const err = errorOracle(error)
        return res.status(err.status).json({ ok: false, error: err.error })
    }
}
