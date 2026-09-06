import { Controller, Get, Post, Put, Delete, Body, Param, Query, ParseIntPipe, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { ClientesService } from './clientes.service';
import { CreateClienteDto } from './dto/create-cliente.dto';
import { JwtAuthGuard } from '../common/guards';
import { CurrentUser } from '../common/decorators';

@ApiTags('Clientes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('clientes')
export class ClientesController {
  constructor(private svc: ClientesService) {}

  @Get()
  @ApiOperation({ summary: 'Listar clientes con filtros opcionales' })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'estado', required: false })
  @ApiQuery({ name: 'ciudad', required: false })
  findAll(@Query() q: { search?: string; estado?: string; ciudad?: string }) {
    return this.svc.findAll(q);
  }

  @Get('buscar')
  @ApiOperation({ summary: 'Búsqueda rápida para autocomplete' })
  buscar(@Query('q') q: string) {
    return this.svc.buscar(q ?? '');
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.svc.findOne(id);
  }

  @Post()
  @ApiOperation({ summary: 'Crear nuevo cliente' })
  create(@Body() dto: CreateClienteDto, @CurrentUser() user: any) {
    return this.svc.create(dto, { id: user?.id, nombre: user?.nombre ?? user?.email, rol: user?.rol });
  }

  @Put(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: Partial<CreateClienteDto>, @CurrentUser() user: any) {
    return this.svc.update(id, dto, { id: user?.id, nombre: user?.nombre ?? user?.email, rol: user?.rol });
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.svc.remove(id);
  }
}
