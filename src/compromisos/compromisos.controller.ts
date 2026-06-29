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
import { CompromisosService } from './compromisos.service';
import { JwtAuthGuard, RolesGuard } from '../common/guards';
import { Roles, CurrentUser } from '../common/decorators';
import { RolUsuario } from '../auth/entities/usuario.entity';

function validarBotSecret(secret: string) {
  const expected = process.env.TELEGRAM_BOT_SHARED_SECRET;
  if (!expected || secret !== expected) {
    throw new UnauthorizedException('Bot secret invalido');
  }
}

@Controller('compromisos')
export class CompromisosController {
  constructor(private readonly svc: CompromisosService) {}

  // ─── Rutas estaticas (deben ir ANTES de :id) ──────────────────────────────

  @UseGuards(JwtAuthGuard)
  @Get()
  listar() {
    return this.svc.listar();
  }

  @UseGuards(JwtAuthGuard)
  @Get('calendario')
  calendario(@Query('desde') desde?: string, @Query('hasta') hasta?: string) {
    return this.svc.calendario(desde, hasta);
  }

  @UseGuards(JwtAuthGuard)
  @Get('alertas')
  alertas() {
    return this.svc.alertas();
  }

  // POST /compromisos (web)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RolUsuario.ADMIN, RolUsuario.SUPERVISOR)
  @Post()
  crear(@Body() body: any, @CurrentUser() user: any) {
    return this.svc.crear({ ...body, creado_por: user && user.nombre });
  }

  // POST /compromisos/cuenta-por-pagar (web, JWT)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RolUsuario.ADMIN, RolUsuario.SUPERVISOR)
  @Post('cuenta-por-pagar')
  crearCuentaPorPagar(@Body() body: any, @CurrentUser() user: any) {
    return this.svc.crearCuentaPorPagar({ ...body, creado_por: user && user.nombre });
  }

  // POST /compromisos/ocurrencias/:id/pagar
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RolUsuario.ADMIN, RolUsuario.SUPERVISOR)
  @Post('ocurrencias/:id/pagar')
  marcarPagada(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: any,
    @CurrentUser() user: any,
  ) {
    return this.svc.marcarPagada(id, {
      ...body,
      usuario_id: user && user.id,
      usuario_nombre: user && user.nombre,
    });
  }

  // POST /compromisos/ocurrencias/:id/deshacer
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RolUsuario.ADMIN)
  @Post('ocurrencias/:id/deshacer')
  deshacerPago(@Param('id', ParseIntPipe) id: number) {
    return this.svc.deshacerPago(id);
  }

  // POST /compromisos/ocurrencias/:id/cancelar
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RolUsuario.ADMIN, RolUsuario.SUPERVISOR)
  @Post('ocurrencias/:id/cancelar')
  cancelarOcurrencia(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.svc.cancelarOcurrencia(id, body && body.motivo);
  }

  // POST /compromisos/bot/pagar (x-bot-secret, sin JWT)
  @Post('bot/pagar')
  async botPagar(@Headers('x-bot-secret') secret: string, @Body() body: any) {
    validarBotSecret(secret);
    return this.svc.pagarPorBot(body && body.texto, body && body.chat_id);
  }

  // POST /compromisos/bot/factura (x-bot-secret, sin JWT)
  @Post('bot/factura')
  async botFactura(@Headers('x-bot-secret') secret: string, @Body() body: any) {
    validarBotSecret(secret);
    return this.svc.crearCuentaPorPagarPorBot(
      body && body.texto,
      body && body.chat_id,
      body && body.forzar_nuevo,
    );
  }

  // ─── Rutas con parametro numerico (DESPUES de las estaticas) ──────────────

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
  @Roles(RolUsuario.ADMIN, RolUsuario.SUPERVISOR)
  @Delete(':id')
  eliminar(@Param('id', ParseIntPipe) id: number) {
    return this.svc.eliminar(id);
  }
}
