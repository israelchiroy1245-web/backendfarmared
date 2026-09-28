import { oracledb } from '../config/database.js'
import { num, nbind } from '../utils/oracle.js'

/**
 * CU04: Reporte Ejecutivo del Valor Consolidado de la Red de Farmacias
 * Suma: Inventario a costo + Activos fijos en libros + Gasto de nómina mensual
 * Proporciona el valor patrimonial y operativo para la preparación hacia bolsa (~US$ 5M)
 */
export async function reporteConsolidadoRed() {
    let conn
    try {
        conn = await oracledb.getConnection()

        // 1. Sucursales activas
        const resSuc = await conn.execute(
            `SELECT COUNT(*) AS TOTAL,
                    SUM(CASE WHEN Tipo = 'MALL' THEN 1 ELSE 0 END) AS MALL,
                    SUM(CASE WHEN Tipo = 'TRADICIONAL' THEN 1 ELSE 0 END) AS TRADICIONAL,
                    SUM(CASE WHEN Tipo = 'GASOLINERA' THEN 1 ELSE 0 END) AS GASOLINERA
             FROM F_Sucursal WHERE Estado = 'ACTIVA'`
        )
        const suc = resSuc.rows?.[0] || {}

        // 2. Inventario valorizado (a costo y precio de venta)
        const resInv = await conn.execute(
            `SELECT 
                NVL(SUM(i.Cantidad), 0) AS UNIDADES_TOTALES,
                NVL(SUM(i.Cantidad * m.Costo), 0) AS VALOR_COSTO,
                NVL(SUM(i.Cantidad * m.Precio_venta), 0) AS VALOR_VENTA,
                NVL(SUM(i.Cantidad * (m.Precio_venta - m.Costo)), 0) AS MARGEN_POTENCIAL
             FROM F_Inventario i
             JOIN F_Medicamentos m ON m.ID = i.F_Medicamentos_ID`
        )
        const inv = resInv.rows?.[0] || {}

        // 3. Activos fijos (valor de adquisición vs valor en libros)
        const resAct = await conn.execute(
            `SELECT 
                COUNT(*) AS TOTAL_ACTIVOS,
                NVL(SUM(Valor_adquisicion), 0) AS VALOR_ADQUISICION,
                NVL(SUM(Depreciacion_acumulada), 0) AS DEPRECIACION_ACUMULADA,
                NVL(SUM(Valor_adquisicion - Depreciacion_acumulada), 0) AS VALOR_LIBROS
             FROM F_Activo_fijo
             WHERE Estado <> 'BAJA'`
        )
        const act = resAct.rows?.[0] || {}

        // 4. Planilla mensual consolidada
        const resPlan = await conn.execute(
            `SELECT 
                MAX(Periodo) AS ULTIMO_PERIODO,
                NVL(SUM(CASE WHEN Periodo = (SELECT MAX(Periodo) FROM F_Planilla) THEN Total ELSE 0 END), 0) AS TOTAL_PLANILLA_MES,
                NVL(SUM(CASE WHEN Periodo = (SELECT MAX(Periodo) FROM F_Planilla) THEN Igss ELSE 0 END), 0) AS IGSS_PATRONAL_LABORAL
             FROM F_Planilla`
        )
        const plan = resPlan.rows?.[0] || {}

        // 5. Flujo de efectivo en caja actual
        const resCaja = await conn.execute(
            `SELECT 
                NVL(SUM(Ventas_efectivo), 0) AS VENTAS_EFECTIVO,
                NVL(SUM(Ventas_tarjeta), 0) AS VENTAS_TARJETA,
                NVL(SUM(Gastos), 0) AS GASTOS,
                NVL(SUM(Diferencia), 0) AS DIFERENCIA_TOTAL
             FROM F_Turno_caja`
        )
        const caja = resCaja.rows?.[0] || {}

        // 6. Desglose patrimonial por sucursal
        const resDesglose = await conn.execute(
            `SELECT 
                s.ID AS SUCURSAL_ID,
                s.Codigo AS SUCURSAL_CODIGO,
                s.Nombre AS SUCURSAL_NOMBRE,
                s.Tipo AS SUCURSAL_TIPO,
                NVL((SELECT SUM(i.Cantidad * m.Costo) 
                     FROM F_Inventario i 
                     JOIN F_Medicamentos m ON m.ID = i.F_Medicamentos_ID 
                     WHERE i.F_Sucursal_ID = s.ID), 0) AS INVENTARIO_COSTO,
                NVL((SELECT SUM(a.Valor_adquisicion - a.Depreciacion_acumulada) 
                     FROM F_Activo_fijo a 
                     WHERE a.F_Sucursal_ID = s.ID AND a.Estado <> 'BAJA'), 0) AS ACTIVOS_LIBROS
             FROM F_Sucursal s
             WHERE s.Estado = 'ACTIVA'
             ORDER BY s.ID ASC`
        )

        const valorInventario = Number(inv.VALOR_COSTO) || 0
        const valorActivosLibros = Number(act.VALOR_LIBROS) || 0
        const valorPatrimonialRed = Math.round((valorInventario + valorActivosLibros) * 100) / 100
        const tasaCambioGTQ_USD = 7.75 // Referencia Banco de Guatemala
        const valorConsolidadoUSD = Math.round((valorPatrimonialRed / tasaCambioGTQ_USD) * 100) / 100

        return {
            fechaReporte: new Date().toISOString(),
            resumenPatrimonial: {
                valorConsolidadoGTQ: valorPatrimonialRed,
                valorConsolidadoUSD,
                tasaCambioReferencia: tasaCambioGTQ_USD,
                inventarioCosto: valorInventario,
                activosFijosLibros: valorActivosLibros,
                planillaMensual: Number(plan.TOTAL_PLANILLA_MES) || 0,
                ultimoPeriodoPlanilla: plan.ULTIMO_PERIODO || '—'
            },
            sucursales: {
                totalActivas: Number(suc.TOTAL) || 0,
                mall: Number(suc.MALL) || 0,
                tradicional: Number(suc.TRADICIONAL) || 0,
                gasolinera: Number(suc.GASOLINERA) || 0
            },
            inventario: {
                unidadesTotales: Number(inv.UNIDADES_TOTALES) || 0,
                valorCosto: valorInventario,
                valorVenta: Number(inv.VALOR_VENTA) || 0,
                margenPotencial: Number(inv.MARGEN_POTENCIAL) || 0
            },
            activosFijos: {
                totalActivos: Number(act.TOTAL_ACTIVOS) || 0,
                valorAdquisicion: Number(act.VALOR_ADQUISICION) || 0,
                depreciacionAcumulada: Number(act.DEPRECIACION_ACUMULADA) || 0,
                valorLibros: valorActivosLibros
            },
            cajaYFlujo: {
                ventasEfectivo: Number(caja.VENTAS_EFECTIVO) || 0,
                ventasTarjeta: Number(caja.VENTAS_TARJETA) || 0,
                gastos: Number(caja.GASTOS) || 0,
                diferenciaNeta: Number(caja.DIFERENCIA_TOTAL) || 0
            },
            desglosePorSucursal: (resDesglose.rows || []).map(r => ({
                sucursalId: r.SUCURSAL_ID,
                codigo: r.SUCURSAL_CODIGO,
                nombre: r.SUCURSAL_NOMBRE,
                tipo: r.SUCURSAL_TIPO,
                inventarioCosto: Number(r.INVENTARIO_COSTO) || 0,
                activosLibros: Number(r.ACTIVOS_LIBROS) || 0,
                totalSucursal: Math.round(((Number(r.INVENTARIO_COSTO) || 0) + (Number(r.ACTIVOS_LIBROS) || 0)) * 100) / 100
            }))
        }
    } finally {
        if (conn) {
            try { await conn.close() } catch (_) {}
        }
    }
}

