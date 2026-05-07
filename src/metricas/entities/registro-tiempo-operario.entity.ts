import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('registros_tiempo_operario')
export class RegistroTiempoOperario {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  lote_id: number;

  @Column()
  orden_id: number;

  @Column({ nullable: true })
  orden_numero: string;

  @Column({ nullable: true })
  operario_nombre: string;

  @Column({ nullable: true })
  departamento: string;

  @Column({ nullable: true })
  tecnica: string;

  @Column({ type: 'int', default: 0 })
  piezas_ok: number;

  @Column({ type: 'int', default: 0 })
  piezas_retrabajo: number;

  @Column({ type: 'int', default: 0 })
  piezas_descarte: number;

  /** Minutos reales trabajados (descontando pausas) */
  @Column({ type: 'int', nullable: true })
  duracion_minutos: number;

  /** Minutos por pieza OK — métrica clave para predicciones */
  @Column({ type: 'decimal', precision: 8, scale: 2, nullable: true })
  min_por_pieza: number;

  @Column({ type: 'date' })
  fecha: string;

  @CreateDateColumn()
  creado_en: Date;
}
