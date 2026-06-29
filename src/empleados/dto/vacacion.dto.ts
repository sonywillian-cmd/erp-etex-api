import {
  IsString, IsOptional, IsEnum, IsNumber, IsDateString, Min, Length,
} from 'class-validator';
import { PartialType } from '@nestjs/swagger';
import {
  DecisionVacacion, EstadoPagoVacacion,
} from '../entities/empleado-vacacion.entity';

export class CreateVacacionDto {
  /** Periodo / año (ej "2026" o "2025-2026") */
  @IsString() @Length(1, 10) periodo: string;

  @IsOptional() @IsNumber() @Min(0) dias_derecho?: number;
  @IsOptional() @IsEnum(DecisionVacacion) decision?: DecisionVacacion;
  @IsOptional() @IsNumber() @Min(0) dias_tomados?: number;
  @IsOptional() @IsDateString() fecha_inicio?: string;
  @IsOptional() @IsDateString() fecha_fin?: string;
  @IsOptional() @IsNumber() @Min(0) monto_a_pagar?: number;
  @IsOptional() @IsNumber() @Min(0) monto_pagado?: number;
  @IsOptional() @IsEnum(EstadoPagoVacacion) estado_pago?: EstadoPagoVacacion;
  @IsOptional() @IsDateString() fecha_pago?: string;
  @IsOptional() @IsString() @Length(1, 30) metodo_pago?: string;
  @IsOptional() @IsString() @Length(1, 100) referencia?: string;
  @IsOptional() @IsString() notas?: string;
}

export class UpdateVacacionDto extends PartialType(CreateVacacionDto) {}

/**
 * Registrar abono/pago contra una fila de vacaciones existente.
 * Se suma a `monto_pagado` y recalcula `estado_pago` automáticamente.
 */
export class RegistrarPagoVacacionDto {
  @IsNumber() @Min(0.01) monto: number;
  @IsOptional() @IsDateString() fecha?: string;
  @IsOptional() @IsString() @Length(1, 30) metodo_pago?: string;
  @IsOptional() @IsString() @Length(1, 100) referencia?: string;
  @IsOptional() @IsString() notas?: string;
}
