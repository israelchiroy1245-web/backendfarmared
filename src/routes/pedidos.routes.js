import { Router } from 'express'
import {
    consultarCobertura,
    listarPedidos,
    obtenerPedido,
    crearPedido,
    cambiarEstadoPedido
} from '../controllers/pedidos.controller.js'
import { requireAuth, requireRol } from '../middlewares/auth.js'

const router = Router()

// Todas las rutas requieren sesión autenticada
router.use(requireAuth)

// CU03: Consulta en vivo de cobertura, stock, distancia Haversine y ETA
router.post('/consulta', requireRol('CALL_CENTER', 'ADMIN', 'QF', 'CAJERO'), consultarCobertura)
router.post('/consultar', requireRol('CALL_CENTER', 'ADMIN', 'QF', 'CAJERO'), consultarCobertura)

// Creación de pedidos a domicilio (canal CALL_CENTER)
router.post('/pedido', requireRol('CALL_CENTER', 'ADMIN'), crearPedido)
router.post('/', requireRol('CALL_CENTER', 'ADMIN'), crearPedido)

// Consulta de pedidos
router.get('/', requireRol('CALL_CENTER', 'ADMIN', 'QF', 'CAJERO'), listarPedidos)
router.get('/:id', requireRol('CALL_CENTER', 'ADMIN', 'QF', 'CAJERO'), obtenerPedido)

// Actualización del ciclo logístico del pedido
router.patch('/:id', requireRol('CALL_CENTER', 'ADMIN', 'QF'), cambiarEstadoPedido)
router.patch('/:id/estado', requireRol('CALL_CENTER', 'ADMIN', 'QF'), cambiarEstadoPedido)

export default router
