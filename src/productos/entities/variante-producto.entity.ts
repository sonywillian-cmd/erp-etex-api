import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('variantes_producto')
export class VarianteProducto {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  producto_id: number;

  @Column({ unique: true })
  sku: string;

  @Column({ type: 'json' })
  atributos: Record<string, string>;

  @Column({ default: 0 })
  stock_actual: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  costo: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  precio: number;

  @Column({ nullable: true, default: null })
  stock_minimo: number | null;

  @Column({ type: 'tinyint', default: 1 })
  activo: boolean;

  @CreateDateColumn()
  creado_en: Date;

  @UpdateDateColumn()
  actualizado_en: Date;
}
