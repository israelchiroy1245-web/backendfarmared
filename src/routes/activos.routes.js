import { Router } from 'express'
import {
    listarActivos,
    obtenerActivo,
    crearActivo,
    actualizarActivo,
    eliminarActivo,
    depreciarActivos
} from '../controllers/activos.controller.js'
import { requireAuth, requireRol } from '../middlewares/auth.js'

const router = Router()

// Todas las rutas requieren sesión autenticada
router.use(requireAuth)

// Consulta de activos (ADMIN, AUDITOR, QF)
router.get('/', requireRol('ADMIN', 'AUDITOR', 'QF'), listarActivos)
router.get('/:id', requireRol('ADMIN', 'AUDITOR', 'QF'), obtenerActivo)

// Gestión de activos (Solo ADMIN)
router.post('/', requireRol('ADMIN'), crearActivo)
router.put('/:id', requireRol('ADMIN'), actualizarActivo)
router.patch('/:id', requireRol('ADMIN'), actualizarActivo)
router.delete('/:id', requireRol('ADMIN'), eliminarActivo)
router.post('/depreciar', requireRol('ADMIN'), depreciarActivos)

export default router
