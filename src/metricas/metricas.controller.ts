import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { MetricasService } from './metricas.service';

@Controller('metricas')
export class MetricasController {
  constructor(private svc: MetricasService) {}

  @Get('resumen')
  resumen() { return this.svc.resumenGeneral(); }

  @Get('operarios')
  operarios(
    @Query('operario')     operario?:     string,
    @Query('departamento') departamento?: string,
  ) { return this.svc.metricasOperarios({ operario, departamento }); }

  @Get('operarios/ranking/:departamento')
  ranking(@Param('departamento') depto: string) {
    return this.svc.rankingOperarios(decodeURIComponent(depto));
  }

  @Get('proveedores')
  proveedores(@Query('proveedor_id') id?: string) {
    return this.svc.metricasProveedores(id ? parseInt(id) : undefined);
  }

  @Get('sugerencia/:ordenId')
  sugerencia(@Param('ordenId', ParseIntPipe) ordenId: number) {
    return this.svc.sugerenciaFechaOrden(ordenId);
  }
}
