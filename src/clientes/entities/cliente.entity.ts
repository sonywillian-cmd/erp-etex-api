import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, OneToMany } from 'typeorm';

export enum TipoCliente { EMPRESA = 'empresa', PERSONA = 'persona' }
export enum EstadoCliente { ACTIVO = 'activo', INACTIVO = 'inactivo', PROSPECTO = 'prospecto' }

@Entity('clientes')
export class Cliente {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  nombre: string;

  @Column({ nullable: true })
  nombre_comercial: string;

  @Column({ type: 'enum', enum: TipoCliente, default: TipoCliente.EMPRESA })
  tipo: TipoCliente;

  @Column({ nullable: true })
  documento: string; // RNC o Cédula

  @Column({ nullable: true })
  telefono: string;

  @Column({ nullable: true })
  telefono_alt: string;

  @Column({ nullable: true })
  email: string;

  @Column({ nullable: true })
  direccion: string;

  @Column({ nullable: true })
  ciudad: string;

  @Column({ nullable: true })
  provincia: string;

  @Column({ nullable: true })
  vendedor_id: number;

  @Column({ default: true })
  aplica_itbis: boolean;

  @Column({ nullable: true })
  terminos_pago: string;

  @Column({ type: 'enum', enum: EstadoCliente, default: EstadoCliente.PROSPECTO })
  estado: EstadoCliente;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  limite_credito: number;

  @Column({ nullable: true, type: 'int' })
  plazo_credito: number; // días (ej: 30, 60, 90)

  /** Política: solo el admin aprueba. sin_credito → pendiente → aprobado | rechazado | suspendido */
  @Column({ type: 'enum', enum: ['sin_credito', 'pendiente', 'aprobado', 'rechazado', 'suspendido'], default: 'sin_credito' })
  credito_estado: string;

  @Column({ nullable: true })
  credito_aprobado_por: string;

  @Column({ type: 'datetime', nullable: true })
  credito_aprobado_en: Date;

  @Column({ nullable: true })
  notas: string;

  /** Tipo NCF preferido para empresas: B01, B02, B14, B15. NULL para personas. */
  @Column({ nullable: true, length: 5 })
  ncf_tipo_default: string;

  @CreateDateColumn()
  creado_en: Date;

  @UpdateDateColumn()
  actualizado_en: Date;
}
