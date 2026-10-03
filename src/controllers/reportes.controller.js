import * as reportesService from '../services/reportes.service.js'
import { errorOracle, num } from '../utils/oracle.js'
import { leerPaginacion, respuestaPaginada } from '../utils/paginacion.js'

/**
 * GET /api/reportes/consolidado-red (o /api/reportes/consolidado o /api/reportes)
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
 * Reporte de ventas por sucursal, fechas y método de pago (3FN)
 */
export async function obtenerReporteVentas(req, res) {
    try {
        const sucursalId = num(req.query.sucursalId)
        const fechaInicio = req.query.fechaInicio || req.query.desde
        const fechaFin = req.query.fechaFin || req.query.hasta

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
 * Reporte de arqueos de caja y auditoría de diferencias (?desde=&hasta=)
 */
export async function obtenerReporteCaja(req, res) {
    try {
        const sucursalId = num(req.query.sucursalId)
        const desde = req.query.desde || req.query.fechaDesde
        const hasta = req.query.hasta || req.query.fechaHasta

        const reporte = await reportesService.reporteArqueoCajas({ sucursalId, desde, hasta })
        return res.json({ ok: true, datos: reporte })
    } catch (error) {
        console.error('Error al generar reporte de caja:', error.message)
        const err = errorOracle(error)
        return res.status(err.status).json({ ok: false, error: err.error })
    }
}

/**
 * GET /api/reportes/planilla
 * Reporte consolidado de nómina (?periodo=YYYY-MM)
 */
export async function obtenerReportePlanilla(req, res) {
    try {
        const periodo = req.query.periodo
        const sucursalId = num(req.query.sucursalId)

        const reporte = await reportesService.reportePlanilla({ periodo, sucursalId })
        return res.json({ ok: true, datos: reporte })
    } catch (error) {
        console.error('Error al generar reporte de planilla:', error.message)
        const err = errorOracle(error)
        return res.status(err.status).json({ ok: false, error: err.error })
    }
}

/**
 * GET /api/reportes/activos
 * Reporte patrimonial de activos fijos y depreciación acumulada
 */
export async function obtenerReporteActivos(req, res) {
    try {
        const sucursalId = num(req.query.sucursalId)
        const categoria = req.query.categoria

        const reporte = await reportesService.reporteActivos({ sucursalId, categoria })
        return res.json({ ok: true, datos: reporte })
    } catch (error) {
        console.error('Error al generar reporte de activos:', error.message)
        const err = errorOracle(error)
        return res.status(err.status).json({ ok: false, error: err.error })
    }
}

/**
 * GET /api/reportes/kardex
 * Historial de movimientos de inventario (?sucursalId=1&desde=&hasta=)
 */
export async function obtenerReporteKardex(req, res) {
    try {
        const sucursalId = num(req.query.sucursalId)
        const medicamentoId = num(req.query.medicamentoId)
        const tipo = req.query.tipo
        const desde = req.query.desde || req.query.fechaDesde
        const hasta = req.query.hasta || req.query.fechaHasta
        const { limit, offset } = leerPaginacion(req.query)

        const pagina = await reportesService.reporteKardex({
            sucursalId,
            medicamentoId,
            tipo,
            desde,
            hasta,
            q: req.query.q,
            limit,
            offset
        })

        return res.json({
            ok: true,
            datos: pagina.rows,
            total: pagina.total,
            paginacion: respuestaPaginada({ total: pagina.total, limit, offset })
        })
    } catch (error) {
        console.error('Error al generar reporte de kardex:', error.message)
        const err = errorOracle(error)
        return res.status(err.status).json({ ok: false, error: err.error })
    }
}

/**
 * GET /api/reportes/auditoria
 * Bitácora de auditoría del sistema (?tabla=&accion=&desde=&hasta=)
 */
export async function obtenerReporteAuditoria(req, res) {
    try {
        const tabla = req.query.tabla
        const accion = req.query.accion
        const desde = req.query.desde || req.query.fechaDesde
        const hasta = req.query.hasta || req.query.fechaHasta
        const { limit, offset } = leerPaginacion(req.query)

        const pagina = await reportesService.reporteAuditoria({
            tabla,
            accion,
            desde,
            hasta,
            q: req.query.q,
            limit,
            offset
        })

        return res.json({
            ok: true,
            datos: pagina.rows,
            total: pagina.total,
            paginacion: respuestaPaginada({ total: pagina.total, limit, offset })
        })
    } catch (error) {
        console.error('Error al generar reporte de auditoría:', error.message)
        const err = errorOracle(error)
        return res.status(err.status).json({ ok: false, error: err.error })
    }
}
