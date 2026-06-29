"""Modifica cxp.service.js para el modelo híbrido:
- Si NCF presente Y a crédito → crea gasto formal con estado='pendiente_pago' + CxP enlazada via gasto_formal_id
- Si NO NCF y a crédito → solo CxP (sin gasto hasta primer abono)
- Si al contado → gasto directo (como hoy)

En _crearGastoYAbono (al registrar abono):
- Si CxP tiene gasto_formal_id → NO crea gasto nuevo, solo registra abono + cuando se completa pago actualiza estado del gasto
- Si CxP NO tiene gasto_formal_id → crea gasto por el monto del abono (como hoy)
"""
import sys

SVC = '/home/u372536694/apps/api/dist/cxp/cxp.service.js'
s = open(SVC).read()

# ─── 1) Modificar crear() para soportar opción C híbrida ─────────────────────
# Buscamos el bloque "if (alContado)" donde se crea el gasto y abono al contado
viejo_contado = """    // Si al contado, crear gasto directo + abono
    if (alContado) {
      await this._crearGastoYAbono(cxpId, {
        monto,
        fecha: dto.fecha_factura,
        metodo_pago: dto.metodo_pago || 'efectivo',
        clasificacion_contable: dto.clasificacion_contable || 'gasto',
        proveedor: provNombre,
        descripcion: dto.descripcion,
        categoria,
        registrado_por_id: dto.registrado_por_id,
        registrado_por_nombre: dto.registrado_por_nombre,
      });
    }

    return this.obtener(cxpId);"""

nuevo_contado = """    // ─── Opción C: Híbrido inteligente ──────────────────────────────
    if (alContado) {
      // Al contado: crea gasto directo + abono (como antes)
      await this._crearGastoYAbono(cxpId, {
        monto,
        fecha: dto.fecha_factura,
        metodo_pago: dto.metodo_pago || 'efectivo',
        clasificacion_contable: dto.clasificacion_contable || 'gasto',
        proveedor: provNombre,
        descripcion: dto.descripcion,
        categoria,
        registrado_por_id: dto.registrado_por_id,
        registrado_por_nombre: dto.registrado_por_nombre,
        ncf: dto.ncf || null,
        rnc: provRnc || null,
      });
    } else if (dto.ncf) {
      // A crédito CON NCF: contabilizar gasto formal pendiente_pago + dejar CxP pendiente
      const rGasto = await this.ds.query(
        "INSERT INTO gastos " +
        "(tipo, clasificacion_contable, fecha, monto, descripcion, categoria, proveedor, rnc, ncf, " +
        " metodo_pago, registrado_por_id, registrado_por_nombre, estado, notas) " +
        "VALUES ('formal', ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, 'pendiente_pago', ?)",
        [
          dto.clasificacion_contable === 'costo' ? 'costo' : 'gasto',
          dto.fecha_factura,
          monto,
          _upper(dto.descripcion) || ('Factura ' + numero),
          categoria,
          provNombre,
          provRnc || null,
          _upper(dto.ncf),
          dto.registrado_por_id || 1,
          dto.registrado_por_nombre || 'Sistema',
          'Crédito - pendiente de pago. CxP #' + cxpId,
        ]
      );
      // Enlazar CxP con el gasto formal creado
      await this.ds.query(
        "UPDATE cuentas_por_pagar SET gasto_formal_id = ? WHERE id = ?",
        [rGasto.insertId, cxpId]
      );
    }
    // Si a crédito sin NCF: no se crea gasto, queda solo en CxP hasta primer abono

    return this.obtener(cxpId);"""

if viejo_contado in s:
    s = s.replace(viejo_contado, nuevo_contado, 1)
    print('crear() actualizado con lógica híbrida.')
elif "// Opción C: Híbrido inteligente" in s:
    print('crear() ya tenía la lógica híbrida.')
else:
    print('ERROR: bloque "if (alContado)" no encontrado'); sys.exit(1)


