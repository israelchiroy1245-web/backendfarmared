import { Router } from 'express'
import {
    listarVentas,
    obtenerVenta,
    registrarVenta
} from '../controllers/ventas.controller.js'
import { requireAuth, requireRol } from '../middlewares/auth.js'

const router = Router()

// Todas las rutas de ventas requieren autenticación
router.use(requireAuth)

// Consulta de ventas
router.get('/', listarVentas)
router.get('/:id', obtenerVenta)

// Emisión y cobro de ventas (CAJERO o ADMIN)
router.post('/', requireRol('CAJERO', 'ADMIN'), registrarVenta)

export default router