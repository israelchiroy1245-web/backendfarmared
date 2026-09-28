import { Router } from 'express'
import {
    listarRoles,
    listarPermisos,
    obtenerRol,
    crearRol,
    actualizarRol,
    eliminarRol,
    obtenerPermisosDeRol,
    asignarPermisosARol,
    sincronizarPermisosDeRol,
    removerPermisoDeRol
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

// Asignación y gestión de permisos por Rol
router.get('/:id/permisos', obtenerPermisosDeRol)
router.post('/:id/permisos', asignarPermisosARol)
router.put('/:id/permisos', sincronizarPermisosDeRol)
router.delete('/:id/permisos/:permisoId', removerPermisoDeRol)

export default router
