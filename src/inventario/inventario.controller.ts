import { Controller, Get, Post, Body, Query, Param, ParseIntPipe, UseGuards, BadRequestException } from '@nestjs/common';
import { MaterialesOrdenService } from '../materiales/materiales-orden.service';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { InventarioService, MOTIVOS_SALIDA } from './inventario.service';
import { JwtAuthGuard } from '../common/guards';

@ApiTags('Inventario')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('inventario')
export class InventarioController {
  constructor(private svc: InventarioService, private materiales: MaterialesOrdenService) {}

  @Get('stock-disponible')
  getStockDisponible() {
    return this.svc.getStockDisponible();
  }

  @Get('stock-variantes')
  getStockVariantes() {
    return this.svc.getStockVariantes();
  }

  /** La pieza separada no está en el almacén: se anula la separación con corrección de conteo y la orden la pide a la compra. */
  @Post('separados/:reservaId/no-existe')
  async separadoNoExiste(
    @Param('reservaId', ParseIntPipe) reservaId: number,
    @Body() body: { cantidad?: number; usuario_nombre?: string },
  ) {
    try { return await this.materiales.separadoNoExiste(reservaId, body?.cantidad ?? null, body?.usuario_nombre ?? 'Sistema'); }
    catch (e: any) { throw new BadRequestException(e?.message ?? 'No se pudo corregir la separación'); }
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

  @Get('motivos-salida')
  motivosSalida() {
    return MOTIVOS_SALIDA;
  }

  @Post('salida')
  salida(@Body() body: any) {
    return this.svc.salidaManual(body);
  }

  @Post('ajuste-lote')
  ajusteLote(@Body() body: any) {
    return this.svc.ajusteLote(body);
  }

  @Post()
  registrar(@Body() body: any) {
    return this.svc.registrar(body);
  }
}
