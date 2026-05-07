import { Controller, Get, Post, Put, Delete, Param, Body, Query, ParseIntPipe, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { ConfiguracionService } from './configuracion.service';
import { JwtAuthGuard, RolesGuard } from '../common/guards';
import { Roles } from '../common/decorators';
import { RolUsuario } from '../auth/entities/usuario.entity';

/** Solo admins y supervisores pueden modificar la configuración */
const ADMIN_SUP = [RolUsuario.ADMIN, RolUsuario.SUPERVISOR];

@ApiTags('Configuración')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('configuracion')
export class ConfiguracionController {
  constructor(private svc: ConfiguracionService) {}

  // ── Departamentos ─────────────────────────────────────────────────────────
  @Get('departamentos')
  departamentos() { return this.svc.listarDepartamentos(); }

  @Post('departamentos')
  @UseGuards(RolesGuard) @Roles(...ADMIN_SUP)
  crearDepto(@Body() body: { nombre: string; orden?: number }) {
    return this.svc.crearDepartamento(body);
  }

  @Put('departamentos/:id')
  @UseGuards(RolesGuard) @Roles(...ADMIN_SUP)
  actualizarDepto(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { nombre?: string; orden?: number; activo?: boolean; checkpoints?: string[] | null },
  ) { return this.svc.actualizarDepartamento(id, body); }

  @Put('departamentos/:id/toggle')
  @UseGuards(RolesGuard) @Roles(...ADMIN_SUP)
  toggleDepto(@Param('id', ParseIntPipe) id: number) {
    return this.svc.toggleDepartamento(id);
  }

  // ── Técnicas ──────────────────────────────────────────────────────────────
  @Get('tecnicas')
  tecnicas(@Query('activas') activas?: string) {
    return this.svc.listarTecnicas(activas === 'true');
  }

  @Post('tecnicas')
  @UseGuards(RolesGuard) @Roles(...ADMIN_SUP)
  crearTecnica(@Body() body: {
    nombre: string;
    precio_default?: number;
    departamento_id?: number;
    departamento_nombre?: string;
  }) { return this.svc.crearTecnica(body); }

  @Put('tecnicas/:id')
  @UseGuards(RolesGuard) @Roles(...ADMIN_SUP)
  actualizarTecnica(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: any,
  ) { return this.svc.actualizarTecnica(id, body); }

  @Put('tecnicas/:id/toggle')
  @UseGuards(RolesGuard) @Roles(...ADMIN_SUP)
  toggleTecnica(@Param('id', ParseIntPipe) id: number) {
    return this.svc.toggleTecnica(id);
  }

  @Delete('tecnicas/:id')
  @UseGuards(RolesGuard) @Roles(...ADMIN_SUP)
  eliminarTecnica(@Param('id', ParseIntPipe) id: number) {
    return this.svc.eliminarTecnica(id);
  }

  // ── Categorías de producto ─────────────────────────────────────────────────
  @Get('categorias')
  categorias() { return this.svc.listarCategorias(); }

  @Post('categorias')
  @UseGuards(RolesGuard) @Roles(...ADMIN_SUP)
  crearCategoria(@Body() body: {
    nombre: string;
    descripcion?: string;
    color?: string;
    orden?: number;
  }) { return this.svc.crearCategoria(body); }

  @Put('categorias/:id')
  @UseGuards(RolesGuard) @Roles(...ADMIN_SUP)
  actualizarCategoria(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { nombre?: string; descripcion?: string; color?: string; orden?: number; activo?: boolean },
  ) { return this.svc.actualizarCategoria(id, body); }

  @Put('categorias/:id/toggle')
  @UseGuards(RolesGuard) @Roles(...ADMIN_SUP)
  toggleCategoria(@Param('id', ParseIntPipe) id: number) {
    return this.svc.toggleCategoria(id);
  }

  @Delete('categorias/:id')
  @UseGuards(RolesGuard) @Roles(...ADMIN_SUP)
  eliminarCategoria(@Param('id', ParseIntPipe) id: number) {
    return this.svc.eliminarCategoria(id);
  }

  // ── Marcas ─────────────────────────────────────────────────────────────────
  @Get('marcas')
  marcas(@Query('activas') activas?: string) {
    return this.svc.listarMarcas(activas === 'true');
  }

  @Post('marcas')
  @UseGuards(RolesGuard) @Roles(...ADMIN_SUP)
  crearMarca(@Body() body: { nombre: string; es_propia?: boolean; descripcion?: string }) {
    return this.svc.crearMarca(body);
  }

  @Put('marcas/:id')
  @UseGuards(RolesGuard) @Roles(...ADMIN_SUP)
  actualizarMarca(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { nombre?: string; es_propia?: boolean; descripcion?: string; activo?: boolean },
  ) { return this.svc.actualizarMarca(id, body); }

  @Put('marcas/:id/toggle')
  @UseGuards(RolesGuard) @Roles(...ADMIN_SUP)
  toggleMarca(@Param('id', ParseIntPipe) id: number) {
    return this.svc.toggleMarca(id);
  }

  @Delete('marcas/:id')
  @UseGuards(RolesGuard) @Roles(...ADMIN_SUP)
  eliminarMarca(@Param('id', ParseIntPipe) id: number) {
    return this.svc.eliminarMarca(id);
  }

  // ── Configuración del sistema ──────────────────────────────────────────────
  @Get('sistema')
  getConfigSistema() { return this.svc.getTodasConfig(); }

  @Put('sistema/:clave')
  @UseGuards(RolesGuard) @Roles(...ADMIN_SUP)
  setConfigSistema(
    @Param('clave') clave: string,
    @Body() body: { valor: string; descripcion?: string },
  ) { return this.svc.setConfig(clave, body.valor, body.descripcion); }

  @Post('sistema/batch')
  @UseGuards(RolesGuard) @Roles(...ADMIN_SUP)
  async setConfigBatch(@Body() items: { clave: string; valor: string }[]) {
    for (const item of items) {
      await this.svc.setConfig(item.clave, item.valor);
    }
    return { ok: true };
  }

  // ── Plantillas de Ruta ────────────────────────────────────────────────────
  @Get('plantillas-ruta')
  plantillas() { return this.svc.listarPlantillas(); }

  @Post('plantillas-ruta')
  @UseGuards(RolesGuard) @Roles(...ADMIN_SUP)
  crearPlantilla(@Body() body: any) { return this.svc.crearPlantilla(body); }

  @Put('plantillas-ruta/:id')
  @UseGuards(RolesGuard) @Roles(...ADMIN_SUP)
  actualizarPlantilla(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.svc.actualizarPlantilla(id, body);
  }

  @Delete('plantillas-ruta/:id')
  @UseGuards(RolesGuard) @Roles(...ADMIN_SUP)
  eliminarPlantilla(@Param('id', ParseIntPipe) id: number) {
    return this.svc.eliminarPlantilla(id);
  }

  // ── Flujos de producción ──────────────────────────────────────────────────
  @Get('flujos-produccion')
  listarFlujos() { return this.svc.listarFlujos(); }

  @Post('flujos-produccion')
  @UseGuards(RolesGuard) @Roles(...ADMIN_SUP)
  crearFlujo(@Body() body: any) { return this.svc.crearFlujo(body); }

  @Put('flujos-produccion/:id')
  @UseGuards(RolesGuard) @Roles(...ADMIN_SUP)
  actualizarFlujo(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.svc.actualizarFlujo(id, body);
  }

  @Delete('flujos-produccion/:id')
  @UseGuards(RolesGuard) @Roles(...ADMIN_SUP)
  eliminarFlujo(@Param('id', ParseIntPipe) id: number) {
    return this.svc.eliminarFlujo(id);
  }

  // ── Máquinas ──────────────────────────────────────────────────────────────
  @Get('maquinas')
  maquinas(
    @Query('departamento_id')     dId?:     string,
    @Query('departamento_nombre') dNombre?: string,
  ) {
    return this.svc.listarMaquinas(
      dId ? parseInt(dId, 10) : undefined,
      dNombre,
    );
  }

  @Post('maquinas')
  @UseGuards(RolesGuard) @Roles(...ADMIN_SUP)
  crearMaquina(@Body() body: { nombre: string; departamento_id: number; descripcion?: string }) {
    return this.svc.crearMaquina(body);
  }

  @Put('maquinas/:id')
  @UseGuards(RolesGuard) @Roles(...ADMIN_SUP)
  actualizarMaquina(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.svc.actualizarMaquina(id, body);
  }

  @Delete('maquinas/:id')
  @UseGuards(RolesGuard) @Roles(...ADMIN_SUP)
  eliminarMaquina(@Param('id', ParseIntPipe) id: number) {
    return this.svc.eliminarMaquina(id);
  }

  @Post('migraciones/crear-tabla-maquinas')
  crearTablaMaquinas() {
    return this.svc.crearTablaMaquinas();
  }

  // ── Feriados ──────────────────────────────────────────────────────────────
  @Get('feriados')
  feriados(@Query('año') año?: string) {
    return this.svc.listarFeriados(año ? parseInt(año, 10) : undefined);
  }

  @Post('feriados')
  @UseGuards(RolesGuard) @Roles(...ADMIN_SUP)
  crearFeriado(@Body() body: { fecha: string; nombre: string; año: number }) {
    return this.svc.crearFeriado(body);
  }

  @Delete('feriados/:id')
  @UseGuards(RolesGuard) @Roles(...ADMIN_SUP)
  eliminarFeriado(@Param('id', ParseIntPipe) id: number) {
    return this.svc.eliminarFeriado(id);
  }

  @Post('migraciones/crear-tabla-feriados')
  crearTablaFeriados() {
    return this.svc.crearTablaFeriados();
  }

  // ── Cuentas bancarias ────────────────────────────────────────────────────
  @Get('cuentas-banco')
  listarCuentas(@Query('activas') activas?: string) {
    return this.svc.listarCuentas(activas === 'true');
  }

  @Post('cuentas-banco')
  @UseGuards(RolesGuard) @Roles(...ADMIN_SUP)
  crearCuenta(@Body() body: {
    banco: string; digitos: string; tipo_cuenta?: string;
    titular?: string; alias?: string;
  }) {
    return this.svc.crearCuenta(body);
  }

  @Put('cuentas-banco/:id')
  @UseGuards(RolesGuard) @Roles(...ADMIN_SUP)
  actualizarCuenta(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { banco?: string; digitos?: string; tipo_cuenta?: string; titular?: string; alias?: string; activo?: boolean },
  ) { return this.svc.actualizarCuenta(id, body); }

  @Delete('cuentas-banco/:id')
  @UseGuards(RolesGuard) @Roles(...ADMIN_SUP)
  eliminarCuenta(@Param('id', ParseIntPipe) id: number) {
    return this.svc.eliminarCuenta(id);
  }
}
