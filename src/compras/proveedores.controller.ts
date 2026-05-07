import {
  Controller, Get, Post, Put, Delete,
  Body, Param, Query, ParseIntPipe, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ProveedoresService } from './proveedores.service';
import { JwtAuthGuard } from '../common/guards';

@ApiTags('Proveedores')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('compras/proveedores')
export class ProveedoresController {
  constructor(private svc: ProveedoresService) {}

  // ─── Proveedores CRUD ────────────────────────────────────────────────────────

  @Get()
  @ApiOperation({ summary: 'Listar proveedores' })
  findAll(@Query() q: { search?: string; activo?: string }) {
    return this.svc.findAll(q);
  }

  @Get('por-producto/:productoId')
  @ApiOperation({ summary: 'Proveedores que suministran un producto' })
  getByProducto(@Param('productoId', ParseIntPipe) productoId: number) {
    return this.svc.getByProducto(productoId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Detalle de proveedor con productos' })
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.svc.findOne(id);
  }

  @Post()
  @ApiOperation({ summary: 'Crear proveedor' })
  create(@Body() body: any) {
    return this.svc.create(body);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Actualizar proveedor' })
  update(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.svc.update(id, body);
  }

  @Put(':id/toggle')
  @ApiOperation({ summary: 'Activar / desactivar proveedor' })
  toggle(@Param('id', ParseIntPipe) id: number) {
    return this.svc.toggle(id);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Eliminar proveedor' })
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.svc.remove(id);
  }

  // ─── Productos del proveedor ─────────────────────────────────────────────────

  @Get(':id/productos')
  @ApiOperation({ summary: 'Listar productos de un proveedor' })
  getProductos(@Param('id', ParseIntPipe) id: number) {
    return this.svc.getProductos(id);
  }

  @Post(':id/productos')
  @ApiOperation({ summary: 'Agregar producto a proveedor' })
  addProducto(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.svc.addProducto(id, body);
  }

  @Put(':id/productos/:productoId')
  @ApiOperation({ summary: 'Actualizar datos de producto-proveedor' })
  updateProducto(
    @Param('id', ParseIntPipe) id: number,
    @Param('productoId', ParseIntPipe) productoId: number,
    @Body() body: any,
  ) {
    return this.svc.updateProducto(id, productoId, body);
  }

  @Delete(':id/productos/:productoId')
  @ApiOperation({ summary: 'Quitar producto de proveedor' })
  removeProducto(
    @Param('id', ParseIntPipe) id: number,
    @Param('productoId', ParseIntPipe) productoId: number,
  ) {
    return this.svc.removeProducto(id, productoId);
  }
}
