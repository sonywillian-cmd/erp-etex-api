import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export enum EstadoTarea {
  PENDIENTE  = 'pendiente',
  EN_PROCESO = 'en_proceso',
  COMPLETADO = 'completado',
}

@Entity('tareas_produccion')
export class TareaProduccion {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  orden_id: number;

  @Column()
  departamento: string; // Diseño, Bordado, DTF, Sublimación, Costura, Terminación

  @Column()
  nombre: string;

  @Column({ type: 'enum', enum: EstadoTarea, default: EstadoTarea.PENDIENTE })
  estado: EstadoTarea;

  @Column({ nullable: true })
  responsable: string;

  @Column({ nullable: true })
  tiempo_estimado: string; // "2h", "1 día"

  @Column({ type: 'datetime', nullable: true })
  fecha_inicio: Date;

  @Column({ type: 'datetime', nullable: true })
  fecha_fin: Date;

  @Column({ default: 0 })
  orden_ejecucion: number; // para ordenar las tareas

  @CreateDateColumn()
  creado_en: Date;

  @UpdateDateColumn()
  actualizado_en: Date;
}
