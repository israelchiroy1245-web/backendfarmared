import * as comprasService from '../services/compras.service.js'
import { errorOracle, num } from '../utils/oracle.js'
import { leerPaginacion, respuestaPaginada } from '../utils/paginacion.js'
import { resolverSucursal } from '../utils/sucursalSesion.js'

/**
 * GET /api/compras
 * Lista cabeceras de compras con filtros opcionales
 */
export async function listarCompras(req, res) {
    try {
        const sucursalId = resolverSucursal(req, req.query.sucursalId)
        const proveedorId = num(req.query.proveedorId)
        const fechaDesde = req.query.fechaDesde
        const fechaHasta = req.query.fechaHasta
        const { limit, offset } = leerPaginacion(req.query)

        const pagina = await comprasService.consultarCompras({
            sucursalId,
            proveedorId,
            fechaDesde,
            fechaHasta,
            q: req.query.q,
            limit,
            offset,
        })

        return res.json({
            ok: true,
            datos: pagina.rows,
            total: pagina.total,
            resumen: { monto: Number(pagina.metrics?.MONTO ?? 0) },
            paginacion: respuestaPaginada({ total: pagina.total, limit, offset }),
        })
    } catch (error) {
        if (error.statusCode) {
            return res.status(error.statusCode).json({ ok: false, error: error.message })
        }
        console.error('Error al listar compras:', error.message)
        const err = errorOracle(error)
        return res.status(err.status).json({ ok: false, error: err.error })
    }
}

/**
 * GET /api/compras/:id
 * Consulta de factura de compra con sus líneas de detalle
 */
export async function obtenerCompra(req, res) {
    try {
        const id = num(req.params.id)
        if (!id) {
            return res.status(400).json({ ok: false, error: 'ID de compra inválido' })
        }

        const compra = await comprasService.consultarCompraPorId(id)
        if (!compra) {
            return res.status(404).json({ ok: false, error: 'Compra no encontrada' })
        }

        return res.json({ ok: true, datos: compra })
    } catch (error) {
        console.error('Error al obtener compra:', error.message)
        const err = errorOracle(error)
        return res.status(err.status).json({ ok: false, error: err.error })
    }
}

/**
 * POST /api/compras
 * Registra factura e invoca el SP procesar_compra por cada línea
 */
export async function registrarCompra(req, res) {
    try {
        const sucursalId = resolverSucursal(req, req.body.sucursalId)
        const proveedorId = num(req.body.proveedorId)
        const numeroFactura = String(req.body.numeroFactura || '').trim()
        const lineas = req.body.lineas || req.body.items
        const usuarioId = req.usuario?.id

        if (!sucursalId || !proveedorId || !numeroFactura) {
            return res.status(400).json({
                ok: false,
                error: 'sucursalId, proveedorId y numeroFactura son obligatorios'
            })
        }

        if (!Array.isArray(lineas) || lineas.length === 0) {
            return res.status(400).json({
                ok: false,
                error: 'Debe incluir al menos una línea/item en la compra ("lineas": [...])'
            })
        }

        const resultado = await comprasService.registrarCompra({
            sucursalId,
            proveedorId,
            numeroFactura,
            lineas,
            usuarioId
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
        console.error('Error al registrar compra:', error.message)
        const err = errorOracle(error)
        return res.status(err.status).json({ ok: false, error: err.error })
    }
}
