import bcrypt from 'bcryptjs'
import { oracledb } from '../config/database.js'
import { firmarAccess, verificarAccess } from '../middlewares/auth.js'
import { errorOracle, num } from '../utils/oracle.js'
import { setUsuario } from '../services/sesion.js'
import {
    crearSesion,
    revocar,
    revocarPorHash,
    rolExigeSucursal,
    rotarSesion,
} from '../services/sesionAuth.service.js'

const VENTANA_MS = 10 * 60 * 1000
const TOPE_INTENTOS = 5
const intentos = new Map()

function fila(row) {
    return row || null
}

function claveIntento(email) {
    return String(email || '').trim().toLowerCase()
}

function bloqueado(email) {
    const rec = intentos.get(claveIntento(email))
    if (!rec) return false
    if (Date.now() > rec.hasta) {
        intentos.delete(claveIntento(email))
        return false
    }
    return rec.n >= TOPE_INTENTOS
}

function anotarFallo(email) {
    const key = claveIntento(email)
    const ahora = Date.now()
    const rec = intentos.get(key)
    if (!rec || ahora > rec.hasta) {
        intentos.set(key, { n: 1, hasta: ahora + VENTANA_MS })
        return 1
    }
    rec.n += 1
    return rec.n
}

function limpiarIntentos(email) {
    intentos.delete(claveIntento(email))
}

function demasiadosIntentos(res) {
    return res.status(429).json({ ok: false, error: 'Demasiados intentos. Espere 10 minutos.' })
}

export const login = async (req, res) => {
    const email = String(req.body.email || req.body.usuario || '').trim()
    const password = String(req.body.password || '')
    if (!email || !password) {
        return res.status(400).json({ ok: false, error: 'correo y password son obligatorios' })
    }
    if (bloqueado(email)) return demasiadosIntentos(res)

    let conn
    try {
        conn = await oracledb.getConnection()
        const q = await conn.execute(
            `SELECT u.ID, u.Nombre, u.Apellido, u.Email, u.Password_hash, u.Estado, u.Roles_ID,
              r.Nombre AS Rol, e.ID AS Empleado_ID, e.Sucursal_ID, e.Cargo
         FROM F_Usuarios u
         JOIN F_Roles r ON r.ID = u.Roles_ID
         LEFT JOIN F_Empleados e ON e.Usuarios_ID = u.ID AND e.Estado = 'ACTIVO'
        WHERE LOWER(u.Email) = LOWER(:email)`,
            { email },
        )
        const u = fila(q.rows?.[0])
        const okPass = u ? await bcrypt.compare(password, u.PASSWORD_HASH) : false
        if (!u || u.ESTADO !== 'ACTIVO' || !okPass) {
            if (anotarFallo(email) >= TOPE_INTENTOS) return demasiadosIntentos(res)
            return res.status(401).json({ ok: false, error: 'Credenciales inválidas' })
        }
        if (rolExigeSucursal(u.ROL) && (u.EMPLEADO_ID == null || u.SUCURSAL_ID == null)) {
            return res.status(401).json({ ok: false, error: 'Credenciales inválidas' })
        }

        const sesion = await crearSesion(conn, {
            usuarioId: u.ID,
            sucursalId: u.SUCURSAL_ID ?? null,
            userAgent: req.get('user-agent'),
        })
        await conn.commit()
        limpiarIntentos(email)

        const payload = {
            id: u.ID,
            email: u.EMAIL,
            rol: u.ROL,
            rolId: u.ROLES_ID,
            empleadoId: u.EMPLEADO_ID ?? null,
            sucursalId: u.SUCURSAL_ID ?? null,
            sid: sesion.sid,
        }
        return res.json({
            ok: true,
            token: firmarAccess(payload),
            refreshToken: sesion.refreshToken,
            expiresIn: 900,
            usuario: { ...payload, nombre: u.NOMBRE, apellido: u.APELLIDO, cargo: u.CARGO ?? null },
        })
    } catch (error) {
        if (conn) {
            try { await conn.rollback() } catch { /* ignore */ }
        }
        const mapped = errorOracle(error)
        return res.status(mapped.status).json({ ok: false, error: mapped.error })
    } finally {
        if (conn) {
            try { await conn.close() } catch { /* ignore */ }
        }
    }
}

