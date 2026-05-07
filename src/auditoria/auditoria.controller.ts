import { Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { AuditoriaService } from './auditoria.service';
import { JwtAuthGuard } from '../common/guards';

@UseGuards(JwtAuthGuard)
@Controller('auditoria')
export class AuditoriaController {
  constructor(private svc: AuditoriaService) {}

  /** GET /auditoria?modulo=caja&desde=2026-01-01&hasta=2026-12-31 */
  @Get()
  listar(
    @Query('modulo')     modulo?:     string,
    @Query('accion')     accion?:     string,
    @Query('usuario')    usuario?:    string,
    @Query('desde')      desde?:      string,
    @Query('hasta')      hasta?:      string,
    @Query('entidad_id') entidad_id?: string,
  ) {
    return this.svc.listar({
      modulo, accion, usuario, desde, hasta,
      entidad_id: entidad_id ? +entidad_id : undefined,
    });
  }

  /** POST /auditoria/migraciones/crear-tabla */
  @Post('migraciones/crear-tabla')
  crearTabla() {
    return this.svc.crearTabla();
  }
}
