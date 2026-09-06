import {
  IsString, IsOptional, IsEnum, IsBoolean, IsNumber, IsEmail,
  IsDateString, Min, Max, Length,
} from 'class-validator';
import {
  Sexo, EstadoCivil, NivelEducativo, TipoContrato, TipoCuenta, EstadoEmpleado,
} from '../entities/empleado-ficha.entity';

/**
 * DTO de creación. Todos los campos son opcionales menos `nombre_completo`,
 * para permitir crear una ficha temprano y completarla en sesiones distintas.
 */
export class CreateEmpleadoDto {
  // ── 0. Vínculo
  @IsOptional() @IsNumber() usuario_id?: number;
  @IsOptional() @IsString() @Length(1, 20) codigo_empleado?: string;

  // ── 1. Datos personales
  @IsString() @Length(1, 150) nombre_completo: string;
  @IsOptional() @IsString() @Length(1, 20) cedula_pasaporte?: string;
  @IsOptional() @IsDateString() fecha_nacimiento?: string;
  @IsOptional() @IsEnum(Sexo) sexo?: Sexo;
  @IsOptional() @IsEnum(EstadoCivil) estado_civil?: EstadoCivil;
  @IsOptional() @IsString() @Length(1, 60) nacionalidad?: string;
  @IsOptional() @IsString() @Length(1, 255) direccion?: string;
  @IsOptional() @IsString() @Length(1, 100) sector_ciudad?: string;
  @IsOptional() @IsString() @Length(1, 30) telefono_personal?: string;
  @IsOptional() @IsString() @Length(1, 30) telefono_alternativo?: string;
  @IsOptional() @IsEmail() correo_electronico?: string;

  // ── 2. Contacto emergencia
  @IsOptional() @IsString() @Length(1, 150) emerg_nombre?: string;
  @IsOptional() @IsString() @Length(1, 60)  emerg_parentesco?: string;
  @IsOptional() @IsString() @Length(1, 30)  emerg_tel_principal?: string;
  @IsOptional() @IsString() @Length(1, 30)  emerg_tel_secundario?: string;
  @IsOptional() @IsString() @Length(1, 255) emerg_direccion?: string;

  // ── 3. Familiar
  @IsOptional() @IsBoolean() tiene_hijos?: boolean;
  @IsOptional() @IsNumber() @Min(0) @Max(20) cantidad_hijos?: number;

  // ── 4. Académica
  @IsOptional() @IsEnum(NivelEducativo) nivel_educativo?: NivelEducativo;
  @IsOptional() @IsString() @Length(1, 120) profesion?: string;
  @IsOptional() @IsString() @Length(1, 120) carrera_estudiada?: string;
  @IsOptional() @IsString() @Length(1, 150) institucion_educativa?: string;
  @IsOptional() @IsString() cursos_certificaciones?: string;

  // ── 5. Laboral
  @IsOptional() @IsDateString() fecha_ingreso?: string;
  @IsOptional() @IsString() @Length(1, 80) departamento?: string;
  @IsOptional() @IsString() @Length(1, 80) cargo?: string;
  @IsOptional() @IsString() @Length(1, 120) supervisor_inmediato?: string;
  @IsOptional() @IsEnum(TipoContrato) tipo_contrato?: TipoContrato;
  @IsOptional() @IsString() @Length(1, 255) horario_trabajo?: string;
  @IsOptional() @IsNumber() @Min(0) salario?: number;
  @IsOptional() @IsString() @Length(1, 80) sucursal?: string;
  @IsOptional() @IsString() @Length(1, 80) centro_costo?: string;

  // ── 7. Bancaria
  @IsOptional() @IsString() @Length(1, 80) banco?: string;
  @IsOptional() @IsEnum(TipoCuenta) tipo_cuenta?: TipoCuenta;
  @IsOptional() @IsString() @Length(1, 40) numero_cuenta?: string;
  @IsOptional() @IsString() @Length(1, 150) titular_cuenta?: string;

  // ── 8. Salud
  @IsOptional() @IsString() @Length(1, 10) tipo_sangre?: string;
  @IsOptional() @IsBoolean() tiene_condicion_medica?: boolean;
  @IsOptional() @IsString() condicion_medica_detalle?: string;
  @IsOptional() @IsBoolean() tiene_alergia?: boolean;
  @IsOptional() @IsString() alergia_detalle?: string;
  @IsOptional() @IsString() @Length(1, 80) ars?: string;
  @IsOptional() @IsString() @Length(1, 80) afp?: string;

