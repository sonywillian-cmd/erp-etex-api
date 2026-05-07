import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn,
} from 'typeorm';

export type EstadoDano =
  | 'reportado'
  | 'aprobado_reponer'
  | 'aprobado_sustitucion'
  | 'sin_stock'
  | 'resuelto';

@Entity('danos_produccion')
export class DanoProduccion {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  lote_id: number;

  @Column()
  orden_id: number;

  @Column({ type: 'varchar', length: 50 })
  orden_numero: string;

  @Column({ type: 'varchar', length: 100 })
  departamento: string;

  @Column({ type: 'varchar', length: 200 })
  producto: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  descripcion: string | null;

  @Column()
  cantidad_danada: number;

  @Column({ type: 'text' })
  motivo: string;

  @Column({ type: 'varchar', length: 30, default: 'reportado' })
  estado: EstadoDano;

  // ── Producto original dañado ──────────────────────────────────────────────
  @Column({ type: 'int', nullable: true })
  producto_id: number | null;

  @Column({ type: 'int', nullable: true })
  variante_id: number | null;

  // ── Reserva de reposición (enlace a reservas_inventario) ─────────────────
  @Column({ type: 'int', nullable: true })
  reserva_id: number | null;

  // ── Reposición ────────────────────────────────────────────────────────────
  @Column({ default: false })
  es_sustitucion: boolean;

  @Column({ type: 'int', nullable: true })
  repuesto_producto_id: number | null;

  @Column({ type: 'int', nullable: true })
  repuesto_variante_id: number | null;

  @Column({ type: 'varchar', length: 200, nullable: true })
  repuesto_descripcion: string | null;

  @Column({ type: 'int', nullable: true })
  cantidad_repuesta: number | null;

  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  costo_repuesto: number | null;

  // ── Trazabilidad ─────────────────────────────────────────────────────────
  @Column()
  reportado_por_id: number;

  @Column({ type: 'varchar', length: 150 })
  reportado_por_nombre: string;

  @Column({ type: 'int', nullable: true })
  aprobado_por_id: number | null;

  @Column({ type: 'varchar', length: 150, nullable: true })
  aprobado_por_nombre: string | null;

  @Column({ type: 'text', nullable: true })
  notas: string | null;

  @CreateDateColumn()
  creado_en: Date;

  @UpdateDateColumn()
  actualizado_en: Date;
}
