import { Controller, Get, Post, Put, Delete, Body, Param, Query, ParseIntPipe, UseGuards, UseInterceptors, UploadedFile, BadRequestException } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ProductosService } from './productos.service';
import { Producto } from './entities/producto.entity';
import { JwtAuthGuard } from '../common/guards';

@ApiTags('Productos')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('productos')
export class ProductosController {
  constructor(private svc: ProductosService) {}

  @Get()
  @ApiOperation({ summary: 'Listar productos' })
  findAll(@Query() q: { search?: string; categoria?: string; activo?: string }) {
    return this.svc.findAll(q);
  }

  @Get('buscar')
  @ApiOperation({ summary: 'Autocomplete de productos' })
  buscar(@Query('q') q: string) {
    return this.svc.buscar(q ?? '');
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.svc.findOne(id);
  }

  @Post('importar')
  @ApiOperation({ summary: 'Importar productos desde un archivo Excel' })
  @UseInterceptors(FileInterceptor('archivo', { storage: undefined }))
  importar(@UploadedFile() archivo: { buffer: Buffer; originalname: string }) {
    if (!archivo) throw new BadRequestException('No se recibió archivo');
    return this.svc.importarDesdeExcel(archivo.buffer);
  }

  @Post()
  create(@Body() body: Partial<Producto>) {
    return this.svc.create(body);
  }

  @Post(':id/duplicar')
  @ApiOperation({ summary: 'Duplicar un producto' })
  duplicar(@Param('id', ParseIntPipe) id: number) {
    return this.svc.duplicar(id);
  }

  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() body: Partial<Producto>) {
    return this.svc.update(id, body);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.svc.remove(id);
  }

  // ── Variantes ──────────────────────────────────────────────────────────────
  @Get('variantes/buscar')
  buscarVariantes(@Query('q') q: string) {
    return this.svc.buscarVariantes(q ?? '');
  }

  @Get(':id/variantes')
  findVariantes(@Param('id', ParseIntPipe) id: number) {
    return this.svc.findVariantes(id);
  }

  @Post(':id/variantes')
  @ApiOperation({ summary: 'Crear una variante para un producto' })
  createVariante(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.svc.createVariante(id, body);
  }

  @Put('variantes/:id')
  updateVariante(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.svc.updateVariante(id, body);
  }

  @Delete('variantes/reset-all')
  @ApiOperation({ summary: 'Reiniciar todas las variantes y atributos de todos los productos' })
  resetAllVariantes() {
    return this.svc.resetAllVariantes();
  }

  @Delete('variantes/:id')
  @ApiOperation({ summary: 'Eliminar una variante' })
  deleteVariante(@Param('id', ParseIntPipe) id: number) {
    return this.svc.deleteVariante(id);
  }
}
