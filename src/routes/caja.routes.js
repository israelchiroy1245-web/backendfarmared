import { Router } from 'express'
import {
    listarTurnos,
    obtenerTurno,
    obtenerTurnoActivo,
    obtenerTurnoAbierto,
    abrirTurno,
    registrarMovimiento,
    cerrarTurno,
    auditarTurno
} from '../controllers/caja.controller.js'
import { requireAuth, requireRol } from '../middlewares/auth.js'

const router = Router()

// Todas las rutas requieren sesión autenticada
router.use(requireAuth)

// Consulta de turnos
router.get('/', listarTurnos)
router.get('/abierta', obtenerTurnoAbierto) // Declarar antes de /:id
router.get('/activo', obtenerTurnoActivo)
router.get('/:id', obtenerTurno)

// Operaciones de caja del cajero / admin
router.post('/apertura', requireRol('CAJERO', 'ADMIN'), abrirTurno)
router.post('/abrir', requireRol('CAJERO', 'ADMIN'), abrirTurno)

router.post('/movimiento', requireRol('CAJERO', 'ADMIN'), registrarMovimiento)
router.post('/:id/movimiento', requireRol('CAJERO', 'ADMIN'), registrarMovimiento)

router.post('/cierre', requireRol('CAJERO', 'ADMIN'), cerrarTurno)
router.patch('/:id/cerrar', requireRol('CAJERO', 'ADMIN'), cerrarTurno)
router.post('/:id/cierre', requireRol('CAJERO', 'ADMIN'), cerrarTurno)

// Auditoría de turno (CU01 - Auditor o Admin)
router.patch('/:id/auditar', requireRol('AUDITOR', 'ADMIN'), auditarTurno)

export default router
