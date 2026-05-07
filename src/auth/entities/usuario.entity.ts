import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export enum RolUsuario {
  ADMIN      = 'admin',
  SUPERVISOR = 'supervisor',
  VENDEDOR   = 'vendedor',
  PRODUCCION = 'produccion',
  CONTADOR   = 'contador',
  OPERARIO   = 'operario',
}

export enum PeriodoPago {
  SEMANAL   = 'semanal',
  QUINCENAL = 'quincenal',
}

@Entity('usuarios')
export class Usuario {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  email: string;

  @Column()
  nombre: string;

  @Column({ select: false })          // nunca se devuelve en queries por defecto
  password_hash: string;

  @Column({ type: 'enum', enum: RolUsuario, default: RolUsuario.VENDEDOR })
  rol: RolUsuario;

  @Column({ default: true })
  activo: boolean;

  /** @deprecated usar departamentos (array) */
  @Column({ nullable: true, type: 'varchar', length: 100 })
  departamento: string | null;

  /** IDs de departamentos asignados (multi-departamento) */
  @Column({ type: 'json', nullable: true })
  departamentos: number[] | null;

  /** Período de cobro del operario (afecta cálculo de meta de incentivos) */
  @Column({ type: 'enum', enum: PeriodoPago, default: PeriodoPago.QUINCENAL, nullable: true })
  periodo_pago: PeriodoPago;

  @Column({ nullable: true })
  ultimo_acceso: Date;

  @CreateDateColumn()
  creado_en: Date;

  @UpdateDateColumn()
  actualizado_en: Date;
}
