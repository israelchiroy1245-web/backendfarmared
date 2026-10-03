import * as cajaService from '../services/caja.service.js'
import { errorOracle, num } from '../utils/oracle.js'
import { leerPaginacion, respuestaPaginada } from '../utils/paginacion.js'

function fallo(res, error, contexto) {
    console.error(contexto, error.message)
    if (error.statusCode) {
        return res.status(error.statusCode).json({ ok: false, error: error.message })
    }
    const err = errorOracle(error)
    return res.status(err.status).json({ ok: false, error: err.error })
}

/**
 * GET /api/caja
 * Listado de turnos de caja con filtros y paginación
 */
export async function listarTurnos(req, res) {
    try {
        const sucursalId = num(req.query.sucursalId)
        const estado = req.query.estado
        const cajeroId = num(req.query.cajeroId)
        const { limit, offset } = leerPaginacion(req.query)

        const pagina = await cajaService.consultarTurnos({
            sucursalId,
            estado,
            cajeroId,
            q: req.query.q,
            limit,
            offset,
        })

        return res.json({
            ok: true,
            datos: pagina.rows,
            total: pagina.total,
            resumen: { abiertos: Number(pagina.metrics?.ABIERTOS ?? 0) },
            paginacion: respuestaPaginada({ total: pagina.total, limit, offset }),
        })
    } catch (error) {
        return fallo(res, error, 'Error al listar turnos de caja:')
    }
}

/**
 * GET /api/caja/abierta
 * Consulta el turno abierto de la sucursal (o 404 si no hay turno abierto)
 */
export async function obtenerTurnoAbierto(req, res) {
    try {
        const sucursalId = num(req.query.sucursalId ?? (req.usuario || req.user)?.sucursalId)
        if (!sucursalId) {
            return res.status(400).json({ ok: false, error: 'sucursalId es requerido' })
        }
        const turno = await cajaService.consultarTurnoAbiertoPorSucursal(sucursalId)
        if (!turno) {
            return res.status(404).json({ ok: false, error: `No hay turno de caja abierto para la sucursal ${sucursalId}` })
        }
        return res.json({ ok: true, datos: turno })
    } catch (error) {
        return fallo(res, error, 'Error al consultar turno abierto de sucursal:')
    }
}

/**
 * GET /api/caja/activo
 * Consulta si el cajero en sesión tiene un turno ABIERTO actualmente
 */
export async function obtenerTurnoActivo(req, res) {
    try {
        const turno = await cajaService.consultarTurnoActivo((req.usuario || req.user).id)
        if (!turno) {
            return res.status(404).json({ ok: false, error: 'No hay turno de caja abierto para el usuario en sesión' })
        }
        return res.json({ ok: true, datos: turno })
    } catch (error) {
        return fallo(res, error, 'Error al consultar turno activo:')
    }
}

/**
 * GET /api/caja/:id
 * Consulta el detalle completo de un turno y sus movimientos
 */
export async function obtenerTurno(req, res) {
    try {
        const id = num(req.params.id)
        if (!id) {
            return res.status(400).json({ ok: false, error: 'ID de turno de caja inválido' })
        }

        const turno = await cajaService.consultarTurnoPorId(id)
        if (!turno) {
            return res.status(404).json({ ok: false, error: 'Turno de caja no encontrado' })
        }

        return res.json({ ok: true, datos: turno })
    } catch (error) {
        return fallo(res, error, 'Error al obtener turno de caja:')
    }
}

/**
 * POST /api/caja/apertura (o /api/caja/abrir)
 * Apertura de turno de caja con fondo inicial
 */
