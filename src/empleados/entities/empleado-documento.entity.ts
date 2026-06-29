import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, ManyToOne, JoinColumn,
} from 'typeorm';
import { EmpleadoFicha } from './empleado-ficha.entity';

export enum TipoDocumento {
  CEDULA                   = 'cedula',
  CURRICULUM               = 'curriculum',
  CERTIFICADO_MEDICO       = 'certificado_medico',
  BUENA_CONDUCTA           = 'buena_conducta',
  CERTIFICACION_ACADEMICA  = 'certificacion_academica',
  FOTO_2X2                 = 'foto_2x2',
  CUENTA_BANCARIA          = 'cuenta_bancaria',
  CONTRATO                 = 'contrato',
  FIRMA                    = 'firma',
  FOTO_EMPLEADO            = 'foto_empleado',
  OTRO                     = 'otro',
}

@Entity('empleados_documentos')
export class EmpleadoDocumento {
  @PrimaryGeneratedColumn()
  id: number;

  @Column() empleado_id: number;

  @ManyToOne(() => EmpleadoFicha, e => e.documentos, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'empleado_id' })
  empleado?: EmpleadoFicha;

  @Column({ type: 'enum', enum: TipoDocumento })
  tipo: TipoDocumento;

  @Column({ length: 255 })  nombre_archivo: string;
  @Column({ length: 500 })  url: string;

  @Column({ type: 'varchar', length: 80, nullable: true })  mime_type: string | null;
  @Column({ type: 'int', nullable: true })                  tamano_bytes: number | null;
  @Column({ type: 'varchar', length: 255, nullable: true }) descripcion: string | null;

  @Column({ type: 'varchar', length: 120, nullable: true }) subido_por: string | null;
  @CreateDateColumn({ type: 'datetime', precision: 6 })     creado_en: Date;
}
