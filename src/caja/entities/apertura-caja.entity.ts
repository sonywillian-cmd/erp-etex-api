import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('apertura_cajas')
export class AperturaCaja {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'date', unique: true })
  fecha: string;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  monto_inicio: number;

  @Column({ nullable: true })
  abierto_por: string;

  @Column({ default: 'abierta' })
  estado: string; // 'abierta' | 'cerrada'

  @CreateDateColumn()
  abierto_en: Date;
}
