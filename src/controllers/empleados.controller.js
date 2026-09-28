import * as empleadosService from '../services/empleados.service.js'
import { errorOracle, num } from '../utils/oracle.js'
import { leerPaginacion, respuestaPaginada } from '../utils/paginacion.js'

/**
 * GET /api/empleados
 * Lista empleados con información de usuario y rol (sin password hash)
 */
export async function listarEmpleados(req, res) {
    try {
        const sucursalId = num(req.query.sucursalId)
        const estado = req.query.estado
        const { limit, offset } = leerPaginacion(req.query)

        const pagina = await empleadosService.consultarEmpleados({
            sucursalId,
            estado,
            q: req.query.q,
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
        console.error('Error al listar empleados:', error.message)
        const err = errorOracle(error)
        return res.status(err.status).json({ ok: false, error: err.error })
    }
}

/**
 * GET /api/empleados/:id
 * Detalle de un empleado por su ID de empleado
 */
export async function obtenerEmpleado(req, res) {
    try {
        const id = num(req.params.id)
        if (!id) {
            return res.status(400).json({ ok: false, error: 'ID de empleado inválido' })
        }

        const empleado = await empleadosService.consultarEmpleadoPorId(id)
        if (!empleado) {
            return res.status(404).json({ ok: false, error: 'Empleado no encontrado' })
        }

        return res.json({ ok: true, datos: empleado })
    } catch (error) {
        console.error('Error al obtener empleado:', error.message)
        const err = errorOracle(error)
        return res.status(err.status).json({ ok: false, error: err.error })
    }
}

/**
 * POST /api/empleados
 * Alta integral transaccional de Usuario + Empleado (Exclusivo ADMIN)
 */
export async function crearEmpleado(req, res) {
    try {
        const nombre = String(req.body.nombre || '').trim()
        const apellido = String(req.body.apellido || '').trim()
        const email = String(req.body.email || '').trim()
        const dpi = String(req.body.dpi || '').trim()
        const telefono = String(req.body.telefono || '').trim() || null
        const password = String(req.body.password || '')
        const rolId = num(req.body.rolId)
        const sucursalId = num(req.body.sucursalId)
        const cargo = String(req.body.cargo || '').trim()
        const salario = num(req.body.salario)
        const adminId = req.usuario?.id

        if (!nombre || !apellido || !email || !dpi || !password || !rolId || !sucursalId || !cargo || salario === null) {
            return res.status(400).json({
                ok: false,
                error: 'nombre, apellido, email, dpi, password, rolId, sucursalId, cargo y salario son obligatorios'
            })
        }

        if (password.length < 6) {
            return res.status(400).json({ ok: false, error: 'La contraseña debe tener mínimo 6 caracteres' })
        }

        const nuevo = await empleadosService.crearEmpleadoTransaccional({
            nombre,
            apellido,
            email,
            dpi,
            telefono,
            password,
            rolId,
            sucursalId,
            cargo,
            salario,
            adminId
        })

        return res.status(201).json({
            ok: true,
            mensaje: 'Empleado y usuario creados exitosamente en una sola transacción',
            datos: nuevo
        })
    } catch (error) {
        if (error.statusCode) {
            return res.status(error.statusCode).json({ ok: false, error: error.message })
        }
        console.error('Error al crear empleado:', error.message)
        const err = errorOracle(error)
        return res.status(err.status).json({ ok: false, error: err.error })
    }
}

/**
 * PATCH /api/empleados/:id
 * Actualiza campos laborales (cargo, salario, sucursal) o personales (nombre, apellido, tel, rol)
 */
export async function actualizarEmpleado(req, res) {
    try {
        const id = num(req.params.id)
        if (!id) {
            return res.status(400).json({ ok: false, error: 'ID de empleado inválido' })
        }

        const { cargo, salario, sucursalId, nombre, apellido, telefono, rolId } = req.body
        const adminId = req.usuario?.id

        const resultado = await empleadosService.actualizarEmpleado(id, {
            cargo,
            salario,
            sucursalId,
            nombre,
            apellido,
            telefono,
            rolId,
            adminId
        })

        return res.json({ ok: true, datos: resultado })
    } catch (error) {
        if (error.statusCode) {
            return res.status(error.statusCode).json({ ok: false, error: error.message })
        }
        console.error('Error al actualizar empleado:', error.message)
        const err = errorOracle(error)
        return res.status(err.status).json({ ok: false, error: err.error })
    }
}

/**
 * PATCH /api/empleados/:id/estado
 * Da de baja o reactiva tanto el empleado como el usuario correspondiente
 */
export async function cambiarEstadoEmpleado(req, res) {
    try {
        const id = num(req.params.id)
        if (!id) {
            return res.status(400).json({ ok: false, error: 'ID de empleado inválido' })
        }

        const { estado } = req.body
        if (!estado) {
            return res.status(400).json({ ok: false, error: 'Debe especificar el nuevo estado ("ACTIVO" o "INACTIVO")' })
        }

        const adminId = req.usuario?.id
        const resultado = await empleadosService.cambiarEstadoEmpleado(id, estado, adminId)

        return res.json({ ok: true, datos: resultado })
    } catch (error) {
        if (error.statusCode) {
            return res.status(error.statusCode).json({ ok: false, error: error.message })
        }
        console.error('Error al cambiar estado de empleado:', error.message)
        const err = errorOracle(error)
        return res.status(err.status).json({ ok: false, error: err.error })
    }
}
