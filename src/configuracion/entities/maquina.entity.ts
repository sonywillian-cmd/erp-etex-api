import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('maquinas')
export class Maquina {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 100 })
  nombre: string;

  /** ID del departamento al que pertenece */
  @Column({ type: 'int' })
  departamento_id: number;

  @Column({ nullable: true, type: 'text' })
  descripcion: string | null;

  @Column({ default: true })
  activo: boolean;

  @CreateDateColumn()
  creado_en: Date;

  @UpdateDateColumn()
  actualizado_en: Date;
}
