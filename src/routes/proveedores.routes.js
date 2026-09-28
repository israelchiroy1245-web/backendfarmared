import { Router } from 'express'
import {
    listarProveedores,
    obtenerProveedor,
    crearProveedor,
    actualizarProveedor,
    eliminarProveedor
} from '../controllers/proveedores.controller.js'
import { requireAuth, requireRol } from '../middlewares/auth.js'

const router = Router()

// Todas las rutas requieren autenticación
router.use(requireAuth)

// Consulta
router.get('/', listarProveedores)
router.get('/:id', obtenerProveedor)

// Gestión y mantenimiento (QF y ADMIN)
router.post('/', requireRol('QF', 'ADMIN'), crearProveedor)
router.put('/:id', requireRol('QF', 'ADMIN'), actualizarProveedor)
router.patch('/:id', requireRol('QF', 'ADMIN'), actualizarProveedor)
router.delete('/:id', requireRol('ADMIN', 'QF'), eliminarProveedor)

export default router
