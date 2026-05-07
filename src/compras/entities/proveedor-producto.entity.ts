import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn } from 'typeorm';
import { Proveedor } from './proveedor.entity';

@Entity('proveedor_productos')
export class ProveedorProducto {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  proveedor_id: number;

  @ManyToOne(() => Proveedor, p => p.productos, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'proveedor_id' })
  proveedor: Proveedor;

  @Column()
  producto_id: number;

  // We do NOT add a FK relation to Producto to avoid circular deps; just store the id
  // Store product name for display purposes
  @Column({ nullable: true })
  producto_nombre: string;

  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  precio_compra: number;

  @Column({ nullable: true })
  tiempo_entrega: string;   // e.g. "3-5 días"

  @Column({ nullable: true })
  codigo_proveedor: string; // supplier's internal code for this product

  @CreateDateColumn()
  creado_en: Date;
}
