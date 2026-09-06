import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export interface SubtecnicaDef {
  nombre: string;
  rol?: string;
}

@Entity('tecnicas')
export class Tecnica {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  nombre: string;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  precio_default: number;

  // Unidad de trabajo de la técnica:
  //   por_pieza → multiplica por la cantidad del producto (ej. BORDADO de 12 polos = 12 unidades)
  //   por_lote  → 1 sola unidad por toda la orden (ej. DISEÑO BORDADO = 1 diseño sirve para 12 polos)
  //   por_color → 1 por cada color único en la orden
  @Column({ type: 'enum', enum: ['por_pieza','por_lote','por_color'], default: 'por_pieza' })
  unidad_de_trabajo: 'por_pieza' | 'por_lote' | 'por_color';

  @Column({ nullable: true })
  departamento_id: number;

  @Column({ nullable: true })
  departamento_nombre: string;

  @Column({ type: 'json', nullable: true })
  subtecnicas: SubtecnicaDef[] | null;

  @Column({ default: true })
  activo: boolean;

  @CreateDateColumn()
  creado_en: Date;

  @UpdateDateColumn()
  actualizado_en: Date;
}
