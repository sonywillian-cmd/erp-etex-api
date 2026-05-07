import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('pausas_produccion')
export class PausaProduccion {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  orden_id: number;

  @Column('text')
  motivo: string;

  @Column({ type: 'datetime' })
  fecha_inicio: Date;

  @Column({ type: 'datetime', nullable: true })
  fecha_fin: Date;

  @CreateDateColumn()
  creado_en: Date;
}
