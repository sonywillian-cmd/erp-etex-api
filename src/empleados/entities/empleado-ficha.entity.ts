import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn, OneToMany, ManyToOne, JoinColumn,
} from 'typeorm';
import { Usuario } from '../../auth/entities/usuario.entity';
import { EmpleadoVacacion }  from './empleado-vacacion.entity';
import { EmpleadoDocumento } from './empleado-documento.entity';

export enum Sexo                  { MASCULINO = 'masculino', FEMENINO = 'femenino' }
export enum EstadoCivil           {
  SOLTERO     = 'soltero',
  CASADO      = 'casado',
  UNION_LIBRE = 'union_libre',
  DIVORCIADO  = 'divorciado',
  VIUDO       = 'viudo',
}
export enum NivelEducativo        {
  PRIMARIA       = 'primaria',
  SECUNDARIA     = 'secundaria',
  TECNICO        = 'tecnico',
  UNIVERSITARIO  = 'universitario',
  POSTGRADO      = 'postgrado',
  MAESTRIA       = 'maestria',
  DOCTORADO      = 'doctorado',
}
export enum TipoContrato          {
  FIJO        = 'fijo',
  INDEFINIDO  = 'indefinido',
  TEMPORAL    = 'temporal',
  PASANTIA    = 'pasantia',
}
export enum TipoCuenta            { AHORRO = 'ahorro', CORRIENTE = 'corriente' }
export enum EstadoEmpleado        {
  ACTIVO      = 'activo',
  LICENCIA    = 'licencia',
  SUSPENDIDO  = 'suspendido',
  BAJA        = 'baja',
}

