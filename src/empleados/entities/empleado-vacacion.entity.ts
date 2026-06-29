import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn, ManyToOne, JoinColumn,
} from 'typeorm';
import { EmpleadoFicha } from './empleado-ficha.entity';

export enum DecisionVacacion {
  TOMAR        = 'tomar',
  COBRAR       = 'cobrar',
  MIXTO        = 'mixto',
  SIN_DEFINIR  = 'sin_definir',
}
export enum EstadoPagoVacacion {
  PENDIENTE    = 'pendiente',
  PARCIAL      = 'parcial',
  PAGADA       = 'pagada',
  NO_APLICA    = 'no_aplica',
}

@Entity('empleados_vacaciones')
export class EmpleadoVacacion {
  @PrimaryGeneratedColumn()
  id: number;

  @Column() empleado_id: number;

  @ManyToOne(() => EmpleadoFicha, e => e.vacaciones, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'empleado_id' })
  empleado?: EmpleadoFicha;

  /** Periodo / año al que corresponden estas vacaciones (ej: "2026" o "2025-2026") */
  @Column({ length: 10 }) periodo: string;

  /** Días a los que tiene derecho (típico RD: 14) */
  @Column({ type: 'decimal', precision: 5, scale: 2, default: 14 })
  dias_derecho: number;

  /** ¿Tomarlos o cobrarlos en efectivo? */
  @Column({ type: 'enum', enum: DecisionVacacion, default: DecisionVacacion.SIN_DEFINIR })
  decision: DecisionVacacion;

  /** Si tomó días, cuántos */
  @Column({ type: 'decimal', precision: 5, scale: 2, default: 0 })
  dias_tomados: number;

  @Column({ type: 'date', nullable: true }) fecha_inicio: string | null;
  @Column({ type: 'date', nullable: true }) fecha_fin: string | null;

  /** Monto a pagar (calculable: salario / 30 * dias o lo que se le tenga prometido) */
  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  monto_a_pagar: number | null;

  /** Monto que ya se le pagó (puede ser parcial) */
  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  monto_pagado: number;

  @Column({ type: 'enum', enum: EstadoPagoVacacion, default: EstadoPagoVacacion.PENDIENTE })
  estado_pago: EstadoPagoVacacion;

  @Column({ type: 'date', nullable: true }) fecha_pago: string | null;
  @Column({ type: 'varchar', length: 30, nullable: true }) metodo_pago: string | null;
  @Column({ type: 'varchar', length: 100, nullable: true }) referencia: string | null;

  @Column({ type: 'text', nullable: true }) notas: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true }) creado_por: string | null;
  @CreateDateColumn({ type: 'datetime', precision: 6 }) creado_en: Date;
  @UpdateDateColumn({ type: 'datetime', precision: 6 }) actualizado_en: Date;
}
