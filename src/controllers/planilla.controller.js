import * as planillaService from '../services/planilla.service.js'
import { errorOracle, num } from '../utils/oracle.js'
import { leerPaginacion, respuestaPaginada } from '../utils/paginacion.js'

/**
 * GET /api/planilla
 * Listado de planillas con filtros por periodo, sucursal, estado y empleado
 */
export async function listarPlanillas(req, res) {
    try {
        const periodo = req.query.periodo
        const sucursalId = num(req.query.sucursalId)
        const estado = req.query.estado
        const empleadoId = num(req.query.empleadoId)
        const { limit, offset } = leerPaginacion(req.query)

        const pagina = await planillaService.consultarPlanillas({
            periodo,
            sucursalId,
            estado,
            empleadoId,
            q: req.query.q,
            limit,
            offset
        })

        return res.json({
            ok: true,
            datos: pagina.rows,
            total: pagina.total,
            resumen: { montoTotal: Number(pagina.metrics?.MONTO ?? 0) },
            paginacion: respuestaPaginada({ total: pagina.total, limit, offset })
        })
    } catch (error) {
        console.error('Error al listar planillas:', error.message)
        const err = errorOracle(error)
        return res.status(err.status).json({ ok: false, error: err.error })
    }
}

/**
 * GET /api/planilla/:id
 * Consulta de registro de planilla por ID
 */
export async function obtenerPlanilla(req, res) {
    try {
        const id = num(req.params.id)
        if (!id) {
            return res.status(400).json({ ok: false, error: 'ID de planilla inválido' })
        }

        const planilla = await planillaService.consultarPlanillaPorId(id)
        if (!planilla) {
            return res.status(404).json({ ok: false, error: 'Registro de planilla no encontrado' })
        }

        return res.json({ ok: true, datos: planilla })
    } catch (error) {
        console.error('Error al obtener planilla:', error.message)
        const err = errorOracle(error)
        return res.status(err.status).json({ ok: false, error: err.error })
    }
}

/**
 * POST /api/planilla/generar
 * Genera la nómina consolidada para un periodo YYYY-MM
 */
export async function generarPlanilla(req, res) {
    try {
        const { periodo, sucursalId, bonificacion } = req.body

        if (!periodo) {
            return res.status(400).json({ ok: false, error: 'periodo (YYYY-MM) es obligatorio' })
        }

        const resultado = await planillaService.generarPlanillaPeriodo({
            periodo,
            sucursalId: num(sucursalId),
            bonificacion: num(bonificacion),
            usuarioId: req.usuario?.id
        })

        return res.status(201).json({ ok: true, ...resultado })
    } catch (error) {
        console.error('Error al generar planilla:', error.message)
        const err = errorOracle(error)
        return res.status(err.status).json({ ok: false, error: err.error })
    }
}

/**
 * POST /api/planilla
 * Registra o actualiza la planilla de un empleado individual
 */
export async function crearOActualizarPlanilla(req, res) {
    try {
        const { empleadoId, periodo, salarioBase, bonificaciones, descuentos } = req.body

        if (!empleadoId) {
            return res.status(400).json({ ok: false, error: 'empleadoId es obligatorio' })
        }
        if (!periodo) {
            return res.status(400).json({ ok: false, error: 'periodo (YYYY-MM) es obligatorio' })
        }

        const resultado = await planillaService.registrarPlanillaEmpleado({
            empleadoId: num(empleadoId),
            periodo,
            salarioBase: num(salarioBase),
            bonificaciones: num(bonificaciones),
            descuentos: num(descuentos),
            usuarioId: req.usuario?.id
        })

        return res.status(201).json({ ok: true, ...resultado })
    } catch (error) {
        console.error('Error al crear planilla de empleado:', error.message)
        const err = errorOracle(error)
        return res.status(err.status).json({ ok: false, error: err.error })
    }
}

/**
 * PATCH /api/planilla/:id
 * Actualiza ajustes de un registro de planilla PENDIENTE
 */
export async function actualizarPlanilla(req, res) {
    try {
        const id = num(req.params.id)
        if (!id) {
            return res.status(400).json({ ok: false, error: 'ID de planilla inválido' })
        }

        const { bonificaciones, descuentos, salarioBase } = req.body

        const resultado = await planillaService.actualizarAjustesPlanilla(id, {
            bonificaciones,
            descuentos,
            salarioBase,
            usuarioId: req.usuario?.id
        })

        return res.json({ ok: true, ...resultado })
    } catch (error) {
        console.error('Error al actualizar ajustes de planilla:', error.message)
        const err = errorOracle(error)
        return res.status(err.status).json({ ok: false, error: err.error })
    }
}

/**
 * PATCH /api/planilla/:id/pagar
 * Marca como PAGADA una planilla individual
 */
export async function pagarPlanilla(req, res) {
    try {
        const id = num(req.params.id)
        if (!id) {
            return res.status(400).json({ ok: false, error: 'ID de planilla inválido' })
        }

        const resultado = await planillaService.pagarPlanilla(id, req.usuario?.id)

        return res.json({ ok: true, ...resultado })
    } catch (error) {
        console.error('Error al pagar planilla:', error.message)
        const err = errorOracle(error)
        return res.status(err.status).json({ ok: false, error: err.error })
    }
}

/**
 * POST /api/planilla/pagar-periodo
 * Dispersa el pago masivo de todas las planillas pendientes de un periodo
 */
export async function pagarPeriodo(req, res) {
    try {
        const { periodo, sucursalId } = req.body
        if (!periodo) {
            return res.status(400).json({ ok: false, error: 'periodo (YYYY-MM) es obligatorio' })
        }

        const resultado = await planillaService.pagarPlanillaPeriodo({
            periodo,
            sucursalId: num(sucursalId),
            usuarioId: req.usuario?.id
        })

        return res.json({ ok: true, ...resultado })
    } catch (error) {
        console.error('Error al pagar planilla del periodo:', error.message)
        const err = errorOracle(error)
        return res.status(err.status).json({ ok: false, error: err.error })
    }
}
