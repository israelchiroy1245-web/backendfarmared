import { Router } from 'express'
import {
    listarVentas,
    obtenerVenta,
    registrarVenta,
    anularVenta
} from '../controllers/ventas.controller.js'
import { requireAuth, requireRol } from '../middlewares/auth.js'

const router = Router()

// Todas las rutas de ventas requieren autenticación
router.use(requireAuth)

// Consulta de ventas
router.get('/', listarVentas)
router.get('/:id', obtenerVenta)

// Emisión y cobro de ticket POS (CAJERO o ADMIN)
router.post('/', requireRol('CAJERO', 'ADMIN'), registrarVenta)

// Anulación de ticket emitido (CAJERO o ADMIN)
router.post('/:id/anular', requireRol('CAJERO', 'ADMIN'), anularVenta)

export default router