"""Desacopla los pagos de compromisos de la caja:
- marcarPagada() siempre crea gasto, sin importar metodo_pago
- Ya no requiere sesion de caja abierta
- El campo metodo_pago se sigue guardando en el gasto (informativo)
"""
import sys

SVC = '/home/u372536694/apps/api/dist/compromisos/compromisos.service.js'

s = open(SVC).read()

# Reemplazar el bloque if metodo === 'efectivo' por SIEMPRE crear gasto
viejo = """    let gastoId = null;
    let egresoId = null;

    if (metodo === 'efectivo') {
      const r = await this.ds.query(
        "INSERT INTO egresos_caja " +
        "(fecha, monto, destinatario, categoria, comentario, registrado_por, sesion_caja_id, clasificacion_contable) " +
        "VALUES (?,?,?,?,?,?, " +
        "  (SELECT id FROM sesiones_caja WHERE estado='abierta' AND usuario_nombre = ? ORDER BY id DESC LIMIT 1), " +
        "  ?)",
        [
          fechaPago,
          monto,
          oc.proveedor || oc.nombre,
          oc.categoria || 'otros',
          'Pago de compromiso: ' + oc.nombre,
          usuarioNombre,
          usuarioNombre,
          oc.clasificacion_contable,
        ]
      );
      egresoId = r.insertId;
    } else {
      const r = await this.ds.query(
        "INSERT INTO gastos " +
        "(tipo, clasificacion_contable, fecha, monto, descripcion, categoria, proveedor, " +
        " metodo_pago, registrado_por_id, registrado_por_nombre, estado, notas) " +
        "VALUES ('informal', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'registrado', ?)",
        [
          oc.clasificacion_contable,
          fechaPago,
          monto,
          'Pago de compromiso: ' + oc.nombre,
          oc.categoria || 'Otros',
          oc.proveedor || null,
          metodo,
          usuarioId || 1,
          usuarioNombre,
          dto.notas || null,
        ]
      );
      gastoId = r.insertId;
    }"""

nuevo = """    let gastoId = null;
    const egresoId = null; // Compromisos NUNCA crean egresos de caja (caja chica es aparte)

    // Siempre crear gasto, sin importar el metodo (no afecta caja fisica)
    const r = await this.ds.query(
      "INSERT INTO gastos " +
      "(tipo, clasificacion_contable, fecha, monto, descripcion, categoria, proveedor, " +
      " metodo_pago, registrado_por_id, registrado_por_nombre, estado, notas) " +
      "VALUES ('informal', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'registrado', ?)",
      [
        oc.clasificacion_contable,
        fechaPago,
        monto,
        'Pago de compromiso: ' + oc.nombre,
        oc.categoria || 'Otros',
        oc.proveedor || null,
        metodo,
        usuarioId || 1,
        usuarioNombre,
        dto.notas || null,
      ]
    );
    gastoId = r.insertId;"""

if viejo in s:
    s = s.replace(viejo, nuevo, 1)
    open(SVC, 'w').write(s)
    print('OK: marcarPagada() ya no crea egresos de caja.')
elif "// Compromisos NUNCA crean egresos" in s:
    print('Ya estaba desacoplado.')
else:
    print('ERROR: bloque no encontrado en service'); sys.exit(1)
