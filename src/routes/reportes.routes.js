import { Router } from 'express'
import {
    obtenerConsolidadoRed,
    obtenerReporteVentas,
    obtenerReporteInventario,
    obtenerReporteCaja,
    obtenerReportePlanilla,
    obtenerReporteActivos,
    obtenerReporteKardex,
    obtenerReporteAuditoria
} from '../controllers/reportes.controller.js'
import { requireAuth, requireRol } from '../middlewares/auth.js'

const router = Router()

// Todas las rutas requieren sesión autenticada
router.use(requireAuth)

// CU04: Valor consolidado de la red de farmacias (~US$ 5M para bolsa)
router.get('/consolidado-red', requireRol('ADMIN', 'AUDITOR', 'QF'), obtenerConsolidadoRed)
router.get('/consolidado', requireRol('ADMIN', 'AUDITOR', 'QF'), obtenerConsolidadoRed)
router.get('/', requireRol('ADMIN', 'AUDITOR', 'QF'), obtenerConsolidadoRed)

// Reportes específicos según la guía
router.get('/caja', requireRol('ADMIN', 'AUDITOR'), obtenerReporteCaja)
router.get('/planilla', requireRol('ADMIN', 'AUDITOR'), obtenerReportePlanilla)
router.get('/activos', requireRol('ADMIN', 'AUDITOR', 'QF'), obtenerReporteActivos)
router.get('/kardex', requireRol('ADMIN', 'AUDITOR', 'QF'), obtenerReporteKardex)
router.get('/auditoria', requireRol('ADMIN', 'AUDITOR'), obtenerReporteAuditoria)
router.get('/ventas', requireRol('ADMIN', 'AUDITOR', 'QF'), obtenerReporteVentas)
router.get('/inventario', requireRol('ADMIN', 'AUDITOR', 'QF'), obtenerReporteInventario)

export default router
