import {
  Controller, Get, Post, Patch, Delete,
  Param, Query, Body, ParseIntPipe, UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../common/guards';
import { InventarioInternoService } from './inventario-interno.service';
import { EstadoUnidad } from './entities/insumo-unidad.entity';
import { EstadoRequerimiento } from './entities/insumo-requerimiento.entity';

@UseGuards(JwtAuthGuard)
@Controller('inventario-interno')
export class InventarioInternoController {
  constructor(private readonly svc: InventarioInternoService) {}

  // ── Catálogo ──────────────────────────────────────────────────────────────
  @Get('insumos')
  listarInsumos(@Query('departamento_id') deptId?: string) {
    return this.svc.listarInsumos(deptId ? parseInt(deptId) : undefined);
  }

  @Post('insumos')
  crearInsumo(@Body() body: {
    departamento_id: number;
    departamento_nombre: string;
    nombre: string;
    descripcion?: string;
    unidad: string;
    stock_minimo?: number;
    creado_por?: string;
  }) {
    return this.svc.crearInsumo(body);
  }

  @Patch('insumos/:id')
  actualizarInsumo(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: any,
  ) {
    return this.svc.actualizarInsumo(id, body);
  }

  @Delete('insumos/:id')
  eliminarInsumo(@Param('id', ParseIntPipe) id: number) {
    return this.svc.eliminarInsumo(id);
  }

  // ── Resumen (dashboard cards) ─────────────────────────────────────────────
  @Get('resumen')
  resumen(@Query('departamento_id') deptId?: string) {
    return this.svc.resumen(deptId ? parseInt(deptId) : undefined);
  }

  // ── Unidades individuales ─────────────────────────────────────────────────
  @Get('insumos/:id/unidades')
  listarUnidades(@Param('id', ParseIntPipe) id: number) {
    return this.svc.listarUnidades(id);
  }

  @Post('insumos/:id/unidades')
  agregarUnidades(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { cantidad: number; notas?: string; registrado_por?: string },
  ) {
    return this.svc.agregarUnidades({ insumo_id: id, ...body });
  }

  @Patch('unidades/:id/estado')
  cambiarEstado(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { estado: EstadoUnidad; modificado_por?: string; notas?: string },
  ) {
    return this.svc.cambiarEstado(id, body);
  }

  // ── Requerimientos ────────────────────────────────────────────────────────
  @Get('requerimientos')
  listarRequerimientos(
    @Query('departamento_id') deptId?: string,
    @Query('estado') estado?: EstadoRequerimiento,
  ) {
    return this.svc.listarRequerimientos({
      departamento_id: deptId ? parseInt(deptId) : undefined,
      estado,
    });
  }

  @Post('requerimientos')
  crearRequerimiento(@Body() body: any) {
    return this.svc.crearRequerimiento(body);
  }

  @Patch('requerimientos/:id/aprobar')
  aprobar(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { aprobado_por: string; notas_admin?: string },
  ) {
    return this.svc.aprobarRequerimiento(id, body.aprobado_por, body.notas_admin);
  }

  @Patch('requerimientos/:id/rechazar')
  rechazar(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { aprobado_por: string; notas_admin?: string },
  ) {
    return this.svc.rechazarRequerimiento(id, body.aprobado_por, body.notas_admin);
  }

  @Patch('requerimientos/:id/comprado')
  marcarComprado(@Param('id', ParseIntPipe) id: number) {
    return this.svc.marcarComprado(id);
  }

  @Patch('requerimientos/:id/recibir')
  recibir(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { recibido_por: string; items: Array<{ item_id: number; cantidad_recibida: number }> },
  ) {
    return this.svc.recibirRequerimiento(id, body);
  }
}