/**
 * Reporte de Ventas por Sucursal, Fechas y Forma de Pago
 */
export async function reporteVentas({ sucursalId, fechaInicio, fechaFin }) {
    let conn
    try {
        conn = await oracledb.getConnection()

        let sql = `
            SELECT 
                s.ID AS SUCURSAL_ID,
                s.Nombre AS SUCURSAL_NOMBRE,
                s.Tipo AS SUCURSAL_TIPO,
                COUNT(v.ID) AS TOTAL_TRANSACCIONES,
                NVL(SUM(v.Total), 0) AS TOTAL_VENTAS,
                NVL(SUM(CASE WHEN v.Metodo_pago = 'EFECTIVO' THEN v.Total ELSE 0 END), 0) AS VENTAS_EFECTIVO,
                NVL(SUM(CASE WHEN v.Metodo_pago = 'TARJETA' THEN v.Total ELSE 0 END), 0) AS VENTAS_TARJETA,
                NVL(SUM(CASE WHEN v.Metodo_pago = 'TRANSFERENCIA' THEN v.Total ELSE 0 END), 0) AS VENTAS_TRANSFERENCIA
            FROM F_Sucursal s
            LEFT JOIN F_Ventas v ON v.F_Sucursal_ID = s.ID AND v.Estado = 'COMPLETADA'
        `
        const binds = {}

        if (fechaInicio) {
            sql += ` AND v.Fecha >= TO_DATE(:fIni, 'YYYY-MM-DD')`
            binds.fIni = String(fechaInicio).trim()
        }
        if (fechaFin) {
            sql += ` AND v.Fecha < TO_DATE(:fFin, 'YYYY-MM-DD') + 1`
            binds.fFin = String(fechaFin).trim()
        }
        if (sucursalId) {
            sql += ` WHERE s.ID = :sucId`
            binds.sucId = nbind(sucursalId)
        }

        sql += ` GROUP BY s.ID, s.Nombre, s.Tipo ORDER BY TOTAL_VENTAS DESC`

        const res = await conn.execute(sql, binds)
        const filas = res.rows || []

        const granTotal = filas.reduce((sum, r) => sum + (Number(r.TOTAL_VENTAS) || 0), 0)

        return {
            totalVentasRed: Math.round(granTotal * 100) / 100,
            sucursales: filas
        }
    } finally {
        if (conn) {
            try { await conn.close() } catch (_) {}
        }
    }
}

