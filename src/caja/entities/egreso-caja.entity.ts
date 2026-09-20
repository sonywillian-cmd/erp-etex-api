import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

/**
 * Las categorías las define el negocio en Ajustes (`categorias_egreso`), no el código.
 * Hasta el 18-sep-2026 la columna era un ENUM de 7 valores fijos: cada egreso con una
 * categoría de Ajustes ("comida_empleado", "pagos"…) se guardaba VACÍO sin error porque
 * MariaDB no corre en modo estricto. 255 egresos desde mayo salieron sin categoría en el
 * reporte contable. Ahora es texto libre; la auditoría (`egreso_registrado`) conservó la
 * categoría real y se usó para recuperarlos.
 */
export const CATEGORIA_EGRESO_DEFAULT = 'otros';

@Entity('egresos_caja')
export class EgresoCaja {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'date' })
  fecha: string;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  monto: number;

  @Column()
  destinatario: string;

  @Column({ type: 'varchar', length: 60, default: CATEGORIA_EGRESO_DEFAULT })
  categoria: string;

  @Column({ type: 'text', nullable: true })
  comentario: string;

  @Column({ nullable: true })
  registrado_por: string;

  @Column({ nullable: true })
  sesion_caja_id: number;

  /** Portado desde dist (6 sep 2026): clasificación contable del egreso */
  @Column({ type: 'enum', enum: ['costo', 'gasto'], default: 'gasto' })
  clasificacion_contable: string;

  @CreateDateColumn()
  creado_en: Date;
}
