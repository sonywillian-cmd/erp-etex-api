import { Controller, Get, Post, Put, Delete, Body, Param, Query, ParseIntPipe, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { CotizacionesService } from './cotizaciones.service';
import { EstadoCotizacion } from './entities/cotizacion.entity';
import { JwtAuthGuard } from '../common/guards';

@ApiTags('Cotizaciones')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('cotizaciones')
export class CotizacionesController {
  constructor(private svc: CotizacionesService) {}

  @Get()
  @ApiOperation({ summary: 'Listar cotizaciones' })
  findAll(@Query() q: { search?: string; estado?: string; cliente_id?: string }) {
    return this.svc.findAll(q);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.svc.findOne(id);
  }

  @Post()
  @ApiOperation({ summary: 'Crear cotización con líneas' })
  create(@Body() body: any) {
    return this.svc.create(body);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Actualizar cotización (lineas + campos)' })
  actualizar(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.svc.actualizar(id, body);
  }

  @Put(':id/estado')
  @ApiOperation({ summary: 'Cambiar estado de cotización' })
  estado(@Param('id', ParseIntPipe) id: number, @Body('estado') estado: EstadoCotizacion) {
    return this.svc.cambiarEstado(id, estado);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.svc.remove(id);
  }

  /** Migración única: normaliza descripciones de variantes " / " → " " */
  @Post('migraciones/normalizar-descripciones')
  @ApiOperation({ summary: '[MIGRACIÓN] Normaliza "COLOR / TALLA" → "COLOR TALLA" en todas las líneas' })
  normalizarDescripciones() {
    return this.svc.normalizarDescripcionesVariantes();
  }
}
