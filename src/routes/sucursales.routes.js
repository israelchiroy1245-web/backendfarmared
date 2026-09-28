import { Router } from 'express'
import {
    listarSucursales,
    obtenerSucursal,
    crearSucursal,
    actualizarSucursal,
    desactivarSucursal,
    reactivarSucursal
} from '../controllers/sucursales.controller.js'
import { requireAuth, requireRol } from '../middlewares/auth.js'

const router = Router()

// Todas las rutas requieren sesión activa
router.use(requireAuth)

// Consulta de sucursales (Cualquier usuario autenticado)
router.get('/', listarSucursales)
router.get('/:id', obtenerSucursal)

// Modificación y gestión (Exclusivo ADMIN)
router.post('/', requireRol('ADMIN'), crearSucursal)
router.put('/:id', requireRol('ADMIN'), actualizarSucursal)
router.delete('/:id', requireRol('ADMIN'), desactivarSucursal) // Baja lógica
router.patch('/:id/reactivar', requireRol('ADMIN'), reactivarSucursal)

export default router
