import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, OneToMany,
} from 'typeorm';
import { InsumoRequerimientoItem } from './insumo-requerimiento-item.entity';

export enum EstadoRequerimiento {
  PENDIENTE = 'pendiente',
  APROBADO  = 'aprobado',
  RECHAZADO = 'rechazado',
  COMPRADO  = 'comprado',
  RECIBIDO  = 'recibido',
}

@Entity('inventario_interno_requerimientos')
export class InsumoRequerimiento {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  departamento_id: number;

  @Column({ length: 100 })
  departamento_nombre: string;

  @Column({ type: 'enum', enum: EstadoRequerimiento, default: EstadoRequerimiento.PENDIENTE })
  estado: EstadoRequerimiento;

  @Column({ length: 100 })
  solicitado_por: string;

  @Column({ type: 'text', nullable: true })
  notas_solicitud: string;

  @Column({ length: 100, nullable: true })
  aprobado_por: string;

  @Column({ type: 'datetime', nullable: true })
  aprobado_en: Date;

  @Column({ type: 'text', nullable: true })
  notas_admin: string;

  @CreateDateColumn()
  creado_en: Date;

  @OneToMany(() => InsumoRequerimientoItem, i => i.requerimiento, { cascade: true, eager: true })
  items: InsumoRequerimientoItem[];
}
