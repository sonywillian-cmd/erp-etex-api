import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn } from 'typeorm';
import { Factura, MetodoPago } from './factura.entity';

export enum TipoPago {
  ANTICIPO = 'anticipo',
  ABONO    = 'abono',
  TOTAL    = 'total',
  CREDITO  = 'credito',
}

@Entity('factura_pagos')
export class FacturaPago {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  factura_id: number;

  @ManyToOne(() => Factura, f => f.pagos, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'factura_id' })
  factura: Factura;

  @Column({ type: 'enum', enum: TipoPago })
  tipo: TipoPago;

  @Column({ type: 'enum', enum: MetodoPago })
  metodo: MetodoPago;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  monto: number;

  @Column({ type: 'date' })
  fecha: string;

  @Column({ nullable: true })
  referencia: string;

  /** Transferencias: banco destino */
  @Column({ nullable: true })
  banco_nombre: string;

  /** Transferencias: últimos 4 dígitos cuenta destino */
  @Column({ length: 4, nullable: true })
  cuenta_digitos: string;

  /** FK a cuentas_banco */
  @Column({ nullable: true })
  cuenta_banco_id: number;

  /** Validado por admin */
  @Column({ default: false })
  validado: boolean;

  @Column({ nullable: true })
  validado_por: string;

  @Column({ type: 'datetime', nullable: true })
  validado_en: Date;

  @Column({ nullable: true })
  nota: string;

  @Column({ nullable: true })
  creado_por: string;

  @Column({ default: false })
  revertido: boolean;

  @Column({ nullable: true })
  revertido_motivo: string;

  @Column({ nullable: true })
  revertido_por: string;

  @Column({ type: 'datetime', nullable: true })
  revertido_en: Date;

  @CreateDateColumn()
  creado_en: Date;
}
