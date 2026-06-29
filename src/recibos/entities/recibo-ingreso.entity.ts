import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn,
} from 'typeorm';

export enum TipoRecibo {
  ANTICIPO    = 'anticipo',    // abono sin factura (orden en curso)
  ABONO       = 'abono',       // pago parcial sobre una factura
  PAGO_TOTAL  = 'pago_total',  // pago que saldó la factura
}

@Entity('recibos_ingreso')
export class ReciboIngreso {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  numero: string; // REC-2024-0001

  @Column({ type: 'enum', enum: TipoRecibo })
  tipo: TipoRecibo;

  /** Orden vinculada (para anticipos sin factura) */
  @Column({ nullable: true })
  orden_produccion_id: number | null;

  /** Factura vinculada (cuando el pago va contra una factura) */
  @Column({ nullable: true })
  factura_id: number | null;

  /** Registro puntual en factura_pagos */
  @Column({ nullable: true })
  factura_pago_id: number | null;

  @Column({ nullable: true })
  cliente_id: number | null;

  @Column({ nullable: true })
  cliente_nombre: string;

  @Column()
  metodo: string; // efectivo | tarjeta | transferencia | cheque

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  monto: number;

  @Column({ type: 'date' })
  fecha: string;

  @Column({ nullable: true })
  referencia: string;

  /** Transferencias: banco destino (nombre, ej. "Banco Popular") */
  @Column({ nullable: true })
  banco_nombre: string;

  /** Transferencias: últimos 4 dígitos de la cuenta destino */
  @Column({ length: 4, nullable: true })
  cuenta_digitos: string;

  /** FK a cuentas_banco (para transferencias) */
  @Column({ nullable: true })
  cuenta_banco_id: number;

  /** Validado por el administrador (confirmó que llegó a la cuenta) */
  @Column({ default: false })
  validado: boolean;

  @Column({ nullable: true })
  validado_por: string;

  @Column({ type: 'datetime', nullable: true })
  validado_en: Date;

  @Column({ type: 'text', nullable: true })
  notas: string;

  @Column({ nullable: true })
  creado_por: string;

  /** Sesión de caja a la que pertenece este recibo */
  @Column({ nullable: true })
  sesion_caja_id: number | null;

  @CreateDateColumn()
  creado_en: Date;
}
