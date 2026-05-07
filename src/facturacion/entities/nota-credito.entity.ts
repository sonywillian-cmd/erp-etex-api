import { Entity, PrimaryGeneratedColumn, Column, ManyToOne, JoinColumn, CreateDateColumn } from 'typeorm';
import { Factura } from './factura.entity';

export enum TipoNotaCredito {
  PARCIAL = 'parcial',
  TOTAL   = 'total',
}

export enum MotivoNotaCredito {
  DEVOLUCION    = 'devolucion',
  AJUSTE_PRECIO = 'ajuste_precio',
  DESCUENTO     = 'descuento',
  ANULACION     = 'anulacion',
}

@Entity('notas_credito')
export class NotaCredito {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  ncf: string; // B04XXXXXXXXX

  @Column()
  ncf_referencia: string; // NCF original que se está corrigiendo

  @Column()
  factura_id: number;

  @ManyToOne(() => Factura, f => f.notas_credito, { onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'factura_id' })
  factura: Factura;

  @Column({ type: 'enum', enum: TipoNotaCredito })
  tipo: TipoNotaCredito;

  @Column({ type: 'enum', enum: MotivoNotaCredito })
  motivo: MotivoNotaCredito;

  @Column({ nullable: true })
  cliente_nombre: string;

  @Column({ nullable: true })
  cliente_rnc: string;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  monto: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  itbis_monto: number;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  total: number; // monto + itbis

  @Column({ nullable: true })
  notas: string;

  @Column({ nullable: true })
  creado_por: string;

  @CreateDateColumn()
  fecha_emision: Date;
}
