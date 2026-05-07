import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn,
} from 'typeorm';

export type EstadoRecepcion = 'pendiente' | 'confirmada' | 'con_diferencias';

export interface ItemRecepcion {
  lote_id: number;
  producto: string;
  descripcion: string;
  cantidad_enviada: number;
  cantidad_recibida: number | null;
}

@Entity('recepciones_departamento')
export class RecepcionDepartamento {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  lote_id: number;

  @Column()
  orden_id: number;

  @Column({ type: 'varchar', length: 50 })
  orden_numero: string;

  @Column({ type: 'varchar', length: 100 })
  dpto_origen: string;

  @Column({ type: 'varchar', length: 100 })
  dpto_destino: string;

  @Column({ type: 'json' })
  items: ItemRecepcion[];

  @Column({
    type: 'varchar',
    length: 20,
    default: 'pendiente',
  })
  estado: EstadoRecepcion;

  @CreateDateColumn()
  creado_en: Date;

  @Column({ type: 'int', nullable: true })
  confirmado_por_id: number | null;

  @Column({ type: 'varchar', length: 150, nullable: true })
  confirmado_por_nombre: string | null;

  @Column({ type: 'datetime', nullable: true })
  confirmado_en: Date | null;

  @Column({ type: 'text', nullable: true })
  notas: string | null;
}
