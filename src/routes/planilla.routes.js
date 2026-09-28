import { Router } from 'express'
import {
    listarPlanillas,
    obtenerPlanilla,
    generarPlanilla,
    crearOActualizarPlanilla,
    actualizarPlanilla,
    pagarPlanilla,
    pagarPeriodo
} from '../controllers/planilla.controller.js'
import { requireAuth, requireRol } from '../middlewares/auth.js'

const router = Router()

// Todas las rutas requieren sesión autenticada
router.use(requireAuth)

// Consulta de planillas (ADMIN y AUDITOR)
router.get('/', requireRol('ADMIN', 'AUDITOR'), listarPlanillas)
router.get('/:id', requireRol('ADMIN', 'AUDITOR'), obtenerPlanilla)

// Gestión de nómina, ajustes y dispersión de pagos (Solo ADMIN)
router.post('/generar', requireRol('ADMIN'), generarPlanilla)
router.post('/', requireRol('ADMIN'), crearOActualizarPlanilla)
router.patch('/:id', requireRol('ADMIN'), actualizarPlanilla)
router.patch('/:id/pagar', requireRol('ADMIN'), pagarPlanilla)
router.post('/pagar-periodo', requireRol('ADMIN'), pagarPeriodo)

export default router
