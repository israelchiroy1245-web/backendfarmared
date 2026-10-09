import * as proveedoresService from '../services/proveedores.service.js'
import { errorOracle, num } from '../utils/oracle.js'
import { leerPaginacion, respuestaPaginada } from '../utils/paginacion.js'

/**
 * GET /api/proveedores
 * Listado paginado de proveedores con búsqueda por nombre, nit o email
 */
export async function listarProveedores(req, res) {
    try {
        const { limit, offset } = leerPaginacion(req.query)
        const q = req.query.q

        const pagina = await proveedoresService.consultarProveedores({
            q,
            estado: req.query.estado,
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
        console.error('Error al listar proveedores:', error.message)
        const err = errorOracle(error)
        return res.status(err.status).json({ ok: false, error: err.error })
    }
}

/**
 * GET /api/proveedores/:id
 * Detalle de proveedor y sus compras recientes
 */
export async function obtenerProveedor(req, res) {
    try {
        const id = num(req.params.id)
        if (!id) {
            return res.status(400).json({ ok: false, error: 'ID de proveedor inválido' })
        }

        const proveedor = await proveedoresService.consultarProveedorPorId(id)
        if (!proveedor) {
            return res.status(404).json({ ok: false, error: 'Proveedor no encontrado' })
        }

        return res.json({ ok: true, datos: proveedor })
    } catch (error) {
        console.error('Error al obtener proveedor:', error.message)
        const err = errorOracle(error)
        return res.status(err.status).json({ ok: false, error: err.error })
    }
}

/**
 * POST /api/proveedores
 * Alta de nuevo proveedor (Exclusivo QF y ADMIN)
 */
export async function crearProveedor(req, res) {
    try {
        const nombre = String(req.body.nombre || '').trim()
        const nit = String(req.body.nit || '').trim()
        const telefono = req.body.telefono ? String(req.body.telefono).trim() : null
        const direccion = req.body.direccion ? String(req.body.direccion).trim() : null
        const email = req.body.email ? String(req.body.email).trim() : null
        const usuarioId = req.usuario?.id

        if (!nombre || !nit) {
            return res.status(400).json({
                ok: false,
                error: 'nombre y nit son obligatorios'
            })
        }

        const nuevo = await proveedoresService.crearProveedor({
            nombre,
            nit,
            telefono,
            direccion,
            email,
            usuarioId
        })

        return res.status(201).json({
            ok: true,
            mensaje: 'Proveedor registrado exitosamente',
            datos: nuevo
        })
    } catch (error) {
        if (error.statusCode) {
            return res.status(error.statusCode).json({ ok: false, error: error.message })
        }
        console.error('Error al crear proveedor:', error.message)
        const err = errorOracle(error)
        return res.status(err.status).json({ ok: false, error: err.error })
    }
}

/**
 * PUT / PATCH /api/proveedores/:id
 * Actualización total o parcial de datos de proveedor
 */
export async function actualizarProveedor(req, res) {
    try {
        const id = num(req.params.id)
        if (!id) {
            return res.status(400).json({ ok: false, error: 'ID de proveedor inválido' })
        }

        const { nombre, nit, telefono, direccion, email, estado } = req.body
        const usuarioId = req.usuario?.id

        const resultado = await proveedoresService.actualizarProveedor(id, {
            nombre,
            nit,
            telefono,
            direccion,
            email,
            estado,
            usuarioId
        })

        return res.json({
            ok: true,
            mensaje: 'Proveedor actualizado exitosamente',
            datos: resultado
        })
    } catch (error) {
        if (error.statusCode) {
            return res.status(error.statusCode).json({ ok: false, error: error.message })
        }
        console.error('Error al actualizar proveedor:', error.message)
        const err = errorOracle(error)
        return res.status(err.status).json({ ok: false, error: err.error })
    }
}

/**
 * DELETE /api/proveedores/:id
 * Baja lógica: Estado = INACTIVO. No borra la fila.
 */
export async function eliminarProveedor(req, res) {
    try {
        const id = num(req.params.id)
        if (!id) {
            return res.status(400).json({ ok: false, error: 'ID de proveedor inválido' })
        }

        const usuarioId = req.usuario?.id
        const resultado = await proveedoresService.eliminarProveedor(id, usuarioId)

        return res.json({
            ok: true,
            mensaje: 'Proveedor desactivado',
            datos: resultado
        })
    } catch (error) {
        if (error.statusCode) {
            return res.status(error.statusCode).json({ ok: false, error: error.message })
        }
        console.error('Error al eliminar proveedor:', error.message)
        const err = errorOracle(error)
        return res.status(err.status).json({ ok: false, error: err.error })
    }
}
