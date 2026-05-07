import {
  Controller, Get, Post, Patch, Param, Body,
  ParseIntPipe, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { RecepcionesService } from './recepciones.service';
import { JwtAuthGuard } from '../common/guards';
import { CurrentUser } from '../common/decorators';
import { Usuario } from '../auth/entities/usuario.entity';
import { ItemRecepcion } from './recepcion-departamento.entity';

@ApiTags('Recepciones')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('recepciones')
export class RecepcionesController {
  constructor(private svc: RecepcionesService) {}

  // ── Migración ─────────────────────────────────────────────────────────────
  @Post('migraciones/crear-tabla')
  @ApiOperation({ summary: 'Crea la tabla recepciones_departamento si no existe' })
  crearTabla() {
    return this.svc.crearTabla();
  }

  // ── Consultas ─────────────────────────────────────────────────────────────
  @Get('pendientes/:dpto')
  @ApiOperation({ summary: 'Recepciones pendientes para un departamento destino' })
  pendientesByDpto(@Param('dpto') dpto: string) {
    return this.svc.getPendientesByDpto(dpto);
  }

  @Get('orden/:ordenId')
  @ApiOperation({ summary: 'Todas las recepciones de una orden de producción' })
  byOrden(@Param('ordenId', ParseIntPipe) ordenId: number) {
    return this.svc.getByOrden(ordenId);
  }

  @Get('lote/:loteId')
  @ApiOperation({ summary: 'Recepciones de un lote específico' })
  byLote(@Param('loteId', ParseIntPipe) loteId: number) {
    return this.svc.getByLote(loteId);
  }

  // ── Crear ─────────────────────────────────────────────────────────────────
  @Post()
  @ApiOperation({ summary: 'Registrar un envío de lote entre departamentos' })
  crear(
    @Body() body: {
      lote_id: number;
      orden_id: number;
      orden_numero: string;
      dpto_origen: string;
      dpto_destino: string;
      items: ItemRecepcion[];
    },
  ) {
    return this.svc.crear(body);
  }

  // ── Confirmar recepción ───────────────────────────────────────────────────
  @Patch(':id/confirmar')
  @ApiOperation({ summary: 'El departamento destino confirma lo recibido' })
  confirmar(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: Usuario,
    @Body() body: {
      items_recibidos: { lote_id: number; cantidad_recibida: number }[];
      notas?: string;
    },
  ) {
    return this.svc.confirmar(
      id,
      user.id,
      user.nombre,
      body.items_recibidos,
      body.notas,
    );
  }
}
