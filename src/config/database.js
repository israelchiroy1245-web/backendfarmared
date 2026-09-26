import oracledb from "oracledb"
import 'dotenv/config'

oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
oracledb.autoCommit = false;

const connectString =
    process.env.DB_CONNECTION_STRING ||
    process.env.ORACLE_CONNECT_STRING ||
    `${process.env.ORACLE_HOST || 'localhost'}:${process.env.ORACLE_PORT || 1521}/${process.env.ORACLE_SERVICE || 'XEPDB1'}`

export async function initializePool() {
    await oracledb.createPool({
        user: process.env.DB_USER || 'farmred',
        password: process.env.DB_PASSWORD || 'farmred',
        connectString,
        poolMin: 1,
        poolMax: 8,
        poolIncrement: 1,
    })
}

export async function closePool() {
    await oracledb.getPool().close(0)
}

export { oracledb }