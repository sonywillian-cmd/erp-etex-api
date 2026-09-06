import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, OneToMany, ManyToOne } from 'typeorm';

export enum EstadoCotizacion {
  BORRADOR   = 'borrador',
  ENVIADA    = 'enviada',
  APROBADA   = 'aprobada',
  RECHAZADA  = 'rechazada',
  CONVERTIDA = 'convertida',
}

export enum ModoPrecio { BUNDLED = 'bundled', DESGLOSADO = 'desglosado' }

@Entity('cotizaciones')
export class Cotizacion {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  numero: string; // COT-2026-001

  @Column()
  cliente_id: number;

  @Column({ nullable: true })
  vendedor_id: number;

  /** Persona del cliente que pide (contacto) — viaja a la orden y a la factura como 'Atención a' */
  @Column({ nullable: true })
  solicitado_por: string;

  @Column({ nullable: true })
  contacto_id: number;

  @Column({ type: 'enum', enum: EstadoCotizacion, default: EstadoCotizacion.BORRADOR })
  estado: EstadoCotizacion;

  @Column({ type: 'enum', enum: ModoPrecio, default: ModoPrecio.BUNDLED })
  modo_precio: ModoPrecio;

  @Column({ default: true })
  aplica_itbis_global: boolean;

  @Column({ nullable: true })
  referencia: string;

  @Column({ type: 'date', nullable: true })
  fecha_vencimiento: Date;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  subtotal: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  descuento_pct: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  itbis_monto: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  total: number;

  @Column({ nullable: true, type: 'text' })
  especificaciones: string;

  @Column({ nullable: true })
  creado_por: string;

  @Column({ nullable: true })
  notas: string;

  @Column({ nullable: true })
  terminos: string;

  @CreateDateColumn()
  creado_en: Date;

  @UpdateDateColumn()
  actualizado_en: Date;
}
