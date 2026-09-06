import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { Cotizacion } from './cotizacion.entity';

@Entity('lineas_cotizacion')
export class LineaCotizacion {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  cotizacion_id: number;

  @Column({ nullable: true })
  producto_id: number;

  @Column({ nullable: true })
  variante_id: number;

  @Column({ nullable: true })
  tecnica: string;

  @Column()
  descripcion: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 1 })
  cantidad: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  precio_unitario: number;

  // Precio del producto SIN técnicas (para reconstruir desglose al editar)
  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  precio_base: number;

  // Desglose de técnicas aplicadas con el precio que sumaron originalmente.
  // Permite editar sin re-sumar el precio del catálogo actual.
  // Formato: [{ nombre: string, precio: number }]
  @Column({ type: 'json', nullable: true })
  tecnicas_aplicadas: { nombre: string; precio: number }[] | null;

  @Column({ type: 'decimal', precision: 5, scale: 2, default: 0 })
  descuento_pct: number;

  @Column({ default: true })
  aplica_itbis: boolean;

  @Column({ type: 'decimal', precision: 5, scale: 2, default: 18 })
  porcentaje_itbis: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  subtotal_linea: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  itbis_monto: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  total_linea: number;

  @Column({ type: 'int', default: 1 })
  orden: number;
}
