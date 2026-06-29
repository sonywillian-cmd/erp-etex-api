import {
  Controller, Get, Post, Put, Delete, Param, Body, Query,
  ParseIntPipe, UploadedFile, UseInterceptors, UseGuards, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import * as fs from 'fs';
import * as path from 'path';
import { EmpleadosService } from './empleados.service';
import { CreateEmpleadoDto } from './dto/create-empleado.dto';
import { UpdateEmpleadoDto } from './dto/update-empleado.dto';
import {
  CreateVacacionDto, UpdateVacacionDto, RegistrarPagoVacacionDto,
} from './dto/vacacion.dto';
import { TipoDocumento } from './entities/empleado-documento.entity';
import { JwtAuthGuard, RolesGuard } from '../common/guards';
import { Roles, CurrentUser } from '../common/decorators';
import { RolUsuario } from '../auth/entities/usuario.entity';

const UPLOAD_DIR = path.join(process.cwd(), 'uploads', 'empleados');
// Asegurar que la carpeta exista al arranque
try { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); } catch {}

const fileStorage = diskStorage({
  destination: UPLOAD_DIR,
  filename: (_req, file, cb) => {
    const ext  = path.extname(file.originalname).toLowerCase().replace(/[^a-z0-9.]/g, '');
    const safe = file.originalname
      .replace(/\.[^.]+$/, '')
      .replace(/[^A-Za-z0-9_-]/g, '_')
      .slice(0, 40);
    cb(null, `${Date.now()}_${safe}${ext}`);
  },
});

@Controller('empleados')
@UseGuards(JwtAuthGuard, RolesGuard)
export class EmpleadosController {
  constructor(private readonly svc: EmpleadosService) {}

  // ── FICHA ────────────────────────────────────────────────────────────────
  @Get()
  @Roles(RolUsuario.ADMIN, RolUsuario.SUPERVISOR)
  listar(
    @Query('estado') estado?: string,
    @Query('departamento') departamento?: string,
    @Query('q') q?: string,
  ) { return this.svc.listar({ estado, departamento, q }); }

  @Get('resumen')
  @Roles(RolUsuario.ADMIN, RolUsuario.SUPERVISOR)
  resumen() { return this.svc.resumen(); }

  @Get(':id')
  @Roles(RolUsuario.ADMIN, RolUsuario.SUPERVISOR)
  obtener(@Param('id', ParseIntPipe) id: number) {
    return this.svc.obtener(id);
  }

  @Post()
  @Roles(RolUsuario.ADMIN, RolUsuario.SUPERVISOR)
  crear(@Body() dto: CreateEmpleadoDto, @CurrentUser() user: any) {
    return this.svc.crear(dto, user?.nombre);
  }

  @Put(':id')
  @Roles(RolUsuario.ADMIN, RolUsuario.SUPERVISOR)
  actualizar(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateEmpleadoDto) {
    return this.svc.actualizar(id, dto);
  }

  @Post(':id/baja')
  @Roles(RolUsuario.ADMIN)
  darDeBaja(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { motivo: string; fecha?: string },
  ) { return this.svc.darDeBaja(id, body.motivo, body.fecha); }

  @Delete(':id')
  @Roles(RolUsuario.ADMIN)
  eliminar(@Param('id', ParseIntPipe) id: number) {
    return this.svc.eliminar(id);
  }

  // ── VACACIONES ───────────────────────────────────────────────────────────
  @Get(':id/vacaciones')
  @Roles(RolUsuario.ADMIN, RolUsuario.SUPERVISOR)
  listarVacaciones(@Param('id', ParseIntPipe) id: number) {
    return this.svc.listarVacaciones(id);
  }

  @Post(':id/vacaciones')
  @Roles(RolUsuario.ADMIN, RolUsuario.SUPERVISOR)
  crearVacacion(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CreateVacacionDto,
    @CurrentUser() user: any,
  ) { return this.svc.crearVacacion(id, dto, user?.nombre); }

  @Put('vacaciones/:vacId')
  @Roles(RolUsuario.ADMIN, RolUsuario.SUPERVISOR)
  actualizarVacacion(
    @Param('vacId', ParseIntPipe) vacId: number,
    @Body() dto: UpdateVacacionDto,
  ) { return this.svc.actualizarVacacion(vacId, dto); }

  @Post('vacaciones/:vacId/pago')
  @Roles(RolUsuario.ADMIN, RolUsuario.SUPERVISOR)
  pagarVacacion(
    @Param('vacId', ParseIntPipe) vacId: number,
    @Body() dto: RegistrarPagoVacacionDto,
  ) { return this.svc.registrarPagoVacacion(vacId, dto); }

  @Delete('vacaciones/:vacId')
  @Roles(RolUsuario.ADMIN)
  eliminarVacacion(@Param('vacId', ParseIntPipe) vacId: number) {
    return this.svc.eliminarVacacion(vacId);
  }

  // ── DOCUMENTOS (subida real con multer) ──────────────────────────────────
  @Get(':id/documentos')
  @Roles(RolUsuario.ADMIN, RolUsuario.SUPERVISOR)
  listarDocumentos(@Param('id', ParseIntPipe) id: number) {
    return this.svc.listarDocumentos(id);
  }

  @Post(':id/documentos')
  @Roles(RolUsuario.ADMIN, RolUsuario.SUPERVISOR)
  @UseInterceptors(FileInterceptor('archivo', {
    storage: fileStorage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  }))
  async subirDocumento(
    @Param('id', ParseIntPipe) id: number,
    @UploadedFile() archivo: any,
    @Body() body: { tipo: TipoDocumento; descripcion?: string },
    @CurrentUser() user: any,
  ) {
    if (!archivo) throw new BadRequestException('No se subió archivo');
    if (!body.tipo) throw new BadRequestException('Tipo de documento requerido');
    return this.svc.agregarDocumento(id, {
      tipo:           body.tipo,
      nombre_archivo: archivo.originalname,
      url:            `/uploads/empleados/${archivo.filename}`,
      mime_type:      archivo.mimetype,
      tamano_bytes:   archivo.size,
      descripcion:    body.descripcion,
      subido_por:     user?.nombre,
    });
  }

  @Delete('documentos/:docId')
  @Roles(RolUsuario.ADMIN, RolUsuario.SUPERVISOR)
  eliminarDocumento(@Param('docId', ParseIntPipe) docId: number) {
    return this.svc.eliminarDocumento(docId);
  }
}
