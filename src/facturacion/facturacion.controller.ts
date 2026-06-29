import { Controller, Get, Post, Patch, Param, Body, Query, Res, UseGuards, Request } from '@nestjs/common';
import { CurrentUser, Roles } from '../common/decorators';
import { Response } from 'express';
import { FacturacionService } from './facturacion.service';
import { JwtAuthGuard, RolesGuard } from '../common/guards';
import { RolUsuario } from '../auth/entities/usuario.entity';
import { TipoNcf } from './entities/ncf-secuencia.entity';
import { EstadoFactura, TipoComprobante, MetodoPago } from './entities/factura.entity';
import { TipoPago } from './entities/factura-pago.entity';
import { TipoNotaCredito, MotivoNotaCredito } from './entities/nota-credito.entity';

@UseGuards(JwtAuthGuard)
@Controller('facturacion')
export class FacturacionController {
  constructor(private readonly svc: FacturacionService) {}

  // ── NCF Secuencias ────────────────────────────────────────────────────────
  @Get('ncf')
  getNcf() { return this.svc.findAllNcf(); }

  @Post('ncf')
  upsertNcf(@Body() body: { tipo: TipoNcf; desde: number; hasta: number; actual?: number; notas?: string; fecha_vencimiento?: string | null }) {
    return this.svc.upsertNcf(body);
  }

  @Patch('ncf/:id/toggle')
  toggleNcf(@Param('id') id: string) { return this.svc.toggleNcf(+id); }

  @Post('migraciones/ncf-fecha-vencimiento')
  migrarNcfFechaVencimiento() { return this.svc.migrarColumnaNcfFechaVencimiento(); }

  // ── Facturas ──────────────────────────────────────────────────────────────
  @Get()
  findAll(
    @Query('estado')              estado?: string,
    @Query('tipo_ncf')            tipo_ncf?: string,
    @Query('desde')               desde?: string,
    @Query('hasta')               hasta?: string,
    @Query('orden_produccion_id') orden_produccion_id?: string,
    @Query('cliente_id')          cliente_id?: string,
  ) { return this.svc.findAll({ estado, tipo_ncf, desde, hasta, orden_produccion_id: orden_produccion_id ? +orden_produccion_id : undefined, cliente_id: cliente_id ? +cliente_id : undefined }); }

  @Get('pendientes-cliente/:clienteId')
  pendientesCliente(@Param('clienteId') clienteId: string) {
    return this.svc.pendientesCliente(+clienteId);
  }

  @Get('export/606')
  async export606(@Query('desde') desde: string, @Query('hasta') hasta: string, @Res() res: Response) {
    const csv = await this.svc.export606(desde, hasta);
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', `attachment; filename="606_${desde}_${hasta}.txt"`);
    res.send(csv);
  }

  @Get('reporte/607')
  async reporte607(@Query('mes') mes: string, @Query('anio') anio: string, @Res() res: Response) {
    const csv = await this.svc.reporte607(+mes, +anio);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="607_${anio}${mes.padStart(2,'0')}.txt"`);
    res.send(csv);
  }

  @Get('reporte/608')
  async reporte608(@Query('mes') mes: string, @Query('anio') anio: string, @Res() res: Response) {
    const csv = await this.svc.reporte608(+mes, +anio);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="608_${anio}${mes.padStart(2,'0')}.txt"`);
    res.send(csv);
  }

  @Get('cuentas-por-cobrar')
  cuentasPorCobrar() { return this.svc.cuentasPorCobrar(); }

  @Post('pago-masivo')
  pagoMasivo(@Body() body: any, @CurrentUser() user: any) {
    return this.svc.pagoMasivo({
      ...body,
      creado_por:  user?.nombre ?? user?.email,
      usuario_rol: user?.rol,
    });
  }

  @Get('estado-cuenta/:clienteId')
  estadoCuenta(
    @Param('clienteId') clienteId: string,
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
  ) {
    return this.svc.estadoCuenta(+clienteId, { desde, hasta });
  }

  @Get(':id')
  findOne(@Param('id') id: string) { return this.svc.findOne(+id); }

  @Post()
  crear(@Body() body: any, @Request() req: any) {
    return this.svc.crear({ ...body, creado_por: req.user?.nombre ?? req.user?.email });
  }

  @Patch(':id/estado')
  actualizarEstado(
    @Param('id') id: string,
    @Body() body: { estado: EstadoFactura; fecha_vencimiento?: string },
    @CurrentUser() user: any,
  ) {
    return this.svc.actualizarEstado(+id, body.estado, body.fecha_vencimiento, user?.rol);
  }

  // ── Pagos ─────────────────────────────────────────────────────────────────
  @Post(':id/pagos')
  registrarPago(@Param('id') id: string, @Body() body: any, @Request() req: any) {
    return this.svc.registrarPago(+id, { ...body, creado_por: req.user?.nombre ?? req.user?.email });
  }

  @Patch(':id/pagos/:pagoId/revertir')
  revertirPago(
    @Param('id') id: string,
    @Param('pagoId') pagoId: string,
    @Body('motivo') motivo: string,
    @CurrentUser() user: any,
  ) {
    return this.svc.revertirPago(+id, +pagoId, motivo ?? '', user?.nombre ?? user?.email, user?.rol);
  }

  @Patch('pagos/:pagoId/validar')
  @UseGuards(RolesGuard) @Roles(RolUsuario.ADMIN)
  validarPago(
    @Param('pagoId') pagoId: string,
    @CurrentUser() user: any,
  ) {
    return this.svc.validarPago(+pagoId, user?.nombre ?? user?.email);
  }

  @Patch('pagos/:pagoId/desvalidar')
  @UseGuards(RolesGuard) @Roles(RolUsuario.ADMIN)
  desvalidarPago(
    @Param('pagoId') pagoId: string,
    @CurrentUser() user: any,
  ) {
    return this.svc.desvalidarPago(+pagoId, user?.nombre ?? user?.email);
  }

  // ── Notas de Crédito ──────────────────────────────────────────────────────
  @Post(':id/nota-credito')
  emitirNotaCredito(@Param('id') id: string, @Body() body: any, @CurrentUser() user: any) {
    return this.svc.emitirNotaCredito(+id, {
      ...body,
      creado_por:   user?.nombre ?? user?.email,
      usuario_rol:  user?.rol,
    });
  }
}
