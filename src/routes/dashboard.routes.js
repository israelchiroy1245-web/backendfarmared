import { Router } from 'express'
import { resumen } from '../controllers/dashboard.controller.js'
import { requireAuth } from '../middlewares/auth.js'

const router = Router()
router.get('/', requireAuth, resumen)
export default router