  // ── 9. Habilidades (1=básico, 2=intermedio, 3=avanzado)
  @IsOptional() @IsNumber() @Min(1) @Max(3) habilidad_excel?: number;
  @IsOptional() @IsNumber() @Min(1) @Max(3) habilidad_word?: number;
  @IsOptional() @IsNumber() @Min(1) @Max(3) habilidad_powerpoint?: number;
  @IsOptional() @IsNumber() @Min(1) @Max(3) habilidad_erp?: number;
  @IsOptional() @IsNumber() @Min(1) @Max(3) habilidad_diseno_grafico?: number;
  @IsOptional() @IsString() otros_conocimientos?: string;

  // ── 10. Intereses
  @IsOptional() @IsString() pasatiempos?: string;
  @IsOptional() @IsString() deportes_favoritos?: string;
  @IsOptional() @IsString() metas_profesionales?: string;
  @IsOptional() @IsString() expectativas_empresa?: string;

  // ── 11. Recursos
  @IsOptional() @IsBoolean() rec_computadora?: boolean;
  @IsOptional() @IsBoolean() rec_laptop?: boolean;
  @IsOptional() @IsBoolean() rec_telefono?: boolean;
  @IsOptional() @IsBoolean() rec_uniforme?: boolean;
  @IsOptional() @IsBoolean() rec_correo_corporativo?: boolean;
  @IsOptional() @IsBoolean() rec_usuario_sistema?: boolean;
  @IsOptional() @IsBoolean() rec_vehiculo?: boolean;
  @IsOptional() @IsBoolean() rec_herramientas?: boolean;
  @IsOptional() @IsString() recursos_observaciones?: string;

  // ── 12. Documentos (checks)
  @IsOptional() @IsBoolean() doc_copia_cedula?: boolean;
  @IsOptional() @IsBoolean() doc_curriculum?: boolean;
  @IsOptional() @IsBoolean() doc_certificado_medico?: boolean;
  @IsOptional() @IsBoolean() doc_buena_conducta?: boolean;
  @IsOptional() @IsBoolean() doc_certif_academicas?: boolean;
  @IsOptional() @IsBoolean() doc_foto_2x2?: boolean;
  @IsOptional() @IsBoolean() doc_cuenta_bancaria?: boolean;
  @IsOptional() @IsBoolean() doc_contrato_firmado?: boolean;

  // ── 13. Declaración
  @IsOptional() @IsBoolean() declaracion_firmada?: boolean;
  @IsOptional() @IsDateString() fecha_firma?: string;
  @IsOptional() @IsString() @Length(1, 120) firmada_por_rrhh?: string;
  @IsOptional() @IsString() @Length(1, 255) firma_url?: string;

  // ── Adicionales ERP
  @IsOptional() @IsString() @Length(1, 10) talla_camisa?: string;
  @IsOptional() @IsString() @Length(1, 10) talla_pantalon?: string;
  @IsOptional() @IsString() @Length(1, 10) talla_zapatos?: string;
  @IsOptional() @IsString() @Length(1, 40) licencia_conducir?: string;
  @IsOptional() @IsDateString() licencia_vencimiento?: string;
  @IsOptional() @IsString() @Length(1, 255) foto_url?: string;

  // ── Meta
  @IsOptional() @IsEnum(EstadoEmpleado) estado?: EstadoEmpleado;
  @IsOptional() @IsDateString() fecha_baja?: string;
  @IsOptional() @IsString() @Length(1, 255) motivo_baja?: string;
  @IsOptional() @IsString() notas?: string;

  // ── Campos del formulario que antes se perdían (completados jul 2026)
  @IsOptional() @IsString() @Length(1, 80) provincia?: string;
  @IsOptional() @IsString() @Length(1, 10) ano_graduacion?: string;
  @IsOptional() @IsString() medicamentos?: string;
  @IsOptional() @IsString() condiciones_medicas?: string;
  @IsOptional() @IsString() @Length(1, 30) metodo_pago?: string;
  @IsOptional() @IsString() @Length(1, 20) periodo_pago?: string;
  @IsOptional() @IsString() @Length(1, 40) numero_afp?: string;
  @IsOptional() @IsString() @Length(1, 80) sfs_arl?: string;
  @IsOptional() @IsString() @Length(1, 120) seguro_privado?: string;
  @IsOptional() @IsBoolean() paga_bonos?: boolean;
  @IsOptional() @IsBoolean() paga_comisiones?: boolean;
  @IsOptional() @IsBoolean() paga_viaticos?: boolean;
  @IsOptional() @IsString() notas_beneficios?: string;
  @IsOptional() @IsString() amonestaciones?: string;
  @IsOptional() @IsString() suspensiones?: string;
  @IsOptional() @IsString() observaciones_disciplinarias?: string;
}
