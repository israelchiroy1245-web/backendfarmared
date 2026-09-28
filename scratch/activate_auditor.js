import { oracledb, initializePool, closePool } from '../src/config/database.js'

async function activateAuditor() {
    await initializePool()
    const conn = await oracledb.getConnection()
    try {
        await conn.execute(`UPDATE F_Usuarios SET Estado = 'ACTIVO' WHERE Email = 'auditor@farmared.gt'`)
        await conn.commit()
        console.log('Auditor activado correctamente.')
    } finally {
        await conn.close()
        await closePool()
    }
}
activateAuditor()
