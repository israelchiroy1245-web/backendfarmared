import { oracledb } from '../config/database.js'
import { num, nbind } from '../utils/oracle.js'
import { ejecutarPagina, terminoLike } from '../utils/paginacion.js'

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
 * Reporte de Ventas por Sucursal, Fechas y Forma de Pago (3FN)
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
                COUNT(DISTINCT v.ID) AS TOTAL_TRANSACCIONES,
                NVL(SUM(v.Total), 0) AS TOTAL_VENTAS,
                NVL(SUM(
                    (SELECT SUM(p.Monto) FROM F_Venta_pago p WHERE p.F_Ventas_ID = v.ID AND p.Metodo_pago = 'EFECTIVO')
                ), 0) AS VENTAS_EFECTIVO,
                NVL(SUM(
                    (SELECT SUM(p.Monto) FROM F_Venta_pago p WHERE p.F_Ventas_ID = v.ID AND p.Metodo_pago = 'TARJETA')
                ), 0) AS VENTAS_TARJETA,
                NVL(SUM(
                    (SELECT SUM(p.Monto) FROM F_Venta_pago p WHERE p.F_Ventas_ID = v.ID AND p.Metodo_pago = 'TRANSFERENCIA')
                ), 0) AS VENTAS_TRANSFERENCIA
            FROM F_Sucursal s
            LEFT JOIN F_Ventas v ON v.F_Sucursal_ID = s.ID AND v.Estado = 'EMITIDA'
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
export async function reporteArqueoCajas({ sucursalId, desde, hasta, fechaDesde, fechaHasta }) {
    let conn
    try {
        conn = await oracledb.getConnection()

        const fDesde = desde || fechaDesde
        const fHasta = hasta || fechaHasta

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

        if (fDesde) {
            sql += ` AND t.Fecha_apertura >= TO_DATE(:fDesde, 'YYYY-MM-DD')`
            binds.fDesde = String(fDesde).substring(0, 10)
        }

        if (fHasta) {
            sql += ` AND t.Fecha_apertura < TO_DATE(:fHasta, 'YYYY-MM-DD') + 1`
            binds.fHasta = String(fHasta).substring(0, 10)
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

/**
 * Reporte de Planilla por Período
 */
export async function reportePlanilla({ periodo, sucursalId }) {
    let conn
    try {
        conn = await oracledb.getConnection()

        let sql = `
            SELECT 
                p.Periodo AS PERIODO,
                s.ID AS SUCURSAL_ID,
                s.Nombre AS SUCURSAL_NOMBRE,
                COUNT(p.ID) AS TOTAL_EMPLEADOS,
                NVL(SUM(p.Salario_base), 0) AS TOTAL_SALARIOS,
                NVL(SUM(p.Bonificaciones), 0) AS TOTAL_BONIFICACIONES,
                NVL(SUM(p.Descuentos), 0) AS TOTAL_DESCUENTOS,
                NVL(SUM(p.Igss), 0) AS TOTAL_IGSS,
                NVL(SUM(p.Total), 0) AS TOTAL_A_PAGAR,
                SUM(CASE WHEN p.Estado = 'PAGADA' THEN 1 ELSE 0 END) AS EMPLEADOS_PAGADOS,
                SUM(CASE WHEN p.Estado = 'PENDIENTE' THEN 1 ELSE 0 END) AS EMPLEADOS_PENDIENTES
            FROM F_Planilla p
            JOIN F_Empleados e ON e.ID = p.F_Empleados_ID
            JOIN F_Sucursal s ON s.ID = e.Sucursal_ID
            WHERE 1 = 1
        `
        const binds = {}

        if (periodo) {
            sql += ` AND p.Periodo = :periodo`
            binds.periodo = String(periodo).trim()
        }

        if (sucursalId) {
            sql += ` AND s.ID = :sucId`
            binds.sucId = nbind(sucursalId)
        }

        sql += ` GROUP BY p.Periodo, s.ID, s.Nombre ORDER BY p.Periodo DESC, s.Nombre ASC`

        const res = await conn.execute(sql, binds)
        const filas = res.rows || []

        const totalNomina = filas.reduce((sum, r) => sum + (Number(r.TOTAL_A_PAGAR) || 0), 0)

        return {
            periodo: periodo || 'TODOS',
            totalNominaRed: Math.round(totalNomina * 100) / 100,
            desglose: filas
        }
    } finally {
        if (conn) {
            try { await conn.close() } catch (_) {}
        }
    }
}

/**
 * Reporte de Activos Fijos y Depreciación
 */
export async function reporteActivos({ sucursalId, categoria }) {
    let conn
    try {
        conn = await oracledb.getConnection()

        let sql = `
            SELECT 
                s.ID AS SUCURSAL_ID,
                s.Nombre AS SUCURSAL_NOMBRE,
                a.Categoria AS CATEGORIA,
                COUNT(a.ID) AS TOTAL_ACTIVOS,
                NVL(SUM(a.Valor_adquisicion), 0) AS TOTAL_ADQUISICION,
                NVL(SUM(a.Depreciacion_acumulada), 0) AS TOTAL_DEPRECIACION,
                NVL(SUM(a.Valor_adquisicion - a.Depreciacion_acumulada), 0) AS VALOR_LIBROS
            FROM F_Activo_fijo a
            JOIN F_Sucursal s ON s.ID = a.F_Sucursal_ID
            WHERE a.Estado <> 'BAJA'
        `
        const binds = {}

        if (sucursalId) {
            sql += ` AND s.ID = :sucId`
            binds.sucId = nbind(sucursalId)
        }

        if (categoria) {
            sql += ` AND a.Categoria = :cat`
            binds.cat = String(categoria).toUpperCase().trim()
        }

        sql += ` GROUP BY s.ID, s.Nombre, a.Categoria ORDER BY s.Nombre ASC, a.Categoria ASC`

        const res = await conn.execute(sql, binds)
        const filas = res.rows || []

        const totalLibros = filas.reduce((sum, r) => sum + (Number(r.VALOR_LIBROS) || 0), 0)
        const totalAdquisicion = filas.reduce((sum, r) => sum + (Number(r.TOTAL_ADQUISICION) || 0), 0)

        return {
            totalActivos: filas.reduce((sum, r) => sum + (Number(r.TOTAL_ACTIVOS) || 0), 0),
            totalAdquisicion: Math.round(totalAdquisicion * 100) / 100,
            totalValorLibros: Math.round(totalLibros * 100) / 100,
            desglose: filas
        }
    } finally {
        if (conn) {
            try { await conn.close() } catch (_) {}
        }
    }
}

/**
 * Reporte de Kardex de Inventario (F_Movimiento_inventario)
 */
export async function reporteKardex({ sucursalId, medicamentoId, tipo, desde, hasta, q, limit, offset }) {
    let conn
    try {
        conn = await oracledb.getConnection()

        let sql = `
            SELECT 
                m.ID AS "ID",
                m.Tipo AS "TIPO",
                m.Cantidad AS "CANTIDAD",
                m.Lote AS "LOTE",
                m.Referencia AS "REFERENCIA",
                TO_CHAR(m.Fecha, 'YYYY-MM-DD HH24:MI:SS') AS "FECHA",
                s.ID AS "SUCURSAL_ID",
                s.Nombre AS "SUCURSAL_NOMBRE",
                med.ID AS "MEDICAMENTO_ID",
                med.Nombre_medic AS "MEDICAMENTO_NOMBRE",
                u.Nombre || ' ' || u.Apellido AS "USUARIO_NOMBRE"
            FROM F_Movimiento_inventario m
            JOIN F_Sucursal s ON s.ID = m.F_Sucursal_ID
            JOIN F_Medicamentos med ON med.ID = m.F_Medicamentos_ID
            LEFT JOIN F_Usuarios u ON u.ID = m.F_Usuarios_ID
            WHERE 1 = 1
        `
        const binds = {}

        if (sucursalId) {
            sql += ` AND m.F_Sucursal_ID = :sucId`
            binds.sucId = nbind(sucursalId)
        }

        if (medicamentoId) {
            sql += ` AND m.F_Medicamentos_ID = :medId`
            binds.medId = nbind(medicamentoId)
        }

        if (tipo) {
            sql += ` AND m.Tipo = :tipo`
            binds.tipo = String(tipo).toUpperCase().trim()
        }

        if (desde) {
            sql += ` AND m.Fecha >= TO_DATE(:desde, 'YYYY-MM-DD')`
            binds.desde = String(desde).substring(0, 10)
        }

        if (hasta) {
            sql += ` AND m.Fecha < TO_DATE(:hasta, 'YYYY-MM-DD') + 1`
            binds.hasta = String(hasta).substring(0, 10)
        }

        const busqueda = terminoLike(q)
        if (busqueda) {
            sql += ` AND (
                UPPER(med.Nombre_medic) LIKE :q
                OR UPPER(m.Lote) LIKE :q
                OR UPPER(NVL(m.Referencia, '')) LIKE :q
                OR UPPER(s.Nombre) LIKE :q
            )`
            binds.q = busqueda
        }

        return await ejecutarPagina(conn, {
            sql,
            binds,
            orderBy: 'ORDER BY m.Fecha DESC, m.ID DESC',
            limit,
            offset,
        })
    } finally {
        if (conn) {
            try { await conn.close() } catch (_) {}
        }
    }
}

/**
 * Reporte de Bitácora de Auditoría del Sistema (F_Auditoria)
 */
export async function reporteAuditoria({ tabla, accion, desde, hasta, q, limit, offset }) {
    let conn
    try {
        conn = await oracledb.getConnection()

        let sql = `
            SELECT 
                a.ID AS "ID",
                a.Tabla_afectada AS "TABLA",
                a.Accion AS "ACCION",
                a.Id_registro AS "ID_REGISTRO",
                a.Datos_anteriores AS "DATOS_ANTERIORES",
                a.Datos_nuevos AS "DATOS_NUEVOS",
                TO_CHAR(a.Fecha, 'YYYY-MM-DD HH24:MI:SS') AS "FECHA",
                a.Usuario_oracle AS "USUARIO_ORACLE",
                a.Ip AS "IP",
                u.Nombre || ' ' || u.Apellido AS "USUARIO_NOMBRE",
                u.Email AS "USUARIO_EMAIL"
            FROM F_Auditoria a
            LEFT JOIN F_Usuarios u ON u.ID = a.F_Usuarios_ID
            WHERE 1 = 1
        `
        const binds = {}

        if (tabla) {
            sql += ` AND UPPER(a.Tabla_afectada) = :tabla`
            binds.tabla = String(tabla).toUpperCase().trim()
        }

        if (accion) {
            sql += ` AND a.Accion = :accion`
            binds.accion = String(accion).toUpperCase().trim()
        }

        if (desde) {
            sql += ` AND a.Fecha >= TO_DATE(:desde, 'YYYY-MM-DD')`
            binds.desde = String(desde).substring(0, 10)
        }

        if (hasta) {
            sql += ` AND a.Fecha < TO_DATE(:hasta, 'YYYY-MM-DD') + 1`
            binds.hasta = String(hasta).substring(0, 10)
        }

        const busqueda = terminoLike(q)
        if (busqueda) {
            sql += ` AND (
                UPPER(a.Tabla_afectada) LIKE :q
                OR UPPER(NVL(u.Nombre || ' ' || u.Apellido, '')) LIKE :q
            )`
            binds.q = busqueda
        }

        return await ejecutarPagina(conn, {
            sql,
            binds,
            orderBy: 'ORDER BY a.Fecha DESC, a.ID DESC',
            limit,
            offset,
        })
    } finally {
        if (conn) {
            try { await conn.close() } catch (_) {}
        }
    }
}