export async function abrirTurno(req, res) {
    try {
        const sucursalId = num(req.body.sucursalId ?? req.body.sucursal_id ?? (req.usuario || req.user)?.sucursalId)
        const montoInicial = num(req.body.montoInicial ?? req.body.monto_inicial)

        if (!sucursalId) {
            return res.status(400).json({ ok: false, error: 'sucursalId es requerido' })
        }
        if (montoInicial === null || montoInicial < 0) {
            return res.status(400).json({ ok: false, error: 'montoInicial es requerido y debe ser >= 0' })
        }

        const resultado = await cajaService.abrirTurno({
            sucursalId,
            montoInicial,
            usuarioId: (req.usuario || req.user).id
        })

        return res.status(201).json({ ok: true, ...resultado })
    } catch (error) {
        return fallo(res, error, 'Error al abrir turno de caja:')
    }
}

/**
 * POST /api/caja/movimiento o POST /api/caja/:id/movimiento
 * Registra movimiento de caja (GASTO, RETIRO, DEPOSITO, etc.)
 */
export async function registrarMovimiento(req, res) {
    try {
        const turnoId = num(req.params.id ?? req.body.turnoId ?? req.body.turno_id)
        if (!turnoId) {
            return res.status(400).json({ ok: false, error: 'ID de turno de caja es requerido' })
        }

        const { tipo, monto, metodoPago, descripcion } = req.body
        if (!tipo) {
            return res.status(400).json({ ok: false, error: 'tipo de movimiento es requerido (GASTO, RETIRO, DEPOSITO)' })
        }
        if (num(monto) === null || num(monto) <= 0) {
            return res.status(400).json({ ok: false, error: 'monto debe ser numérico mayor a 0' })
        }

        const resultado = await cajaService.registrarMovimientoCaja(turnoId, {
            tipo,
            monto,
            metodoPago,
            descripcion,
            usuarioId: (req.usuario || req.user).id
        })

        return res.status(201).json({ ok: true, ...resultado })
    } catch (error) {
        return fallo(res, error, 'Error al registrar movimiento de caja:')
    }
}

/**
 * POST /api/caja/cierre o PATCH /api/caja/:id/cerrar
 * Cierre de turno de caja (arqueo físico y cálculo de diferencia)
 */
export async function cerrarTurno(req, res) {
    try {
        let turnoId = num(req.params.id ?? req.body.turnoId ?? req.body.turno_id)

        // Si no se proporcionó id en params o body, buscar el turno activo del cajero
        if (!turnoId) {
            const activo = await cajaService.consultarTurnoActivo((req.usuario || req.user).id)
            if (activo) {
                turnoId = activo.ID
            }
        }

        if (!turnoId) {
            return res.status(400).json({ ok: false, error: 'ID de turno de caja es requerido para el cierre' })
        }

        const montoContado = num(req.body.montoContado ?? req.body.monto_contado)
        if (montoContado === null || montoContado < 0) {
            return res.status(400).json({ ok: false, error: 'montoContado es obligatorio y debe ser >= 0' })
        }

        const ventasEfectivo = req.body.ventasEfectivo ?? req.body.ventas_efectivo
        const ventasTarjeta = req.body.ventasTarjeta ?? req.body.ventas_tarjeta
        const gastos = req.body.gastos

        const resultado = await cajaService.cerrarTurno(turnoId, {
            montoContado,
            ventasEfectivo,
            ventasTarjeta,
            gastos,
            usuarioId: (req.usuario || req.user).id
        })

        return res.json({ ok: true, ...resultado })
    } catch (error) {
        return fallo(res, error, 'Error al cerrar turno de caja:')
    }
}

/**
 * PATCH /api/caja/:id/auditar
 * Auditoría formal de cierre de turno (CU01 - Auditor / Admin pasa a AUDITADA)
 */
export async function auditarTurno(req, res) {
    try {
        const id = num(req.params.id)
        if (!id) {
            return res.status(400).json({ ok: false, error: 'ID de turno de caja inválido' })
        }

        const resultado = await cajaService.auditarTurno(id, (req.usuario || req.user).id)

        return res.json({ ok: true, ...resultado })
    } catch (error) {
        return fallo(res, error, 'Error al auditar turno de caja:')
    }
}
