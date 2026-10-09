import * as transferenciasService from '../services/transferencias.service.js'
import { errorOracle, num } from '../utils/oracle.js'
import { leerPaginacion, respuestaPaginada } from '../utils/paginacion.js'
import { resolverSucursal, rolDe, sucursalDelToken, sucursalFijadaEnApi } from '../utils/sucursalSesion.js'

/**
 * GET /api/transferencias
 * Listado de transferencias con filtros y paginación
 */
export async function listarTransferencias(req, res) {
    try {
        const sucursalId = resolverSucursal(req, req.query.sucursalId)
        const origenId = num(req.query.origenId)
        const destinoId = num(req.query.destinoId)
        const estado = req.query.estado
        const fechaDesde = req.query.fechaDesde
        const fechaHasta = req.query.fechaHasta
        const { limit, offset } = leerPaginacion(req.query)

        const pagina = await transferenciasService.consultarTransferencias({
            sucursalId,
            origenId,
            destinoId,
            estado,
            fechaDesde,
            fechaHasta,
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
        if (error.statusCode) {
            return res.status(error.statusCode).json({ ok: false, error: error.message })
        }
        console.error('Error al listar transferencias:', error.message)
        const err = errorOracle(error)
        return res.status(err.status).json({ ok: false, error: err.error })
    }
}

/**
 * GET /api/transferencias/:id
 * Detalle de cabecera y líneas de una transferencia
 */
export async function obtenerTransferencia(req, res) {
    try {
        const id = num(req.params.id)
        if (!id) {
            return res.status(400).json({ ok: false, error: 'ID de transferencia inválido' })
        }

        const transferencia = await transferenciasService.consultarTransferenciaPorId(id)
        if (!transferencia) {
            return res.status(404).json({ ok: false, error: 'Transferencia no encontrada' })
        }

        if (sucursalFijadaEnApi(req)) {
            const propia = sucursalDelToken(req)
            const origen = num(transferencia.SUCURSAL_ORIGEN_ID)
            const destino = num(transferencia.SUCURSAL_DESTINO_ID)
            if (!propia || (origen !== propia && destino !== propia)) {
                return res.status(403).json({ ok: false, error: 'Solo puede operar en su sucursal asignada' })
            }
        }

        return res.json({ ok: true, datos: transferencia })
    } catch (error) {
        console.error('Error al obtener transferencia:', error.message)
        const err = errorOracle(error)
        return res.status(err.status).json({ ok: false, error: err.error })
    }
}

/**
 * POST /api/transferencias
 * Crea solicitud de transferencia en estado SOLICITADA (sin mover stock aún)
 */
export async function crearTransferencia(req, res) {
    try {
        const origenId = num(req.body.origenId ?? req.body.sucursalOrigenId)
        const destinoId = num(req.body.destinoId ?? req.body.sucursalDestinoId)
        const observacion = req.body.observacion
        const lineas = req.body.lineas || req.body.items
        const usuarioId = req.usuario?.id

        if (!origenId || !destinoId) {
            return res.status(400).json({
                ok: false,
                error: 'origenId y destinoId son obligatorios'
            })
        }

        if (origenId === destinoId) {
            return res.status(400).json({
                ok: false,
                error: 'La sucursal de origen debe ser distinta a la de destino'
            })
        }

        if (!Array.isArray(lineas) || lineas.length === 0) {
            return res.status(400).json({
                ok: false,
                error: 'Debe incluir al menos una línea con medicamentoId y cantidad (> 0)'
            })
        }

        const resultado = await transferenciasService.crearTransferencia({
            origenId,
            destinoId,
            observacion,
            lineas,
            usuarioId,
            rol: rolDe(req)
        })

        return res.status(201).json({
            ok: true,
            mensaje: resultado.mensaje,
            datos: resultado
        })
    } catch (error) {
        if (error.statusCode) {
            return res.status(error.statusCode).json({ ok: false, error: error.message })
        }
        console.error('Error al crear transferencia:', error.message)
        const err = errorOracle(error)
        return res.status(err.status).json({ ok: false, error: err.error })
    }
}

/**
 * PATCH /api/transferencias/:id/enviar
 * Ejecuta el SP procesar_transferencia_envio (descuenta origen FEFO y pasa a EN_TRANSITO)
 */
export async function enviarTransferencia(req, res) {
    try {
        const id = num(req.params.id)
        if (!id) {
            return res.status(400).json({ ok: false, error: 'ID de transferencia inválido' })
        }

        const usuarioId = req.usuario?.id
        const resultado = await transferenciasService.enviarTransferencia(id, usuarioId, rolDe(req))

        return res.json({
            ok: true,
            mensaje: resultado.mensaje,
            datos: resultado
        })
    } catch (error) {
        if (error.statusCode) {
            return res.status(error.statusCode).json({ ok: false, error: error.message })
        }
        console.error('Error al enviar transferencia:', error.message)
        const err = errorOracle(error)
        return res.status(err.status).json({ ok: false, error: err.error })
    }
}

/**
 * PATCH /api/transferencias/:id/recibir
 * Ejecuta el SP procesar_transferencia_recepcion (suma stock en destino y pasa a RECIBIDA)
 */
export async function recibirTransferencia(req, res) {
    try {
        const id = num(req.params.id)
        if (!id) {
            return res.status(400).json({ ok: false, error: 'ID de transferencia inválido' })
        }

        const usuarioId = req.usuario?.id
        const resultado = await transferenciasService.recibirTransferencia(id, usuarioId, rolDe(req))

        return res.json({
            ok: true,
            mensaje: resultado.mensaje,
            datos: resultado
        })
    } catch (error) {
        if (error.statusCode) {
            return res.status(error.statusCode).json({ ok: false, error: error.message })
        }
        console.error('Error al recibir transferencia:', error.message)
        const err = errorOracle(error)
        return res.status(err.status).json({ ok: false, error: err.error })
    }
}

/**
 * PATCH /api/transferencias/:id/cancelar
 * Cancela una transferencia si sigue en estado SOLICITADA
 */
export async function cancelarTransferencia(req, res) {
    try {
        const id = num(req.params.id)
        if (!id) {
            return res.status(400).json({ ok: false, error: 'ID de transferencia inválido' })
        }

        const usuarioId = req.usuario?.id
        const resultado = await transferenciasService.cancelarTransferencia(id, usuarioId, rolDe(req))

        return res.json({
            ok: true,
            mensaje: resultado.mensaje,
            datos: resultado
        })
    } catch (error) {
        if (error.statusCode) {
            return res.status(error.statusCode).json({ ok: false, error: error.message })
        }
        console.error('Error al cancelar transferencia:', error.message)
        const err = errorOracle(error)
        return res.status(err.status).json({ ok: false, error: err.error })
    }
}
