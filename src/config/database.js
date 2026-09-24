import oracledb from "oracledb";
import 'dotenv/config';


oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
oracledb.autoCommit = false;

export async function initializePool() {
    await oracledb.createPool({
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        connectString: process.env.DB_CONNECTION_STRING,
        poolMin: 2,
        poolMax: 10,
        poolIncrement: 2,
        poolTimeout: 60
    });
    console.log("Pool de conexión a Oracle creado exitosamente");
}

export async function closePool() {
    try {
        await oracledb.getPool().close(10) // 10 segundos antes de forzar el cierre 
        console.log('cierre limpio del pool de oracledb');
    } catch (error) {
        console.error("Error al cerrar el pool de conexion a oracle:", error.message);
    }
}

export { oracledb };