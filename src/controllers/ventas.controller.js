import { oracledb } from '../config/database.js'

function num(v) {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
}

function errorOracle(error) {
    const msg = error.message || String(error)
    if (msg.includes('ORA-20001')) return { status: 400, error: 'La cantidad debe ser positiva' }
    if (msg.includes('ORA-20002')) return { status: 409, error: 'Stock insuficiente (FEFO, sin vencidos)' }
    if (msg.includes('ORA-01403')) return { status: 404, error: 'No se encontró el medicamento, la sucursal o el cajero' }
    return { status: 500, error: msg }
}

export const registrarVenta = async (req, res) => {
    const sucursalId = num(req.body.sucursalId)
    const medicamentoId = num(req.body.medicamentoId)
    const cantidad = num(req.body.cantidad)
    const clienteId = num(req.body.clienteId)
    const metodoPago = req.body.metodoPago || 'EFECTIVO'
    const cajeroId = num(req.usuario?.id ?? req.body.cajeroId ?? process.env.CAJERO_ID_PRUEBA)

    if (!sucursalId || !medicamentoId || !cantidad || cantidad <= 0) {
        return res.status(400).json({ ok: false, error: 'sucursalId, medicamentoId y cantidad (> 0) son obligatorios' })
    }
    if (!cajeroId) {
        return res.status(401).json({ ok: false, error: 'No hay cajero en sesión. En pruebas mande cajeroId o CAJERO_ID_PRUEBA=1' })
    }
    if (!['EFECTIVO', 'TARJETA', 'TRANSFERENCIA'].includes(metodoPago)) {
        return res.status(400).json({ ok: false, error: 'metodoPago inválido' })
    }

    let conn
    try {
        conn = await oracledb.getConnection()

        await conn.execute(`BEGIN pkg_sesion.set_usuario(:id); END;`, {
            id: { val: cajeroId, type: oracledb.NUMBER },
        })

        const emp = await conn.execute(
            `SELECT ID FROM F_Empleados WHERE Usuarios_ID = :u AND Estado = 'ACTIVO' AND ROWNUM = 1`,
            { u: { val: cajeroId, type: oracledb.NUMBER } },
        )
        const empleadoId = emp.rows?.[0]?.ID
        if (!empleadoId) {
            return res.status(403).json({ ok: false, error: 'El usuario no tiene empleado activo' })
        }

        const alta = await conn.execute(
            `INSERT INTO F_Ventas (F_Empleados_ID, F_Sucursal_ID, F_Clientes_ID, Metodo_pago)
       VALUES (:emp, :suc, :cli, :pago)
       RETURNING ID INTO :id`,
            {
                emp: { val: empleadoId, type: oracledb.NUMBER },
                suc: { val: sucursalId, type: oracledb.NUMBER },
                cli: { val: clienteId, type: oracledb.NUMBER },
                pago: metodoPago,
                id: { dir: oracledb.BIND_OUT, type: oracledb.NUMBER },
            },
        )
        const ventaId = Array.isArray(alta.outBinds.id) ? alta.outBinds.id[0] : alta.outBinds.id

        await conn.execute(
            `BEGIN procesar_venta(:s, :m, :c, :v); END;`,
            {
                s: { val: sucursalId, type: oracledb.NUMBER },
                m: { val: medicamentoId, type: oracledb.NUMBER },
                c: { val: cantidad, type: oracledb.NUMBER },
                v: { val: ventaId, type: oracledb.NUMBER },
            },
        )

        const tot = await conn.execute(
            `SELECT Total FROM F_Ventas WHERE ID = :id`,
            { id: { val: ventaId, type: oracledb.NUMBER } },
        )

        await conn.commit()

        return res.status(201).json({
            ok: true,
            ventaId,
            total: tot.rows?.[0]?.TOTAL ?? null,
            mensaje: 'Venta emitida, stock descontado por FEFO y kardex registrado',
        })
    } catch (error) {
        if (conn) {
            try { await conn.rollback() } catch { /* ignore */ }
        }
        const mapped = errorOracle(error)
        console.error('Error al procesar la venta:', error.message)
        return res.status(mapped.status).json({ ok: false, error: mapped.error })
    } finally {
        if (conn) {
            try { await conn.close() } catch (poolError) {
                console.error('Error al devolver conexión al pool:', poolError.message)
            }
        }
    }
}
