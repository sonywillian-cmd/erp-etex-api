import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { InventarioService } from './inventario.service';
import { JwtAuthGuard } from '../common/guards';

@ApiTags('Inventario')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('inventario')
export class InventarioController {
  constructor(private svc: InventarioService) {}

  @Get('stock-disponible')
  getStockDisponible() {
    return this.svc.getStockDisponible();
  }

  @Get('stock-variantes')
  getStockVariantes() {
    return this.svc.getStockVariantes();
  }

  @Get('separados')
  getSeparados() {
    return this.svc.getSeparados();
  }

  @Post('reconciliar')
  reconciliarStock() {
    return this.svc.reconciliarStock();
  }

  @Get()
  findAll(@Query() q: { producto_id?: string; tipo?: string }) {
    return this.svc.findAll(q);
  }

  @Post()
  registrar(@Body() body: any) {
    return this.svc.registrar(body);
  }
}
