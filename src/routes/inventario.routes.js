import { Router } from 'express'
import {
    listarInventario,
    listarKardex,
    obtenerLote,
    crearLote,
    actualizarLote,
    ajustarStock,
    eliminarLote
} from '../controllers/inventario.controller.js'
import { requireAuth, requireRol } from '../middlewares/auth.js'

const router = Router()

// Todas las rutas de inventario requieren token activo
router.use(requireAuth)

// Consultas (Cajero, QF, Admin, Auditor)
router.get('/', listarInventario)
router.get('/kardex', listarKardex) // Definir antes de /:id
router.get('/:id', obtenerLote)

// Operaciones de modificación (Exclusivo QF y ADMIN)
router.post('/', requireRol('QF', 'ADMIN', 'ENCARGADO'), crearLote)
router.put('/:id', requireRol('QF', 'ADMIN', 'ENCARGADO'), actualizarLote)
router.patch('/:id', requireRol('QF', 'ADMIN', 'ENCARGADO'), ajustarStock)
router.delete('/:id', requireRol('QF', 'ADMIN', 'ENCARGADO'), eliminarLote)

export default router
