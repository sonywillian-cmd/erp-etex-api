import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn } from 'typeorm';
import { Factura } from './factura.entity';

@Entity('factura_lineas')
export class FacturaLinea {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  factura_id: number;

  @ManyToOne(() => Factura, f => f.lineas, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'factura_id' })
  factura: Factura;

  @Column({ nullable: true })
  producto_id: number;

  @Column()
  descripcion: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 1 })
  cantidad: number;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  precio_unitario: number;

  @Column({ type: 'decimal', precision: 5, scale: 2, default: 0 })
  itbis_pct: number; // 0 o 18

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  itbis_monto: number;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  subtotal: number;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  total: number;
}
