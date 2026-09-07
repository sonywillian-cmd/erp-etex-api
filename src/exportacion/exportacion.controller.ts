import { Controller, Get, Res, UseGuards, StreamableFile } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { Response } from 'express';
import { JwtAuthGuard, RolesGuard } from '../common/guards';
import { Roles, CurrentUser } from '../common/decorators';
import { RolUsuario } from '../auth/entities/usuario.entity';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { ModuloAuditoria } from '../auditoria/entities/auditoria-financiera.entity';
import { ExportacionService } from './exportacion.service';

/**
 * "Mis datos" — la empresa descarga su propia información.
 * SOLO ADMIN: el archivo lleva la cartera de clientes, precios y salarios.
 * Cada descarga queda registrada en la auditoría.
 */
@ApiTags('Mis datos')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(RolUsuario.ADMIN)
@Controller('exportacion')
export class ExportacionController {
  constructor(private svc: ExportacionService, private auditoria: AuditoriaService) {}

  private async registrar(user: any, que: string) {
    await this.auditoria.registrar({
      modulo: ModuloAuditoria.FACTURACION, accion: 'datos_exportados',
      usuario_id: user?.id ?? null, usuario_nombre: user?.nombre ?? user?.email ?? null, usuario_rol: user?.rol ?? null,
      datos: { formato: que },
      descripcion: `Descarga de datos de la empresa (${que}) por ${user?.nombre ?? 'admin'}`,
    });
  }

  @Get('resumen')
  @ApiOperation({ summary: 'Qué incluye la descarga y cuántos registros tiene cada hoja' })
  resumen() {
    return this.svc.resumen();
  }

  @Get('excel')
  @ApiOperation({ summary: 'Excel con una hoja por módulo' })
  async excel(@Res({ passthrough: true }) res: Response, @CurrentUser() user: any) {
    const buffer = await this.svc.excelCompleto();
    await this.registrar(user, 'excel');
    const fecha = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="mis-datos-${fecha}.xlsx"`);
    res.setHeader('Content-Length', buffer.length);
    return new StreamableFile(buffer);
  }

  @Get('completa')
  @ApiOperation({ summary: 'ZIP con el volcado SQL de la base y los archivos subidos' })
  async completa(@Res() res: Response, @CurrentUser() user: any) {
    const fecha = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="copia-etex360-${fecha}.zip"`);
    await this.registrar(user, 'copia técnica');
    await this.svc.copiaTecnica(res);   // el zip se escribe directo en la respuesta
  }
}