/**
 * Reporte de Inventario FEFO y alertas de vencimiento
 */
export async function reporteInventarioFefo({ sucursalId, diasVencimiento = 90 }) {
    let conn
    try {
        conn = await oracledb.getConnection()

        let sql = `
            SELECT 
                i.ID AS LOTE_ID,
                i.Lote AS LOTE,
                TO_CHAR(i.Fecha_vencimiento, 'YYYY-MM-DD') AS FECHA_VENCIMIENTO,
                ROUND(i.Fecha_vencimiento - TRUNC(SYSDATE)) AS DIAS_RESTANTES,
                i.Cantidad AS CANTIDAD,
                m.ID AS MEDICAMENTO_ID,
                m.Nombre_medic AS MEDICAMENTO_NOMBRE,
                m.Codigo_barra AS SKU,
                m.Costo AS COSTO_UNITARIO,
                (i.Cantidad * m.Costo) AS VALOR_COSTO,
                s.ID AS SUCURSAL_ID,
                s.Nombre AS SUCURSAL_NOMBRE
            FROM F_Inventario i
            JOIN F_Medicamentos m ON m.ID = i.F_Medicamentos_ID
            JOIN F_Sucursal s ON s.ID = i.F_Sucursal_ID
            WHERE i.Fecha_vencimiento <= TRUNC(SYSDATE) + :dias
            ORDER BY i.Fecha_vencimiento ASC
        `
        const res = await conn.execute(sql, { dias: nbind(diasVencimiento) })
        const lotes = res.rows || []

        const totalRiesgo = lotes.reduce((sum, l) => sum + (Number(l.VALOR_COSTO) || 0), 0)

        return {
            filtroDias: diasVencimiento,
            totalLotesProximos: lotes.length,
            valorEnRiesgo: Math.round(totalRiesgo * 100) / 100,
            lotes
        }
    } finally {
        if (conn) {
            try { await conn.close() } catch (_) {}
        }
    }
}

/**
 * Reporte de Auditoría de Cajas y Arqueos (Faltantes y Sobrantes)
 */
export async function reporteArqueoCajas({ sucursalId }) {
    let conn
    try {
        conn = await oracledb.getConnection()

        let sql = `
            SELECT 
                t.ID AS TURNO_ID,
                TO_CHAR(t.Fecha_apertura, 'YYYY-MM-DD HH24:MI') AS FECHA_APERTURA,
                TO_CHAR(t.Fecha_cierre, 'YYYY-MM-DD HH24:MI') AS FECHA_CIERRE,
                t.Monto_inicial AS MONTO_INICIAL,
                t.Ventas_efectivo AS VENTAS_EFECTIVO,
                t.Gastos AS GASTOS,
                (t.Monto_inicial + t.Ventas_efectivo - t.Gastos) AS ESPERADO_EN_CAJA,
                t.Monto_contado AS MONTO_CONTADO,
                t.Diferencia AS DIFERENCIA,
                t.Estado AS ESTADO,
                s.Nombre AS SUCURSAL_NOMBRE,
                u.Nombre || ' ' || u.Apellido AS CAJERO_NOMBRE,
                ua.Nombre || ' ' || ua.Apellido AS AUDITOR_NOMBRE
            FROM F_Turno_caja t
            JOIN F_Sucursal s ON s.ID = t.F_Sucursal_ID
            JOIN F_Empleados e ON e.ID = t.F_Empleados_ID
            JOIN F_Usuarios u ON u.ID = e.Usuarios_ID
            LEFT JOIN F_Usuarios ua ON ua.ID = t.Auditor
            WHERE t.Estado IN ('CERRADA', 'AUDITADA')
        `
        const binds = {}
        if (sucursalId) {
            sql += ` AND t.F_Sucursal_ID = :sucId`
            binds.sucId = nbind(sucursalId)
        }

        sql += ` ORDER BY t.Fecha_apertura DESC`

        const res = await conn.execute(sql, binds)
        const turnos = res.rows || []

        let cuadreExacto = 0
        let sobrantes = 0
        let faltantes = 0

        for (const t of turnos) {
            const dif = Number(t.DIFERENCIA) || 0
            if (dif === 0) cuadreExacto++
            else if (dif > 0) sobrantes++
            else faltantes++
        }

        return {
            totalTurnosAnalizados: turnos.length,
            metricas: {
                cuadreExacto,
                conSobrante: sobrantes,
                conFaltante: faltantes
            },
            turnos
        }
    } finally {
        if (conn) {
            try { await conn.close() } catch (_) {}
        }
    }
}
