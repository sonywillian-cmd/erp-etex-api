import {
  Controller, Get, Post, Patch, Body, Query, Param,
  ParseIntPipe, UseGuards,
} from '@nestjs/common';
import { CajaService } from './caja.service';
import { JwtAuthGuard } from '../common/guards';
import { CurrentUser } from '../common/decorators';

@UseGuards(JwtAuthGuard)
@Controller('caja')
export class CajaController {
  constructor(private svc: CajaService) {}

  // ═══════════════════════════════════════════════════════════════════════════
  // SESIONES
  // ═══════════════════════════════════════════════════════════════════════════

  @Get('sesiones')
  listarSesiones(
    @Query('estado')          estado?:          string,
    @Query('usuario_id')      usuario_id?:      string,
    @Query('usuario_nombre')  usuario_nombre?:  string,
    @Query('desde')           desde?:           string,
    @Query('hasta')           hasta?:           string,
  ) {
    return this.svc.listarSesiones({
      estado,
      usuario_id:     usuario_id ? parseInt(usuario_id) : undefined,
      usuario_nombre,
      desde,
      hasta,
    });
  }

  /** GET /caja/sesiones/activa?usuario=SONY WILLIAMS */
  @Get('sesiones/activa')
  sesionActiva(@Query('usuario') usuario?: string) {
    return this.svc.sesionActiva(usuario);
  }

  /** GET /caja/sesiones/:id */
  @Get('sesiones/:id')
  findOneSesion(@Param('id', ParseIntPipe) id: number) {
    return this.svc.findOneSesion(id);
  }

  /** GET /caja/sesiones/:id/pagos */
  @Get('sesiones/:id/pagos')
  pagosDeSesion(@Param('id', ParseIntPipe) id: number) {
    return this.svc.pagosDeSesion(id);
  }

  /** GET /caja/sesiones/:id/resumen */
  @Get('sesiones/:id/resumen')
  resumenMetodosSesion(@Param('id', ParseIntPipe) id: number) {
    return this.svc.resumenMetodosSesion(id);
  }

  /** POST /caja/sesiones — abrir nueva sesión */
  @Post('sesiones')
  abrirSesion(
    @Body() body: { efectivo_inicial: number; usuario_nombre: string; usuario_id?: number },
    @CurrentUser() user: any,
  ) {
    return this.svc.abrirSesion({
      ...body,
      // Usa los datos del JWT como fuente de verdad si no vienen en el body
      usuario_id:     body.usuario_id     ?? user?.id,
      usuario_nombre: body.usuario_nombre ?? user?.nombre,
    });
  }

  /** PATCH /caja/sesiones/:id/cerrar — cajero cierra su sesión → por_validar */
  @Patch('sesiones/:id/cerrar')
  cerrarSesion(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { efectivo_final_real: number; notas_cierre?: string; cerrado_por?: string },
    @CurrentUser() user: any,
  ) {
    return this.svc.cerrarSesion(id, {
      ...body,
      usuario_cierre: user
        ? { id: user.id, nombre: user.nombre, rol: user.rol }
        : undefined,
    });
  }

  /** PATCH /caja/sesiones/:id/validar — admin valida → validada (requiere credenciales) */
  @Patch('sesiones/:id/validar')
  validarSesion(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { email: string; password: string; validado_por?: string },
  ) {
    return this.svc.validarSesion(id, body);
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // BACKWARD COMPAT — apertura/estado (usado en facturacion/[id])
  // ═══════════════════════════════════════════════════════════════════════════

  /** GET /caja/apertura/estado?usuario=NOMBRE */
  @Get('apertura/estado')
  async cajaAbierta(@Query('usuario') usuario?: string) {
    const abierta = await this.svc.cajaAbierta(usuario);
    return { abierta };
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // EGRESOS
  // ═══════════════════════════════════════════════════════════════════════════

  @Get('egresos')
  getEgresos(
    @Query('desde')     desde?:     string,
    @Query('hasta')     hasta?:     string,
    @Query('categoria') categoria?: string,
    @Query('sesion_id') sesion_id?: string,
  ) {
    return this.svc.getEgresos({ desde, hasta, categoria, sesion_id: sesion_id ? +sesion_id : undefined });
  }

  @Post('egresos')
  registrarEgreso(@Body() body: any, @CurrentUser() user: any) {
    return this.svc.registrarEgreso({
      ...body,
      usuario_rol: user?.rol,
    });
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // VENTAS DIRECTAS (POS)
  // ═══════════════════════════════════════════════════════════════════════════

  @Get()
  findAll(@Query() q: { cliente_id?: string; metodo?: string; estado?: string }) {
    return this.svc.findAll(q);
  }

  @Post()
  registrar(@Body() body: any) {
    return this.svc.registrar(body);
  }
}
