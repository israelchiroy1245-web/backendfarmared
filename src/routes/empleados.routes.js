import { Router } from 'express'
import {
    listarEmpleados,
    obtenerEmpleado,
    crearEmpleado,
    actualizarEmpleado,
    cambiarEstadoEmpleado
} from '../controllers/empleados.controller.js'
import { requireAuth, requireRol } from '../middlewares/auth.js'

const router = Router()

// Todas las rutas de empleados requieren autenticación
router.use(requireAuth)

// Consulta (Cualquier usuario autenticado para ver datos de compañeros/sucursal)
router.get('/', listarEmpleados)
router.get('/:id', obtenerEmpleado)

// Modificación y gestión integral (Exclusivo ADMIN)
router.post('/', requireRol('ADMIN'), crearEmpleado)
router.patch('/:id', requireRol('ADMIN'), actualizarEmpleado)
router.patch('/:id/estado', requireRol('ADMIN'), cambiarEstadoEmpleado)

export default router
