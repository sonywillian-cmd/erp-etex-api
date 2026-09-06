import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

export enum MetodoPago { EFECTIVO = 'efectivo', TARJETA = 'tarjeta', TRANSFERENCIA = 'transferencia', CHEQUE = 'cheque' }
export enum EstadoPago { PENDIENTE = 'pendiente', COMPLETADO = 'completado', PARCIAL = 'parcial', ANULADO = 'anulado' }

@Entity('pagos')
export class Pago {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  numero: string;

  @Column({ nullable: true })
  cliente_id: number;

  @Column({ nullable: true })
  cotizacion_id: number;

  @Column({ nullable: true })
  referencia: string;

  @Column({ type: 'enum', enum: MetodoPago })
  metodo: MetodoPago;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  monto_total: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  itbis_monto: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  base_imponible: number;

  @Column({ default: true })
  incluye_itbis: boolean;

  @Column({ nullable: true })
  banco: string;

  @Column({ nullable: true })
  referencia_banco: string;

  @Column({ type: 'enum', enum: EstadoPago, default: EstadoPago.COMPLETADO })
  estado: EstadoPago;

  @Column({ type: 'json', nullable: true })
  lineas: { producto_id: number; nombre: string; cantidad: number; precio_unit: number; subtotal: number }[];

  @Column({ nullable: true })
  notas: string;

  @Column({ nullable: true })
  usuario_id: number;

  /** Sesión de caja a la que pertenece esta venta directa (POS) */
  @Column({ nullable: true })
  sesion_caja_id: number | null;

  @Column({ type: 'date', nullable: true })
  fecha_cobro: Date;

  @CreateDateColumn()
  creado_en: Date;
}
