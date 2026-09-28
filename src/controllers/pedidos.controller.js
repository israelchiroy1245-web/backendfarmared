import * as pedidosService from '../services/pedidos.service.js'
import { errorOracle, num } from '../utils/oracle.js'

/**
 * POST /api/call-center/consultar o POST /api/pedidos/consultar
 * CU03: Consulta en vivo de disponibilidad de stock, cálculo de distancia Haversine y ETA
 */
export async function consultarCobertura(req, res) {
    try {
        const { latitud, longitud, items } = req.body

        if (num(latitud) === null || num(longitud) === null) {
            return res.status(400).json({ ok: false, error: 'latitud y longitud del cliente son requeridas' })
        }

        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ ok: false, error: 'items debe ser un arreglo de medicamentos con cantidad' })
        }

        const resultado = await pedidosService.consultarDisponibilidad({
            latitud,
            longitud,
            items
        })

        return res.json({ ok: true, ...resultado })
    } catch (error) {
        console.error('Error al consultar cobertura de call center:', error.message)
        const err = errorOracle(error)
        return res.status(err.status).json({ ok: false, error: err.error })
    }
}

/**
 * GET /api/pedidos o GET /api/call-center/pedidos
 * Listado de pedidos con filtros por estado, sucursal, cliente y paginación
 */
export async function listarPedidos(req, res) {
    try {
        const estado = req.query.estado
        const sucursalId = num(req.query.sucursalId)
        const clienteId = num(req.query.clienteId)
        const canal = req.query.canal
        const limit = num(req.query.limit) || 50
        const offset = num(req.query.offset) || 0

        const pedidos = await pedidosService.consultarPedidos({
            estado,
            sucursalId,
            clienteId,
            canal,
            limit,
            offset
        })

        return res.json({ ok: true, total: pedidos.length, datos: pedidos })
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
 * POST /api/pedidos o POST /api/call-center/pedidos
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
            items
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
            items,
            usuarioId: (req.usuario || req.user)?.id
        })

        return res.status(201).json({ ok: true, ...resultado })
    } catch (error) {
        console.error('Error al crear pedido:', error.message)
        const err = errorOracle(error)
        return res.status(err.status).json({ ok: false, error: err.error })
    }
}

/**
 * PATCH /api/pedidos/:id/estado
 * Actualización del ciclo de vida del pedido
 */
export async function cambiarEstadoPedido(req, res) {
    try {
        const id = num(req.params.id)
        if (!id) {
            return res.status(400).json({ ok: false, error: 'ID de pedido inválido' })
        }

        const { estado } = req.body
        if (!estado) {
            return res.status(400).json({ ok: false, error: 'El campo estado es requerido' })
        }

        const resultado = await pedidosService.actualizarEstadoPedido(
            id,
            estado,
            (req.usuario || req.user)?.id
        )

        return res.json({ ok: true, ...resultado })
    } catch (error) {
        console.error('Error al cambiar estado de pedido:', error.message)
        const err = errorOracle(error)
        return res.status(err.status).json({ ok: false, error: err.error })
    }
}
