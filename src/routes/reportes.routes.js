import { Router } from 'express'
import {
    obtenerConsolidadoRed,
    obtenerReporteVentas,
    obtenerReporteInventario,
    obtenerReporteCaja
} from '../controllers/reportes.controller.js'
import { requireAuth, requireRol } from '../middlewares/auth.js'

const router = Router()

// Todas las rutas requieren sesión autenticada
router.use(requireAuth)

// CU04: Valor consolidado de la red de farmacias
router.get('/consolidado-red', requireRol('ADMIN', 'AUDITOR', 'QF'), obtenerConsolidadoRed)
router.get('/consolidado', requireRol('ADMIN', 'AUDITOR', 'QF'), obtenerConsolidadoRed)
router.get('/', requireRol('ADMIN', 'AUDITOR', 'QF'), obtenerConsolidadoRed)

// Reportes específicos de auditoría y gerencia
router.get('/ventas', requireRol('ADMIN', 'AUDITOR', 'QF'), obtenerReporteVentas)
router.get('/inventario', requireRol('ADMIN', 'AUDITOR', 'QF'), obtenerReporteInventario)
router.get('/caja', requireRol('ADMIN', 'AUDITOR', 'QF'), obtenerReporteCaja)

export default router
