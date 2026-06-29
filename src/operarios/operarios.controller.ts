import {
  Controller, Get, Param, Query, ParseIntPipe, UseGuards, ForbiddenException,
} from '@nestjs/common';
import { OperariosService } from './operarios.service';
import { JwtAuthGuard, RolesGuard } from '../common/guards';
import { Roles, CurrentUser } from '../common/decorators';
import { RolUsuario } from '../auth/entities/usuario.entity';

@Controller('operarios')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OperariosController {
  constructor(private readonly svc: OperariosService) {}

  // ── Listado ────────────────────────────────────────────────────────────────
  @Get()
  @Roles(RolUsuario.ADMIN, RolUsuario.SUPERVISOR)
  listar() { return this.svc.listar(); }

  // ── Datos base de un operario ─────────────────────────────────────────────
  @Get(':id')
  @Roles(RolUsuario.ADMIN, RolUsuario.SUPERVISOR)
  obtener(@Param('id', ParseIntPipe) id: number) {
    return this.svc.obtener(id);
  }

  // ── Resumen / KPIs por periodo ────────────────────────────────────────────
  @Get(':id/resumen')
  @Roles(RolUsuario.ADMIN, RolUsuario.SUPERVISOR)
  resumen(
    @Param('id', ParseIntPipe) id: number,
    @Query('periodo') periodo: string = 'mes',
  ) {
    const ok = ['semana', 'quincena', 'mes', 'anio', 'global'] as const;
    const p = (ok as readonly string[]).includes(periodo) ? (periodo as any) : 'mes';
    return this.svc.resumen(id, p);
  }

  // ── Histórico de lotes (con a tiempo / tardío) ────────────────────────────
  // Sin @Roles: admin/supervisor ven a cualquiera; el operario ve SOLO el suyo
  // (mismo componente que la vista admin → /produccion/mis-tareas reusa esto).
  @Get(':id/historico')
  historico(
    @CurrentUser() user: any,
    @Param('id', ParseIntPipe) id: number,
    @Query('desde')         desde?: string,
    @Query('hasta')         hasta?: string,
    @Query('periodo')       periodo?: string,
    @Query('departamento')  departamento?: string,
    @Query('puntualidad')   puntualidad?: string,
    @Query('solo_tardios')  soloTardios?: string,    // legacy
    @Query('q')             q?: string,
  ) {
    const esStaff = user?.rol === RolUsuario.ADMIN || user?.rol === RolUsuario.SUPERVISOR;
    if (!esStaff && user?.id !== id) {
      throw new ForbiddenException('Solo puedes ver tu propio histórico');
    }
    const periodosOk = ['semana','quincena','mes','anio','global'] as const;
    const puntsOk    = ['todas','a_tiempo','tardios'] as const;
    return this.svc.historico(id, {
      desde, hasta, departamento, q,
      periodo:     (periodosOk as readonly string[]).includes(periodo ?? '') ? (periodo as any) : undefined,
      puntualidad: (puntsOk as readonly string[]).includes(puntualidad ?? '') ? (puntualidad as any) : undefined,
      soloTardios: soloTardios === '1' || soloTardios === 'true',
    });
  }

  // ── Rendimiento mensual (gráficos) ────────────────────────────────────────
  @Get(':id/rendimiento')
  @Roles(RolUsuario.ADMIN, RolUsuario.SUPERVISOR)
  rendimiento(
    @Param('id', ParseIntPipe) id: number,
    @Query('meses') meses?: string,
  ) {
    const m = Number(meses) || 6;
    return this.svc.rendimientoMensual(id, m);
  }

  // ── Tareas activas (lotes en curso asignados) ────────────────────────────
  @Get(':id/tareas')
  @Roles(RolUsuario.ADMIN, RolUsuario.SUPERVISOR)
  tareas(@Param('id', ParseIntPipe) id: number) {
    return this.svc.tareasActivas(id);
  }
}
