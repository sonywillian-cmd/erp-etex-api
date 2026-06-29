import { IsString, IsOptional, IsEnum, IsEmail, IsBoolean, IsNumber } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TipoCliente, EstadoCliente } from '../entities/cliente.entity';

export class CreateClienteDto {
  @ApiProperty()
  @IsString()
  nombre: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  nombre_comercial?: string;

  @ApiPropertyOptional({ enum: TipoCliente })
  @IsOptional() @IsEnum(TipoCliente)
  tipo?: TipoCliente;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  documento?: string;

  @ApiProperty()
  @IsString()
  telefono: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  telefono_alt?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsEmail()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  direccion?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  ciudad?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  provincia?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsNumber()
  vendedor_id?: number;

  @ApiPropertyOptional()
  @IsOptional() @IsBoolean()
  aplica_itbis?: boolean;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  terminos_pago?: string;

  @ApiPropertyOptional({ enum: EstadoCliente })
  @IsOptional() @IsEnum(EstadoCliente)
  estado?: EstadoCliente;

  @ApiPropertyOptional()
  @IsOptional() @IsNumber()
  limite_credito?: number;

  @ApiPropertyOptional()
  @IsOptional() @IsNumber()
  plazo_credito?: number;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  notas?: string;

  /**
   * Tipo NCF preferido para esta empresa al facturar: B01, B02, B14, B15.
   * NULL para personas (se decide al momento de facturar).
   */
  @ApiPropertyOptional({ enum: ['B01', 'B02', 'B14', 'B15'] })
  @IsOptional() @IsString()
  ncf_tipo_default?: string;
}
