import {
  Controller, Get, Post, Put, Delete, Body, Param, Query, Request, Headers,
  UseGuards,
} from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { JwtAuthGuard, RolesGuard } from '../common/guards';
import { Roles } from '../common/decorators';
import { RolUsuario } from '../auth/entities/usuario.entity';

@Controller('telegram')
export class TelegramController {
  constructor(private svc: TelegramService) {}

  // ── Migración (idempotente; protegida con JWT desde el parche del VPS) ──
  @UseGuards(JwtAuthGuard)
  @Post('migraciones/crear-tablas')
  crearTablas() { return this.svc.crearTablas(); }

  // ─────────────────────────────────────────────────────────────────────────
  // ENDPOINTS PARA EL ERP WEB (autenticados con JWT)
  // ─────────────────────────────────────────────────────────────────────────

  @UseGuards(JwtAuthGuard)
  @Post('codigo')
  generarCodigo(@Request() req: any) {
    return this.svc.generarCodigo(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Get('mi-estado')
  miEstado(@Request() req: any) {
    return this.svc.miEstado(req.user.id);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('vinculaciones/:chatId')
  desvincular(@Request() req: any, @Param('chatId') chatId: string) {
    return this.svc.desvincular(req.user.id, chatId);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // ENDPOINTS PARA EL BOT (autenticados con shared secret en header)
  // ─────────────────────────────────────────────────────────────────────────

  // ── Configuración del bot (Ajustes) — SOLO ADMIN ─────────────────────────
  @UseGuards(JwtAuthGuard, RolesGuard) @Roles(RolUsuario.ADMIN)
  @Get('config')
  configAdmin() { return this.svc.configAdmin(); }

  @UseGuards(JwtAuthGuard, RolesGuard) @Roles(RolUsuario.ADMIN)
  @Put('config')
  guardarConfig(@Body() body: any) { return this.svc.guardarConfigAdmin(body ?? {}); }

  @UseGuards(JwtAuthGuard, RolesGuard) @Roles(RolUsuario.ADMIN)
  @Post('config/probar')
  probarToken(@Body() body: { token?: string }) { return this.svc.probarToken(body?.token); }

  /** El bot lee su configuración al arrancar (x-bot-secret). */
  @Get('bot/config')
  configBot(@Headers('x-bot-secret') secret: string) { return this.svc.configParaBot(secret); }

  @Post('bot/vincular')
  botVincular(
    @Headers('x-bot-secret') secret: string,
    @Body() body: { chat_id: string; codigo: string; telegram_username?: string; telegram_first_name?: string },
  ) {
    return this.svc.botVincular(secret, body);
  }

  @Get('bot/resolver-chat')
  botResolverChat(
    @Headers('x-bot-secret') secret: string,
    @Query('chat_id') chatId: string,
  ) {
    return this.svc.botResolverChat(secret, chatId);
  }

  @Post('bot/gasto')
  botCrearGasto(
    @Headers('x-bot-secret') secret: string,
    @Body() body: any,
  ) {
    return this.svc.botCrearGasto(secret, body);
  }
}
