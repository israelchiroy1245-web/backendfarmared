import jwt from 'jsonwebtoken'

function secreto() {
    const valor = process.env.JWT_SECRET
    if (!valor) {
        throw new Error('JWT_SECRET no está definido')
    }
    return valor
}

export function requireAuth(req, res, next) {
    const header = req.headers.authorization || ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : null
    if (!token) {
        return res.status(401).json({ ok: false, error: 'Falta token. Haga POST /api/auth/login' })
    }
    try {
        req.usuario = jwt.verify(token, secreto())
        next()
    } catch (error) {
        if (String(error.message || '').includes('JWT_SECRET')) {
            return res.status(500).json({ ok: false, error: 'JWT_SECRET no está definido' })
        }
        return res.status(401).json({ ok: false, error: 'Token inválido o vencido' })
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