# ─── 2) Modificar _crearGastoYAbono para no duplicar si ya hay gasto formal ─
# Necesitamos saber si la CxP ya tiene gasto_formal_id. Modificamos la función
# para que verifique y, si ya existe, solo cree el abono + actualice estado del gasto.

viejo_abono = """  async _crearGastoYAbono(cxpId, dto) {
    // 1) Crear el gasto
    const rGasto = await this.ds.query(
      "INSERT INTO gastos " +
      "(tipo, clasificacion_contable, fecha, monto, descripcion, categoria, proveedor, " +
      " metodo_pago, registrado_por_id, registrado_por_nombre, estado, notas) " +
      "VALUES ('informal', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'registrado', ?)",
      [
        dto.clasificacion_contable,
        dto.fecha,
        dto.monto,
        dto.descripcion || 'Pago a proveedor',
        dto.categoria || 'otros',
        dto.proveedor || null,
        dto.metodo_pago,
        dto.registrado_por_id || 1,
        dto.registrado_por_nombre || 'Sistema',
        dto.notas || null,
      ]
    );
    const gastoId = rGasto.insertId;"""

nuevo_abono = """  async _crearGastoYAbono(cxpId, dto) {
    // Verificar si la CxP ya tiene un gasto formal asociado (modelo híbrido)
    const [cxpInfo] = await this.ds.query(
      "SELECT gasto_formal_id, monto_total, monto_pagado FROM cuentas_por_pagar WHERE id = ?",
      [cxpId]
    );

    let gastoId = null;

    if (cxpInfo && cxpInfo.gasto_formal_id) {
      // Ya hay gasto formal contabilizado. NO crear gasto duplicado.
      // Solo actualizamos su estado a 'registrado' cuando el pago se complete.
      gastoId = cxpInfo.gasto_formal_id;
      const totalConAbono = Number(cxpInfo.monto_pagado) + Number(dto.monto);
      if (totalConAbono >= Number(cxpInfo.monto_total) - 0.01) {
        // Pago completo: cambiar estado a 'registrado' (pagado)
        await this.ds.query(
          "UPDATE gastos SET estado = 'registrado', metodo_pago = ? WHERE id = ?",
          [dto.metodo_pago, gastoId]
        );
      }
    } else {
      // No hay gasto formal previo. Crear gasto nuevo por el monto del abono.
      const tipoGasto = dto.ncf ? 'formal' : 'informal';
      const rGasto = await this.ds.query(
        "INSERT INTO gastos " +
        "(tipo, clasificacion_contable, fecha, monto, descripcion, categoria, proveedor, rnc, ncf, " +
        " metodo_pago, registrado_por_id, registrado_por_nombre, estado, notas) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'registrado', ?)",
        [
          tipoGasto,
          dto.clasificacion_contable,
          dto.fecha,
          dto.monto,
          dto.descripcion || 'Pago a proveedor',
          dto.categoria || 'otros',
          dto.proveedor || null,
          dto.rnc || null,
          dto.ncf || null,
          dto.metodo_pago,
          dto.registrado_por_id || 1,
          dto.registrado_por_nombre || 'Sistema',
          dto.notas || null,
        ]
      );
      gastoId = rGasto.insertId;
    }"""

if viejo_abono in s:
    s = s.replace(viejo_abono, nuevo_abono, 1)
    print('_crearGastoYAbono actualizado para no duplicar.')
elif 'Ya hay gasto formal contabilizado' in s:
    print('_crearGastoYAbono ya tenía la lógica.')
else:
    print('ERROR: bloque _crearGastoYAbono no encontrado'); sys.exit(1)


# ─── 3) Modificar resumen() para considerar gastos formales pendientes ────
# El reporte debe mostrar saldo total de CxP pendientes correctamente.
# Y el reporte mensual debe sumar gastos con estado IN ('registrado', 'pendiente_pago')

open(SVC, 'w').write(s)
print('OK: cxp.service.js patched con modelo híbrido.')
