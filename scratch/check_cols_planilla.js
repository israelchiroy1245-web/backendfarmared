import { oracledb, initializePool, closePool } from '../src/config/database.js'

async function checkCols() {
    await initializePool()
    const conn = await oracledb.getConnection()
    try {
        const empCols = await conn.execute(`SELECT column_name, data_type FROM user_tab_cols WHERE table_name = 'F_EMPLEADOS' ORDER BY column_id`)
        console.log('F_EMPLEADOS columns:', empCols.rows)

        const planCols = await conn.execute(`SELECT column_name, data_type FROM user_tab_cols WHERE table_name = 'F_PLANILLA' ORDER BY column_id`)
        console.log('F_PLANILLA columns:', planCols.rows)

        const empSample = await conn.execute(`SELECT e.ID, e.Salario, e.Cargo, e.Estado, e.SUCURSAL_ID, u.Nombre, u.Apellido FROM F_Empleados e JOIN F_Usuarios u ON u.ID = e.Usuarios_ID`)
        console.log('Sample employees:', empSample.rows)

        const planCount = await conn.execute(`SELECT COUNT(*) as TOTAL FROM F_Planilla`)
        console.log('F_Planilla count:', planCount.rows)
    } finally {
        await conn.close()
        await closePool()
    }
}
checkCols()
