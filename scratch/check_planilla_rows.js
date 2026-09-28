import { oracledb, initializePool, closePool } from '../src/config/database.js'

async function checkPlanilla() {
    await initializePool()
    const conn = await oracledb.getConnection()
    try {
        const rows = await conn.execute(`SELECT p.ID, p.Periodo, p.Salario_base, p.Bonificaciones, p.Descuentos, p.Igss, p.Total, TO_CHAR(p.Fecha_pago, 'YYYY-MM-DD') as Fecha_pago, p.Estado, p.F_Empleados_ID FROM F_Planilla p`)
        console.log('F_Planilla rows:', rows.rows)
    } finally {
        await conn.close()
        await closePool()
    }
}
checkPlanilla()
