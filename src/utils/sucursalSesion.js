import { num } from './oracle.js'

const ROLES_LOCALES = ['CAJERO', 'ENCARGADO', 'QF']

export function rolDe(req) {
    return String(req.usuario?.rol || req.user?.rol || '').toUpperCase()
}

export function sucursalDelToken(req) {
    return num(req.usuario?.sucursalId ?? req.user?.sucursalId)
}

export function sucursalFijadaEnApi(req) {
    return ROLES_LOCALES.includes(rolDe(req))
}

/**
 * CAJERO, ENCARGADO y QF solo operan en la sucursal del token.
 * El resto puede pedir una sucursal o ninguna (todas).
 */
export function resolverSucursal(req, pedida) {
    const propia = sucursalDelToken(req)
    const n = num(pedida)
    if (sucursalFijadaEnApi(req)) {
        if (!propia) {
            const err = new Error('El usuario no tiene sucursal asignada')
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
