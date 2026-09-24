import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import oracledb from 'oracledb';

const app = express();

// Middlewares
app.use(cors());
app.use(express.json());

// Inicializar conexión a Oracle
async function initDB() {
    try {
        await oracledb.createPool({
            user: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            connectString: process.env.DB_CONNECTION_STRING
        });
        console.log("Conexión a Oracle XE establecida con éxito.");
    } catch (error) {
        console.error("Error conectando a Oracle:", error);
    }
}

// Levantar el servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, async () => {
    console.log(`Servidor Node.js corriendo en http://localhost:${PORT}`);
    await initDB();
});