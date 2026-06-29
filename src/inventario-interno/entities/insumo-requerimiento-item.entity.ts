import {
  Entity, PrimaryGeneratedColumn, Column,
  ManyToOne, JoinColumn,
} from 'typeorm';
import { InsumoRequerimiento } from './insumo-requerimiento.entity';

@Entity('inventario_interno_req_items')
export class InsumoRequerimientoItem {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  requerimiento_id: number;

  /** Referencia al catálogo — null si es ítem libre */
  @Column({ nullable: true })
  insumo_id: number;

  @Column({ length: 150 })
  nombre: string;

  @Column({ length: 50 })
  unidad: string;

  @Column({ default: 1 })
  cantidad_solicitada: number;

  /** Se llena cuando llega la compra */
  @Column({ nullable: true })
  cantidad_recibida: number;

  @Column({ length: 500, nullable: true })
  notas: string;

  @ManyToOne(() => InsumoRequerimiento, r => r.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'requerimiento_id' })
  requerimiento: InsumoRequerimiento;
}
