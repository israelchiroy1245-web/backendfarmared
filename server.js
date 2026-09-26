import 'dotenv/config';
import express from 'express';
import cors from "cors";
import { initializePool, closePool } from './src/config/database.js';

const app = express();
app.use(cors());
app.use(express.json());

app.get("/api/health", (_req, res) => res.json({ ok: true }));
import authRoutes from './src/routes/auth.routes.js'
app.use('/api/auth', authRoutes)
import ventasRoutes from './src/routes/ventas.routes.js'
app.use('/api/ventas', ventasRoutes)
import dashboardRoutes from './src/routes/dashboard.routes.js'
app.use('/api/dashboard', dashboardRoutes)

//Inicia servidor y base de datos
async function startServer() {
    await initializePool();

    const PORT = process.env.PORT || 3000;

    app.listen(PORT, () => console.log(`API en http://localhost:${PORT}`));

}

startServer().catch((error) => {
    console.error("error al iniciar el servidor", error.message);
    process.exit(1);
});

//Manejo del cierre del servidor
async function shutdown() {
    await closePool();
    process.exit(0);
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);