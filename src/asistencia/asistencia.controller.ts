import {
  Controller, Get, Post, Put, Delete, Param, Body, Query,
  ParseIntPipe, UseGuards, Req, UseInterceptors, UploadedFile, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import * as fs from 'fs';
import * as path from 'path';
import { AsistenciaService } from './asistencia.service';
import { JwtAuthGuard, RolesGuard } from '../common/guards';
import { Roles, CurrentUser } from '../common/decorators';
import { RolUsuario } from '../auth/entities/usuario.entity';
import { uploadsDir } from '../common/rutas-instancia';

// Fotos de colaboradores: carpeta pública de la instancia (ver common/rutas-instancia.ts)
const FOTO_EMPLEADOS_DIR = uploadsDir('empleados');

const fotoStorage = diskStorage({
  destination: (_req, _file, cb) => {
    try { fs.mkdirSync(FOTO_EMPLEADOS_DIR, { recursive: true }); } catch {}
    cb(null, FOTO_EMPLEADOS_DIR);
  },
  filename: (req: any, file, cb) => {
    const ext = (path.extname(file.originalname || '').toLowerCase().replace(/[^a-z0-9.]/g, '') || '.jpg');
    cb(null, `emp_${req.params?.usuarioId ?? 'x'}_${Date.now()}${ext}`);
  },
});

function ipDe(req: any): string {
  const fw = req.headers?.['x-forwarded-for'];
  const raw = (Array.isArray(fw) ? fw[0] : fw)?.split(',')[0]?.trim()
    || req.ip || req.connection?.remoteAddress || '';
  return raw.replace(/^::ffff:/, '');
}

@Controller('asistencia')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AsistenciaController {
  constructor(private readonly svc: AsistenciaService) {}

  // ── Ponche (cualquier usuario autenticado) ──
  @Post('ponche')
  ponchar(@CurrentUser() user: any, @Body() dto: any, @Req() req: any) {
    return this.svc.ponchar(user, dto, ipDe(req));
  }

  @Get('ponche/estado')
  estado(@CurrentUser() user: any, @Req() req: any) {
    return this.svc.estadoHoy(Number(user.id ?? user.sub), ipDe(req));
  }

  // ── Sucursales ──
  @Get('sucursales')
  @Roles(RolUsuario.ADMIN, RolUsuario.SUPERVISOR)
  sucursales() { return this.svc.listarSucursales(); }

  @Put('sucursales/:id')
  @Roles(RolUsuario.ADMIN)
  actualizarSucursal(@Param('id', ParseIntPipe) id: number, @Body() dto: any) {
    return this.svc.actualizarSucursal(id, dto);
  }

  // ── Dispositivos (relojes) ──
  @Get('dispositivos')
  @Roles(RolUsuario.ADMIN, RolUsuario.SUPERVISOR)
  dispositivos() { return this.svc.listarDispositivos(); }

  @Put('dispositivos/:id')
  @Roles(RolUsuario.ADMIN)
  actualizarDispositivo(@Param('id', ParseIntPipe) id: number, @Body() dto: any) {
    return this.svc.actualizarDispositivo(id, dto);
  }

  // ── Plantillas de horario ──
  @Get('plantillas')
  @Roles(RolUsuario.ADMIN, RolUsuario.SUPERVISOR)
  plantillas() { return this.svc.listarPlantillas(); }

  @Post('plantillas')
  @Roles(RolUsuario.ADMIN)
  crearPlantilla(@Body() dto: any) { return this.svc.crearPlantilla(dto); }

  @Put('plantillas/:id')
  @Roles(RolUsuario.ADMIN)
  actualizarPlantilla(@Param('id', ParseIntPipe) id: number, @Body() dto: any) {
    return this.svc.actualizarPlantilla(id, dto);
  }

  @Delete('plantillas/:id')
  @Roles(RolUsuario.ADMIN)
  eliminarPlantilla(@Param('id', ParseIntPipe) id: number) {
    return this.svc.eliminarPlantilla(id);
  }

  // ── Horario por colaborador ──
  @Get('usuarios')
  @Roles(RolUsuario.ADMIN, RolUsuario.SUPERVISOR)
  usuarios() { return this.svc.listarUsuariosAsistencia(); }

  @Get('horario/:usuarioId')
  @Roles(RolUsuario.ADMIN, RolUsuario.SUPERVISOR)
  horario(@Param('usuarioId', ParseIntPipe) usuarioId: number) {
    return this.svc.horarioDe(usuarioId);
  }

  @Post('horario')
  @Roles(RolUsuario.ADMIN)
  asignarHorario(@Body() dto: any, @CurrentUser() user: any) {
    return this.svc.asignarHorario(dto, user?.nombre ?? user?.email ?? 'admin');
  }

  // ── Marcajes ──
  @Get('marcajes')
  @Roles(RolUsuario.ADMIN, RolUsuario.SUPERVISOR)
  marcajes(@Query() q: any) { return this.svc.listarMarcajes(q); }

  @Post('marcajes')
  @Roles(RolUsuario.ADMIN)
  crearMarcaje(@Body() dto: any, @CurrentUser() user: any) {
    return this.svc.crearMarcajeManual(dto, user?.nombre ?? user?.email ?? 'admin');
  }

  @Put('marcajes/:id')
  @Roles(RolUsuario.ADMIN)
  corregirMarcaje(@Param('id', ParseIntPipe) id: number, @Body() dto: any, @CurrentUser() user: any) {
    return this.svc.corregirMarcaje(id, dto, user?.nombre ?? user?.email ?? 'admin');
  }

  // ── Jornadas ──
  @Get('jornadas')
  @Roles(RolUsuario.ADMIN, RolUsuario.SUPERVISOR)
  jornadas(@Query() q: any) { return this.svc.listarJornadas(q); }

  @Post('jornadas/recalcular')
  @Roles(RolUsuario.ADMIN)
  recalcular(@Body() dto: any) { return this.svc.recalcularRango(dto); }

  @Get('presentes')
  @Roles(RolUsuario.ADMIN, RolUsuario.SUPERVISOR)
  presentes() { return this.svc.presentes(); }

  @Get('resumen-semanal')
  @Roles(RolUsuario.ADMIN, RolUsuario.SUPERVISOR)
  resumenSemanal(@Query('fecha') fecha?: string) { return this.svc.resumenSemanal(fecha); }

  // ── Biometría y celulares ──
  @Get('biometria/:usuarioId')
  @Roles(RolUsuario.ADMIN, RolUsuario.SUPERVISOR)
  biometria(@Param('usuarioId', ParseIntPipe) usuarioId: number) {
    return this.svc.biometriaDe(usuarioId);
  }

  @Post('biometria/:usuarioId')
  @Roles(RolUsuario.ADMIN)
  guardarBiometria(@Param('usuarioId', ParseIntPipe) usuarioId: number, @Body() dto: any) {
    return this.svc.guardarBiometria(usuarioId, dto);
  }

  @Put('moviles/:id')
  @Roles(RolUsuario.ADMIN)
  gestionarMovil(@Param('id', ParseIntPipe) id: number, @Body() dto: any) {
    return this.svc.gestionarMovil(id, dto);
  }

  // ── Foto del colaborador (cámara o archivo) ──
  @Post('foto/:usuarioId')
  @Roles(RolUsuario.ADMIN, RolUsuario.SUPERVISOR)
  @UseInterceptors(FileInterceptor('foto', {
    storage: fotoStorage,
    limits: { fileSize: 8 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      // Lista blanca de extensión Y tipo: el mimetype lo declara el navegador
      // (un atacante lo controla), así que por sí solo no basta.
      const ext = path.extname(file.originalname || '').toLowerCase();
      const extOk = ['.jpg', '.jpeg', '.png', '.webp'].includes(ext);
      if (extOk && /^image\//.test(file.mimetype)) cb(null, true);
      else cb(new BadRequestException('Solo se aceptan imágenes JPG, PNG o WEBP'), false);
    },
  }))
  subirFoto(@Param('usuarioId', ParseIntPipe) usuarioId: number, @UploadedFile() file: any) {
    if (!file) throw new BadRequestException('No se recibió la foto');
    return this.svc.guardarFoto(usuarioId, file.filename);
  }
}
