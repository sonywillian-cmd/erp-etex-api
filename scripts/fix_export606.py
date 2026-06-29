"""Reescribe export606 con el formato OFICIAL DGII desde tabla gastos."""
import re

F = '/home/u372536694/apps/api/dist/facturacion/facturacion.service.js'
s = open(F).read()

nuevo_metodo = '''    async export606(desde, hasta) {
        // ========================================================================
        // FORMATO DGII 606 OFICIAL — Compras de Bienes y Servicios
        // Fuente: tabla `gastos` filtrada por NCF presente (NCF del proveedor)
        // Anti-duplicación: como las CxP con NCF generan gasto formal,
        // toda compra documentada con NCF aparece exactamente UNA vez aquí.
        // ========================================================================

        const gastos = await this.ds.query(
            "SELECT g.id, g.fecha, g.proveedor, g.rnc, g.ncf, g.tipo_ncf, " +
            "       g.subtotal, g.itbis, g.monto, g.categoria, g.metodo_pago, g.estado, " +
            "       g.descripcion " +
            "FROM gastos g " +
            "WHERE g.ncf IS NOT NULL AND g.ncf != '' " +
            "  AND g.rnc IS NOT NULL AND g.rnc != '' " +
            "  AND g.tipo = 'formal' " +
            "  AND DATE(g.fecha) >= ? AND DATE(g.fecha) <= ? " +
            "ORDER BY g.fecha ASC, g.ncf ASC",
            [desde, hasta]
        );

        // Pagos vinculados (para fecha_pago de gastos pendientes desde CxP)
        const idsGasto = gastos.map(g => g.id);
        const pagosPorGasto = {};
        if (idsGasto.length > 0) {
            const placeholders = idsGasto.map(() => '?').join(',');
            const abonosCxp = await this.ds.query(
                "SELECT a.gasto_id, a.fecha, a.metodo_pago, a.monto " +
                "FROM cuentas_por_pagar_abonos a WHERE a.gasto_id IN (" + placeholders + ")",
                idsGasto
            );
            for (const a of abonosCxp) {
                if (!pagosPorGasto[a.gasto_id]) pagosPorGasto[a.gasto_id] = [];
                pagosPorGasto[a.gasto_id].push(a);
            }
        }

        // Mapeo categoría → tipo bienes/servicios DGII
        const mapaTipoBs = {
            'alquiler': '03',       // Arrendamientos
            'nomina': '01',         // Personal
            'prestamos': '06',      // Financieros
            'impuestos': '11',      // Otras Operaciones
            'materia_prima': '02',  // Trabajos/Suministros/Servicios
            'mantenimiento': '02',
            'tecnologia': '02',
            'servicios': '02',
            'otros': '02',
        };

        // Mapeo método pago → forma pago DGII
        const mapaFormaPago = {
            'efectivo': '01',
            'transferencia': '02',
            'cheque': '02',
            'tarjeta': '03',
            'credito': '04',
        };

        const fmtFecha = (d) => {
            if (!d) return '';
            const dt = d instanceof Date ? d : new Date(d);
            const y = dt.getFullYear();
            const m = String(dt.getMonth() + 1).padStart(2, '0');
            const day = String(dt.getDate()).padStart(2, '0');
            return y + m + day;
        };

        const cleanRnc = (r) => String(r || '').replace(/[^0-9]/g, '');

        const header = [
            'RNC_CEDULA',
            'TIPO_ID',
            'TIPO_BIENES_SERVICIOS',
            'NCF',
            'NCF_MODIFICADO',
            'FECHA_COMPROBANTE',
            'FECHA_PAGO',
            'MONTO_FACTURADO_SERVICIOS',
            'MONTO_FACTURADO_BIENES',
            'TOTAL_MONTO_FACTURADO',
            'ITBIS_FACTURADO',
            'ITBIS_RETENIDO',
            'ITBIS_SUJETO_PROPORCIONALIDAD',
            'ITBIS_LLEVADO_AL_COSTO',
            'ITBIS_POR_ADELANTAR',
            'ITBIS_PERCIBIDO',
            'TIPO_RETENCION_ISR',
            'MONTO_RETENCION_RENTA',
            'ISR_PERCIBIDO_COMPRAS',
            'IMPUESTO_SELECTIVO',
            'OTROS_IMPUESTOS',
            'MONTO_PROPINA_LEGAL',
            'FORMA_PAGO',
        ].join('|');

        const rows = gastos.map(g => {
            const rnc = cleanRnc(g.rnc);
            const tipoId = rnc.length === 9 ? '2' : (rnc.length === 11 ? '1' : '3');
            const tipoBs = mapaTipoBs[g.categoria] || '02';
            const fechaDoc = fmtFecha(g.fecha);

            // Forma de pago: primer abono (si hay) o método del gasto
            const abonos = pagosPorGasto[g.id] || [];
            let formaPago, fechaPago = '';
            if (abonos.length === 1) {
                formaPago = mapaFormaPago[abonos[0].metodo_pago] || '01';
                fechaPago = fmtFecha(abonos[0].fecha);
            } else if (abonos.length > 1) {
                // Mixto
                const metodos = new Set(abonos.map(a => mapaFormaPago[a.metodo_pago] || '01'));
                formaPago = metodos.size > 1 ? '07' : Array.from(metodos)[0];
                const ultimoAbono = abonos.sort((a, b) => new Date(b.fecha) - new Date(a.fecha))[0];
                fechaPago = fmtFecha(ultimoAbono.fecha);
            } else if (g.estado === 'pendiente_pago') {
                // CxP a crédito sin abono aún
                formaPago = '04'; // Crédito
            } else {
                formaPago = mapaFormaPago[g.metodo_pago] || '01';
                fechaPago = fechaDoc; // Si está pagado y no hay abono registrado, asumir misma fecha
            }

            // Para servicios usamos subtotal, para bienes 0 (la mayoría de gastos son servicios)
            // Si en el futuro distinguimos por tipo de producto, ajustar aquí
            const subtotal = Number(g.subtotal ?? (Number(g.monto) - Number(g.itbis ?? 0))).toFixed(2);
            const itbis = Number(g.itbis ?? 0).toFixed(2);
            const total = Number(g.monto).toFixed(2);

            return [
                rnc,                  // RNC_CEDULA
                tipoId,               // TIPO_ID
                tipoBs,               // TIPO_BIENES_SERVICIOS
                g.ncf,                // NCF
                '',                   // NCF_MODIFICADO (para notas de crédito futuras)
                fechaDoc,             // FECHA_COMPROBANTE
                fechaPago,            // FECHA_PAGO
                subtotal,             // MONTO_FACTURADO_SERVICIOS
                '0.00',               // MONTO_FACTURADO_BIENES
                total,                // TOTAL_MONTO_FACTURADO
                itbis,                // ITBIS_FACTURADO
                '0.00',               // ITBIS_RETENIDO (Norma 06-18 — futuro)
                '0.00',               // ITBIS_SUJETO_PROPORCIONALIDAD
                '0.00',               // ITBIS_LLEVADO_AL_COSTO
                itbis,                // ITBIS_POR_ADELANTAR (todo el ITBIS por defecto)
                '0.00',               // ITBIS_PERCIBIDO
                '',                   // TIPO_RETENCION_ISR
                '0.00',               // MONTO_RETENCION_RENTA
                '0.00',               // ISR_PERCIBIDO_COMPRAS
                '0.00',               // IMPUESTO_SELECTIVO
                '0.00',               // OTROS_IMPUESTOS
                '0.00',               // MONTO_PROPINA_LEGAL
                formaPago,            // FORMA_PAGO
            ].join('|');
        });

        return [header, ...rows].join('\\n');
    }'''

# Reemplazar el método viejo
viejo_marker = "    async export606(desde, hasta) {"
viejo_end_marker = "        return [header, ...rows].join('\\n');\\n    }"

# Buscar el método completo (de la firma al cierre)
inicio = s.find(viejo_marker)
if inicio < 0:
    print("ERROR: no encontré export606")
    raise SystemExit(1)

# Buscar el } que cierra (debe ser al nivel correcto)
# Contamos llaves desde inicio
nivel = 0
i = inicio
while i < len(s):
    if s[i] == '{': nivel += 1
    elif s[i] == '}':
        nivel -= 1
        if nivel == 0:
            fin = i + 1
            break
    i += 1
else:
    print("ERROR: no encontré cierre de export606")
    raise SystemExit(1)

print(f"Reemplazando export606 ({fin - inicio} chars)")
s = s[:inicio] + nuevo_metodo + s[fin:]
open(F, 'w').write(s)
print("OK: export606 reescrito")
