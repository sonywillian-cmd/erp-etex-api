import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { fechaHoyLocal, primerDiaMesLocal } from '../common/fecha-local';

@Injectable()
export class ReportesService {
  constructor(private ds: DataSource) {}

  async getTablero(desde?: string, hasta?: string) {
    const desde_ = desde ?? primerDiaMesLocal();
    const hasta_ = hasta ?? fechaHoyLocal();

    const [kpiV, kpiO, kpiP, serie, productos, deptos, clientes] = await Promise.all([
      this.kpiVentas(desde_, hasta_),
      this.kpiOrdenes(desde_, hasta_),
      this.kpiPiezas(desde_, hasta_),
      this.ventasSerie(desde_, hasta_),
      this.topProductos(desde_, hasta_),
      this.deptosProduccion(desde_, hasta_),
      this.topClientes(desde_, hasta_),
    ]);

    return {
      periodo:       { desde: desde_, hasta: hasta_ },
      kpis:          { ...kpiV, ...kpiO, ...kpiP },
      ventas_serie:  serie,
      top_productos: productos,
      departamentos: deptos,
      top_clientes:  clientes,
    };
  }

  // ── KPI ventas ─────────────────────────────────────────────────────────────
  private async kpiVentas(desde: string, hasta: string) {
    const [row] = await this.ds.query(`
      SELECT
        COALESCE(SUM(total),           0) AS total_facturado,
        COALESCE(SUM(total_pagado),    0) AS total_cobrado,
        COALESCE(SUM(saldo_pendiente), 0) AS saldo_pendiente,
        COUNT(*)                          AS num_facturas
      FROM facturas
      WHERE estado NOT IN ('borrador','anulada')
        AND DATE(fecha_emision) BETWEEN ? AND ?
    `, [desde, hasta]);
    return {
      total_facturado: Number(row.total_facturado),
      total_cobrado:   Number(row.total_cobrado),
      saldo_pendiente: Number(row.saldo_pendiente),
      num_facturas:    Number(row.num_facturas),
    };
  }

  // ── KPI órdenes completadas ────────────────────────────────────────────────
  private async kpiOrdenes(desde: string, hasta: string) {
    const [row] = await this.ds.query(`
      SELECT COUNT(*) AS ordenes_completadas
      FROM ordenes_produccion
      WHERE estado IN ('listo','entregado')
        AND DATE(tiempo_fin) BETWEEN ? AND ?
    `, [desde, hasta]);
    return { ordenes_completadas: Number(row.ordenes_completadas) };
  }

  // ── KPI piezas producidas ──────────────────────────────────────────────────
  private async kpiPiezas(desde: string, hasta: string) {
    const [row] = await this.ds.query(`
      SELECT COALESCE(SUM(piezas_ok), 0) AS piezas_producidas
      FROM lotes_produccion
      WHERE estado = 'completado'
        AND DATE(tiempo_fin) BETWEEN ? AND ?
    `, [desde, hasta]);
    return { piezas_producidas: Number(row.piezas_producidas) };
  }

  // ── Serie diaria de ventas ─────────────────────────────────────────────────
  private async ventasSerie(desde: string, hasta: string) {
    const rows = await this.ds.query(`
      SELECT
        DATE(fecha_emision)        AS fecha,
        COALESCE(SUM(total), 0)    AS total,
        COUNT(*)                   AS num_facturas
      FROM facturas
      WHERE estado NOT IN ('borrador','anulada')
        AND DATE(fecha_emision) BETWEEN ? AND ?
      GROUP BY DATE(fecha_emision)
      ORDER BY fecha ASC
    `, [desde, hasta]);
    return rows.map((r: any) => ({
      fecha:        r.fecha,
      total:        Number(r.total),
      num_facturas: Number(r.num_facturas),
    }));
  }

