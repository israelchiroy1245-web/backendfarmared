import { oracledb, initializePool, closePool } from '../src/config/database.js'

async function checkActivos() {
    await initializePool()
    const conn = await oracledb.getConnection()
    try {
        const rows = await conn.execute(`SELECT ID, Codigo, Nombre, Categoria, Valor_adquisicion, TO_CHAR(Fecha_adquisicion, 'YYYY-MM-DD') as Fecha, Vida_util_meses, Valor_residual, Depreciacion_acumulada, Estado, F_Sucursal_ID FROM F_Activo_fijo ORDER BY ID FETCH FIRST 5 ROWS ONLY`)
        console.log('Sample Activos:', rows.rows)
        const count = await conn.execute(`SELECT COUNT(*) as TOTAL FROM F_Activo_fijo`)
        console.log('Total Activos:', count.rows)
    } finally {
        await conn.close()
        await closePool()
    }
}
checkActivos()
