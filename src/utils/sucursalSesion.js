import { num } from './oracle.js'

export function rolDe(req) {
    return String((req.usuario || req.user)?.rol || '').toUpperCase()
}

export function sucursalDelToken(req) {
    return num((req.usuario || req.user)?.sucursalId ?? (req.usuario || req.user)?.sucursal_id)
}

/** CAJERO: siempre su sucursal. Otros: la que pidieron (puede ser null en listados). */
export function resolverSucursal(req, pedida) {
    const rol = rolDe(req)
    const propia = sucursalDelToken(req)
    const n = num(pedida)

    if (rol === 'CAJERO') {
        if (!propia) {
            const err = new Error('El cajero no tiene sucursal asignada')
            err.statusCode = 403
            throw err
        }
        if (n && n !== propia) {
            const err = new Error('Solo puede operar en su sucursal asignada')
            err.statusCode = 403
            throw err
        }
        return propia
    }
    return n
}
