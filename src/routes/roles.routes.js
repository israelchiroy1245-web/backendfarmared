import { Router } from 'express'
import {
    listarRoles,
    listarPermisos,
    obtenerRol,
    crearRol,
    actualizarRol,
    eliminarRol,
    obtenerPermisosDeRol
} from '../controllers/roles.controller.js'
import { requireAuth, requireRol } from '../middlewares/auth.js'

const router = Router()

// Todas las rutas de administración de roles requieren ser ADMIN
router.use(requireAuth, requireRol('ADMIN'))

// CRUD básico de roles
router.get('/', listarRoles)
router.get('/permisos', listarPermisos)
router.get('/:id', obtenerRol)
router.post('/', crearRol)
router.put('/:id', actualizarRol)
router.delete('/:id', eliminarRol)

router.get('/:id/permisos', obtenerPermisosDeRol)

export default router
