import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn,
} from 'typeorm';

export enum EstadoSesion {
  BORRADOR    = 'borrador',
  ABIERTA     = 'abierta',
  POR_VALIDAR = 'por_validar',
  VALIDADA    = 'validada',
}

@Entity('sesiones_caja')
export class SesionCaja {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  numero: string; // CAJ/2026/0001

  @Column({ nullable: true })
  usuario_nombre: string;

  @Column({ nullable: true })
  usuario_id: number;

  @Column({ type: 'enum', enum: EstadoSesion, default: EstadoSesion.ABIERTA })
  estado: EstadoSesion;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  efectivo_inicial: number;

  /** Suma real de pagos en efectivo recibidos en la sesión (calculada al cerrar) */
  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  efectivo_cobrado: number;

  /** Efectivo físico que el cajero cuenta al cierre */
  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  efectivo_final_real: number;

  @Column({ type: 'text', nullable: true })
  notas_cierre: string;

  @Column({ nullable: true })
  cerrado_por: string;

  @Column({ nullable: true })
  validado_por: string;

  @CreateDateColumn()
  fecha_apertura: Date;

  @Column({ type: 'datetime', nullable: true })
  fecha_cierre: Date;

  @Column({ type: 'datetime', nullable: true })
  fecha_validacion: Date;
}