@Entity('empleados_ficha')
export class EmpleadoFicha {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'int', nullable: true, unique: true })
  usuario_id: number | null;

  @ManyToOne(() => Usuario, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'usuario_id' })
  usuario?: Usuario | null;

  @Column({ type: 'varchar', length: 20, nullable: true, unique: true })
  codigo_empleado: string | null;

  // 1. DATOS PERSONALES
  @Column({ length: 150 }) nombre_completo: string;
  @Column({ type: 'varchar', length: 20, nullable: true, unique: true }) cedula_pasaporte: string | null;
  @Column({ type: 'date', nullable: true }) fecha_nacimiento: string | null;
  @Column({ type: 'enum', enum: Sexo, nullable: true }) sexo: Sexo | null;
  @Column({ type: 'enum', enum: EstadoCivil, nullable: true }) estado_civil: EstadoCivil | null;
  @Column({ type: 'varchar', length: 60, nullable: true, default: 'Dominicana' }) nacionalidad: string | null;
  @Column({ type: 'varchar', length: 255, nullable: true }) direccion: string | null;
  @Column({ type: 'varchar', length: 100, nullable: true }) sector_ciudad: string | null;
  @Column({ type: 'varchar', length: 30, nullable: true }) telefono_personal: string | null;
  @Column({ type: 'varchar', length: 30, nullable: true }) telefono_alternativo: string | null;
  @Column({ type: 'varchar', length: 120, nullable: true }) correo_electronico: string | null;

  // 2. CONTACTO DE EMERGENCIA
  @Column({ type: 'varchar', length: 150, nullable: true }) emerg_nombre: string | null;
  @Column({ type: 'varchar', length: 60,  nullable: true }) emerg_parentesco: string | null;
  @Column({ type: 'varchar', length: 30,  nullable: true }) emerg_tel_principal: string | null;
  @Column({ type: 'varchar', length: 30,  nullable: true }) emerg_tel_secundario: string | null;
  @Column({ type: 'varchar', length: 255, nullable: true }) emerg_direccion: string | null;

  // 3. INFO FAMILIAR
  @Column({ default: false }) tiene_hijos: boolean;
  @Column({ type: 'tinyint', nullable: true }) cantidad_hijos: number | null;

  // 4. ACADÉMICA
  @Column({ type: 'enum', enum: NivelEducativo, nullable: true }) nivel_educativo: NivelEducativo | null;
  @Column({ type: 'varchar', length: 120, nullable: true }) profesion: string | null;
  @Column({ type: 'varchar', length: 120, nullable: true }) carrera_estudiada: string | null;
  @Column({ type: 'varchar', length: 150, nullable: true }) institucion_educativa: string | null;
  @Column({ type: 'text', nullable: true }) cursos_certificaciones: string | null;

  // 5. LABORAL
  @Column({ type: 'date', nullable: true }) fecha_ingreso: string | null;
  @Column({ type: 'varchar', length: 80, nullable: true }) departamento: string | null;
  @Column({ type: 'varchar', length: 80, nullable: true }) cargo: string | null;
  @Column({ type: 'varchar', length: 120, nullable: true }) supervisor_inmediato: string | null;
  @Column({ type: 'enum', enum: TipoContrato, nullable: true }) tipo_contrato: TipoContrato | null;
  @Column({ type: 'varchar', length: 255, nullable: true }) horario_trabajo: string | null;
  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true }) salario: number | null;
  @Column({ type: 'varchar', length: 80, nullable: true }) sucursal: string | null;
  @Column({ type: 'varchar', length: 80, nullable: true }) centro_costo: string | null;

  // 7. BANCARIA
  @Column({ type: 'varchar', length: 80, nullable: true }) banco: string | null;
  @Column({ type: 'enum', enum: TipoCuenta, nullable: true }) tipo_cuenta: TipoCuenta | null;
  @Column({ type: 'varchar', length: 40, nullable: true }) numero_cuenta: string | null;
  @Column({ type: 'varchar', length: 150, nullable: true }) titular_cuenta: string | null;

  // 8. SALUD
  @Column({ type: 'varchar', length: 10, nullable: true }) tipo_sangre: string | null;
  @Column({ default: false }) tiene_condicion_medica: boolean;
  @Column({ type: 'text', nullable: true }) condicion_medica_detalle: string | null;
  @Column({ default: false }) tiene_alergia: boolean;
  @Column({ type: 'text', nullable: true }) alergia_detalle: string | null;
  @Column({ type: 'varchar', length: 80, nullable: true }) ars: string | null;
  @Column({ type: 'varchar', length: 80, nullable: true }) afp: string | null;

  // 9. HABILIDADES (1=básico, 2=intermedio, 3=avanzado)
  @Column({ type: 'tinyint', nullable: true }) habilidad_excel: number | null;
  @Column({ type: 'tinyint', nullable: true }) habilidad_word: number | null;
  @Column({ type: 'tinyint', nullable: true }) habilidad_powerpoint: number | null;
  @Column({ type: 'tinyint', nullable: true }) habilidad_erp: number | null;
  @Column({ type: 'tinyint', nullable: true }) habilidad_diseno_grafico: number | null;
  @Column({ type: 'text', nullable: true }) otros_conocimientos: string | null;

  // 10. INTERESES
  @Column({ type: 'text', nullable: true }) pasatiempos: string | null;
  @Column({ type: 'text', nullable: true }) deportes_favoritos: string | null;
  @Column({ type: 'text', nullable: true }) metas_profesionales: string | null;
  @Column({ type: 'text', nullable: true }) expectativas_empresa: string | null;

  // 11. RECURSOS
  @Column({ default: false }) rec_computadora: boolean;
  @Column({ default: false }) rec_laptop: boolean;
  @Column({ default: false }) rec_telefono: boolean;
  @Column({ default: false }) rec_uniforme: boolean;
  @Column({ default: false }) rec_correo_corporativo: boolean;
  @Column({ default: false }) rec_usuario_sistema: boolean;
  @Column({ default: false }) rec_vehiculo: boolean;
  @Column({ default: false }) rec_herramientas: boolean;
  @Column({ type: 'text', nullable: true }) recursos_observaciones: string | null;

  // 12. DOCUMENTOS (checkboxes; los archivos van en empleados_documentos)
  @Column({ default: false }) doc_copia_cedula: boolean;
  @Column({ default: false }) doc_curriculum: boolean;
  @Column({ default: false }) doc_certificado_medico: boolean;
  @Column({ default: false }) doc_buena_conducta: boolean;
  @Column({ default: false }) doc_certif_academicas: boolean;
  @Column({ default: false }) doc_foto_2x2: boolean;
  @Column({ default: false }) doc_cuenta_bancaria: boolean;
  @Column({ default: false }) doc_contrato_firmado: boolean;

  // 13. DECLARACIÓN
  @Column({ default: false }) declaracion_firmada: boolean;
  @Column({ type: 'date', nullable: true }) fecha_firma: string | null;
  @Column({ type: 'varchar', length: 120, nullable: true }) firmada_por_rrhh: string | null;
  @Column({ type: 'varchar', length: 255, nullable: true }) firma_url: string | null;

  // ADICIONALES ERP
  @Column({ type: 'varchar', length: 10, nullable: true }) talla_camisa: string | null;
  @Column({ type: 'varchar', length: 10, nullable: true }) talla_pantalon: string | null;
  @Column({ type: 'varchar', length: 10, nullable: true }) talla_zapatos: string | null;
  @Column({ type: 'varchar', length: 40, nullable: true }) licencia_conducir: string | null;
  @Column({ type: 'date', nullable: true }) licencia_vencimiento: string | null;
  @Column({ type: 'varchar', length: 255, nullable: true }) foto_url: string | null;

  // META
  @Column({ type: 'enum', enum: EstadoEmpleado, default: EstadoEmpleado.ACTIVO })
  estado: EstadoEmpleado;
  @Column({ type: 'date', nullable: true }) fecha_baja: string | null;
  @Column({ type: 'varchar', length: 255, nullable: true }) motivo_baja: string | null;
  @Column({ type: 'text', nullable: true }) notas: string | null;

  // AUDITORÍA
  @Column({ type: 'varchar', length: 120, nullable: true }) creado_por: string | null;
  @CreateDateColumn({ type: 'datetime', precision: 6 }) creado_en: Date;
  @UpdateDateColumn({ type: 'datetime', precision: 6 }) actualizado_en: Date;

  // Relaciones
  @OneToMany(() => EmpleadoVacacion, v => v.empleado)
  vacaciones?: EmpleadoVacacion[];

  @OneToMany(() => EmpleadoDocumento, d => d.empleado)
  documentos?: EmpleadoDocumento[];
}
