import { Controller, Get, Post, Patch, Param, Body, Query, ParseIntPipe, UseGuards } from '@nestjs/common';
import { RecibosService } from './recibos.service';
import { TipoRecibo } from './entities/recibo-ingreso.entity';
import { JwtAuthGuard, RolesGuard } from '../common/guards';
import { Roles, CurrentUser } from '../common/decorators';
import { RolUsuario } from '../auth/entities/usuario.entity';

// Lecturas: cualquier autenticado. Crear recibos/anticipos: admin y supervisor.
// Validar/desvalidar transferencias: solo admin.
@UseGuards(JwtAuthGuard, RolesGuard)
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

  /** GET /recibos/transferencias — panel de validación admin.
   *  IMPORTANTE: debe declararse ANTES de `@Get(':id')`; si no, la ruta estática
   *  cae en el comodín `:id` y el ParseIntPipe la rechaza con 400. */
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

  /** GET /recibos/:id — comodín, va DESPUÉS de las rutas estáticas de arriba */
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.svc.findOne(id);
  }

  /**
   * POST /recibos/anticipo
   * Crea un anticipo/abono sobre una orden SIN factura.
   */
  @Post('anticipo')
  @Roles(RolUsuario.ADMIN, RolUsuario.SUPERVISOR, RolUsuario.VENDEDOR)
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

  /** PATCH /recibos/:id/validar — admin certifica transferencia.
   *  El certificador se toma del JWT, NO del body, para no falsificar quién validó. */
  @Patch(':id/validar')
  @Roles(RolUsuario.ADMIN)
  validar(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: any,
  ) {
    return this.svc.validarRecibo(id, user?.nombre ?? user?.email ?? 'admin');
  }

  /** PATCH /recibos/:id/desvalidar — admin revierte validación */
  @Patch(':id/desvalidar')
  @Roles(RolUsuario.ADMIN)
  desvalidar(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: any,
  ) {
    return this.svc.desvalidarRecibo(id, user?.nombre ?? user?.email ?? 'admin');
  }

  /** POST /recibos — crear recibo genérico */
  @Post()
  @Roles(RolUsuario.ADMIN, RolUsuario.SUPERVISOR, RolUsuario.VENDEDOR)
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
