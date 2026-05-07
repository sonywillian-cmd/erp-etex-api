import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, Unique } from 'typeorm';

export enum ComplejidadOrden {
  EXENTA   = 'exenta',
  SENCILLA = 'sencilla',
  MEDIANA  = 'mediana',
  AVANZADA = 'avanzada',
}

export enum PeriodoPago {
  SEMANAL   = 'semanal',
  QUINCENAL = 'quincenal',
}

/**
 * Configuración de incentivos por departamento + complejidad.
 * - precio_por_pieza : cuánto gana el operario por cada pieza en esta combinación
 * - meta_semanal     : piezas mínimas (base semanal) para activar el incentivo
 *                      Para operarios quincenales se usa meta_semanal × 2
 */
@Entity('incentivos_config')
@Unique(['departamento', 'complejidad'])
export class IncentivosConfig {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 100 })
  departamento: string;

  @Column({ type: 'enum', enum: ComplejidadOrden, default: ComplejidadOrden.MEDIANA })
  complejidad: ComplejidadOrden;

  /** RD$ por pieza producida (se activa sólo si se cumple la meta) */
  @Column({ type: 'decimal', precision: 10, scale: 2 })
  precio_por_pieza: number;

  /** Meta en piezas por semana (para quincenales se multiplica × 2) */
  @Column({ type: 'int' })
  meta_semanal: number;

  @Column({ default: true })
  activo: boolean;

  @CreateDateColumn()
  creado_en: Date;

  @UpdateDateColumn()
  actualizado_en: Date;
}
