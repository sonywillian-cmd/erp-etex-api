import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn,
} from 'typeorm';

export type TipoGasto = 'formal' | 'informal' | 'personal';

@Entity('gastos')
export class Gasto {
  @PrimaryGeneratedColumn()
  id: number;

  // ── Clasificación principal ────────────────────────────────────────────
  @Column({ type: 'varchar', length: 20 })
  tipo: TipoGasto;  // formal (con NCF) | informal (sin comprobante) | personal (retiro del socio)

  @Column({ type: 'date' })
  fecha: string;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  monto: number;

  @Column({ type: 'varchar', length: 500, nullable: true })
  descripcion: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  categoria: string | null;

  // ── Datos de factura formal (todos opcionales para no bloquear el registro) ──
  @Column({ type: 'varchar', length: 200, nullable: true })
  proveedor: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  rnc: string | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  ncf: string | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  tipo_ncf: string | null;  // B01, B02, B11, B14, B15

  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  subtotal: number | null;

  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true })
  itbis: number | null;

  // ── Foto de la factura/recibo ──────────────────────────────────────────
  // foto_url = página principal (la primera). fotos_adicionales = páginas 2, 3, etc.
  @Column({ type: 'varchar', length: 500, nullable: true })
  foto_url: string | null;

  @Column({ type: 'json', nullable: true })
  fotos_adicionales: string[] | null;

  // ── Metadata ───────────────────────────────────────────────────────────
  @Column()
  registrado_por_id: number;

  @Column({ type: 'varchar', length: 150 })
  registrado_por_nombre: string;

  // Método de pago (efectivo, transferencia, tarjeta, etc.)
  @Column({ type: 'varchar', length: 50, nullable: true })
  metodo_pago: string | null;

  // Estado: registrado | aprobado | rechazado
  // (fase 1 = todos quedan 'registrado'; aprobación viene después)
  @Column({ type: 'varchar', length: 20, default: 'registrado' })
  estado: string;

  @Column({ type: 'text', nullable: true })
  notas: string | null;

  /** Portado del dist (6 sep 2026): costo directo vs gasto operativo */
  @Column({ type: 'enum', enum: ['costo', 'gasto'], default: 'gasto' })
  clasificacion_contable: string;

  @CreateDateColumn()
  creado_en: Date;

  @UpdateDateColumn()
  actualizado_en: Date;
}
