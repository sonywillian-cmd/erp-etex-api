import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export enum EstadoCompra { BORRADOR = 'borrador', CONFIRMADA = 'confirmada', EN_TRANSITO = 'en_transito', RECIBIDA = 'recibida', CANCELADA = 'cancelada' }

@Entity('ordenes_compra')
export class OrdenCompra {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  numero: string;

  @Column()
  proveedor: string;

  @Column({ nullable: true, type: 'int' })
  proveedor_id: number | null;

  @Column({ type: 'enum', enum: EstadoCompra, default: EstadoCompra.BORRADOR })
  estado: EstadoCompra;

  @Column({ type: 'date', nullable: true })
  fecha_estimada: Date;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  total: number;

  @Column({ nullable: true })
  notas: string;

  @Column({ type: 'tinyint', default: 0 })
  aplica_itbis: boolean;

  @Column({ nullable: true })
  usuario_id: number;

  @Column({ nullable: true })
  comprador: string;

  @Column({ nullable: true })
  referencia_proveedor: string;

  @Column({ nullable: true, type: 'date' })
  fecha_limite: string;

  @Column({ nullable: true, type: 'date' })
  entrega_esperada: string;

  @Column({ nullable: true })
  documento_origen: string;

  @Column({ nullable: true })
  orden_produccion_id: number;

  @Column({ type: 'json', nullable: true })
  lineas: any[];

  @Column({ type: 'json', nullable: true })
  op_ids: number[];

  @CreateDateColumn()
  creado_en: Date;

  @UpdateDateColumn()
  actualizado_en: Date;
}
