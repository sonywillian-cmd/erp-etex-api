import { Controller, Get, Post, Patch, Param, Body, Query, ParseIntPipe, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard, RolesGuard } from '../common/guards';
import { Roles, CurrentUser } from '../common/decorators';
import { RolUsuario } from '../auth/entities/usuario.entity';
import { CreditoService } from './credito.service';

/**
 * Crédito a clientes (web). Declarado ANTES de ClientesController en el módulo
 * para que sus rutas estáticas no caigan en el comodín `:id`.
 */
@ApiTags('Clientes · Crédito')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('clientes')
export class CreditoController {
  constructor(private svc: CreditoService) {}

  /** GET /clientes/credito/solicitudes?estado=pendiente — panel del admin */
  @Get('credito/solicitudes')
  @Roles(RolUsuario.ADMIN)
  @ApiOperation({ summary: 'Listar solicitudes de crédito (solo admin)' })
  listar(@Query('estado') estado?: string) {
    return this.svc.listar(estado ?? 'todas');
  }

  /** PATCH /clientes/credito/solicitudes/:sid/aprobar — SOLO ADMIN */
  @Patch('credito/solicitudes/:sid/aprobar')
  @Roles(RolUsuario.ADMIN)
  aprobar(@Param('sid', ParseIntPipe) sid: number, @Body() body: { limite?: number; plazo?: number }, @CurrentUser() user: any) {
    return this.svc.aprobar(sid, { id: user?.id, nombre: user?.nombre ?? user?.email }, body ?? {});
  }

  /** PATCH /clientes/credito/solicitudes/:sid/rechazar — SOLO ADMIN */
  @Patch('credito/solicitudes/:sid/rechazar')
  @Roles(RolUsuario.ADMIN)
  rechazar(@Param('sid', ParseIntPipe) sid: number, @Body() body: { motivo?: string }, @CurrentUser() user: any) {
    return this.svc.rechazar(sid, { id: user?.id, nombre: user?.nombre ?? user?.email }, body?.motivo);
  }

  /** GET /clientes/:id/credito?monto=1234 — estado y si un monto sería permitido */
  @Get(':id/credito')
  estado(@Param('id', ParseIntPipe) id: number, @Query('monto') monto?: string) {
    return this.svc.estado(id, monto != null && monto !== '' ? Number(monto) : undefined);
  }

  /** POST /clientes/:id/credito/solicitar — vendedor, supervisor o admin piden crédito */
  @Post(':id/credito/solicitar')
  @Roles(RolUsuario.ADMIN, RolUsuario.SUPERVISOR, RolUsuario.VENDEDOR)
  solicitar(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { limite: number; plazo: number; motivo?: string; orden_id?: number },
    @CurrentUser() user: any,
  ) {
    return this.svc.solicitar(id, body, { id: user?.id, nombre: user?.nombre ?? user?.email, rol: user?.rol });
  }
}
