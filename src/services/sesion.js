import { oracledb } from '../config/database.js'

export async function setUsuario(conn, usuarioId) {
    await conn.execute(`BEGIN pkg_sesion.set_usuario(:id); END;`, {
        id: { val: usuarioId, type: oracledb.NUMBER },
    })
}

export async function empleadoActivoDeUsuario(conn, usuarioId) {
    const emp = await conn.execute(
        `SELECT ID FROM F_Empleados WHERE Usuarios_ID = :u AND Estado = 'ACTIVO' AND ROWNUM = 1`,
        { u: { val: usuarioId, type: oracledb.NUMBER } },
    )
    return emp.rows?.[0]?.ID ?? null
}
