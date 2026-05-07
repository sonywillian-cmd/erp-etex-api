import { Controller, Post, Get, Put, Body, Param, UseGuards, Patch, ParseIntPipe } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { JwtAuthGuard, RolesGuard } from '../common/guards';
import { CurrentUser, Roles } from '../common/decorators';
import { RolUsuario, Usuario } from './entities/usuario.entity';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private svc: AuthService) {}

  @Post('login')
  @ApiOperation({ summary: 'Iniciar sesión' })
  login(@Body() dto: LoginDto) {
    return this.svc.login(dto);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  me(@CurrentUser() user: Usuario) {
    return this.svc.me(user.id);
  }

  @Get('usuarios')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(RolUsuario.ADMIN, RolUsuario.SUPERVISOR)
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
