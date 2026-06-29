import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, ManyToOne, JoinColumn,
} from 'typeorm';
import { InsumoDepto } from './insumo-depto.entity';

export enum EstadoUnidad {
  SELLADO = 'sellado',
  EN_USO  = 'en_uso',
  AGOTADO = 'agotado',
}

@Entity('inventario_interno_unidades')
export class InsumoUnidad {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  insumo_id: number;

  @Column({ type: 'enum', enum: EstadoUnidad, default: EstadoUnidad.SELLADO })
  estado: EstadoUnidad;

  @Column({ length: 500, nullable: true })
  notas: string;

  @Column({ length: 100, nullable: true })
  registrado_por: string;

  @Column({ length: 100, nullable: true })
  modificado_por: string;

  @Column({ type: 'datetime', nullable: true })
  fecha_cambio_estado: Date;

  @CreateDateColumn()
  creado_en: Date;

  @ManyToOne(() => InsumoDepto, i => i.unidades, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'insumo_id' })
  insumo: InsumoDepto;
}
