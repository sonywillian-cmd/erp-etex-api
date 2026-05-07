import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('bom_items')
export class BomItem {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  producto_id: number; // the finished/fabricated product

  @Column()
  material_id: number; // the raw material product

  @Column({ nullable: true })
  material_nombre: string; // stored for display

  @Column({ type: 'decimal', precision: 10, scale: 4, default: 1 })
  cantidad: number;

  @Column({ default: 'Pieza' })
  unidad: string;

  @Column({ nullable: true })
  notas: string;

  @CreateDateColumn()
  creado_en: Date;
}
