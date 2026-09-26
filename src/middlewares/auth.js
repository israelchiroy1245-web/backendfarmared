import jwt from 'jsonwebtoken'

const secreto = () => process.env.JWT_SECRET || 'farmared-dev'

export function requireAuth(req, res, next) {
    const header = req.headers.authorization || ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : null
    if (!token) {
        return res.status(401).json({ ok: false, error: 'Falta token. Haga POST /api/auth/login' })
    }
    try {
        req.usuario = jwt.verify(token, secreto())
        next()
    } catch {
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

export function firmarToken(payload) {
    return jwt.sign(payload, secreto(), { expiresIn: process.env.JWT_EXPIRES || '8h' })
}

