import { oracledb } from '../config/database.js'

export function num(v) {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
}

export function nbind(val) {
    return { val, type: oracledb.NUMBER }
}

export function errorOracle(error) {
    const msg = error.message || String(error)
    if (msg.includes('ORA-20001')) return { status: 400, error: 'La cantidad debe ser positiva' }
    if (msg.includes('ORA-20002')) return { status: 409, error: 'Stock insuficiente (FEFO, sin vencidos)' }
    if (msg.includes('ORA-20003')) return { status: 409, error: 'Solo se envían transferencias solicitadas' }
    if (msg.includes('ORA-20004')) return { status: 409, error: 'Solo se reciben transferencias en tránsito' }
    if (msg.includes('ORA-20005')) return { status: 409, error: 'Stock insuficiente en origen para la transferencia' }
    if (msg.includes('ORA-00001')) return { status: 409, error: 'Registro duplicado (violación de restricción única)' }
    if (msg.includes('ORA-02292')) return { status: 409, error: 'No se puede eliminar el registro porque tiene datos relacionados dependientes' }
    if (msg.includes('ORA-01403')) return { status: 404, error: 'No se encontró el registro' }
    return { status: 500, error: msg }
}

