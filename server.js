import 'dotenv/config';
import express from 'express';
import cors from "cors";
import { initializePool, closePool } from './src/config/database.js';

const app = express();
app.use(cors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
    credentials: false,
}));
app.use(express.json({ limit: '100kb' }));

app.get("/api/health", (_req, res) => res.json({ ok: true }));
import authRoutes from './src/routes/auth.routes.js'
app.use('/api/auth', authRoutes)

//Rutas de Dashboard
import dashboardRoutes from './src/routes/dashboard.routes.js'
app.use('/api/dashboard', dashboardRoutes)

//Rutas de Usuarios
import usuariosRoutes from './src/routes/usuarios.routes.js'
app.use('/api/usuarios', usuariosRoutes)

//Rutas de Empleados (1b)
import empleadosRoutes from './src/routes/empleados.routes.js'
app.use('/api/empleados', empleadosRoutes)

//Rutas de Roles
import rolesRoutes from './src/routes/roles.routes.js'
app.use('/api/roles', rolesRoutes)

//Rutas de Permisos
import permisosRoutes from './src/routes/permisos.routes.js'
app.use('/api/permisos', permisosRoutes)

//Rutas de Sucursales
import sucursalesRoutes from './src/routes/sucursales.routes.js'
app.use('/api/sucursales', sucursalesRoutes)

//Rutas de Inventario
import inventarioRoutes from './src/routes/inventario.routes.js'
app.use('/api/inventario', inventarioRoutes)

//Rutas de Compras
import comprasRoutes from './src/routes/compras.routes.js'
app.use('/api/compras', comprasRoutes)

//Rutas de Proveedores
import proveedoresRoutes from './src/routes/proveedores.routes.js'
app.use('/api/proveedores', proveedoresRoutes)

import medicamentosRoutes from './src/routes/medicamentos.routes.js'
app.use('/api/medicamentos', medicamentosRoutes)

//Rutas de Caja & Turnos (Módulo 4) — antes que el POS
import cajaRoutes from './src/routes/caja.routes.js'
app.use('/api/caja', cajaRoutes)

//Rutas de Ventas POS (Módulo 5)
import ventasRoutes from './src/routes/ventas.routes.js'
app.use('/api/ventas', ventasRoutes)

//Rutas de Transferencias
import transferenciasRoutes from './src/routes/transferencias.routes.js'
app.use('/api/transferencias', transferenciasRoutes)

//Rutas de Catálogos de Apoyo
import catalogosRoutes from './src/routes/catalogos.routes.js'
app.use('/api/catalogos', catalogosRoutes)

//Rutas de Planilla (Módulo 7)
import planillaRoutes from './src/routes/planilla.routes.js'
app.use('/api/planilla', planillaRoutes)

//Rutas de Activos Fijos (Módulo 8)
import activosRoutes from './src/routes/activos.routes.js'
app.use('/api/activos', activosRoutes)

//Rutas de Call Center & Pedidos a Domicilio (Módulo 9)
import pedidosRoutes from './src/routes/pedidos.routes.js'
app.use('/api/pedidos', pedidosRoutes)
app.use('/api/call-center', pedidosRoutes)

//Rutas de Reportes Gerenciales (Módulo 10)
import reportesRoutes from './src/routes/reportes.routes.js'
app.use('/api/reportes', reportesRoutes)

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