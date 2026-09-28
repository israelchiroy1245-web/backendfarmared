import { Router } from 'express'
import {
    listarPermisos,
    crearPermiso,
    eliminarPermiso
} from '../controllers/permisos.controller.js'
import { requireAuth, requireRol } from '../middlewares/auth.js'

const router = Router()

// Todas las rutas de administración de permisos requieren ADMIN
router.use(requireAuth, requireRol('ADMIN'))

router.get('/', listarPermisos)
router.post('/', crearPermiso)
router.delete('/:id', eliminarPermiso)

export default router
