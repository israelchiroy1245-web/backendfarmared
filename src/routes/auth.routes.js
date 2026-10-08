import { Router } from 'express'
import { login, logout, me, refresh, registrarEmpleado } from '../controllers/auth.controller.js'
import { requireAuth, requireRol } from '../middlewares/auth.js'

const router = Router()
router.post('/login', login)
router.post('/refresh', refresh)
router.post('/logout', logout)
router.get('/me', requireAuth, me)
router.post('/registrar-empleado', requireAuth, requireRol('ADMIN'), registrarEmpleado)
router.post('/register-employee', requireAuth, requireRol('ADMIN'), registrarEmpleado)
export default router
