import { Router } from 'express'
import {
    listarUsuarios,
    obtenerUsuario,
    crearUsuario,
    actualizarUsuario,
    cambiarPassword
} from '../controllers/usuarios.controller.js'
import { requireAuth, requireRol } from '../middlewares/auth.js'

const router = Router()

// Todas las rutas del CRUD de usuarios están protegidas por requireAuth y requireRol('ADMIN')
router.use(requireAuth, requireRol('ADMIN'))

router.get('/', listarUsuarios)
router.get('/:id', obtenerUsuario)
router.post('/', crearUsuario)
router.put('/:id', actualizarUsuario)
router.patch('/:id/password', cambiarPassword)

export default router