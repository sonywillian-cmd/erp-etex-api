import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export enum EstadoProceso {
  PENDIENTE   = 'pendiente',
  EN_PROCESO  = 'en_proceso',
  COMPLETADO  = 'completado',
}

export interface PausaProceso {
  motivo: string;
  inicio: string;   // ISO datetime
  fin: string | null;
}

@Entity('procesos_lote')
export class ProcesoLote {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  lote_id: number;

  @Column({ length: 100 })
  nombre: string;  // e.g. "Diseño", "Ejecución", "Impresión", "Planchado"

  @Column({ type: 'int', default: 0 })
  orden: number;

  @Column({ type: 'enum', enum: EstadoProceso, default: EstadoProceso.PENDIENTE })
  estado: EstadoProceso;

  @Column({ nullable: true, length: 150 })
  responsable: string | null;

  @Column({ type: 'datetime', nullable: true })
  tiempo_inicio: Date | null;

  @Column({ type: 'datetime', nullable: true })
  tiempo_fin: Date | null;

  @Column({ type: 'json', nullable: true })
  pausas: PausaProceso[] | null;

  @Column({ nullable: true, type: 'text' })
  notas: string | null;

  @CreateDateColumn()
  creado_en: Date;

  @UpdateDateColumn()
  actualizado_en: Date;
}
