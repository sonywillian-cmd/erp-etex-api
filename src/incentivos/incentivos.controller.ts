import {
  Controller, Get, Post, Put, Delete,
  Body, Param, ParseIntPipe, Query, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { IncentivosService, UpsertConfigDto, UpsertEmpleadoDto } from './incentivos.service';
import { RolesGuard } from '../common/guards';

@ApiTags('incentivos')
@UseGuards(RolesGuard)
@Controller('incentivos')
export class IncentivosController {
  constructor(private readonly svc: IncentivosService) {}

  // ── Plantillas por departamento ───────────────────────────────────────────

  @Get('config')
  getConfig() { return this.svc.getConfig(); }

  @Post('config')
  upsertConfig(@Body() dto: UpsertConfigDto) { return this.svc.upsertConfig(dto); }

  @Delete('config/:id')
  deleteConfig(@Param('id', ParseIntPipe) id: number) { return this.svc.deleteConfig(id); }

  @Get('config/plantilla/:departamento')
  @ApiOperation({ summary: 'Obtener plantilla de un departamento para pre-llenar formulario' })
  getPlantilla(@Param('departamento') departamento: string) {
    return this.svc.getPlantillaDepartamento(decodeURIComponent(departamento));
  }

  // ── Incentivos por empleado ───────────────────────────────────────────────

  @Get('empleado/:usuarioId')
  @ApiOperation({ summary: 'Obtener configs de incentivo de un empleado' })
  getEmpleado(@Param('usuarioId', ParseIntPipe) id: number) {
    return this.svc.getEmpleadoIncentivos(id);
  }

  @Post('empleado')
  @ApiOperation({ summary: 'Crear o actualizar incentivo para empleado+departamento' })
  upsertEmpleado(@Body() dto: UpsertEmpleadoDto) {
    return this.svc.upsertEmpleadoIncentivo(dto);
  }

  @Put('empleado/:id/toggle')
  @ApiOperation({ summary: 'Activar o desactivar incentivo' })
  toggleEmpleado(
    @Param('id', ParseIntPipe) id: number,
    @Body('activo') activo: boolean,
  ) { return this.svc.toggleEmpleadoIncentivo(id, activo); }

  @Delete('empleado/:id')
  @ApiOperation({ summary: 'Eliminar incentivo de empleado' })
  deleteEmpleado(@Param('id', ParseIntPipe) id: number) {
    return this.svc.deleteEmpleadoIncentivo(id);
  }

  // ── Rendimiento (admin) ───────────────────────────────────────────────────

  @Get('rendimiento')
  @ApiOperation({ summary: 'Resumen de todos los empleados con incentivo activo' })
  getResumen(
    @Query('departamento') departamento?: string,
    @Query('fecha_desde')  fecha_desde?: string,
    @Query('fecha_hasta')  fecha_hasta?: string,
  ) {
    return this.svc.getResumenTodos({ departamento, fechaDesde: fecha_desde, fechaHasta: fecha_hasta });
  }

  @Get('rendimiento/:usuarioId')
  @ApiOperation({ summary: 'Rendimiento detallado de un empleado (con $$$)' })
  getRendimiento(
    @Param('usuarioId', ParseIntPipe) usuarioId: number,
    @Query('fecha_desde') fecha_desde?: string,
    @Query('fecha_hasta') fecha_hasta?: string,
  ) {
    return this.svc.getRendimientoEmpleado(usuarioId, fecha_desde, fecha_hasta);
  }

  // ── Progreso personal (empleado — sin $$$) ────────────────────────────────

  @Get('mi-progreso/:usuarioId')
  @ApiOperation({ summary: 'Progreso del período actual del empleado (sin montos)' })
  getMiProgreso(@Param('usuarioId', ParseIntPipe) usuarioId: number) {
    return this.svc.getMiProgreso(usuarioId);
  }

  @Get('mi-historial/:usuarioId')
  @ApiOperation({ summary: 'Historial de rendimiento y gráfica de puntualidad del empleado' })
  getMiHistorial(@Param('usuarioId', ParseIntPipe) usuarioId: number) {
    return this.svc.getMiHistorial(usuarioId);
  }
}
