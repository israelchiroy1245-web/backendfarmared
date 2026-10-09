import { Router } from 'express'
import {
    listarTransferencias,
    obtenerTransferencia,
    crearTransferencia,
    enviarTransferencia,
    recibirTransferencia,
    cancelarTransferencia
} from '../controllers/transferencias.controller.js'
import { requireAuth, requireRol } from '../middlewares/auth.js'

const router = Router()

// Todas las rutas requieren autenticación
router.use(requireAuth)

// Consulta de transferencias
router.get('/', listarTransferencias)
router.get('/:id', obtenerTransferencia)

// Flujo de estados y gestión de transferencias (QF y ADMIN)
router.post('/', requireRol('QF', 'ADMIN', 'ENCARGADO'), crearTransferencia)
router.patch('/:id/enviar', requireRol('QF', 'ADMIN', 'ENCARGADO'), enviarTransferencia)
router.patch('/:id/recibir', requireRol('QF', 'ADMIN', 'ENCARGADO'), recibirTransferencia)
router.patch('/:id/cancelar', requireRol('QF', 'ADMIN', 'ENCARGADO'), cancelarTransferencia)

export default router
