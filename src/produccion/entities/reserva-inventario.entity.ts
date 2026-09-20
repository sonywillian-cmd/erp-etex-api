import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

export enum EstadoReserva {
  ACTIVA    = 'activa',
  CONSUMIDA = 'consumida',
  LIBERADA  = 'liberada',
}

@Entity('reservas_inventario')
export class ReservaInventario {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  orden_id: number;

  @Column()
  producto_id: number;

  @Column()
  producto_nombre: string;

  /**
   * Qué variante exacta está apartada. Sin esto, "1 POLOSHIRT EN PIQUE apartado"
   * no dice si es el blanco talla 10 o el negro XS — y ese producto tiene 154
   * variantes. Queda opcional porque los productos sin talla ni color no la usan.
   */
  @Column({ type: 'int', nullable: true })
  variante_id: number | null;

  /** "BLANCO / 10", para leer la reserva sin ir a buscar la variante. */
  @Column({ type: 'varchar', length: 120, nullable: true })
  variante_label: string | null;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  cantidad_reservada: number;

  @Column({ type: 'enum', enum: EstadoReserva, default: EstadoReserva.ACTIVA })
  estado: EstadoReserva;

  @CreateDateColumn()
  creado_en: Date;
}
