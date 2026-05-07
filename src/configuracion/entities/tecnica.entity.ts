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
