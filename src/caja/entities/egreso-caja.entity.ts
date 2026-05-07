import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

export enum CategoriaEgreso {
  SERVICIOS    = 'servicios',
  SUMINISTROS  = 'suministros',
  NOMINA       = 'nomina',
  TRANSPORTE   = 'transporte',
  PROVEEDORES  = 'proveedores',
  MANTENIMIENTO= 'mantenimiento',
  OTROS        = 'otros',
}

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

  @Column({ type: 'enum', enum: CategoriaEgreso, default: CategoriaEgreso.OTROS })
  categoria: CategoriaEgreso;

  @Column({ type: 'text', nullable: true })
  comentario: string;

  @Column({ nullable: true })
  registrado_por: string;

  @Column({ nullable: true })
  sesion_caja_id: number;

  @CreateDateColumn()
  creado_en: Date;
}
