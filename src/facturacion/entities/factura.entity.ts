import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, OneToMany } from 'typeorm';
import { TipoNcf } from './ncf-secuencia.entity';

export enum TipoComprobante {
  B01      = 'B01',
  B02      = 'B02',
  B14      = 'B14',
  B15      = 'B15',
  PROFORMA = 'PROFORMA',
}

export enum EstadoFactura {
  BORRADOR = 'borrador',
  EMITIDA  = 'emitida',
  PARCIAL  = 'parcial',
  PAGADA   = 'pagada',
  CREDITO  = 'credito',
  ANULADA  = 'anulada',
}

export enum MetodoPago {
  EFECTIVO      = 'efectivo',
  TARJETA       = 'tarjeta',
  TRANSFERENCIA = 'transferencia',
  CHEQUE        = 'cheque',
  CREDITO       = 'credito',
}

@Entity('facturas')
export class Factura {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  numero: string; // FAC-2024-0001

  @Column({ nullable: true })
  ncf: string; // B0100000001 — null para Proforma

  @Column({ type: 'enum', enum: TipoComprobante })
  tipo_ncf: TipoComprobante;

  @Column({ nullable: true })
  orden_produccion_id: number;

  @Column({ nullable: true })
  cotizacion_id: number;

  @Column({ nullable: true })
  cliente_id: number;

  @Column({ nullable: true })
  cliente_nombre: string;

  @Column({ nullable: true })
  cliente_rnc: string;

  @Column({ nullable: true })
  cliente_direccion: string;

  @Column({ nullable: true })
  cliente_telefono: string;

  /** 'Atención a': persona del cliente que solicitó (se hereda de la orden) */
  @Column({ nullable: true })
  atencion_a: string;

  @Column({ type: 'enum', enum: MetodoPago, nullable: true })
  metodo_pago: MetodoPago;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  subtotal: number; // Subtotal BRUTO (antes de descuento)

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  descuento_pct: number; // % de descuento global (heredado de la cotización)

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  descuento_monto: number; // Monto del descuento en RD$

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  itbis: number; // ITBIS sobre la base ya descontada

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  total: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  total_pagado: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  saldo_pendiente: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  credito_a_favor: number;

  @Column({ type: 'enum', enum: EstadoFactura, default: EstadoFactura.BORRADOR })
  estado: EstadoFactura;

  @Column({ type: 'date', nullable: true })
  fecha_vencimiento: string;

  @Column({ nullable: true })
  notas: string;

  // Preparado para e-CF (factura electrónica DGII)
  @Column({ type: 'text', nullable: true })
  ecf_xml: string;

  @Column({ nullable: true })
  ecf_estado: string;

  @Column({ nullable: true })
  creado_por: string;

  @CreateDateColumn()
  fecha_emision: Date;

  // ── Facturación electrónica DGII (e-CF) — portado desde dist del VPS el 6-sep-2026 ──
  @Column({ type: 'enum', enum: ['no_aplica', 'pendiente', 'enviada', 'aprobada', 'rechazada'], default: 'no_aplica' })
  estado_dgii: string;

  @Column({ type: 'datetime', nullable: true })
  enviada_dgii_at: Date;

  @Column({ type: 'datetime', nullable: true })
  aprobada_dgii_at: Date;

  @Column({ type: 'varchar', length: 64, nullable: true })
  track_id_dgii: string;

  @Column({ type: 'varchar', length: 16, nullable: true })
  codigo_seguridad_dgii: string;

  @Column({ type: 'longtext', nullable: true })
  xml_eCF: string;

  @Column({ type: 'varchar', length: 500, nullable: true })
  mensaje_dgii: string;

  @UpdateDateColumn()
  actualizado_en: Date;

  @OneToMany('FacturaLinea', 'factura', { cascade: true, eager: true })
  lineas: any[];

  @OneToMany('FacturaPago', 'factura', { cascade: true, eager: true })
  pagos: any[];

  @OneToMany('NotaCredito', 'factura', { eager: true })
  notas_credito: any[];
}
