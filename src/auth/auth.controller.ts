import { Controller, Post, Get, Put, Body, Param, UseGuards, Patch, ParseIntPipe, Req, Query } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { Throttle } from '@nestjs/throttler';
import { AuthThrottlerGuard } from './auth-throttler.guard';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard, RolesGuard } from '../common/guards';
import { CurrentUser, Roles } from '../common/decorators';
import { RolUsuario, Usuario } from './entities/usuario.entity';

function ipDe(req: any): string {
  const fw = req?.headers?.['x-forwarded-for'];
  const raw = (Array.isArray(fw) ? fw[0] : fw)?.split(',')[0]?.trim()
    || req?.headers?.['x-real-ip'] || req?.ip || req?.connection?.remoteAddress || '';
  return String(raw).replace(/^::ffff:/, '');
}

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private svc: AuthService) {}

  @Post('login')
  @UseGuards(AuthThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })   // 5 intentos/min por correo
  @ApiOperation({ summary: 'Iniciar sesión' })
  login(@Body() dto: LoginDto, @Req() req: any) {
    return this.svc.login(dto, ipDe(req), String(req?.headers?.['user-agent'] ?? ''));
  }

  // ── Olvidé contraseña (público) ──
  @Post('solicitar-reset')
  @UseGuards(AuthThrottlerGuard)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })   // 3 solicitudes/min por correo
  @ApiOperation({ summary: 'El empleado solicita restablecer su contraseña' })
  solicitarReset(@Body('email') email: string, @Req() req: any) {
    return this.svc.solicitarReset(email, ipDe(req));
  }

  // ── Admin: gestionar solicitudes de reset ──
  @Get('reset-solicitudes')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RolUsuario.ADMIN, RolUsuario.SUPERVISOR)
  @ApiBearerAuth()
  listarSolicitudesReset() {
    return this.svc.listarSolicitudesReset();
  }

  @Post('reset-solicitudes/:id/atender')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RolUsuario.ADMIN, RolUsuario.SUPERVISOR)
  @ApiBearerAuth()
  atenderSolicitudReset(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: Usuario) {
    return this.svc.atenderSolicitudReset(id, user?.nombre ?? user?.email ?? 'admin');
  }

  @Get('sesiones')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RolUsuario.ADMIN)
  @ApiBearerAuth()
  sesiones(@Query('limite') limite?: string) {
    return this.svc.listarSesiones(limite ? +limite : 200);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  me(@CurrentUser() user: Usuario) {
    return this.svc.me(user.id);
  }

  @Get('usuarios')
  @UseGuards(JwtAuthGuard, RolesGuard)
  // VENDEDOR incluido: el modal de asignar responsables (producción) llena su
  // lista con este endpoint; sin acceso, el vendedor veía la lista vacía.
  // Solo lectura del directorio; crear/editar usuarios sigue siendo ADMIN.
  @Roles(RolUsuario.ADMIN, RolUsuario.SUPERVISOR, RolUsuario.VENDEDOR)
  @ApiBearerAuth()
  listar() {
    return this.svc.listar();
  }

  @Post('usuarios')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RolUsuario.ADMIN)
  @ApiBearerAuth()
  crear(@Body() body: {
    email: string; nombre: string; password: string;
    rol: RolUsuario; departamentos?: number[] | null;
  }) {
    return this.svc.crear(body);
  }

  @Put('usuarios/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RolUsuario.ADMIN)
  @ApiBearerAuth()
  actualizar(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { nombre?: string; email?: string; rol?: RolUsuario; departamentos?: number[] | null; activo?: boolean },
  ) {
    return this.svc.actualizar(id, body);
  }

  @Put('usuarios/:id/reset-password')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RolUsuario.ADMIN)
  @ApiBearerAuth()
  resetPassword(
    @Param('id', ParseIntPipe) id: number,
    @Body('password') password: string,
  ) {
    return this.svc.resetPasswordAdmin(id, password);
  }

  @Patch('password')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  cambiarPassword(
    @CurrentUser() user: Usuario,
    @Body() body: { actual: string; nueva: string },
  ) {
    return this.svc.cambiarPassword(user.id, body.actual, body.nueva);
  }
}
