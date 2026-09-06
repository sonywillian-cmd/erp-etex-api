import { Controller, Get, Post, Body, Query, Param, Request, Headers, UseGuards, UnauthorizedException } from '@nestjs/common';
import { AsistenteService } from './asistente.service';
import { JwtAuthGuard } from '../common/guards';

@Controller('asistente')
export class AsistenteController {
  constructor(private svc: AsistenteService) {}

  // ─── Validador de shared-secret para endpoints del bot ───────────────────
  private validarBotSecret(secret: string | undefined) {
    const expected = process.env.TELEGRAM_BOT_SHARED_SECRET;
    if (!expected || secret !== expected) {
      throw new UnauthorizedException('Bot secret inválido');
    }
  }

  // ─── ENDPOINTS PARA EL BOT (autenticados con x-bot-secret) ───────────────

  @Post('bot/interpretar')
  async botInterpretar(
    @Headers('x-bot-secret') secret: string,
    @Body() body: { texto?: string; audio_base64?: string; audio_mime?: string },
  ) {
    this.validarBotSecret(secret);
    if (body.audio_base64) {
      return this.svc.interpretarAudio(body.audio_base64, body.audio_mime || 'audio/ogg');
    }
    return this.svc.interpretar(body.texto || '');
  }

  /** Reporte mensual para el bot (portado del dist del VPS) */
  @Get('bot/reporte-mensual')
  botReporteMensual(@Headers('x-bot-secret') secret: string, @Query('mes') mes: string) {
    this.validarBotSecret(secret);
    return this.svc.botReporteMensual(mes);
  }

  /** Chats de admin/supervisor para avisos push del bot (portado del dist del VPS) */
  @Get('bot/admins-chat-ids')
  botAdminsChatIds(@Headers('x-bot-secret') secret: string) {
    this.validarBotSecret(secret);
    return this.svc.botAdminsChatIds();
  }

  @Get('bot/buscar-cliente')
  botBuscarCliente(@Headers('x-bot-secret') secret: string, @Query('q') q: string) {
    this.validarBotSecret(secret);
    return this.svc.buscarClienteFuzzy(q);
  }

  @Post('bot/cliente')
  botCrearCliente(@Headers('x-bot-secret') secret: string, @Body() body: any) {
    this.validarBotSecret(secret);
    return this.svc.crearCliente(body);
  }

  @Post('bot/cotizar')
  botCotizar(@Headers('x-bot-secret') secret: string, @Body() body: any) {
    this.validarBotSecret(secret);
    return this.svc.crearCotizacion(body);
  }

  @Get('bot/orden/:numero')
  botConsultarOrden(@Headers('x-bot-secret') secret: string, @Param('numero') numero: string) {
    this.validarBotSecret(secret);
    return this.svc.consultarOrden(numero);
  }

  @Post('bot/gasto')
  botCrearGasto(@Headers('x-bot-secret') secret: string, @Body() body: any) {
    this.validarBotSecret(secret);
    return this.svc.crearGastoTexto({
      ...body,
      registrado_por_id:     body.usuario_id,
      registrado_por_nombre: body.usuario_nombre,
    });
  }

  @Post('bot/facturar')
  botFacturar(@Headers('x-bot-secret') secret: string, @Body() body: any) {
    this.validarBotSecret(secret);
    return this.svc.facturar(body);
  }

  @Get('bot/metricas')
  botMetricas(
    @Headers('x-bot-secret') secret: string,
    @Query('tipo') tipo: string,
    @Query('periodo') periodo?: string,
  ) {
    this.validarBotSecret(secret);
    return this.svc.consultarMetricas(tipo, periodo);
  }

  // ─── ENDPOINTS WEB (autenticados con JWT) ─────────────────────────────────

  @UseGuards(JwtAuthGuard) @Post('interpretar')
  interpretar(@Body() body: { texto: string }) {
    return this.svc.interpretar(body.texto);
  }

  @UseGuards(JwtAuthGuard) @Get('dgii-rnc')
  validarRnc(@Query('rnc') rnc: string) {
    return this.svc.validarRncDgii(rnc);
  }

  @UseGuards(JwtAuthGuard) @Post('cliente')
  crearCliente(@Body() body: any) {
    return this.svc.crearCliente(body);
  }

  @UseGuards(JwtAuthGuard) @Get('buscar-cliente')
  buscarCliente(@Query('q') q: string) {
    return this.svc.buscarClienteFuzzy(q);
  }

  @UseGuards(JwtAuthGuard) @Post('cotizar')
  cotizar(@Request() req: any, @Body() body: any) {
    return this.svc.crearCotizacion({ ...body, creado_por: req.user.nombre });
  }

  @UseGuards(JwtAuthGuard) @Get('orden/:numero')
  consultarOrden(@Param('numero') numero: string) {
    return this.svc.consultarOrden(numero);
  }

  @UseGuards(JwtAuthGuard) @Post('gasto')
  crearGasto(@Request() req: any, @Body() body: any) {
    return this.svc.crearGastoTexto({
      ...body,
      registrado_por_id:     req.user.id,
      registrado_por_nombre: req.user.nombre,
    });
  }

  @UseGuards(JwtAuthGuard) @Post('facturar')
  facturar(@Request() req: any, @Body() body: any) {
    return this.svc.facturar({ ...body, creado_por: req.user.nombre });
  }

  @UseGuards(JwtAuthGuard) @Get('metricas')
  metricas(@Query('tipo') tipo: string, @Query('periodo') periodo?: string) {
    return this.svc.consultarMetricas(tipo, periodo);
  }
}
