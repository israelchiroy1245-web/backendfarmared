import { oracledb, initializePool, closePool } from '../src/config/database.js'

async function checkUsers() {
    await initializePool()
    const conn = await oracledb.getConnection()
    try {
        const res = await conn.execute(`SELECT u.ID, u.Email, u.Estado, r.Nombre as ROL FROM F_Usuarios u JOIN F_Roles r ON r.ID = u.Roles_ID`)
        console.log(res.rows)
    } finally {
        await conn.close()
        await closePool()
    }
}
checkUsers()
