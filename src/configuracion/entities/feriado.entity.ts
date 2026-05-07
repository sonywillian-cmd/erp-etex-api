import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('feriados')
export class Feriado {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'date' })
  fecha: string; // 'YYYY-MM-DD'

  @Column({ length: 120 })
  nombre: string;

  @Column()
  año: number;

  @CreateDateColumn()
  creado_en: Date;
}
