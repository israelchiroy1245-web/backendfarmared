import { Router } from 'express'
import {
    listarCompras,
    obtenerCompra,
    registrarCompra
} from '../controllers/compras.controller.js'
import { requireAuth, requireRol } from '../middlewares/auth.js'

const router = Router()

// Todas las rutas de compras requieren autenticación
router.use(requireAuth)

// Consulta de facturas de compras
router.get('/', listarCompras)
router.get('/:id', obtenerCompra)

// Registro de compras vía SP procesar_compra (Exclusivo QF y ADMIN)
router.post('/', requireRol('QF', 'ADMIN', 'ENCARGADO'), registrarCompra)

export default router
