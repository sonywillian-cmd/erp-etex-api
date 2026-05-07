import { Controller, Get, Post, Patch, Param, Body, Query, ParseIntPipe, UseGuards } from '@nestjs/common';
import { RecibosService } from './recibos.service';
import { TipoRecibo } from './entities/recibo-ingreso.entity';
import { JwtAuthGuard, RolesGuard } from '../common/guards';
import { Roles } from '../common/decorators';
import { RolUsuario } from '../auth/entities/usuario.entity';

@UseGuards(JwtAuthGuard)
@Controller('recibos')
export class RecibosController {
  constructor(private svc: RecibosService) {}

  @Get()
  listar(
    @Query('fecha')          fecha?:          string,
    @Query('desde')          desde?:          string,
    @Query('hasta')          hasta?:          string,
    @Query('tipo')           tipo?:           string,
    @Query('metodo')         metodo?:         string,
    @Query('cliente_nombre') cliente_nombre?: string,
  ) {
    return this.svc.listar({ fecha, desde, hasta, tipo, metodo, cliente_nombre });
  }

  /** GET /recibos/:id */
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.svc.findOne(id);
  }

  /** GET /recibos/factura/:facturaId */
  @Get('factura/:facturaId')
  porFactura(@Param('facturaId', ParseIntPipe) facturaId: number) {
    return this.svc.porFactura(facturaId);
  }

  /** GET /recibos/orden/:ordenId */
  @Get('orden/:ordenId')
  porOrden(@Param('ordenId', ParseIntPipe) ordenId: number) {
    return this.svc.porOrden(ordenId);
  }

  /** GET /recibos/transferencias — panel de validación admin */
  @Get('transferencias')
  @UseGuards(RolesGuard) @Roles(RolUsuario.ADMIN)
  listarTransferencias(
    @Query('desde')           desde?:           string,
    @Query('hasta')           hasta?:           string,
    @Query('validado')        validado?:        string,
    @Query('cuenta_banco_id') cuenta_banco_id?: string,
  ) {
    return this.svc.listarTransferencias({ desde, hasta, validado, cuenta_banco_id });
  }

  /**
   * POST /recibos/anticipo
   * Crea un anticipo/abono sobre una orden SIN factura.
   */
  @Post('anticipo')
  crearAnticipo(@Body() body: {
    orden_produccion_id: number;
    cliente_id?: number;
    cliente_nombre?: string;
    metodo: string;
    monto: number;
    fecha: string;
    referencia?: string;
    banco_nombre?: string;
    cuenta_digitos?: string;
    cuenta_banco_id?: number;
    notas?: string;
    creado_por?: string;
  }) {
    return this.svc.crearAnticipo(body);
  }

  /** PATCH /recibos/:id/validar — admin certifica transferencia */
  @Patch(':id/validar')
  @UseGuards(RolesGuard) @Roles(RolUsuario.ADMIN)
  validar(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { validado_por: string },
  ) {
    return this.svc.validarRecibo(id, body.validado_por);
  }

  /** PATCH /recibos/:id/desvalidar — admin revierte validación */
  @Patch(':id/desvalidar')
  @UseGuards(RolesGuard) @Roles(RolUsuario.ADMIN)
  desvalidar(@Param('id', ParseIntPipe) id: number) {
    return this.svc.desvalidarRecibo(id);
  }

  /** POST /recibos — crear recibo genérico */
  @Post()
  crear(@Body() body: {
    tipo: TipoRecibo;
    orden_produccion_id?: number;
    factura_id?: number;
    factura_pago_id?: number;
    cliente_id?: number;
    cliente_nombre?: string;
    metodo: string;
    monto: number;
    fecha: string;
    referencia?: string;
    banco_nombre?: string;
    cuenta_digitos?: string;
    cuenta_banco_id?: number;
    notas?: string;
    creado_por?: string;
  }) {
    return this.svc.crear(body);
  }
}
