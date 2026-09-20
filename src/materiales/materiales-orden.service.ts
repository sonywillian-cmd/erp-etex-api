import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

/**
 * Materiales de una orden de producción, medidos por TALLA Y COLOR.
 *
 * Antes había tres cálculos distintos que no se ponían de acuerdo (13-sep-2026):
 *  - al crear la orden se apartaba por variante;
 *  - la validación que arma la compra descontaba lo apartado por PRODUCTO completo;
 *  - el estado de materiales comparaba contra el total del producto.
 * Resultado: una segunda orden sobre la misma talla y color quedaba sin apartar y
 * sin pedir, y órdenes a las que les faltaba una pieza decían "disponible".
 *
 * Aquí hay una sola cuenta. Para cada talla y color que pide la ORDEN:
 *   separado (reservas activas) + pedido al proveedor (compras_faltantes) = lo que pide.
 *
 * Reglas del dueño (13-sep-2026):
 *  - Manda la orden, nunca la cotización: la cotización es para precios; al
 *    confirmar la orden el cliente cambia tallas, colores y cantidades.
 *  - Separar DESCUENTA del almacén: la pieza sale del inventario y pasa a
 *    Separados con su movimiento de salida. Lo que llega de una compra entra y
 *    sale a Separados para la orden que lo pidió. Al iniciar o entregar ya no se
 *    descuenta otra vez; si la orden baja o se cancela, lo separado vuelve.
 * Todo es idempotente: repetir la operación no duplica separados ni compras.
 */

export const PROVEEDOR_PENDIENTE = 'POR ASIGNAR PROVEEDOR';

type Q = { query: (sql: string, params?: any[]) => Promise<any> };
type OrdenRef = { id: number; numero: string };

export interface ItemDemanda {
  clave: string;
  producto_id: number;
  variante_id: number | null;
  variante_label: string | null;
  producto: string;
  cantidad: number;
  comprable: boolean;        // se compra a proveedor (no se fabrica en taller)
}

export interface FaltanteMaterial {
  producto_id: number;
  producto_nombre: string;
  variante_id: number | null;
  variante_label: string | null;
  requerido: number;
  disponible: number;        // lo que quedó separado para esta orden
  faltante: number;
  proveedor_id: number | null;
  proveedor_nombre: string | null;
  pendiente_proveedor: boolean;
  oc_numero: string | null;
}

export interface ResultadoMateriales {
  faltantes: FaltanteMaterial[];
  ordenes_generadas: number[];
  estado_sugerido: 'pendiente_produccion' | 'esperando_materiales';
  estado_materiales: 'disponible' | 'parcial' | 'en_espera';
  pendientes_proveedor: number;
  omitida?: string;
}

const J = (x: any, def: any) => {
  let v = x;
  for (let i = 0; i < 3 && typeof v === 'string'; i++) { try { v = JSON.parse(v); } catch { return def; } }
  return v ?? def;
};
const n = (x: any) => Number(x ?? 0) || 0;
const EPS = 1e-9;

/** Mismo valor escrito de dos formas: "2XL" es "XXL" y la gorra "NEGRA" es el color "NEGRO". */
const ALIAS: Record<string, string> = { '2XL': 'XXL', '3XL': 'XXXL', '4XL': 'XXXXL', NEGRA: 'NEGRO', BLANCA: 'BLANCO' };

@Injectable()
export class MaterialesOrdenService {
  private readonly logger = new Logger('Materiales');
  private tablasListas = false;

  constructor(private ds: DataSource) {}

