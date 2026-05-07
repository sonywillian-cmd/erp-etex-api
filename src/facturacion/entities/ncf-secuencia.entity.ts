import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export enum TipoNcf {
  B01 = 'B01', // Crédito Fiscal
  B02 = 'B02', // Consumidor Final
  B03 = 'B03', // Nota de Débito
  B04 = 'B04', // Nota de Crédito
  B14 = 'B14', // Régimen Especial
  B15 = 'B15', // Gubernamental
}

@Entity('ncf_secuencias')
export class NcfSecuencia {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'enum', enum: TipoNcf, unique: true })
  tipo: TipoNcf;

  @Column()
  desde: number;

  @Column()
  hasta: number;

  @Column({ default: 0 })
  actual: number;

  @Column({ default: true })
  activo: boolean;

  @Column({ type: 'date', nullable: true })
  fecha_vencimiento: string | null;   // Fecha de vencimiento de la autorización DGII

  @Column({ nullable: true })
  notas: string;

  @CreateDateColumn()
  creado_en: Date;

  @UpdateDateColumn()
  actualizado_en: Date;
}
