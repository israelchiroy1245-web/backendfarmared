import { Router } from 'express'
import { registrarVenta } from '../controllers/ventas.controller.js'
import { requireAuth } from '../middlewares/auth.js'

const router = Router()
router.post('/', requireAuth, registrarVenta)
export default router