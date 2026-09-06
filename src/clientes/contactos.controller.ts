import { Controller, Get, Post, Put, Delete, Param, Body, ParseIntPipe, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards';
import { ContactosService, ContactoDto } from './contactos.service';

/** Contactos por cliente. Registrado ANTES de ClientesController (comodín `:id`). */
@ApiTags('Clientes · Contactos')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('clientes')
export class ContactosController {
  constructor(private svc: ContactosService) {}

  @Get(':id/contactos')
  listar(@Param('id', ParseIntPipe) id: number) {
    return this.svc.listar(id);
  }

  @Post(':id/contactos')
  crear(@Param('id', ParseIntPipe) id: number, @Body() body: ContactoDto) {
    return this.svc.crear(id, body);
  }

  @Put('contactos/:cid')
  actualizar(@Param('cid', ParseIntPipe) cid: number, @Body() body: Partial<ContactoDto>) {
    return this.svc.actualizar(cid, body);
  }

  @Delete('contactos/:cid')
  eliminar(@Param('cid', ParseIntPipe) cid: number) {
    return this.svc.eliminar(cid);
  }
}
