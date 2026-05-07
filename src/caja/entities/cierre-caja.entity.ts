import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('cierre_cajas')
export class CierreCaja {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'date', unique: true })
  fecha: string;

  // ─── Totales del sistema (desde factura_pagos) ────────────────────────────
  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  efectivo_sistema: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  tarjeta_sistema: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  transferencia_sistema: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  cheque_sistema: number;

  // ─── Conteo físico ────────────────────────────────────────────────────────
  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  efectivo_contado: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  tarjeta_contado: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  transferencia_contado: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  cheque_contado: number;

  @Column({ type: 'text', nullable: true })
  notas: string;

  @Column({ nullable: true })
  cerrado_por: string;

  @Column({ default: 'abierto' })
  estado: string; // 'abierto' | 'cerrado'

  @CreateDateColumn()
  cerrado_en: Date;
}
