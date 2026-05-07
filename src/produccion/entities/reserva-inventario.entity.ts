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

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  cantidad_reservada: number;

  @Column({ type: 'enum', enum: EstadoReserva, default: EstadoReserva.ACTIVA })
  estado: EstadoReserva;

  @CreateDateColumn()
  creado_en: Date;
}
