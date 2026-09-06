import {
  Controller, Get, Post, Delete, Body, Param, Query, Request, Headers,
  UseGuards,
} from '@nestjs/common';
import { TelegramService } from './telegram.service';
import { JwtAuthGuard } from '../common/guards';

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
