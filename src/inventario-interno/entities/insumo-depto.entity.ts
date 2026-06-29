import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, OneToMany,
} from 'typeorm';
import { InsumoUnidad } from './insumo-unidad.entity';

@Entity('inventario_interno_insumos')
export class InsumoDepto {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  departamento_id: number;

  @Column({ length: 100 })
  departamento_nombre: string;

  @Column({ length: 150 })
  nombre: string;

  @Column({ length: 500, nullable: true })
  descripcion: string;

  /** pote | rollo | cono | litro | kg | unidad | metro | resma */
  @Column({ length: 50, default: 'unidad' })
  unidad: string;

  /** Alerta cuando sellados < stock_minimo */
  @Column({ default: 1 })
  stock_minimo: number;

  @Column({ default: true })
  activo: boolean;

  @Column({ length: 100, nullable: true })
  creado_por: string;

  @CreateDateColumn()
  creado_en: Date;

  @OneToMany(() => InsumoUnidad, u => u.insumo)
  unidades: InsumoUnidad[];
}