export const refresh = async (req, res) => {
    const refreshToken = String(req.body.refreshToken || '').trim()
    if (!refreshToken) {
        return res.status(400).json({ ok: false, error: 'refreshToken es obligatorio' })
    }

    let conn
    try {
        conn = await oracledb.getConnection()
        const sesion = await rotarSesion(conn, refreshToken)
        await conn.commit()
        return res.json({
            ok: true,
            token: firmarAccess(sesion.payload),
            refreshToken: sesion.refreshToken,
            expiresIn: 900,
        })
    } catch (error) {
        if (conn) {
            try {
                if (error.persistir) await conn.commit()
                else await conn.rollback()
            } catch { /* ignore */ }
        }
        if (error.statusCode) {
            return res.status(error.statusCode).json({ ok: false, error: error.message })
        }
        const mapped = errorOracle(error)
        return res.status(mapped.status).json({ ok: false, error: mapped.error })
    } finally {
        if (conn) {
            try { await conn.close() } catch { /* ignore */ }
        }
    }
}

export const logout = async (req, res) => {
    const header = req.headers.authorization || ''
    const access = header.startsWith('Bearer ') ? header.slice(7) : ''
    const refreshToken = String(req.body?.refreshToken || '').trim()
    if (!access && !refreshToken) {
        return res.status(400).json({ ok: false, error: 'Falta token o refreshToken' })
    }

    let conn
    try {
        conn = await oracledb.getConnection()
        if (access) {
            try {
                const payload = verificarAccess(access)
                if (payload?.sid) await revocar(conn, payload.sid)
            } catch {
                /* el access ya venció; el refresh igual puede revocar la fila */
            }
        }
        if (refreshToken) await revocarPorHash(conn, refreshToken)
        await conn.commit()
        return res.json({ ok: true })
    } catch (error) {
        if (conn) {
            try { await conn.rollback() } catch { /* ignore */ }
        }
        const mapped = errorOracle(error)
        return res.status(mapped.status).json({ ok: false, error: mapped.error })
    } finally {
        if (conn) {
            try { await conn.close() } catch { /* ignore */ }
        }
    }
}

export const me = async (req, res) => {
    res.json({ ok: true, usuario: req.usuario })
}

/** Alta interna: usuario + empleado. No es registro público. Solo ADMIN. */
export const registrarEmpleado = async (req, res) => {
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

    if (!nombre || !apellido || !email || !dpi || !password || !rolId || !sucursalId || !cargo || salario == null) {
        return res.status(400).json({
            ok: false,
            error: 'nombre, apellido, email, dpi, password, rolId, sucursalId, cargo y salario son obligatorios',
        })
    }
    if (password.length < 6) {
        return res.status(400).json({ ok: false, error: 'password mínimo 6 caracteres' })
    }

    let conn
    try {
        conn = await oracledb.getConnection()
        await setUsuario(conn, req.usuario.id)
        const hash = await bcrypt.hash(password, 10)

        const altaU = await conn.execute(
            `INSERT INTO F_Usuarios (Nombre, Apellido, Email, DPI, Telefono, Estado, Roles_ID, Password_hash)
       VALUES (:nombre, :apellido, :email, :dpi, :tel, 'ACTIVO', :rol, :hash)
       RETURNING ID INTO :id`,
            {
                nombre,
                apellido,
                email,
                dpi,
                tel: telefono,
                rol: { val: rolId, type: oracledb.NUMBER },
                hash,
                id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
            },
        )
        const usuarioId = Array.isArray(altaU.outBinds.id) ? altaU.outBinds.id[0] : altaU.outBinds.id

        const altaE = await conn.execute(
            `INSERT INTO F_Empleados (Cargo, Salario, Estado, Usuarios_ID, Sucursal_ID)
       VALUES (:cargo, :salario, 'ACTIVO', :usuarioId, :sucursalId)
       RETURNING ID INTO :empleadoId`,
            {
                cargo,
                salario: { val: salario, type: oracledb.NUMBER },
                usuarioId: { val: usuarioId, type: oracledb.NUMBER },
                sucursalId: { val: sucursalId, type: oracledb.NUMBER },
                empleadoId: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
            },
        )
        const empleadoId = Array.isArray(altaE.outBinds.empleadoId) ? altaE.outBinds.empleadoId[0] : altaE.outBinds.empleadoId

        await conn.commit()
        return res.status(201).json({
            ok: true,
            usuarioId,
            empleadoId,
            mensaje: 'Empleado creado. Ya puede hacer login con su email.',
        })
    } catch (error) {
        if (conn) {
            try { await conn.rollback() } catch { /* ignore */ }
        }
        const msg = error.message || ''
        if (msg.includes('F_Usuarios_Email_UK') || msg.includes('F_Usuarios_DPI_UK')) {
            return res.status(409).json({ ok: false, error: 'Email o DPI ya registrado' })
        }
        const mapped = errorOracle(error)
        return res.status(mapped.status).json({ ok: false, error: mapped.error })
    } finally {
        if (conn) {
            try { await conn.close() } catch { /* ignore */ }
        }
    }
}