import { Router } from 'express'
import {
    catalogoSucursales,
    catalogoMedicamentos,
    catalogoRoles,
    catalogoPermisos,
    catalogoProveedores
} from '../controllers/catalogos.controller.js'
import { requireAuth } from '../middlewares/auth.js'

const router = Router()

// Requiere autenticación
router.use(requireAuth)

router.get('/sucursales', catalogoSucursales)
router.get('/medicamentos', catalogoMedicamentos)
router.get('/roles', catalogoRoles)
router.get('/permisos', catalogoPermisos)
router.get('/proveedores', catalogoProveedores)

export default router

