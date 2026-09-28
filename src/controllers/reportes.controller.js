import * as reportesService from '../services/reportes.service.js'
import { errorOracle, num } from '../utils/oracle.js'

/**
 * GET /api/reportes/consolidado-red (o /api/reportes/consolidado)
 * CU04: Valor consolidado de la red de farmacias (Inventario a costo + Activos en libros + Planilla mensual)
 */
export async function obtenerConsolidadoRed(_req, res) {
    try {
        const reporte = await reportesService.reporteConsolidadoRed()
        return res.json({ ok: true, datos: reporte })
    } catch (error) {
        console.error('Error al generar reporte consolidado:', error.message)
        const err = errorOracle(error)
        return res.status(err.status).json({ ok: false, error: err.error })
    }
}

/**
 * GET /api/reportes/ventas
 * Reporte de ventas por sucursal y fechas
 */
export async function obtenerReporteVentas(req, res) {
    try {
        const sucursalId = num(req.query.sucursalId)
        const fechaInicio = req.query.fechaInicio
        const fechaFin = req.query.fechaFin

        const reporte = await reportesService.reporteVentas({ sucursalId, fechaInicio, fechaFin })
        return res.json({ ok: true, datos: reporte })
    } catch (error) {
        console.error('Error al generar reporte de ventas:', error.message)
        const err = errorOracle(error)
        return res.status(err.status).json({ ok: false, error: err.error })
    }
}

/**
 * GET /api/reportes/inventario
 * Reporte de inventario FEFO y productos próximos a vencer
 */
export async function obtenerReporteInventario(req, res) {
    try {
        const sucursalId = num(req.query.sucursalId)
        const dias = num(req.query.dias) || 90

        const reporte = await reportesService.reporteInventarioFefo({ sucursalId, diasVencimiento: dias })
        return res.json({ ok: true, datos: reporte })
    } catch (error) {
        console.error('Error al generar reporte de inventario:', error.message)
        const err = errorOracle(error)
        return res.status(err.status).json({ ok: false, error: err.error })
    }
}

/**
 * GET /api/reportes/caja
 * Reporte de arqueos de caja y auditoría de diferencias
 */
export async function obtenerReporteCaja(req, res) {
    try {
        const sucursalId = num(req.query.sucursalId)

        const reporte = await reportesService.reporteArqueoCajas({ sucursalId })
        return res.json({ ok: true, datos: reporte })
    } catch (error) {
        console.error('Error al generar reporte de caja:', error.message)
        const err = errorOracle(error)
        return res.status(err.status).json({ ok: false, error: err.error })
    }
}
