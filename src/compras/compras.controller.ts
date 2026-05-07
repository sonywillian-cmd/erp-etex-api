import { Controller, Get, Post, Put, Patch, Body, Param, Query, ParseIntPipe, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ComprasService } from './compras.service';
import { EstadoCompra } from './entities/orden-compra.entity';
import { JwtAuthGuard } from '../common/guards';

@ApiTags('Compras')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('compras')
export class ComprasController {
  constructor(private svc: ComprasService) {}

  @Get()
  findAll(@Query() q: { estado?: string; proveedor?: string }) {
    return this.svc.findAll(q);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.svc.findOne(id);
  }

  @Post()
  @ApiOperation({ summary: 'Crear orden de compra' })
  create(@Body() body: any) {
    return this.svc.create(body);
  }

  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.svc.update(id, body);
  }

  @Put(':id/estado')
  estadoPut(@Param('id', ParseIntPipe) id: number, @Body('estado') estado: EstadoCompra) {
    return this.svc.cambiarEstado(id, estado);
  }

  @Patch(':id/estado')
  estadoPatch(@Param('id', ParseIntPipe) id: number, @Body('estado') estado: EstadoCompra) {
    return this.svc.cambiarEstado(id, estado);
  }

  @Post(':id/recibir')
  @ApiOperation({ summary: 'Registrar recepción de mercancía y generar entrada al inventario' })
  recibir(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { lineas: Array<{ producto_id: number; talla: string | null; color: string | null; cantidad_recibida: number }>; usuario_id?: number },
  ) {
    return this.svc.recibirOrden(id, body.lineas, body.usuario_id);
  }

  @Get(':id/ordenes-produccion')
  @ApiOperation({ summary: 'Obtener OPs relacionadas a esta OC y conteo de piezas' })
  getOrdenesProduccion(@Param('id', ParseIntPipe) id: number) {
    return this.svc.getOrdenesProduccionRelacionadas(id);
  }

  @Post(':id/separar')
  @ApiOperation({ summary: 'Separar OPs seleccionadas en una nueva OC o agregar a existente' })
  separar(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { op_ids: number[]; oc_destino_id?: number },
  ) {
    return this.svc.separarOC(id, body.op_ids, body.oc_destino_id);
  }

  @Post('validar-inventario')
  @UseGuards(JwtAuthGuard)
  validarInventario(@Body() body: { orden_produccion_id: number; documento_origen: string; items: any[]; comprador: string }) {
    return this.svc.validarInventarioYGenerarCompras(body.orden_produccion_id, body.documento_origen, body.items, body.comprador);
  }
}
