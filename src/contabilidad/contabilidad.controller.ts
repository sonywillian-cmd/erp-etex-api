import {
  Controller, Get, Query, Res, UseGuards, StreamableFile,
} from '@nestjs/common';
import { Response } from 'express';
import { ContabilidadService } from './contabilidad.service';
import { JwtAuthGuard } from '../common/guards';

@UseGuards(JwtAuthGuard)
@Controller('contabilidad')
export class ContabilidadController {
  constructor(private svc: ContabilidadService) {}

  // ── Dashboard del mes ────────────────────────────────────────────────────
  @Get('dashboard')
  dashboard(@Query('periodo') periodo: string) {
    return this.svc.dashboard(periodo);
  }

  // ── 606 — Compras (gastos) ───────────────────────────────────────────────
  @Get('606')
  async generar606(
    @Query('periodo') periodo: string,
    @Query('formato') formato: 'dgii' | 'json' = 'json',
    @Res({ passthrough: true }) res?: Response,
  ) {
    const result: any = await this.svc.generar606(periodo, formato);
    if (formato === 'dgii' && res) {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="606_${periodo}.txt"`);
      return result.texto;
    }
    return result;
  }

  // ── 607 — Ventas ────────────────────────────────────────────────────────
  @Get('607')
  async generar607(
    @Query('periodo') periodo: string,
    @Query('formato') formato: 'dgii' | 'json' = 'json',
    @Res({ passthrough: true }) res?: Response,
  ) {
    const result: any = await this.svc.generar607(periodo, formato);
    if (formato === 'dgii' && res) {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="607_${periodo}.txt"`);
      return result.texto;
    }
    return result;
  }

  // ── 608 — Anulados ──────────────────────────────────────────────────────
  @Get('608')
  async generar608(
    @Query('periodo') periodo: string,
    @Query('formato') formato: 'dgii' | 'json' = 'json',
    @Res({ passthrough: true }) res?: Response,
  ) {
    const result: any = await this.svc.generar608(periodo, formato);
    if (formato === 'dgii' && res) {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="608_${periodo}.txt"`);
      return result.texto;
    }
    return result;
  }

  // ── Cobros del periodo ──────────────────────────────────────────────────
  @Get('cobros')
  cobros(@Query('periodo') periodo: string) {
    return this.svc.listarCobros(periodo);
  }

  // ── Egresos del periodo ─────────────────────────────────────────────────
  @Get('egresos')
  egresos(@Query('periodo') periodo: string) {
    return this.svc.listarEgresos(periodo);
  }

  // ── Reporte mensual completo (.xlsx con todas las hojas) ───────────────
  @Get('excel-mensual')
  async excelMensual(
    @Query('periodo') periodo: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const buffer = await this.svc.generarExcelMensual(periodo);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="reporte_contable_${periodo}.xlsx"`);
    res.setHeader('Content-Length', buffer.length);
    return new StreamableFile(buffer);
  }
}
