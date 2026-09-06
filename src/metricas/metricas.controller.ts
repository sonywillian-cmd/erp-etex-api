import { Controller, Get, Param, ParseIntPipe, Query, UseGuards } from '@nestjs/common';
import { MetricasService } from './metricas.service';
import { JwtAuthGuard, RolesGuard } from '../common/guards';
import { Roles } from '../common/decorators';
import { RolUsuario } from '../auth/entities/usuario.entity';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(RolUsuario.ADMIN, RolUsuario.SUPERVISOR)
@Controller('metricas')
export class MetricasController {
  constructor(private svc: MetricasService) {}

  @Get('resumen')
  resumen() { return this.svc.resumenGeneral(); }

  @Get('reporte-mensual')
  reporteMensual(@Query('mes') mes?: string) { return this.svc.reporteMensual(mes); }

  // ── Ganancias por producto/técnica ──
  @Get('ganancia-resumen')
  gananciaResumen(
    @Query('desde') desde: string,
    @Query('hasta') hasta: string,
    @Query('base')  base?: 'orden' | 'factura',
  ) { return this.svc.gananciaResumen(desde, hasta, base === 'factura' ? 'factura' : 'orden'); }

  @Get('ganancia-orden/:id')
  gananciaOrden(@Param('id', ParseIntPipe) id: number) { return this.svc.gananciaOrden(id); }

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
