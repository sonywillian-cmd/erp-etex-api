import {
  Controller, Get, Post, Put, Delete, Body, Param, Query, Request,
  ParseIntPipe, UseGuards, UseInterceptors, UploadedFile, UploadedFiles, BadRequestException,
} from '@nestjs/common';
import { FileInterceptor, FilesInterceptor } from '@nestjs/platform-express';
import { GastosService } from './gastos.service';
import { JwtAuthGuard } from '../common/guards';
import { TipoGasto } from './gasto.entity';

@UseGuards(JwtAuthGuard)
@Controller('gastos')
export class GastosController {
  constructor(private svc: GastosService) {}

  // ── Migración ─────────────────────────────────────────────────────────────
  @Post('migraciones/crear-tabla')
  crearTabla() { return this.svc.crearTabla(); }

  // ── OCR: subir foto(s) + procesar con Gemini (devuelve datos pre-llenados) ──
  // Soporta 1 sola foto (campo 'foto') o múltiples páginas (campo 'fotos[]', hasta 10)
  @Post('ocr')
  @UseInterceptors(FilesInterceptor('fotos', 10, { limits: { fileSize: 10 * 1024 * 1024 } }))
  async procesarFotos(@UploadedFiles() files: Express.Multer.File[]) {
    if (!files || files.length === 0) {
      throw new BadRequestException('Falta el archivo (campo "fotos")');
    }
    const imagenes = files.map(f => ({ buffer: f.buffer, mimeType: f.mimetype }));
    return this.svc.procesarFotosOCR(imagenes);
  }

  // ── Listar con filtros ────────────────────────────────────────────────────
  @Get()
  listar(
    @Query('desde')              desde?: string,
    @Query('hasta')              hasta?: string,
    @Query('tipo')               tipo?: TipoGasto,
    @Query('categoria')          categoria?: string,
    @Query('busqueda')           busqueda?: string,
    @Query('registrado_por_id')  registrado_por_id?: string,
  ) {
    return this.svc.listar({
      desde, hasta, tipo, categoria, busqueda,
      registrado_por_id: registrado_por_id ? Number(registrado_por_id) : undefined,
    });
  }

  // ── Resumen del periodo ───────────────────────────────────────────────────
  @Get('resumen')
  resumen(@Query('desde') desde: string, @Query('hasta') hasta: string) {
    return this.svc.resumen(desde, hasta);
  }

  // ── Promedio mensual de gastos personales ─────────────────────────────────
  @Get('promedio-personal')
  promedioPersonal(@Query('meses') meses?: string) {
    return this.svc.promedioPersonal(meses ? Number(meses) : 3);
  }

  // ── Categorías sugeridas ──────────────────────────────────────────────────
  @Get('categorias')
  categorias() { return this.svc.categorias(); }

  // ── Obtener uno ───────────────────────────────────────────────────────────
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) { return this.svc.findOne(id); }

  // ── Crear ────────────────────────────────────────────────────────────────
  @Post()
  crear(@Request() req: any, @Body() body: any) {
    return this.svc.crear({
      ...body,
      registrado_por_id:     req.user.id,
      registrado_por_nombre: req.user.nombre,
    });
  }

  // ── Actualizar ───────────────────────────────────────────────────────────
  @Put(':id')
  actualizar(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: any,
    @Request() req: any,
  ) {
    return this.svc.actualizar(id, body, req.user.id, req.user.rol);
  }

  // ── Eliminar ─────────────────────────────────────────────────────────────
  @Delete(':id')
  eliminar(@Param('id', ParseIntPipe) id: number, @Request() req: any) {
    return this.svc.eliminar(id, req.user.id, req.user.rol);
  }
}
