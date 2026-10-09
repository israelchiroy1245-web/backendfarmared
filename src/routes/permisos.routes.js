import { Router } from 'express'
import { listarPermisos } from '../controllers/permisos.controller.js'
import { requireAuth, requireRol } from '../middlewares/auth.js'

const router = Router()

// Todas las rutas de administración de permisos requieren ADMIN
router.use(requireAuth, requireRol('ADMIN'))

router.get('/', listarPermisos)

export default router