  // ── Top 8 productos más vendidos ──────────────────────────────────────────
  private async topProductos(desde: string, hasta: string) {
    const rows = await this.ds.query(`
      SELECT
        COALESCE(p.nombre, fl.descripcion)  AS nombre,
        COALESCE(SUM(fl.cantidad), 0)        AS cantidad,
        COALESCE(SUM(fl.total), 0)           AS ingresos,
        COUNT(DISTINCT fl.factura_id)        AS num_facturas
      FROM factura_lineas fl
      INNER JOIN facturas f ON f.id = fl.factura_id
      LEFT JOIN  productos p ON p.id = fl.producto_id
      WHERE f.estado NOT IN ('borrador','anulada')
        AND DATE(f.fecha_emision) BETWEEN ? AND ?
      GROUP BY COALESCE(p.nombre, fl.descripcion)
      ORDER BY ingresos DESC
      LIMIT 8
    `, [desde, hasta]);
    return rows.map((r: any) => ({
      nombre:       r.nombre,
      cantidad:     Number(r.cantidad),
      ingresos:     Number(r.ingresos),
      num_facturas: Number(r.num_facturas),
    }));
  }

  // ── Ingresos por departamento (via técnica) ────────────────────────────────
  // Cada lote tiene una técnica; esa técnica coincide con las líneas de
  // cotización → así se asigna el valor económico a cada departamento.
  private async deptosProduccion(desde: string, hasta: string) {
    const rows = await this.ds.query(`
      SELECT
        sub.departamento                     AS nombre,
        COALESCE(SUM(sub.total_linea), 0)    AS ingresos,
        COUNT(DISTINCT sub.factura_id)       AS num_facturas,
        COUNT(DISTINCT sub.cotizacion_id)    AS num_ordenes
      FROM (
        SELECT DISTINCT
          lc.id            AS linea_id,
          lc.total_linea,
          lc.cotizacion_id,
          f.id             AS factura_id,
          lp.departamento
        FROM lineas_cotizacion lc
        INNER JOIN cotizaciones       cot ON cot.id          = lc.cotizacion_id
        INNER JOIN ordenes_produccion op  ON op.cotizacion_id = cot.id
        INNER JOIN lotes_produccion   lp  ON lp.orden_id      = op.id
                                         AND lp.tecnica       = lc.tecnica
                                         AND lp.tecnica IS NOT NULL
        INNER JOIN facturas           f   ON f.cotizacion_id  = cot.id
        WHERE f.estado NOT IN ('borrador','anulada')
          AND lc.tecnica IS NOT NULL
          AND lp.departamento IS NOT NULL
          AND DATE(f.fecha_emision) BETWEEN ? AND ?
      ) sub
      GROUP BY sub.departamento
      ORDER BY ingresos DESC
    `, [desde, hasta]);

    return rows.map((r: any) => ({
      nombre:       r.nombre,
      ingresos:     Number(r.ingresos),
      num_facturas: Number(r.num_facturas),
      num_ordenes:  Number(r.num_ordenes),
    }));
  }

  // ── Top 5 clientes por revenue ─────────────────────────────────────────────
  private async topClientes(desde: string, hasta: string) {
    const rows = await this.ds.query(`
      SELECT
        COALESCE(c.nombre, f.cliente_nombre) AS nombre,
        COALESCE(SUM(f.total), 0)             AS total,
        COUNT(*)                              AS num_facturas
      FROM facturas f
      LEFT JOIN clientes c ON c.id = f.cliente_id
      WHERE f.estado NOT IN ('borrador','anulada')
        AND DATE(f.fecha_emision) BETWEEN ? AND ?
      GROUP BY COALESCE(c.nombre, f.cliente_nombre)
      ORDER BY total DESC
      LIMIT 5
    `, [desde, hasta]);
    return rows.map((r: any) => ({
      nombre:       r.nombre,
      total:        Number(r.total),
      num_facturas: Number(r.num_facturas),
    }));
  }
}
