import {
  Controller, Get, Post, Patch, Param, Body, Query,
  ParseIntPipe, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { DanosService } from './danos.service';
import { JwtAuthGuard, RolesGuard } from '../common/guards';
import { Roles, CurrentUser } from '../common/decorators';
import { RolUsuario, Usuario } from '../auth/entities/usuario.entity';

@ApiTags('Daños de Producción')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('danos')
export class DanosController {
  constructor(private svc: DanosService) {}

  // ── Migración ─────────────────────────────────────────────────────────────
  @Post('migraciones/crear-tabla')
  @ApiOperation({ summary: 'Crea la tabla danos_produccion si no existe' })
  crearTabla() {
    return this.svc.crearTabla();
  }

  // ── Consultas ─────────────────────────────────────────────────────────────
  @Get()
  @ApiOperation({ summary: 'Todos los daños con filtros opcionales' })
  getAll(
    @Query('estado') estado?: string,
    @Query('desde')  desde?:  string,
    @Query('hasta')  hasta?:  string,
  ) {
    return this.svc.getAll({ estado, desde, hasta });
  }

  @Get('pendientes-aprobacion')
  @ApiOperation({ summary: 'Daños en estado reportado o aprobado_sustitucion' })
  pendientesAprobacion() {
    return this.svc.getPendientesAprobacion();
  }

  @Get('orden/:ordenId')
  @ApiOperation({ summary: 'Daños registrados para una orden de producción' })
  byOrden(@Param('ordenId', ParseIntPipe) ordenId: number) {
    return this.svc.getByOrden(ordenId);
  }

  @Get('lote/:loteId')
  @ApiOperation({ summary: 'Daños registrados para un lote específico' })
  byLote(@Param('loteId', ParseIntPipe) loteId: number) {
    return this.svc.getByLote(loteId);
  }

  // ── Reportar daño ─────────────────────────────────────────────────────────
  @Post()
  @ApiOperation({ summary: 'Reportar un daño en producción' })
  reportar(
    @CurrentUser() user: Usuario,
    @Body() body: {
      lote_id:         number;
      orden_id:        number;
      orden_numero:    string;
      departamento:    string;
      producto:        string;
      descripcion?:    string;
      cantidad_danada: number;
      motivo:          string;
      producto_id?:    number;
      variante_id?:    number;
    },
  ) {
    return this.svc.reportar({
      ...body,
      reportado_por_id:     user.id,
      reportado_por_nombre: user.nombre,
    });
  }

  // ── Aprobar reposición ────────────────────────────────────────────────────
  @Patch(':id/aprobar-reponer')
  @UseGuards(RolesGuard)
  @Roles(RolUsuario.ADMIN, RolUsuario.SUPERVISOR)
  @ApiOperation({ summary: 'Aprobar reposición con la misma variante — crea movimiento de merma y reserva' })
  aprobarReponer(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: Usuario,
  ) {
    return this.svc.aprobarReponer(id, user.id, user.nombre);
  }

  // ── Aprobar sustitución ───────────────────────────────────────────────────
  @Patch(':id/aprobar-sustitucion')
  @UseGuards(RolesGuard)
  @Roles(RolUsuario.ADMIN, RolUsuario.SUPERVISOR)
  @ApiOperation({ summary: 'Aprobar sustitución con variante diferente' })
  aprobarSustitucion(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: Usuario,
    @Body() body: {
      repuesto_producto_id: number;
      repuesto_variante_id: number;
      repuesto_descripcion: string;
    },
  ) {
    return this.svc.aprobarSustitucion(id, user.id, user.nombre, body);
  }

  // ── Rechazar ──────────────────────────────────────────────────────────────
  @Patch(':id/rechazar')
  @UseGuards(RolesGuard)
  @Roles(RolUsuario.ADMIN, RolUsuario.SUPERVISOR)
  @ApiOperation({ summary: 'Rechazar un reporte de daño' })
  rechazar(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: Usuario,
    @Body() body: { notas?: string },
  ) {
    return this.svc.rechazar(id, user.id, user.nombre, body.notas);
  }

  // ── Resolver ──────────────────────────────────────────────────────────────
  @Patch(':id/resolver')
  @ApiOperation({ summary: 'Marcar daño como resuelto y consumir reserva de reposición' })
  resolver(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: Usuario,
    @Body() body: { cantidad_repuesta: number; costo_repuesto: number },
  ) {
    return this.svc.resolver(id, user.id, user.nombre, body);
  }

  // ── Sin stock ─────────────────────────────────────────────────────────────
  @Patch(':id/sin-stock')
  @ApiOperation({ summary: 'Marcar daño como sin_stock' })
  sinStock(@Param('id', ParseIntPipe) id: number) {
    return this.svc.marcarSinStock(id);
  }
}
