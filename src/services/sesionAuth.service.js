import crypto from 'crypto'
import { oracledb } from '../config/database.js'
import { nbind } from '../utils/oracle.js'

const ROLES_CON_SUCURSAL = ['CAJERO', 'ENCARGADO', 'QF']

function horasRefresh() {
    const n = Number(process.env.REFRESH_HOURS)
    return Number.isFinite(n) && n > 0 ? n : 12
}

export function hashRefresh(raw) {
    return crypto.createHash('sha256').update(String(raw)).digest('hex')
}

export function nuevoRefresh() {
    return crypto.randomBytes(32).toString('hex')
}

export function rolExigeSucursal(rol) {
    return ROLES_CON_SUCURSAL.includes(String(rol || '').toUpperCase())
}

function falloSesion(mensaje, persistir = false) {
    const err = new Error(mensaje)
    err.statusCode = 401
    err.persistir = persistir
    return err
}

/** Una sesión por persona: el login nuevo revoca las filas anteriores del mismo usuario. */
export async function crearSesion(conn, { usuarioId, sucursalId, userAgent }) {
    await revocarTodas(conn, usuarioId)
    const refreshToken = nuevoRefresh()
    const alta = await conn.execute(
        `INSERT INTO F_Sesion (F_Usuarios_ID, Refresh_hash, Sucursal_ID, User_agent, Expira)
         VALUES (:usuarioId, :hash, :sucursalId, :ua, SYSTIMESTAMP + NUMTODSINTERVAL(:horas, 'HOUR'))
         RETURNING ID INTO :sid`,
        {
            usuarioId: nbind(usuarioId),
            hash: hashRefresh(refreshToken),
            sucursalId: sucursalId == null ? { val: null, type: oracledb.NUMBER } : nbind(sucursalId),
            ua: userAgent ? String(userAgent).slice(0, 250) : null,
            horas: nbind(horasRefresh()),
            sid: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
        },
    )
    const sid = Array.isArray(alta.outBinds.sid) ? alta.outBinds.sid[0] : alta.outBinds.sid
    return { sid, refreshToken }
}

export async function rotarSesion(conn, raw) {
    const actual = await conn.execute(
        `SELECT ID, F_Usuarios_ID, Sucursal_ID, Revocada,
                CASE WHEN Expira < SYSTIMESTAMP THEN 1 ELSE 0 END AS VENCIDA
           FROM F_Sesion
          WHERE Refresh_hash = :hash
          FOR UPDATE`,
        { hash: hashRefresh(raw) },
    )
    const fila = actual.rows?.[0]
    if (!fila || Number(fila.REVOCADA) === 1 || Number(fila.VENCIDA) === 1) {
        throw falloSesion('Sesión revocada o vencida')
    }

    const usuario = await conn.execute(
        `SELECT u.ID, u.Email, u.Estado, u.Roles_ID, r.Nombre AS ROL,
                e.ID AS EMPLEADO_ID, e.Sucursal_ID AS EMP_SUCURSAL
           FROM F_Usuarios u
           JOIN F_Roles r ON r.ID = u.Roles_ID
           LEFT JOIN F_Empleados e ON e.Usuarios_ID = u.ID AND e.Estado = 'ACTIVO'
          WHERE u.ID = :id`,
        { id: nbind(fila.F_USUARIOS_ID) },
    )
    const u = usuario.rows?.[0]
    const rol = String(u?.ROL || '').toUpperCase()
    const inactivo = !u || u.ESTADO !== 'ACTIVO'
    const sinSucursal = Boolean(u) && rolExigeSucursal(rol) && (u.EMPLEADO_ID == null || u.EMP_SUCURSAL == null)
    if (inactivo || sinSucursal) {
        await revocar(conn, fila.ID)
        throw falloSesion('Sesión revocada o vencida', true)
    }

    const refreshToken = nuevoRefresh()
    await conn.execute(
        `UPDATE F_Sesion
            SET Refresh_hash = :hash,
                Fecha_uso = SYSTIMESTAMP
          WHERE ID = :sid`,
        { hash: hashRefresh(refreshToken), sid: nbind(fila.ID) },
    )

    return {
        sid: fila.ID,
        refreshToken,
        payload: {
            id: u.ID,
            email: u.EMAIL,
            rol: u.ROL,
            rolId: u.ROLES_ID,
            empleadoId: u.EMPLEADO_ID ?? null,
            sucursalId: u.EMP_SUCURSAL ?? fila.SUCURSAL_ID ?? null,
            sid: fila.ID,
        },
    }
}

export async function revocar(conn, sid) {
    await conn.execute(
        `UPDATE F_Sesion SET Revocada = 1 WHERE ID = :sid`,
        { sid: nbind(sid) },
    )
}

export async function revocarTodas(conn, usuarioId) {
    await conn.execute(
        `UPDATE F_Sesion SET Revocada = 1 WHERE F_Usuarios_ID = :id AND Revocada = 0`,
        { id: nbind(usuarioId) },
    )
}

export async function revocarPorHash(conn, raw) {
    if (!raw) return 0
    const result = await conn.execute(
        `UPDATE F_Sesion SET Revocada = 1 WHERE Refresh_hash = :hash AND Revocada = 0`,
        { hash: hashRefresh(raw) },
    )
    return result.rowsAffected || 0
}
