import jwt from 'jsonwebtoken'
import { oracledb } from '../config/database.js'
import { errorOracle, nbind, num } from '../utils/oracle.js'

function secreto() {
    const valor = process.env.JWT_SECRET
    if (!valor) {
        throw new Error('JWT_SECRET no está definido')
    }
    return valor
}

export async function requireAuth(req, res, next) {
    const header = req.headers.authorization || ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : null
    if (!token) {
        return res.status(401).json({ ok: false, error: 'Falta token. Haga POST /api/auth/login' })
    }

    let payload
    try {
        payload = jwt.verify(token, secreto())
    } catch (error) {
        if (String(error.message || '').includes('JWT_SECRET')) {
            return res.status(500).json({ ok: false, error: 'JWT_SECRET no está definido' })
        }
        return res.status(401).json({ ok: false, error: 'Token inválido o vencido' })
    }

    const sid = num(payload?.sid)
    if (!sid) {
        return res.status(401).json({ ok: false, error: 'Token inválido o vencido' })
    }

    let conn
    try {
        conn = await oracledb.getConnection()
        const q = await conn.execute(
            `SELECT Revocada, Expira,
                    CASE WHEN Expira < SYSTIMESTAMP THEN 1 ELSE 0 END AS VENCIDA
               FROM F_Sesion
              WHERE ID = :sid`,
            { sid: nbind(sid) },
        )
        const fila = q.rows?.[0]
        if (!fila || Number(fila.REVOCADA) === 1 || Number(fila.VENCIDA) === 1) {
            return res.status(401).json({ ok: false, error: 'Sesión revocada o vencida' })
        }
        req.usuario = payload
        return next()
    } catch (error) {
        const mapped = errorOracle(error)
        return res.status(mapped.status).json({ ok: false, error: mapped.error })
    } finally {
        if (conn) {
            try { await conn.close() } catch { /* ignore */ }
        }
    }
}

export function requireRol(...roles) {
    const permitidos = roles.map((r) => String(r).toUpperCase())
    return (req, res, next) => {
        const rol = String(req.usuario?.rol || '').toUpperCase()
        if (!permitidos.includes(rol)) {
            return res.status(403).json({ ok: false, error: `Requiere rol: ${permitidos.join(', ')}` })
        }
        next()
    }
}

export function firmarAccess(payload) {
    return jwt.sign(payload, secreto(), {
        expiresIn: process.env.JWT_EXPIRES || '15m',
    })
}

export function firmarToken(payload) {
    return firmarAccess(payload)
}

export function verificarAccess(token) {
    return jwt.verify(token, secreto())
}