  // ── Utilidades ─────────────────────────────────────────────────────────────
  /** Claves de atributo normalizadas: el catálogo tiene "COLOR", "COLORES" y hasta "COLOR ". */
  private atributos(raw: any): Record<string, string> {
    const a = J(raw, {});
    const out: Record<string, string> = {};
    if (a && typeof a === 'object' && !Array.isArray(a))
      for (const [k, v] of Object.entries(a)) out[String(k).trim().toUpperCase()] = String(v ?? '').trim();
    return out;
  }
  private etiqueta(raw: any): string | null {
    return Object.values(this.atributos(raw)).filter(Boolean).join(' / ').slice(0, 120) || null;
  }
  private norm(t: any) { return String(t ?? '').toUpperCase().replace(/\s+/g, ' ').trim(); }
  private tok(t: any) { const v = this.norm(t); return ALIAS[v] ?? v; }
  /** "BLANCO / 10", "10 / BLANCO" y "BLANCO - 10" son la misma percha. */
  private valoresTexto(t: any) {
    return this.norm(t).split(/\s-\s|\//).map(p => this.tok(p)).filter(Boolean).sort().join('|');
  }
  clave(productoId: number, varianteId: number | null) { return `p${productoId}v${varianteId ?? 0}`; }
  private partirClave(clave: string) {
    const m = clave.match(/^p(\d+)v(\d+)$/)!;
    return { producto_id: Number(m[1]), variante_id: Number(m[2]) || null };
  }

  async asegurarTablas() {
    if (this.tablasListas) return;
    await this.ds.query(`
      CREATE TABLE IF NOT EXISTS compras_faltantes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        orden_id INT NOT NULL,
        orden_compra_id INT NOT NULL,
        producto_id INT NOT NULL,
        variante_id INT NULL,
        cantidad DECIMAL(12,2) NOT NULL,
        cantidad_recibida DECIMAL(12,2) NOT NULL DEFAULT 0,
        estado VARCHAR(20) NOT NULL DEFAULT 'pendiente',
        creado_en DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        actualizado_en DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        INDEX idx_cf_orden (orden_id), INDEX idx_cf_oc (orden_compra_id), INDEX idx_cf_var (producto_id, variante_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    // 1 = la pieza ya salió del almacén al separarla. Las reservas viejas (0) se
    // descuentan al iniciar o entregar, como antes.
    await this.ds.query(`ALTER TABLE reservas_inventario ADD COLUMN IF NOT EXISTS descontada TINYINT(1) NOT NULL DEFAULT 0`);
    this.tablasListas = true;
  }

  /**
   * Primera orden medida contra el inventario cargado. Las anteriores las declaró
   * cuadradas el dueño (11-sep-2026), salvo las que él mismo pidió revisar
   * (inventario_ordenes_incluidas).
   */
  async corteOrdenId(q: Q = this.ds): Promise<number> {
    const [r] = await q.query(`SELECT valor FROM configuracion_sistema WHERE clave = 'inventario_corte_orden_id' LIMIT 1`);
    if (r && n(r.valor) > 0) return n(r.valor);
    const [m] = await q.query(`SELECT COALESCE(MAX(id), 0) + 1 AS siguiente FROM ordenes_produccion`);
    return n(m?.siguiente);
  }

  async ordenesIncluidas(q: Q = this.ds): Promise<number[]> {
    const [r] = await q.query(`SELECT valor FROM configuracion_sistema WHERE clave = 'inventario_ordenes_incluidas' LIMIT 1`);
    const v = J(r?.valor, []);
    return Array.isArray(v) ? v.map(Number).filter(Boolean) : [];
  }

  async esMedible(ordenId: number, q: Q = this.ds) {
    return ordenId >= await this.corteOrdenId(q) || (await this.ordenesIncluidas(q)).includes(ordenId);
  }

  /** Si la orden ya arrancó o terminó, su material salió del almacén. */
  yaConsumio(o: { estado?: any; estado_produccion?: any }) {
    if (['listo', 'listo_parcial', 'entregado', 'cancelado'].includes(String(o.estado))) return true;
    return String(o.estado_produccion ?? '') !== 'sin_iniciar';
  }

  async resolverVariante(q: Q, productoId: number, varianteId: number | null, descripcion: string) {
    if (varianteId) {
      const [v] = await q.query(`SELECT id, atributos FROM variantes_producto WHERE id = ? AND producto_id = ?`, [varianteId, productoId]);
      if (v) return { id: n(v.id), label: this.etiqueta(v.atributos) };
      // La variante se recreó al editar el producto: se sigue por su equivalente.
      const eqs = await q.query(
        `SELECT r.id_nuevo, v.atributos FROM variantes_reemplazadas r JOIN variantes_producto v ON v.id = r.id_nuevo
          WHERE r.id_viejo = ? AND v.producto_id = ?`, [varianteId, productoId]).catch(() => []);
      if (eqs?.[0]) return { id: n(eqs[0].id_nuevo), label: this.etiqueta(eqs[0].atributos) };
    }
    const buscado = this.valoresTexto(descripcion);
    if (!buscado) return null;
    const vs = await q.query(`SELECT id, atributos FROM variantes_producto WHERE producto_id = ?`, [productoId]);
    for (const v of vs) {
      const valores = Object.values(this.atributos(v.atributos)).map(x => this.tok(x)).filter(Boolean).sort().join('|');
      if (valores && valores === buscado) return { id: n(v.id), label: this.etiqueta(v.atributos) };
    }
    return null;
  }

  // ── Qué pide la orden ──────────────────────────────────────────────────────
  /** Solo las líneas de la ORDEN. La cotización no se consulta. */
  async demandaOrden(q: Q, ordenId: number): Promise<Map<string, ItemDemanda>> {
    const demanda = new Map<string, ItemDemanda>();
    const [o] = await q.query(`SELECT lineas_produccion FROM ordenes_produccion WHERE id = ?`, [ordenId]);
    if (!o) return demanda;
    const productos = new Map<number, any>();

    for (const l of J(o.lineas_produccion, []) as any[]) {
      const pid = n(l?.producto_id);
      if (!pid) continue;
      if (!productos.has(pid)) {
        const [p] = await q.query(`SELECT id, nombre, maneja_inventario, tipo_producto FROM productos WHERE id = ?`, [pid]);
        productos.set(pid, p ?? null);
      }
      const p = productos.get(pid);
      if (!p || !Number(p.maneja_inventario) || p.tipo_producto === 'servicio') continue;

      const v = await this.resolverVariante(q, pid, l.variante_id ? n(l.variante_id) : null, l.descripcion ?? '');
      const clave = this.clave(pid, v?.id ?? null);
      const actual = demanda.get(clave);
      if (actual) actual.cantidad += n(l.cantidad);
      else demanda.set(clave, {
        clave, producto_id: pid, variante_id: v?.id ?? null, variante_label: v?.label ?? null,
        producto: p.nombre ?? l.producto ?? '', cantidad: n(l.cantidad),
        comprable: p.tipo_producto !== 'fisico_fabricado',
      });
    }
    return demanda;
  }

  private async reservadoPorClave(q: Q, ordenId: number) {
    const m = new Map<string, number>();
    for (const r of await q.query(
      `SELECT producto_id, variante_id, SUM(cantidad_reservada) t FROM reservas_inventario
        WHERE orden_id = ? AND estado = 'activa' GROUP BY producto_id, variante_id`, [ordenId]))
      m.set(this.clave(n(r.producto_id), r.variante_id ? n(r.variante_id) : null), n(r.t));
    return m;
  }

  private async pendienteCompraPorClave(q: Q, ordenId: number) {
    const m = new Map<string, number>();
    for (const r of await q.query(
      `SELECT cf.producto_id, cf.variante_id, SUM(cf.cantidad - cf.cantidad_recibida) t
         FROM compras_faltantes cf JOIN ordenes_compra oc ON oc.id = cf.orden_compra_id
        WHERE cf.orden_id = ? AND cf.estado = 'pendiente' AND oc.estado <> 'cancelada'
        GROUP BY cf.producto_id, cf.variante_id`, [ordenId]))
      m.set(this.clave(n(r.producto_id), r.variante_id ? n(r.variante_id) : null), n(r.t));
    return m;
  }

  /**
   * Existencia sin dueño. Lo separado ya salió del almacén, así que es la
   * existencia misma; solo se restan reservas viejas que todavía no se
   * descontaron (las de antes del 13-sep y las reposiciones por daño).
   */
  async libre(q: Q, productoId: number, varianteId: number | null) {
    if (varianteId) {
      const [r] = await q.query(
        `SELECT COALESCE(v.stock_actual,0) - COALESCE((SELECT SUM(x.cantidad_reservada) FROM reservas_inventario x
                  WHERE x.variante_id = v.id AND x.estado = 'activa' AND x.descontada = 0),0) AS libre
           FROM variantes_producto v WHERE v.id = ? FOR UPDATE`, [varianteId]);
      return Math.max(0, n(r?.libre));
    }
    const [r] = await q.query(
      `SELECT COALESCE(p.stock_actual,0) - COALESCE((SELECT SUM(x.cantidad_reservada) FROM reservas_inventario x
                WHERE x.producto_id = p.id AND x.estado = 'activa' AND x.descontada = 0),0) AS libre
         FROM productos p WHERE p.id = ? FOR UPDATE`, [productoId]);
    return Math.max(0, n(r?.libre));
  }

  private async movimiento(q: Q, tipo: 'entrada' | 'salida', it: { producto_id: number; variante_id: number | null; variante_label?: string | null },
                           cantidad: number, referencia: string, nota: string) {
    await q.query(
      `INSERT INTO movimientos_inventario (producto_id, variante_id, variante_label, tipo, cantidad, referencia, nota, creado_en)
       VALUES (?,?,?,?,?,?,?, NOW(6))`,
      [it.producto_id, it.variante_id, it.variante_label ?? null, tipo, cantidad, referencia.slice(0, 255), nota.slice(0, 255)]);
  }

  /** Separar: la pieza sale del almacén y queda a nombre de la orden. */
  private async apartar(q: Q, orden: OrdenRef, it: ItemDemanda, cantidad: number, nota = 'Sale del almacén a Separados') {
    await q.query(`UPDATE productos SET stock_actual = COALESCE(stock_actual,0) - ? WHERE id = ?`, [cantidad, it.producto_id]);
    if (it.variante_id)
      await q.query(`UPDATE variantes_producto SET stock_actual = COALESCE(stock_actual,0) - ? WHERE id = ?`, [cantidad, it.variante_id]);
    await this.movimiento(q, 'salida', it, cantidad, `Separado para ${orden.numero}`, nota);
    await q.query(
      `INSERT INTO reservas_inventario
         (orden_id, producto_id, producto_nombre, variante_id, variante_label, cantidad_reservada, estado, descontada, creado_en)
       VALUES (?,?,?,?,?,?, 'activa', 1, NOW(6))`,
      [orden.id, it.producto_id, String(it.producto ?? '').slice(0, 255), it.variante_id, it.variante_label, cantidad]);
  }

  /** Soltar lo separado: si ya había salido del almacén, vuelve con su entrada. */
  private async liberar(q: Q, orden: OrdenRef, it: { producto_id: number; variante_id: number | null }, cantidad: number, nota = 'Vuelve de Separados al almacén') {
    let resto = cantidad;
    const filas = await q.query(
      `SELECT id, cantidad_reservada, descontada, variante_label FROM reservas_inventario
        WHERE orden_id = ? AND producto_id = ? AND COALESCE(variante_id,0) = ? AND estado = 'activa'
        ORDER BY id DESC`, [orden.id, it.producto_id, it.variante_id ?? 0]);
    for (const f of filas) {
      if (resto <= EPS) break;
      const c = n(f.cantidad_reservada);
      const suelta = Math.min(c, resto);
      if (c <= resto + EPS) await q.query(`UPDATE reservas_inventario SET estado = 'liberada' WHERE id = ?`, [f.id]);
      else await q.query(`UPDATE reservas_inventario SET cantidad_reservada = ? WHERE id = ?`, [c - suelta, f.id]);
      if (Number(f.descontada)) {
        await q.query(`UPDATE productos SET stock_actual = COALESCE(stock_actual,0) + ? WHERE id = ?`, [suelta, it.producto_id]);
        if (it.variante_id)
          await q.query(`UPDATE variantes_producto SET stock_actual = COALESCE(stock_actual,0) + ? WHERE id = ?`, [suelta, it.variante_id]);
        await this.movimiento(q, 'entrada', { ...it, variante_label: f.variante_label }, suelta, `Devuelto de ${orden.numero}`, nota);
      }
      resto -= suelta;
    }
  }

  // ── Proveedor y orden de compra ────────────────────────────────────────────
  /**
   * Proveedor de un producto: el que tiene asignado en su ficha (que se elige de la
   * lista de proveedores), si no el de la tabla proveedor_productos, y si no hay
   * ninguno la compra queda "POR ASIGNAR PROVEEDOR" con aviso. Nada se pierde.
   */
  async resolverProveedor(q: Q, productoId: number): Promise<{ id: number | null; nombre: string | null; pendiente: boolean }> {
    const [p] = await q.query(`SELECT proveedor FROM productos WHERE id = ?`, [productoId]);
    const texto = String(p?.proveedor ?? '').trim();
    if (texto) {
      const [v] = await q.query(`SELECT id, nombre FROM proveedores WHERE UPPER(TRIM(nombre)) = UPPER(?) LIMIT 1`, [texto]);
      return { id: v ? n(v.id) : null, nombre: v?.nombre ?? texto, pendiente: false };
    }
    const [pp] = await q.query(
      `SELECT v.id, v.nombre FROM proveedor_productos x JOIN proveedores v ON v.id = x.proveedor_id
        WHERE x.producto_id = ? ORDER BY COALESCE(x.precio_compra, 999999999) LIMIT 1`, [productoId]);
    if (pp) return { id: n(pp.id), nombre: pp.nombre, pendiente: false };
    return { id: null, nombre: PROVEEDOR_PENDIENTE, pendiente: true };
  }

  private async siguienteNumeroOC(q: Q) {
    const year = new Date().getFullYear();
    const [r] = await q.query(
      `SELECT numero FROM ordenes_compra WHERE numero LIKE ?
        ORDER BY CAST(SUBSTRING_INDEX(numero, '-', -1) AS UNSIGNED) DESC LIMIT 1`, [`OC-${year}-%`]);
    const ultimo = r ? (parseInt(String(r.numero).split('-').pop() ?? '0', 10) || 0) : 0;
    return `OC-${year}-${String(ultimo + 1).padStart(3, '0')}`;
  }

  private async lineaCompra(q: Q, it: ItemDemanda, cantidad: number) {
    const [p] = await q.query(`SELECT nombre, costo FROM productos WHERE id = ?`, [it.producto_id]);
    let costo = n(p?.costo);
    let sku: string | null = null, color: string | null = null, talla: string | null = null;
    if (it.variante_id) {
      const [v] = await q.query(`SELECT sku, costo, atributos FROM variantes_producto WHERE id = ?`, [it.variante_id]);
      if (v) {
        if (n(v.costo) > 0) costo = n(v.costo);
        sku = v.sku;
        const a = this.atributos(v.atributos);
        color = a.COLOR ?? a.COLORES ?? null;
        talla = a.TALLA ?? a.TALLAS ?? null;
      }
    }
    return {
      producto_id: it.producto_id, producto_nombre: p?.nombre ?? it.producto, variante_id: it.variante_id,
      sku, color, talla, cantidad, precio_unitario: costo, descripcion: '',
    };
  }

  private claveLinea(l: any) {
    return l.variante_id ? `v${l.variante_id}` : `${l.producto_id}|${l.talla ?? ''}|${l.color ?? ''}`;
  }

  /** Agrega la pieza al borrador del proveedor (o crea uno) y anota qué orden la pidió. */
  private async agregarACompra(
    q: Q, orden: OrdenRef | null, it: ItemDemanda, cantidad: number,
    comprador: string, documentoOrigen: string,
  ) {
    const prov = await this.resolverProveedor(q, it.producto_id);
    const existentes = prov.id
      ? await q.query(
          `SELECT id, numero, lineas, op_ids FROM ordenes_compra
            WHERE estado = 'borrador' AND (proveedor_id = ? OR (proveedor_id IS NULL AND UPPER(TRIM(proveedor)) = UPPER(?)))
            ORDER BY id DESC LIMIT 1 FOR UPDATE`, [prov.id, prov.nombre])
      : await q.query(
          `SELECT id, numero, lineas, op_ids FROM ordenes_compra
            WHERE estado = 'borrador' AND proveedor_id IS NULL AND UPPER(TRIM(proveedor)) = UPPER(?)
            ORDER BY id DESC LIMIT 1 FOR UPDATE`, [prov.nombre]);
    const existente = existentes?.[0];
    const linea = await this.lineaCompra(q, it, cantidad);
    let ocId: number, numero: string;

    if (existente) {
      const lineas: any[] = J(existente.lineas, []);
      const igual = lineas.find(l => this.claveLinea(l) === this.claveLinea(linea));
      if (igual) igual.cantidad = n(igual.cantidad) + cantidad; else lineas.push(linea);
      const total = lineas.reduce((s, l) => s + n(l.cantidad) * n(l.precio_unitario ?? l.costo_unit), 0);
      const ops: number[] = (J(existente.op_ids, []) as any[]).map(Number);
      if (orden && !ops.includes(orden.id)) ops.push(orden.id);
      await q.query(
        `UPDATE ordenes_compra SET lineas = ?, total = ?, op_ids = ?, proveedor_id = COALESCE(proveedor_id, ?) WHERE id = ?`,
        [JSON.stringify(lineas), total, ops.length ? JSON.stringify(ops) : null, prov.id, existente.id]);
      ocId = n(existente.id);
      numero = existente.numero;
    } else {
      numero = await this.siguienteNumeroOC(q);
      const notas = (prov.pendiente ? '⚠ Asignar proveedor antes de confirmar. ' : '') + `Generada automáticamente desde ${documentoOrigen}`;
      const r = await q.query(
        `INSERT INTO ordenes_compra
           (numero, proveedor, proveedor_id, estado, total, notas, comprador, documento_origen,
            orden_produccion_id, lineas, op_ids, aplica_itbis, creado_en, actualizado_en)
         VALUES (?,?,?, 'borrador', ?,?,?,?, ?,?,?, 0, NOW(6), NOW(6))`,
        [numero, prov.nombre, prov.id, n(linea.cantidad) * n(linea.precio_unitario), notas, comprador, documentoOrigen,
         orden?.id ?? null, JSON.stringify([linea]), orden ? JSON.stringify([orden.id]) : null]);
      ocId = n(r?.insertId);
    }

    if (orden)
      await q.query(
        `INSERT INTO compras_faltantes (orden_id, orden_compra_id, producto_id, variante_id, cantidad) VALUES (?,?,?,?,?)`,
        [orden.id, ocId, it.producto_id, it.variante_id, cantidad]);

    return { id: ocId, numero, proveedor_id: prov.id, proveedor_nombre: prov.nombre, pendiente: prov.pendiente };
  }

  /**
   * La orden ya no necesita tanto: se reduce lo pedido. El documento solo se toca
   * si sigue en borrador; si ya se le pidió al proveedor, la mercancía llega igual
   * y entra libre al inventario.
   */
  private async reducirCompra(q: Q, ordenId: number, it: { producto_id: number; variante_id: number | null }, cantidad: number) {
    let resto = cantidad;
    const filas = await q.query(
      `SELECT id, orden_compra_id, cantidad, cantidad_recibida FROM compras_faltantes
        WHERE orden_id = ? AND producto_id = ? AND COALESCE(variante_id,0) = ? AND estado = 'pendiente'
        ORDER BY id DESC`, [ordenId, it.producto_id, it.variante_id ?? 0]);
    for (const f of filas) {
      if (resto <= EPS) break;
      const quitar = Math.min(n(f.cantidad) - n(f.cantidad_recibida), resto);
      if (quitar <= EPS) continue;
      const nueva = n(f.cantidad) - quitar;
      const estado = nueva <= n(f.cantidad_recibida) + EPS ? (n(f.cantidad_recibida) > 0 ? 'cubierta' : 'cancelada') : 'pendiente';
      await q.query(`UPDATE compras_faltantes SET cantidad = ?, estado = ? WHERE id = ?`, [nueva, estado, f.id]);

      const ocs = await q.query(`SELECT id, estado, lineas, op_ids FROM ordenes_compra WHERE id = ? FOR UPDATE`, [f.orden_compra_id]);
      const oc = ocs?.[0];
      if (oc?.estado === 'borrador') {
        const lineas: any[] = J(oc.lineas, []);
        const l = lineas.find(x => n(x.producto_id) === it.producto_id && n(x.variante_id) === n(it.variante_id));
        if (l) l.cantidad = Math.max(0, n(l.cantidad) - quitar);
        const quedan = lineas.filter(x => n(x.cantidad) > EPS);
        const [sigue] = await q.query(
          `SELECT COUNT(*) c FROM compras_faltantes WHERE orden_compra_id = ? AND orden_id = ? AND estado = 'pendiente'`, [oc.id, ordenId]);
        const ops = (J(oc.op_ids, []) as any[]).map(Number).filter(x => n(sigue?.c) > 0 || x !== ordenId);
        const total = quedan.reduce((s, x) => s + n(x.cantidad) * n(x.precio_unitario ?? x.costo_unit), 0);
        await q.query(`UPDATE ordenes_compra SET lineas = ?, total = ?, op_ids = ? WHERE id = ?`,
          [JSON.stringify(quedan), total, ops.length ? JSON.stringify(ops) : null, oc.id]);
      }
      resto -= quitar;
    }
    return cantidad - resto;
  }

  private estadoGeneral(demanda: Map<string, ItemDemanda>, reservado: Map<string, number>): 'disponible' | 'parcial' | 'en_espera' {
    if (!demanda.size) return 'disponible';
    let completos = 0, vacios = 0;
    for (const d of demanda.values()) {
      const r = reservado.get(d.clave) ?? 0;
      if (r >= d.cantidad - EPS) completos++; else if (r <= EPS) vacios++;
    }
    if (completos === demanda.size) return 'disponible';
    if (vacios === demanda.size) return 'en_espera';
    return 'parcial';
  }

  // ── Operación principal ────────────────────────────────────────────────────
  /** Separa lo que alcance, pide lo que falte y guarda el estado de materiales. */
  async sincronizar(
    ordenId: number,
    opts: { comprador?: string; documentoOrigen?: string; generarCompras?: boolean } = {},
  ): Promise<ResultadoMateriales> {
    await this.asegurarTablas();
    const vacio: ResultadoMateriales = {
      faltantes: [], ordenes_generadas: [], estado_sugerido: 'pendiente_produccion',
      estado_materiales: 'disponible', pendientes_proveedor: 0,
    };
    const [o] = await this.ds.query(`SELECT id, numero, estado, estado_produccion FROM ordenes_produccion WHERE id = ?`, [ordenId]);
    if (!o) return { ...vacio, omitida: 'La orden no existe' };
    if (this.yaConsumio(o)) return { ...vacio, omitida: 'La orden ya consumió su material' };
    if (!await this.esMedible(n(o.id))) return { ...vacio, omitida: 'Orden anterior a la carga del inventario' };
    const orden: OrdenRef = { id: n(o.id), numero: o.numero };

    return this.ds.transaction(async em => {
      const demanda = await this.demandaOrden(em, ordenId);

      // 1. Devolver lo separado de más (la orden bajó cantidades o quitó líneas)
      for (const [clave, r] of await this.reservadoPorClave(em, ordenId)) {
        const dem = demanda.get(clave)?.cantidad ?? 0;
        if (r > dem + EPS) await this.liberar(em, orden, this.partirClave(clave), r - dem);
      }

      // 2. Separar lo que falte si hay existencia en el almacén
      let reservado = await this.reservadoPorClave(em, ordenId);
      for (const d of demanda.values()) {
        const falta = d.cantidad - (reservado.get(d.clave) ?? 0);
        if (falta <= EPS) continue;
        const toma = Math.min(falta, await this.libre(em, d.producto_id, d.variante_id));
        if (toma > EPS) await this.apartar(em, orden, d, toma);
      }
      reservado = await this.reservadoPorClave(em, ordenId);

      // 3. Pedir al proveedor lo que siga faltando, sin repetir lo ya pedido.
      //    Lo pedido DE MÁS se reduce siempre, aunque no se generen compras nuevas:
      //    con generarCompras=false (revalidar tras una entrada) se separaba del
      //    almacén pero la compra seguía pedida, y el borrador quedaba con piezas
      //    dobles (OP-2026-1131: 2 separadas + 2 pedidas para 2, 19-sep-2026).
      {
        const pendiente = await this.pendienteCompraPorClave(em, ordenId);
        for (const d of demanda.values()) {
          if (!d.comprable) continue;
          const pedir = (d.cantidad - (reservado.get(d.clave) ?? 0)) - (pendiente.get(d.clave) ?? 0);
          if (pedir > EPS && opts.generarCompras !== false)
            await this.agregarACompra(em, orden, d, pedir, opts.comprador ?? 'Sistema', opts.documentoOrigen ?? o.numero);
          else if (pedir < -EPS) await this.reducirCompra(em, ordenId, d, -pedir);
        }
        for (const [clave, p] of pendiente)
          if (!demanda.has(clave) && p > EPS) await this.reducirCompra(em, ordenId, this.partirClave(clave), p);
      }

      // 4. Qué quedó pendiente y en qué compra está
      const pedidos = await em.query(
        `SELECT cf.producto_id, cf.variante_id, oc.id oc_id, oc.numero, oc.proveedor, oc.proveedor_id
           FROM compras_faltantes cf JOIN ordenes_compra oc ON oc.id = cf.orden_compra_id
          WHERE cf.orden_id = ? AND cf.estado = 'pendiente' AND oc.estado <> 'cancelada' ORDER BY cf.id`, [ordenId]);
      const ocPorClave = new Map<string, any>();
      const ocIds = new Set<number>();
      for (const r of pedidos) {
        ocIds.add(n(r.oc_id));
        ocPorClave.set(this.clave(n(r.producto_id), r.variante_id ? n(r.variante_id) : null), r);
      }

      const faltantes: FaltanteMaterial[] = [];
      let pendProv = 0;
      for (const d of demanda.values()) {
        const res = reservado.get(d.clave) ?? 0;
        const falta = d.cantidad - res;
        if (falta <= EPS) continue;
        const oc = ocPorClave.get(d.clave);
        const prov = oc
          ? { id: oc.proveedor_id ? n(oc.proveedor_id) : null, nombre: oc.proveedor as string, pendiente: oc.proveedor === PROVEEDOR_PENDIENTE }
          : d.comprable ? await this.resolverProveedor(em, d.producto_id) : { id: null, nombre: null, pendiente: false };
        if (prov.pendiente) pendProv++;
        faltantes.push({
          producto_id: d.producto_id, producto_nombre: d.producto, variante_id: d.variante_id, variante_label: d.variante_label,
          requerido: d.cantidad, disponible: res, faltante: falta,
          proveedor_id: prov.id, proveedor_nombre: prov.nombre, pendiente_proveedor: prov.pendiente, oc_numero: oc?.numero ?? null,
        });
      }

      const estado = this.estadoGeneral(demanda, reservado);
      await em.query(`UPDATE ordenes_produccion SET estado_materiales = ? WHERE id = ?`, [estado, ordenId]);
      return {
        faltantes, ordenes_generadas: [...ocIds],
        estado_sugerido: estado === 'disponible' ? 'pendiente_produccion' : 'esperando_materiales',
        estado_materiales: estado, pendientes_proveedor: pendProv,
      };
    });
  }

  async sincronizarSeguro(ordenId: number, opts: { comprador?: string; documentoOrigen?: string; generarCompras?: boolean } = {}) {
    try { return await this.sincronizar(ordenId, opts); }
    catch (e: any) { this.logger.error(`No se pudieron sincronizar los materiales de la orden #${ordenId}: ${e.message}`); return null; }
  }

  /**
   * Se editaron las líneas de una orden. Las medibles y sin iniciar se recalculan
   * completas. En las viejas (declaradas cuadradas) o ya en producción, lo que
   * tenían estaba cubierto: solo se atiende la DIFERENCIA — lo que aumentó se
   * separa o se pide, lo que bajó se deja de pedir o vuelve al almacén.
   */
  async aplicarCambio(ordenId: number, antes: Map<string, ItemDemanda>, opts: { comprador?: string; documentoOrigen?: string } = {}) {
    await this.asegurarTablas();
    const [o] = await this.ds.query(`SELECT id, numero, estado, estado_produccion FROM ordenes_produccion WHERE id = ?`, [ordenId]);
    if (!o || ['entregado', 'cancelado', 'listo', 'listo_parcial'].includes(String(o.estado))) return null;
    if (!this.yaConsumio(o) && await this.esMedible(n(o.id)))
      return this.sincronizar(ordenId, { ...opts, generarCompras: true });
    const orden: OrdenRef = { id: n(o.id), numero: o.numero };

    return this.ds.transaction(async em => {
      const despues = await this.demandaOrden(em, ordenId);
      const generadas = new Set<number>();
      for (const clave of new Set([...antes.keys(), ...despues.keys()])) {
        const it = despues.get(clave) ?? antes.get(clave)!;
        const delta = (despues.get(clave)?.cantidad ?? 0) - (antes.get(clave)?.cantidad ?? 0);
        if (delta > EPS) {
          const toma = Math.min(delta, await this.libre(em, it.producto_id, it.variante_id));
          if (toma > EPS) await this.apartar(em, orden, it, toma);
          const resta = delta - toma;
          if (resta > EPS && it.comprable) {
            const oc = await this.agregarACompra(em, orden, it, resta, opts.comprador ?? 'Sistema', opts.documentoOrigen ?? o.numero);
            generadas.add(oc.id);
          }
        } else if (delta < -EPS) {
          let quitar = -delta;
          quitar -= await this.reducirCompra(em, ordenId, this.partirClave(clave), quitar);
          if (quitar > EPS) {
            const res = (await this.reservadoPorClave(em, ordenId)).get(clave) ?? 0;
            if (res > EPS) await this.liberar(em, orden, this.partirClave(clave), Math.min(res, quitar));
          }
        }
      }
      if (!this.yaConsumio(o)) {
        const [pend] = await em.query(`SELECT COUNT(*) c FROM compras_faltantes WHERE orden_id = ? AND estado = 'pendiente'`, [ordenId]);
        await em.query(`UPDATE ordenes_produccion SET estado_materiales = ? WHERE id = ?`, [n(pend?.c) > 0 ? 'parcial' : 'disponible', ordenId]);
      }
      return { ordenes_generadas: [...generadas] };
    });
  }

  /**
   * La orden se cancela: lo separado vuelve al almacén y se deja de pedir lo que
   * estaba en compras en borrador.
   */
  async liberarOrden(ordenId: number, motivo: string) {
    await this.asegurarTablas();
    const [o] = await this.ds.query(`SELECT id, numero FROM ordenes_produccion WHERE id = ?`, [ordenId]);
    if (!o) return;
    const orden: OrdenRef = { id: n(o.id), numero: o.numero };
    await this.ds.transaction(async em => {
      for (const [clave, r] of await this.reservadoPorClave(em, ordenId))
        if (r > EPS) await this.liberar(em, orden, this.partirClave(clave), r, motivo);
      for (const [clave, p] of await this.pendienteCompraPorClave(em, ordenId))
        if (p > EPS) await this.reducirCompra(em, ordenId, this.partirClave(clave), p);
      await em.query(`UPDATE compras_faltantes SET estado = 'cancelada' WHERE orden_id = ? AND estado = 'pendiente'`, [ordenId]);
    });
  }

  /**
   * La orden arrancó o terminó: su tela ya salió del almacén, así que lo que
   * siguiera pedido para ella no le sirve. En un borrador la pieza se quita; en
   * una compra ya confirmada llega igual y entra libre. Con consumirSeparado, lo
   * separado (ya descontado) se marca consumido sin mover stock.
   *
   * Antes nada cerraba estos pedidos: órdenes listas y entregadas seguían con
   * líneas en el borrador (OP-2026-1125, 1131 y 1155 en OC-2026-025, 19-sep-2026).
   */
  async cerrarPedidosPendientes(ordenId: number, motivo: string, opts: { consumirSeparado?: boolean } = {}) {
    await this.asegurarTablas();
    const [o] = await this.ds.query(`SELECT id, numero FROM ordenes_produccion WHERE id = ?`, [ordenId]);
    if (!o) return { piezas_quitadas: 0 };
    let quitadas = 0;
    await this.ds.transaction(async em => {
      for (const [clave, p] of await this.pendienteCompraPorClave(em, ordenId))
        if (p > EPS) quitadas += await this.reducirCompra(em, ordenId, this.partirClave(clave), p);
      await em.query(`UPDATE compras_faltantes SET estado = 'cancelada' WHERE orden_id = ? AND estado = 'pendiente'`, [ordenId]);
      if (opts.consumirSeparado)
        await em.query(`UPDATE reservas_inventario SET estado = 'consumida' WHERE orden_id = ? AND estado = 'activa' AND descontada = 1`, [ordenId]);
    });
    if (quitadas > EPS) this.logger.log(`${o.numero}: ${quitadas} pieza(s) dejan de pedirse (${motivo})`);
    return { piezas_quitadas: quitadas };
  }

  /**
   * Limpia un borrador de compra: quita lo pedido por órdenes que ya arrancaron o
   * terminaron y vuelve a cuadrar las que siguen esperando (separado + pedido =
   * lo que pide la orden). Botón "Depurar" en la orden de compra.
   */
  async depurarBorrador(ocId: number, comprador = 'Sistema') {
    await this.asegurarTablas();
    const [oc] = await this.ds.query(`SELECT id, numero, estado, op_ids, lineas FROM ordenes_compra WHERE id = ?`, [ocId]);
    if (!oc) return null;
    if (oc.estado !== 'borrador') return { numero: oc.numero, omitida: 'Solo se depura un borrador' };
    // Pedidos colgados de compras canceladas: no cuentan para nadie
    await this.ds.query(
      `UPDATE compras_faltantes cf JOIN ordenes_compra o ON o.id = cf.orden_compra_id
          SET cf.estado = 'cancelada' WHERE o.estado = 'cancelada' AND cf.estado = 'pendiente'`);
    const antes = (J(oc.lineas, []) as any[]).reduce((s, l) => s + n(l.cantidad), 0);
    const ordenes = await this.ds.query(
      `SELECT DISTINCT o.id, o.numero, o.estado, o.estado_produccion FROM compras_faltantes cf
         JOIN ordenes_produccion o ON o.id = cf.orden_id WHERE cf.orden_compra_id = ? AND cf.estado = 'pendiente'`, [ocId]);
    const cerradas: string[] = [], recalculadas: string[] = [];
    for (const o of ordenes) {
      if (this.yaConsumio(o)) {
        await this.cerrarPedidosPendientes(n(o.id), `Depuración de ${oc.numero}`, { consumirSeparado: true });
        cerradas.push(o.numero);
      } else if (await this.esMedible(n(o.id))) {
        await this.sincronizarSeguro(n(o.id), { generarCompras: true, comprador, documentoOrigen: `Depuración de ${oc.numero}` });
        recalculadas.push(o.numero);
      }
    }
    const [d] = await this.ds.query(`SELECT lineas FROM ordenes_compra WHERE id = ?`, [ocId]);
    const despues = (J(d?.lineas, []) as any[]).reduce((s, l) => s + n(l.cantidad), 0);
    return { numero: oc.numero, ordenes_cerradas: cerradas, ordenes_recalculadas: recalculadas, piezas_antes: antes, piezas_despues: despues };
  }

  /**
   * Para la pantalla de la compra: qué pide una orden por talla y color, cuánto ya
   * está separado (salió del almacén a su nombre) y cuánto viene en ESTA compra.
   * Sin esto la pantalla decía "×20" y la compra traía 10: las otras 10 estaban
   * separadas y nadie lo veía (19-sep-2026).
   */
  async resumenOrdenParaCompra(ordenId: number, ocId: number) {
    const demanda = await this.demandaOrden(this.ds, ordenId);
    const reservado = await this.reservadoPorClave(this.ds, ordenId);
    const enEsta = new Map<string, number>(), enOtras = new Map<string, string[]>();
    for (const r of await this.ds.query(
      `SELECT cf.producto_id, cf.variante_id, cf.orden_compra_id, oc.numero, SUM(cf.cantidad - cf.cantidad_recibida) t
         FROM compras_faltantes cf JOIN ordenes_compra oc ON oc.id = cf.orden_compra_id
        WHERE cf.orden_id = ? AND cf.estado = 'pendiente' AND oc.estado <> 'cancelada'
        GROUP BY cf.producto_id, cf.variante_id, cf.orden_compra_id, oc.numero`, [ordenId])) {
      const k = this.clave(n(r.producto_id), r.variante_id ? n(r.variante_id) : null);
      if (n(r.orden_compra_id) === n(ocId)) enEsta.set(k, (enEsta.get(k) ?? 0) + n(r.t));
      else if (n(r.t) > EPS) enOtras.set(k, [...(enOtras.get(k) ?? []), String(r.numero)]);
    }
    return [...demanda.values()].map(d => ({
      producto_id: d.producto_id, producto: d.producto, variante_id: d.variante_id, variante_label: d.variante_label,
      necesita: d.cantidad, separado: reservado.get(d.clave) ?? 0, en_esta_compra: enEsta.get(d.clave) ?? 0,
      en_otras_compras: enOtras.get(d.clave) ?? [], comprable: d.comprable,
      sin_cubrir: Math.max(0, d.cantidad - (reservado.get(d.clave) ?? 0) - (enEsta.get(d.clave) ?? 0)),
    }));
  }

  /**
   * "No está físicamente": una pieza separada que el conteo dio por existente y no
   * aparece en el almacén (GINDUCAL, 19-sep-2026: el conteo del 11-sep cargó 11
   * NEGRO/S que no existían; 10 se separaron para OP-2026-1173 y la compra no las
   * pedía). Se devuelve la separación y se registra la salida por corrección de
   * conteo (el stock queda como estaba, pero el rastro es honesto), y la orden se
   * vuelve a cuadrar: lo que ya no tiene, lo pide a la compra.
   */
  async separadoNoExiste(reservaId: number, cantidad: number | null, usuario: string) {
    await this.asegurarTablas();
    const [r] = await this.ds.query(
      `SELECT r.*, o.numero orden_numero FROM reservas_inventario r JOIN ordenes_produccion o ON o.id = r.orden_id WHERE r.id = ?`, [reservaId]);
    if (!r) throw new Error('La separación no existe');
    if (r.estado !== 'activa') throw new Error('Esa separación ya no está activa');
    if (!Number(r.descontada)) throw new Error('Esa reserva es de las viejas (no descontó stock): libérala desde la orden');
    const total = n(r.cantidad_reservada);
    const cant = cantidad != null ? Math.min(total, Math.max(0, n(cantidad))) : total;
    if (cant <= EPS) throw new Error('Cantidad inválida');
    const orden: OrdenRef = { id: n(r.orden_id), numero: r.orden_numero };
    const it = { producto_id: n(r.producto_id), variante_id: r.variante_id ? n(r.variante_id) : null, variante_label: r.variante_label ?? null };

    await this.ds.transaction(async em => {
      await this.liberar(em, orden, it, cant, 'No estaba físicamente: se anula la separación');
      await em.query(`UPDATE productos SET stock_actual = COALESCE(stock_actual,0) - ? WHERE id = ?`, [cant, it.producto_id]);
      if (it.variante_id)
        await em.query(`UPDATE variantes_producto SET stock_actual = COALESCE(stock_actual,0) - ? WHERE id = ?`, [cant, it.variante_id]);
      await this.movimiento(em, 'salida', it, cant, orden.numero, `Corrección de conteo · no estaba físicamente · ${usuario}`);
    });

    const [o] = await this.ds.query(`SELECT id, numero, estado, estado_produccion FROM ordenes_produccion WHERE id = ?`, [orden.id]);
    const res = o && !this.yaConsumio(o) && await this.esMedible(orden.id)
      ? await this.sincronizarSeguro(orden.id, { generarCompras: true, comprador: usuario, documentoOrigen: `Corrección de conteo ${orden.numero}` })
      : null;
    const oc = res?.faltantes.find(f => f.producto_id === it.producto_id && (f.variante_id ?? null) === it.variante_id)?.oc_numero ?? null;
    return { orden: orden.numero, cantidad: cant, producto_id: it.producto_id, variante_label: it.variante_label, oc_numero: oc, estado_materiales: res?.estado_materiales ?? null };
  }

  /**
   * Llegó una compra (su entrada ya se registró): lo recibido sale a Separados
   * primero para las órdenes que la originaron, empezando por la más vieja. Lo
   * que sobre queda en el almacén para las órdenes que esperan. Si la compra llegó
   * incompleta, lo que no llegó se vuelve a pedir para las órdenes que lo necesitaban.
   */
  async recibirParaOrdenes(ocId: number, recibidas: Array<{ producto_id: number; variante_id?: number | null; cantidad_recibida: number }>) {
    await this.asegurarTablas();
    const afectadas = new Map<number, string>();
    let piezas = 0;
    const [oc] = await this.ds.query(`SELECT numero FROM ordenes_compra WHERE id = ?`, [ocId]);

    await this.ds.transaction(async em => {
      for (const rec of recibidas) {
        let resto = n(rec.cantidad_recibida);
        if (resto <= EPS) continue;
        const filas = await em.query(
          `SELECT cf.id, cf.orden_id, cf.cantidad, cf.cantidad_recibida, o.numero, o.estado, p.nombre producto
             FROM compras_faltantes cf
             JOIN ordenes_produccion o ON o.id = cf.orden_id
             LEFT JOIN productos p ON p.id = cf.producto_id
            WHERE cf.orden_compra_id = ? AND cf.producto_id = ? AND COALESCE(cf.variante_id,0) = ? AND cf.estado = 'pendiente'
            ORDER BY o.creado_en ASC, cf.id ASC FOR UPDATE`, [ocId, rec.producto_id, rec.variante_id ?? 0]);
        let label: string | null = null;
        if (rec.variante_id) {
          const [v] = await em.query(`SELECT atributos FROM variantes_producto WHERE id = ?`, [rec.variante_id]);
          label = v ? this.etiqueta(v.atributos) : null;
        }
        for (const f of filas) {
          if (resto <= EPS) break;
          if (['entregado', 'cancelado'].includes(String(f.estado))) {
            await em.query(`UPDATE compras_faltantes SET estado = 'cancelada' WHERE id = ?`, [f.id]);
            continue;
          }
          const toma = Math.min(n(f.cantidad) - n(f.cantidad_recibida), resto);
          if (toma <= EPS) continue;
          await this.apartar(em, { id: n(f.orden_id), numero: f.numero }, {
            clave: '', producto_id: rec.producto_id, variante_id: rec.variante_id ?? null, variante_label: label,
            producto: f.producto ?? '', cantidad: toma, comprable: true,
          }, toma, `Llegó en ${oc?.numero ?? 'compra'} y pasa a Separados`);
          const recibido = n(f.cantidad_recibida) + toma;
          await em.query(`UPDATE compras_faltantes SET cantidad_recibida = ?, estado = ? WHERE id = ?`,
            [recibido, recibido >= n(f.cantidad) - EPS ? 'cubierta' : 'pendiente', f.id]);
          afectadas.set(n(f.orden_id), f.numero);
          piezas += toma;
          resto -= toma;
        }
      }
      // La compra se cerró: lo que no llegó ya no está pedido en ella.
      const sinLlegar = await em.query(
        `SELECT DISTINCT orden_id FROM compras_faltantes WHERE orden_compra_id = ? AND estado = 'pendiente'`, [ocId]);
      for (const s of sinLlegar) if (!afectadas.has(n(s.orden_id))) afectadas.set(n(s.orden_id), '');
      await em.query(`UPDATE compras_faltantes SET estado = 'cancelada' WHERE orden_compra_id = ? AND estado = 'pendiente'`, [ocId]);
    });

    for (const id of afectadas.keys()) {
      if (await this.esMedible(id)) await this.sincronizarSeguro(id, { generarCompras: true, comprador: 'Sistema', documentoOrigen: 'Recepción de compra' });
      else {
        const [pend] = await this.ds.query(`SELECT COUNT(*) c FROM compras_faltantes WHERE orden_id = ? AND estado = 'pendiente'`, [id]);
        await this.ds.query(`UPDATE ordenes_produccion SET estado_materiales = ? WHERE id = ? AND estado_produccion = 'sin_iniciar'`,
          [n(pend?.c) > 0 ? 'parcial' : 'disponible', id]);
      }
    }
    await this.revalidarEnEspera([...afectadas.keys()]);
    return { piezas_apartadas: piezas, ordenes: [...afectadas.values()].filter(Boolean) };
  }

  /** Órdenes medibles que esperan material: toman lo que haya quedado en el almacén, sin pedir más. */
  async revalidarEnEspera(excluir: number[] = []) {
    const corte = await this.corteOrdenId();
    const incluidas = await this.ordenesIncluidas();
    const espera = await this.ds.query(
      `SELECT id FROM ordenes_produccion
        WHERE (id >= ? OR id IN (?)) AND estado_materiales <> 'disponible' AND estado_produccion = 'sin_iniciar'
          AND estado NOT IN ('entregado','cancelado','listo','listo_parcial')
        ORDER BY creado_en ASC`, [corte, incluidas.length ? incluidas : [0]]);
    for (const e of espera)
      if (!excluir.includes(n(e.id))) await this.sincronizarSeguro(n(e.id), { generarCompras: false });
  }

  // ── Venta directa (sin orden de producción) ────────────────────────────────
  async reponerInventario(
    items: Array<{ producto_id: number; cantidad: number; variante_id?: number | null }>,
    comprador: string, documentoOrigen: string,
  ): Promise<ResultadoMateriales> {
    await this.asegurarTablas();
    return this.ds.transaction(async em => {
      const faltantes: FaltanteMaterial[] = [];
      const generadas = new Set<number>();
      let pendProv = 0;
      for (const item of items ?? []) {
        const pid = n(item.producto_id);
        const [p] = await em.query(`SELECT nombre, maneja_inventario, tipo_producto FROM productos WHERE id = ?`, [pid]);
        if (!p || !Number(p.maneja_inventario) || ['fisico_fabricado', 'servicio'].includes(p.tipo_producto)) continue;
        const v = await this.resolverVariante(em, pid, item.variante_id ?? null, '');
        const libre = await this.libre(em, pid, v?.id ?? null);
        const falta = n(item.cantidad) - libre;
        if (falta <= EPS) continue;
        const it: ItemDemanda = {
          clave: this.clave(pid, v?.id ?? null), producto_id: pid, variante_id: v?.id ?? null, variante_label: v?.label ?? null,
          producto: p.nombre, cantidad: n(item.cantidad), comprable: true,
        };
        const oc = await this.agregarACompra(em, null, it, falta, comprador, documentoOrigen);
        generadas.add(oc.id);
        if (oc.pendiente) pendProv++;
        faltantes.push({
          producto_id: pid, producto_nombre: p.nombre, variante_id: it.variante_id, variante_label: it.variante_label,
          requerido: it.cantidad, disponible: libre, faltante: falta,
          proveedor_id: oc.proveedor_id, proveedor_nombre: oc.proveedor_nombre, pendiente_proveedor: oc.pendiente, oc_numero: oc.numero,
        });
      }
      return {
        faltantes, ordenes_generadas: [...generadas],
        estado_sugerido: faltantes.length ? 'esperando_materiales' : 'pendiente_produccion',
        estado_materiales: 'disponible', pendientes_proveedor: pendProv,
      };
    });
  }

  // ── Separar órdenes de una compra ──────────────────────────────────────────
  async piezasDeOrdenesEnOC(ocId: number, opIds: number[]) {
    await this.asegurarTablas();
    if (!opIds.length) return [] as Array<{ producto_id: number; variante_id: number | null; cantidad: number }>;
    const filas = await this.ds.query(
      `SELECT producto_id, variante_id, SUM(cantidad - cantidad_recibida) cantidad FROM compras_faltantes
        WHERE orden_compra_id = ? AND estado = 'pendiente' AND orden_id IN (${opIds.map(() => '?').join(',')})
        GROUP BY producto_id, variante_id`, [ocId, ...opIds]);
    return filas.map((f: any) => ({ producto_id: n(f.producto_id), variante_id: f.variante_id ? n(f.variante_id) : null, cantidad: n(f.cantidad) }));
  }

  /** Lo que piden las ÓRDENES de cada producto (para compras sin registro exacto). */
  async lineasDeOrdenes(opIds: number[], productoIds: number[]) {
    const suma = new Map<number, number>();
    if (!opIds.length) return [] as Array<{ producto_id: number; cantidad: number }>;
    const filas = await this.ds.query(
      `SELECT lineas_produccion FROM ordenes_produccion WHERE id IN (${opIds.map(() => '?').join(',')})`, opIds);
    for (const f of filas)
      for (const l of J(f.lineas_produccion, []) as any[]) {
        const pid = n(l?.producto_id);
        if (pid && productoIds.map(Number).includes(pid)) suma.set(pid, (suma.get(pid) ?? 0) + n(l.cantidad));
      }
    return [...suma].map(([producto_id, cantidad]) => ({ producto_id, cantidad }));
  }

  async moverFaltantes(ocOrigen: number, ocDestino: number, opIds: number[]) {
    if (!opIds.length) return;
    await this.ds.query(
      `UPDATE compras_faltantes SET orden_compra_id = ?
        WHERE orden_compra_id = ? AND estado = 'pendiente' AND orden_id IN (${opIds.map(() => '?').join(',')})`,
      [ocDestino, ocOrigen, ...opIds]);
  }

  // ── Detalle para la pantalla de la orden ───────────────────────────────────
  async detalleOrden(ordenId: number) {
    await this.asegurarTablas();
    const [o] = await this.ds.query(
      `SELECT id, estado, estado_produccion, lineas_produccion FROM ordenes_produccion WHERE id = ?`, [ordenId]);
    if (!o) return { lineas: [], estado_calculado: 'disponible' };
    const vieja = !await this.esMedible(n(o.id));
    const consumio = this.yaConsumio(o);
    const lineas: any[] = J(o.lineas_produccion, []);
    const reservado = await this.reservadoPorClave(this.ds, ordenId);
    const pendiente = await this.pendienteCompraPorClave(this.ds, ordenId);
    const ocPorClave = new Map<string, string[]>();
    for (const r of await this.ds.query(
      `SELECT cf.producto_id, cf.variante_id, oc.numero FROM compras_faltantes cf JOIN ordenes_compra oc ON oc.id = cf.orden_compra_id
        WHERE cf.orden_id = ? AND cf.estado = 'pendiente' AND oc.estado <> 'cancelada'`, [ordenId])) {
      const k = this.clave(n(r.producto_id), r.variante_id ? n(r.variante_id) : null);
      ocPorClave.set(k, [...new Set([...(ocPorClave.get(k) ?? []), r.numero])]);
    }

    const usado = new Map<string, number>();
    const resultado: any[] = [];
    for (const l of lineas) {
      const pid = n(l?.producto_id);
      const base = {
        producto: l?.producto ?? '', descripcion: l?.descripcion ?? null, producto_id: pid || null,
        cantidad_necesaria: n(l?.cantidad), stock_total: null, reservado_otras_ordenes: 0, reservado_esta_orden: 0,
        pendiente_compra: 0, variante_label: null, disponible: null, en_oc: false, oc_numeros: [] as string[],
      };
      const [p] = pid ? await this.ds.query(`SELECT maneja_inventario, tipo_producto FROM productos WHERE id = ?`, [pid]) : [];
      if (!p || !Number(p.maneja_inventario) || p.tipo_producto === 'servicio') { resultado.push({ ...base, estado: 'sin_inventario' }); continue; }

      const v = await this.resolverVariante(this.ds, pid, l.variante_id ? n(l.variante_id) : null, l.descripcion ?? '');
      const clave = this.clave(pid, v?.id ?? null);
      // stock = lo que queda en el almacén (lo separado ya salió); otras = separado para otras órdenes
      const [st] = v
        ? await this.ds.query(
            `SELECT COALESCE(stock_actual,0) stock, COALESCE((SELECT SUM(cantidad_reservada) FROM reservas_inventario
                WHERE variante_id = ? AND estado = 'activa' AND orden_id <> ?),0) otras FROM variantes_producto WHERE id = ?`, [v.id, ordenId, v.id])
        : await this.ds.query(
            `SELECT COALESCE(stock_actual,0) stock, COALESCE((SELECT SUM(cantidad_reservada) FROM reservas_inventario
                WHERE producto_id = ? AND estado = 'activa' AND orden_id <> ?),0) otras FROM productos WHERE id = ?`, [pid, ordenId, pid]);

      const necesita = n(l.cantidad);
      const asignable = Math.max(0, (reservado.get(clave) ?? 0) - (usado.get(clave) ?? 0));
      const aparta = Math.min(necesita, asignable);
      usado.set(clave, (usado.get(clave) ?? 0) + aparta);
      const pend = pendiente.get(clave) ?? 0;

      let estado: 'ok' | 'parcial' | 'sin_stock';
      if (consumio) estado = 'ok';
      else if (vieja) estado = pend > EPS ? 'parcial' : 'ok';
      else if (aparta >= necesita - EPS) estado = 'ok';
      else if (aparta > EPS) estado = 'parcial';
      else estado = 'sin_stock';

      resultado.push({
        ...base, variante_label: v?.label ?? null,
        stock_total: n(st?.stock), reservado_otras_ordenes: n(st?.otras), reservado_esta_orden: aparta,
        pendiente_compra: pend, disponible: await this.libre(this.ds, pid, v?.id ?? null),
        en_oc: (ocPorClave.get(clave) ?? []).length > 0, oc_numeros: ocPorClave.get(clave) ?? [], estado,
      });
    }

    const conInv = resultado.filter(r => r.estado !== 'sin_inventario');
    let estadoCalc: 'disponible' | 'parcial' | 'en_espera' = 'disponible';
    if (conInv.length && !conInv.every(r => r.estado === 'ok'))
      estadoCalc = conInv.every(r => r.estado === 'sin_stock') ? 'en_espera' : 'parcial';
    if (!vieja && !consumio)
      await this.ds.query(`UPDATE ordenes_produccion SET estado_materiales = ? WHERE id = ?`, [estadoCalc, ordenId]);
    return { lineas: resultado, estado_calculado: estadoCalc };
  }
}
