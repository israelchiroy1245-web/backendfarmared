import bcrypt from 'bcryptjs'
import { oracledb } from '../config/database.js'
import { firmarToken } from '../middlewares/auth.js'
import { errorOracle, num } from '../utils/oracle.js'
import { setUsuario } from '../services/sesion.js'

function fila(row) {
    return row || null
}

export const login = async (req, res) => {
    const email = String(req.body.email || req.body.usuario || '').trim()
    const password = String(req.body.password || '')
    if (!email || !password) {
        return res.status(400).json({ ok: false, error: 'correo y password son obligatorios' })
    }

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
        if (!u || u.ESTADO !== 'ACTIVO') {
            return res.status(401).json({ ok: false, error: 'Credenciales inválidas' })
        }
        const okPass = await bcrypt.compare(password, u.PASSWORD_HASH)
        if (!okPass) {
            return res.status(401).json({ ok: false, error: 'Credenciales inválidas' })
        }

        const payload = {
            id: u.ID,
            email: u.EMAIL,
            rol: u.ROL,
            rolId: u.ROLES_ID,
            empleadoId: u.EMPLEADO_ID ?? null,
            sucursalId: u.SUCURSAL_ID ?? null,
        }
        const token = firmarToken(payload)
        return res.json({
            ok: true,
            token,
            usuario: { ...payload, nombre: u.NOMBRE, apellido: u.APELLIDO, cargo: u.CARGO ?? null },
        })
    } catch (error) {
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
       VALUES (:cargo, :salario, 'ACTIVO', :uid, :suc)
       RETURNING ID INTO :id`,
            {
                cargo,
                salario: { val: salario, type: oracledb.NUMBER },
                uid: { val: usuarioId, type: oracledb.NUMBER },
                suc: { val: sucursalId, type: oracledb.NUMBER },
                id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
            },
        )
        const empleadoId = Array.isArray(altaE.outBinds.id) ? altaE.outBinds.id[0] : altaE.outBinds.id

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