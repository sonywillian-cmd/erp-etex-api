import {
  Controller, Get, Post, Patch, Delete,
  Body, Param, ParseIntPipe, UseGuards, Request,
} from '@nestjs/common';
import { NotasService } from './notas.service';
import { JwtAuthGuard } from '../common/guards';

@UseGuards(JwtAuthGuard)
@Controller('notas')
export class NotasController {
  constructor(private svc: NotasService) {}

  // ── Migración: crear tabla ────────────────────────────────────────────────
  @Post('migraciones/crear-tabla')
  crearTabla() {
    return this.svc.crearTabla();
  }

  // ── Mis notas (personales + compartidas conmigo) ──────────────────────────
  @Get()
  getMisNotas(@Request() req: any) {
    return this.svc.getMisNotas(req.user.id);
  }

  // ── Contador para badge ───────────────────────────────────────────────────
  @Get('pendientes-count')
  contarPendientes(@Request() req: any) {
    return this.svc.contarPendientes(req.user.id);
  }

  // ── Crear nota ────────────────────────────────────────────────────────────
  @Post()
  crear(
    @Request() req: any,
    @Body() body: { texto: string; destinatarios?: number[] },
  ) {
    return this.svc.crear({
      texto: body.texto,
      creado_por_id: req.user.id,
      creado_por_nombre: req.user.nombre,
      destinatarios: body.destinatarios,
    });
  }

  // ── Marcar como cumplida ──────────────────────────────────────────────────
  @Patch(':id/cumplir')
  cumplir(@Param('id', ParseIntPipe) id: number, @Request() req: any) {
    return this.svc.cumplir(id, req.user.id);
  }

  // ── Eliminar nota ─────────────────────────────────────────────────────────
  @Delete(':id')
  eliminar(@Param('id', ParseIntPipe) id: number, @Request() req: any) {
    return this.svc.eliminar(id, req.user.id, req.user.rol);
  }
}
