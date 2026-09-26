import { oracledb } from '../config/database.js'
import { errorOracle } from '../utils/oracle.js'

function num(row, key) {
    const n = Number(row?.[key] ?? 0)
    return Number.isFinite(n) ? n : 0
}

export const resumen = async (_req, res) => {
    let conn
    try {
        conn = await oracledb.getConnection()

        const sucursales = await conn.execute(
            `SELECT COUNT(*) AS N FROM F_Sucursal WHERE Estado = 'ACTIVA'`,
        )
        const inventario = await conn.execute(
            `SELECT NVL(SUM(i.Cantidad * m.Costo), 0) AS COSTO,
                    NVL(SUM(i.Cantidad * m.Precio_venta), 0) AS VENTA
               FROM F_Inventario i
               JOIN F_Medicamentos m ON m.ID = i.F_Medicamentos_ID`,
        )
        const caja = await conn.execute(
            `SELECT NVL(SUM(Ventas_efectivo), 0) AS EFECTIVO,
                    NVL(SUM(Ventas_tarjeta), 0) AS TARJETA,
                    NVL(SUM(Gastos), 0) AS GASTOS,
                    NVL(SUM(CASE WHEN Estado = 'ABIERTA' THEN 1 ELSE 0 END), 0) AS ABIERTOS
               FROM F_Turno_caja`,
        )
        const planilla = await conn.execute(
            `SELECT NVL(SUM(Total), 0) AS TOTAL, MAX(Periodo) AS PERIODO FROM F_Planilla`,
        )
        const activos = await conn.execute(
            `SELECT NVL(SUM(Valor_adquisicion), 0) AS ADQUISICION,
                    NVL(SUM(Valor_adquisicion - NVL(Depreciacion_acumulada, 0)), 0) AS LIBROS
               FROM F_Activo_fijo`,
        )
        const ventas = await conn.execute(
            `SELECT s.Codigo AS CODIGO,
                    NVL(SUM(NVL(t.Ventas_efectivo, 0) + NVL(t.Ventas_tarjeta, 0)), 0) AS VENTAS
               FROM F_Sucursal s
               LEFT JOIN F_Turno_caja t ON t.F_Sucursal_ID = s.ID
              GROUP BY s.Codigo
              ORDER BY s.Codigo`,
        )
        const alertas = await conn.execute(
            `SELECT * FROM (
               SELECT s.ID AS SUCURSAL_ID,
                      m.Codigo_barra AS SKU,
                      m.Nombre_medic AS PRODUCTO,
                      s.Nombre AS SUCURSAL,
                      SUM(i.Cantidad) AS CANTIDAD,
                      MAX(i.Stock_minimo) AS STOCK_MINIMO
                 FROM F_Inventario i
                 JOIN F_Sucursal s ON s.ID = i.F_Sucursal_ID
                 JOIN F_Medicamentos m ON m.ID = i.F_Medicamentos_ID
                GROUP BY s.ID, m.Codigo_barra, m.Nombre_medic, s.Nombre
               HAVING SUM(i.Cantidad) <= MAX(i.Stock_minimo)
                ORDER BY SUM(i.Cantidad), s.Nombre
             ) WHERE ROWNUM <= 20`,
        )

        const cajaRow = caja.rows?.[0]
        const efectivo = num(cajaRow, 'EFECTIVO')
        const tarjeta = num(cajaRow, 'TARJETA')

        return res.json({
            ok: true,
            sucursales_activas: num(sucursales.rows?.[0], 'N'),
            inventario: {
                valor_costo: num(inventario.rows?.[0], 'COSTO'),
                valor_venta: num(inventario.rows?.[0], 'VENTA'),
            },
            caja: {
                ventas: efectivo + tarjeta,
                turnos_abiertos: num(cajaRow, 'ABIERTOS'),
                efectivo,
                tarjeta,
                gastos: num(cajaRow, 'GASTOS'),
            },
            planilla: {
                total: num(planilla.rows?.[0], 'TOTAL'),
                periodo: planilla.rows?.[0]?.PERIODO || '—',
            },
            activos: {
                libros: num(activos.rows?.[0], 'LIBROS'),
                adquisicion: num(activos.rows?.[0], 'ADQUISICION'),
            },
            entregas: { pendientes: 0, entregados: 0 },
            transferencias: { transito: 0 },
            ventas_por_sucursal: (ventas.rows || []).map((r) => ({
                codigo: r.CODIGO,
                ventas: num(r, 'VENTAS'),
            })),
            alertas: (alertas.rows || []).map((a) => ({
                sucursal_id: a.SUCURSAL_ID,
                sku: a.SKU,
                producto: a.PRODUCTO,
                sucursal: a.SUCURSAL,
                cantidad: num(a, 'CANTIDAD'),
                stock_minimo: num(a, 'STOCK_MINIMO'),
            })),
        })
    } catch (error) {
        const mapped = errorOracle(error)
        return res.status(mapped.status).json({ ok: false, error: mapped.error })
    } finally {
        if (conn) {
            try { await conn.close() } catch { /* ignore */ }
        }
    }
}
