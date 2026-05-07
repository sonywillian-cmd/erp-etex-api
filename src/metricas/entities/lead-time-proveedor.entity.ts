import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('lead_times_proveedores')
export class LeadTimeProveedor {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ nullable: true })
  orden_compra_id: number;

  @Column({ nullable: true })
  proveedor_id: number;

  @Column({ nullable: true })
  proveedor_nombre: string;

  /** Días estimados según la fecha de entrega prometida al crear la OC */
  @Column({ type: 'int', nullable: true })
  dias_estimados: number;

  /** Días reales desde que se confirmó la OC hasta que se recibió */
  @Column({ type: 'int', nullable: true })
  dias_reales: number;

  @Column({ type: 'date', nullable: true })
  fecha_orden: string;

  @Column({ type: 'date', nullable: true })
  fecha_llegada: string;

  @CreateDateColumn()
  creado_en: Date;
}
