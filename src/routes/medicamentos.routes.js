import { Router } from 'express'
import {
    listarMedicamentos,
    obtenerMedicamento,
    crearMedicamento,
    actualizarMedicamento,
    eliminarMedicamento,
} from '../controllers/medicamentos.controller.js'
import { requireAuth, requireRol } from '../middlewares/auth.js'

const router = Router()

router.use(requireAuth)

router.get('/', listarMedicamentos)
router.get('/:id', obtenerMedicamento)

router.post('/', requireRol('QF', 'ADMIN'), crearMedicamento)
router.put('/:id', requireRol('QF', 'ADMIN'), actualizarMedicamento)
router.patch('/:id', requireRol('QF', 'ADMIN'), actualizarMedicamento)
router.delete('/:id', requireRol('ADMIN', 'QF'), eliminarMedicamento)

export default router
