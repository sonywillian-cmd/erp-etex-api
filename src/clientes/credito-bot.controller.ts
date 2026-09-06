import { Controller, Post, Param, Body, Req, ParseIntPipe, UnauthorizedException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { CreditoService } from './credito.service';

/**
 * Aprobación/rechazo de crédito desde los botones de Telegram.
 * Sin JWT: se protege con `x-bot-secret` + el chat DEBE pertenecer a un usuario admin.
 */
@Controller('clientes/bot/credito')
export class CreditoBotController {
  constructor(private svc: CreditoService, @InjectDataSource() private ds: DataSource) {}

  private async admin(req: any, chatId?: string) {
    const secret = req?.headers?.['x-bot-secret'];
    if (!secret || secret !== process.env.TELEGRAM_BOT_SHARED_SECRET) throw new UnauthorizedException('Secret inválido');
    if (!chatId) throw new BadRequestException('chat_id requerido');
    const [v] = await this.ds.query(
      `SELECT u.id, u.nombre, u.rol FROM telegram_usuarios v JOIN usuarios u ON u.id = v.usuario_id
       WHERE v.chat_id = ? AND u.activo = 1 LIMIT 1`, [String(chatId)]);
    if (!v) throw new UnauthorizedException('Chat no vinculado al ERP');
    if (v.rol !== 'admin') throw new ForbiddenException('Solo el administrador puede aprobar créditos');
    return v;
  }

  @Post(':sid/aprobar')
  async aprobar(@Req() req: any, @Param('sid', ParseIntPipe) sid: number, @Body() body: { chat_id: string }) {
    const a = await this.admin(req, body?.chat_id);
    return this.svc.aprobar(sid, { id: a.id, nombre: a.nombre });
  }

  @Post(':sid/rechazar')
  async rechazar(@Req() req: any, @Param('sid', ParseIntPipe) sid: number, @Body() body: { chat_id: string; motivo?: string }) {
    const a = await this.admin(req, body?.chat_id);
    return this.svc.rechazar(sid, { id: a.id, nombre: a.nombre }, body?.motivo ?? 'Rechazado desde Telegram');
  }
}
