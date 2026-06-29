import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Query,
  Body,
  Headers,
  ParseIntPipe,
  UseGuards,
  UnauthorizedException,
} from '@nestjs/common';
import { CxpService } from './cxp.service';
import { JwtAuthGuard, RolesGuard } from '../common/guards';
import { Roles, CurrentUser } from '../common/decorators';
import { RolUsuario } from '../auth/entities/usuario.entity';

function validarBotSecret(secret: string) {
  const expected = process.env.TELEGRAM_BOT_SHARED_SECRET;
  if (!expected || secret !== expected) {
    throw new UnauthorizedException('Bot secret invalido');
  }
}

@Controller('cxp')
export class CxpController {
  constructor(private readonly svc: CxpService) {}

  // ─── Rutas estaticas (deben ir ANTES de :id) ──────────────────────────────

  @UseGuards(JwtAuthGuard)
  @Get()
  listar(
    @Query('estado') estado?: string,
    @Query('q') q?: string,
    @Query('proveedor_id') proveedor_id?: string,
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
  ) {
    return this.svc.listar({ estado, q, proveedor_id, desde, hasta });
  }

  @UseGuards(JwtAuthGuard)
  @Get('resumen')
  resumen() {
    return this.svc.resumen();
  }

  @UseGuards(JwtAuthGuard)
  @Get('aging')
  aging() {
    return this.svc.aging();
  }

  @UseGuards(JwtAuthGuard)
  @Get('calendario')
  calendario(@Query('desde') desde?: string, @Query('hasta') hasta?: string) {
    return this.svc.calendario(desde, hasta);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RolUsuario.ADMIN, RolUsuario.SUPERVISOR)
  @Post()
  crear(@Body() body: any, @CurrentUser() user: any) {
    return this.svc.crear({
      ...body,
      registrado_por_id: user && user.id,
      registrado_por_nombre: user && user.nombre,
    });
  }

  /**
   * Pago masivo: una transferencia única que paga varias CxP a la vez.
   * Body: { cxp_ids: number[], monto_total, fecha, metodo_pago, referencia?, cuenta_banco_id?, notas? }
   */
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RolUsuario.ADMIN, RolUsuario.SUPERVISOR)
  @Post('pago-masivo')
  pagoMasivo(@Body() body: any, @CurrentUser() user: any) {
    return this.svc.pagoMasivo({
      ...body,
      registrado_por_id: user && user.id,
      registrado_por_nombre: user && user.nombre,
    });
  }

  // Bot endpoints (SIN JWT, validan x-bot-secret)
  @Post('bot/factura')
  async botFactura(@Headers('x-bot-secret') secret: string, @Body() body: any) {
    validarBotSecret(secret);
    return this.svc.desdeBot(
      body && body.texto,
      body && body.chat_id,
      body && body.modo,
      body && body.forzar_nuevo,
    );
  }

  @Post('bot/foto')
  async botFoto(@Headers('x-bot-secret') secret: string, @Body() body: any) {
    validarBotSecret(secret);
    return this.svc.crearDesdeFotoBot(body && body.chat_id, body || {});
  }

  // ─── Rutas con :id (DESPUES de las estaticas) ─────────────────────────────

  @UseGuards(JwtAuthGuard)
  @Get(':id')
  obtener(@Param('id', ParseIntPipe) id: number) {
    return this.svc.obtener(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RolUsuario.ADMIN, RolUsuario.SUPERVISOR)
  @Put(':id')
  actualizar(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.svc.actualizar(id, body);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RolUsuario.ADMIN)
  @Delete(':id')
  eliminar(@Param('id', ParseIntPipe) id: number) {
    return this.svc.eliminar(id);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RolUsuario.ADMIN, RolUsuario.SUPERVISOR)
  @Post(':id/cancelar')
  cancelar(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.svc.cancelar(id, body && body.motivo);
  }

  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RolUsuario.ADMIN, RolUsuario.SUPERVISOR)
  @Post(':id/abono')
  registrarAbono(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: any,
    @CurrentUser() user: any,
  ) {
    return this.svc.registrarAbono(id, {
      ...body,
      registrado_por_id: user && user.id,
      registrado_por_nombre: user && user.nombre,
    });
  }
}
