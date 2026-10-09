import * as medicamentosService from '../services/medicamentos.service.js'
import { errorOracle, num } from '../utils/oracle.js'
import { leerPaginacion, respuestaPaginada } from '../utils/paginacion.js'

function dinero(valor, nombre, obligatorio) {
    if (valor === undefined || valor === null || valor === '') {
        if (!obligatorio) return undefined
        const err = new Error(`${nombre} es obligatorio`)
        err.statusCode = 400
        throw err
    }
    const n = num(valor)
    if (n === null || n < 0) {
        const err = new Error(`${nombre} debe ser mayor o igual a 0`)
        err.statusCode = 400
        throw err
    }
    return n
}

function receta(valor, obligatorio) {
    if (valor === undefined || valor === null || valor === '') {
        if (!obligatorio) return undefined
        return 0
    }
    const n = Number(valor)
    if (n !== 0 && n !== 1) {
        const err = new Error('recetaRequerida debe ser 0 o 1')
        err.statusCode = 400
        throw err
    }
    return n
}

function responder(res, error, texto) {
    if (error.statusCode) {
        return res.status(error.statusCode).json({ ok: false, error: error.message })
    }
    console.error(texto, error.message)
    const err = errorOracle(error)
    return res.status(err.status).json({ ok: false, error: err.error })
}

export async function listarMedicamentos(req, res) {
    try {
        const { limit, offset } = leerPaginacion(req.query)
        const pagina = await medicamentosService.consultarMedicamentos({
            q: req.query.q,
            estado: req.query.estado,
            limit,
            offset,
        })
        return res.json({
            ok: true,
            datos: pagina.rows,
            total: pagina.total,
            paginacion: respuestaPaginada({ total: pagina.total, limit, offset }),
        })
    } catch (error) {
        return responder(res, error, 'Error al listar medicamentos:')
    }
}

export async function obtenerMedicamento(req, res) {
    try {
        const id = num(req.params.id)
        if (!id) return res.status(400).json({ ok: false, error: 'ID de medicamento inválido' })
        const medicamento = await medicamentosService.consultarMedicamentoPorId(id)
        if (!medicamento) return res.status(404).json({ ok: false, error: 'Medicamento no encontrado' })
        return res.json({ ok: true, datos: medicamento })
    } catch (error) {
        return responder(res, error, 'Error al obtener medicamento:')
    }
}

export async function crearMedicamento(req, res) {
    try {
        const nombre = String(req.body.nombre || '').trim()
        const codigoBarra = String(req.body.codigoBarra || '').trim()
        if (!nombre || !codigoBarra) {
            return res.status(400).json({ ok: false, error: 'nombre y codigoBarra son obligatorios' })
        }
        const nuevo = await medicamentosService.crearMedicamento({
            nombre,
            codigoBarra,
            principioActivo: req.body.principioActivo,
            presentacion: req.body.presentacion,
            laboratorio: req.body.laboratorio,
            recetaRequerida: receta(req.body.recetaRequerida, true),
            precioVenta: dinero(req.body.precioVenta, 'precioVenta', true),
            costo: dinero(req.body.costo, 'costo', true),
            descripcion: req.body.descripcion,
            usuarioId: req.usuario?.id,
        })
        return res.status(201).json({
            ok: true,
            mensaje: 'Medicamento registrado exitosamente',
            datos: nuevo,
        })
    } catch (error) {
        return responder(res, error, 'Error al crear medicamento:')
    }
}

export async function actualizarMedicamento(req, res) {
    try {
        const id = num(req.params.id)
        if (!id) return res.status(400).json({ ok: false, error: 'ID de medicamento inválido' })
        const body = req.body || {}
        const resultado = await medicamentosService.actualizarMedicamento(id, {
            nombre: body.nombre,
            codigoBarra: body.codigoBarra,
            principioActivo: body.principioActivo,
            presentacion: body.presentacion,
            laboratorio: body.laboratorio,
            recetaRequerida: body.recetaRequerida !== undefined ? receta(body.recetaRequerida, true) : undefined,
            precioVenta: body.precioVenta !== undefined ? dinero(body.precioVenta, 'precioVenta', true) : undefined,
            costo: body.costo !== undefined ? dinero(body.costo, 'costo', true) : undefined,
            descripcion: body.descripcion,
            estado: body.estado,
        }, req.usuario?.id)
        return res.json({
            ok: true,
            mensaje: 'Medicamento actualizado exitosamente',
            datos: resultado,
        })
    } catch (error) {
        return responder(res, error, 'Error al actualizar medicamento:')
    }
}

export async function eliminarMedicamento(req, res) {
    try {
        const id = num(req.params.id)
        if (!id) return res.status(400).json({ ok: false, error: 'ID de medicamento inválido' })
        const resultado = await medicamentosService.eliminarMedicamento(id, req.usuario?.id)
        return res.json({
            ok: true,
            mensaje: 'Medicamento desactivado',
            datos: resultado,
        })
    } catch (error) {
        return responder(res, error, 'Error al desactivar medicamento:')
    }
}
