import {
  Controller, Get, Post, Put, Delete, Param, Body, Query,
  ParseIntPipe, UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { ProduccionService } from './produccion.service';
import { EstadoOrden, EstadoMateriales } from './entities/orden-produccion.entity';
import { EstadoTarea } from './entities/tarea-produccion.entity';
import { EstadoLote } from './entities/lote-produccion.entity';
import { JwtAuthGuard, RolesGuard } from '../common/guards';
import { Roles, CurrentUser } from '../common/decorators';
import { RolUsuario } from '../auth/entities/usuario.entity';

@ApiTags('Producción')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('produccion')
export class ProduccionController {
  constructor(private svc: ProduccionService) {}

  // ── Desbloqueo manual de un lote (admin/supervisor) ────────────────────────
  @Post('lotes/:loteId/desbloquear')
  @UseGuards(RolesGuard)
  @Roles(RolUsuario.ADMIN, RolUsuario.SUPERVISOR)
  @ApiOperation({ summary: 'Desbloquear manualmente un lote pendiente (auditado)' })
  desbloquearLote(@Param('loteId', ParseIntPipe) loteId: number, @CurrentUser() user: any) {
    return this.svc.desbloquearLoteManual(loteId, user?.nombre ?? user?.email ?? 'admin');
  }

  // ── Validación física de pedidos (conteo escaneado) ───────────────────────
  @Post('validacion-fisica')
  @UseGuards(RolesGuard)
  @Roles(RolUsuario.ADMIN, RolUsuario.SUPERVISOR)
  @ApiOperation({ summary: 'Iniciar sesión de validación física de pedidos listos' })
  iniciarValidacion(@CurrentUser() user: any) {
    return this.svc.iniciarValidacionFisica(user?.nombre ?? user?.email ?? 'admin');
  }

  @Get('validacion-fisica/activa')
  @UseGuards(RolesGuard)
  @Roles(RolUsuario.ADMIN, RolUsuario.SUPERVISOR)
  validacionActiva() {
    return this.svc.validacionFisicaActiva();
  }

  @Get('validacion-fisica/:id')
  @UseGuards(RolesGuard)
  @Roles(RolUsuario.ADMIN, RolUsuario.SUPERVISOR)
  obtenerValidacion(@Param('id', ParseIntPipe) id: number) {
    return this.svc.obtenerValidacionFisica(id);
  }

  @Delete('validacion-fisica/:id')
  @UseGuards(RolesGuard)
  @Roles(RolUsuario.ADMIN, RolUsuario.SUPERVISOR)
  borrarValidacion(@Param('id', ParseIntPipe) id: number) {
    return this.svc.borrarValidacionFisica(id);
  }

  @Post('validacion-fisica/:id/marcar')
  @UseGuards(RolesGuard)
  @Roles(RolUsuario.ADMIN, RolUsuario.SUPERVISOR)
  marcarValidacion(
    @Param('id', ParseIntPipe) id: number,
    @Body('codigo') codigo: string,
    @CurrentUser() user: any,
  ) {
    return this.svc.marcarValidacionFisica(id, codigo, user?.nombre ?? user?.email ?? 'admin');
  }

  @Post('validacion-fisica/:id/cerrar')
  @UseGuards(RolesGuard)
  @Roles(RolUsuario.ADMIN, RolUsuario.SUPERVISOR)
  cerrarValidacion(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: any) {
    return this.svc.cerrarValidacionFisica(id, user?.nombre ?? user?.email ?? 'admin');
  }

  // ── Vista personal del operario ──────────────────────────────────────────
  @Get('mis-tareas')
  @ApiOperation({ summary: 'Lotes asignados al operario + disponibles en su depto' })
  misTareas(
    @Query('responsable') responsable: string,
    @Query('departamentos') departamentos?: string,
    @Query('rol') rol?: string,
  ) {
    const deptos = departamentos ? departamentos.split(',').map(d => d.trim()).filter(Boolean) : [];
    return this.svc.getMisTareas(responsable, deptos, rol);
  }

  // ── Operarios disponibles para asignación ────────────────────────────────
  @Get('operarios')
  @ApiOperation({ summary: 'Lista operarios (filtro opcional por departamento)' })
  operarios(@Query('departamento') departamento?: string) {
    return this.svc.getOperarios(departamento);
  }

  // ── Reporte (debe ir ANTES de :id para no colisionar) ────────────────────
  @Get('reporte')
  @ApiOperation({ summary: 'Reporte de producción filtrado por fecha' })
  reporte(@Query('desde') desde?: string, @Query('hasta') hasta?: string) {
    return this.svc.getReporte(desde, hasta);
  }

  // ── Histórico de tareas completadas por operario (debe ir ANTES de :id) ───
  @Get('historico-operario')
  @ApiOperation({ summary: 'Histórico de tareas completadas por operario, agrupado por día' })
  historicoOperario(
    @CurrentUser() user: any,
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
    @Query('responsable') responsable?: string,
    @Query('departamento') departamento?: string,
    @Query('tecnica') tecnica?: string,
  ) {
    const rol = user?.rol;
    // Admin/supervisor pueden consultar a cualquiera; el resto, solo lo suyo.
    const responsableFinal = (rol === 'admin' || rol === 'supervisor')
      ? (responsable || undefined)
      : user?.nombre;
    return this.svc.historicoOperario({
      desde, hasta,
      responsable: responsableFinal,
      departamento: departamento || undefined,
      tecnica: tecnica || undefined,
    });
  }

  // ── Vista financiera de órdenes ──────────────────────────────────────────
  @Get('financiero')
  @UseGuards(RolesGuard)
  @Roles(RolUsuario.ADMIN, RolUsuario.SUPERVISOR)
  @ApiOperation({ summary: 'Vista financiera: cotización, recibos y factura por orden' })
  vistaFinanciera() { return this.svc.getVistaFinanciera(); }

  // ── Pipeline ──────────────────────────────────────────────────────────────
  @Get('pipeline')
  @ApiOperation({ summary: 'Vista pipeline de flujo por departamentos' })
  pipeline() { return this.svc.getPipeline(); }

  @Get('alertas')
  @ApiOperation({ summary: 'Lotes desbloqueados por departamento (notificaciones)' })
  alertas() { return this.svc.getAlertas(); }

  @Post('preview-ruta')
  @ApiOperation({ summary: 'Preview de ruta de producción sin guardar' })
  previewRuta(@Body('lineas') lineas: any[]) { return this.svc.previewRuta(lineas ?? []); }

  // ── CRUD órdenes ──────────────────────────────────────────────────────────
  @Post()
  @ApiOperation({ summary: 'Crear orden + tareas automáticas' })
  create(@Body() body: any) { return this.svc.create(body); }

  @Get()
  @ApiOperation({ summary: 'Listar órdenes (Kanban / Órdenes de Producción)' })
  findAll(@Query() q: { estado?: string; semaforo?: string; excluir_entregado?: string; search?: string; cliente_id?: string }) {
    return this.svc.findAll(q);
  }

  /** IMPORTANTE: va ANTES de :id para evitar colisión de rutas */
  @Get('conduces/:conduceId')
  @ApiOperation({ summary: 'Detalle de un conduce (para impresión)' })
  getConduce(@Param('conduceId', ParseIntPipe) conduceId: number) {
    return this.svc.getConduce(conduceId);
  }

  @Get('reprogramaciones')
  @UseGuards(RolesGuard)
  @Roles(RolUsuario.ADMIN, RolUsuario.SUPERVISOR)
  @ApiOperation({ summary: 'Bitácora de reprogramaciones de entrega' })
  reprogramaciones(@Query('orden_id') ordenId?: string) {
    return this.svc.listarReprogramaciones(ordenId ? +ordenId : undefined);
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) { return this.svc.findOne(id); }

  @Put(':id')
  @UseGuards(RolesGuard)
  @Roles(RolUsuario.ADMIN, RolUsuario.SUPERVISOR, RolUsuario.VENDEDOR)
  @ApiOperation({ summary: 'Editar orden (admin/supervisor)' })
  editar(@Param('id', ParseIntPipe) id: number, @Body() body: any) {
    return this.svc.editarOrden(id, body);
  }

  @Put(':id/estado')
  @ApiOperation({ summary: 'Cambiar estado de orden' })
  estado(
    @Param('id', ParseIntPipe) id: number,
    @Body('estado') estado: EstadoOrden,
  ) { return this.svc.actualizarEstado(id, estado); }

  @Put(':id/entrega')
  @UseGuards(RolesGuard)
  @Roles(RolUsuario.ADMIN, RolUsuario.SUPERVISOR)
  @ApiOperation({ summary: 'Actualizar/reprogramar fecha de entrega (solo admin/supervisor)' })
  entrega(
    @Param('id', ParseIntPipe) id: number,
    @Body('fecha_hora_entrega') fecha: string,
    @Body('motivo') motivo: string,
    @CurrentUser() user: any,
  ) { return this.svc.actualizarEntrega(id, fecha, user?.nombre ?? user?.email ?? 'admin', motivo); }

  @Put(':id/responsables')
  @ApiOperation({ summary: 'Actualizar responsables' })
  responsables(
    @Param('id', ParseIntPipe) id: number,
    @Body('responsable_principal') principal: string,
    @Body('responsables_secundarios') secundarios: string[],
  ) { return this.svc.actualizarResponsables(id, principal, secundarios ?? []); }

  @Put(':id/materiales')
  @ApiOperation({ summary: 'Actualizar estado de materiales' })
  materiales(
    @Param('id', ParseIntPipe) id: number,
    @Body('estado_materiales') estado: EstadoMateriales,
  ) { return this.svc.actualizarMateriales(id, estado); }

  // ── Control de producción ─────────────────────────────────────────────────
  @Post(':id/iniciar')
  @ApiOperation({ summary: 'Iniciar producción (arranca el timer)' })
  iniciar(@Param('id', ParseIntPipe) id: number) {
    return this.svc.iniciarProduccion(id);
  }

  @Post(':id/pausar')
  @ApiOperation({ summary: 'Pausar producción (requiere motivo)' })
  pausar(
    @Param('id', ParseIntPipe) id: number,
    @Body('motivo') motivo: string,
  ) { return this.svc.pausarProduccion(id, motivo); }

  @Post(':id/reanudar')
  @ApiOperation({ summary: 'Reanudar desde pausa' })
  reanudar(@Param('id', ParseIntPipe) id: number) {
    return this.svc.reanudarProduccion(id);
  }

  @Post(':id/finalizar')
  @ApiOperation({ summary: 'Finalizar producción (detiene el timer)' })
  finalizar(@Param('id', ParseIntPipe) id: number) {
    return this.svc.finalizarProduccion(id);
  }

  // ── Pausas ────────────────────────────────────────────────────────────────
  @Get(':id/pausas')
  @ApiOperation({ summary: 'Historial de pausas' })
  pausas(@Param('id', ParseIntPipe) id: number) {
    return this.svc.getPausas(id);
  }

  // ── Entrega ───────────────────────────────────────────────────────────────
  @Post(':id/entregar')
  @ApiOperation({ summary: 'Entrega simple (sin conduce) — valida factura' })
  entregar(
    @Param('id', ParseIntPipe) id: number,
    @Body('entregado_por') entregadoPor: string,
  ) { return this.svc.entregar(id, { entregado_por: entregadoPor }); }

  @Post(':id/conduces')
  @ApiOperation({ summary: 'Crear conduce de entrega (parcial o total)' })
  crearConduce(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: {
      entregado_por: string;
      recibido_por?: string;
      notas?: string;
      items: { linea_idx: number; cantidad_entregada: number }[];
    },
  ) { return this.svc.crearConduce(id, body); }

  @Get(':id/conduces')
  @ApiOperation({ summary: 'Historial de conduces de una orden' })
  getConduces(@Param('id', ParseIntPipe) id: number) {
    return this.svc.getConduces(id);
  }

  // ── Cancelación ──────────────────────────────────────────────────────────
  @Post(':id/cancelar')
  @UseGuards(RolesGuard)
  @Roles(RolUsuario.ADMIN, RolUsuario.SUPERVISOR)
  @ApiOperation({ summary: 'Cancelar orden directamente (admin/supervisor)' })
  cancelar(
    @Param('id', ParseIntPipe) id: number,
    @Body('motivo') motivo: string,
    @Body('solicitado_por') solicitadoPor: string,
  ) { return this.svc.cancelarOrden(id, motivo, solicitadoPor); }

  @Post(':id/solicitar-cancelacion')
  @ApiOperation({ summary: 'Solicitar cancelación (requiere aprobación de admin/supervisor)' })
  solicitarCancelacion(
    @Param('id', ParseIntPipe) id: number,
    @Body('motivo') motivo: string,
    @Body('solicitado_por') solicitadoPor: string,
  ) { return this.svc.solicitarCancelacion(id, motivo, solicitadoPor); }

  @Post(':id/aprobar-cancelacion')
  @UseGuards(RolesGuard)
  @Roles(RolUsuario.ADMIN, RolUsuario.SUPERVISOR)
  @ApiOperation({ summary: 'Aprobar solicitud de cancelación' })
  aprobarCancelacion(
    @Param('id', ParseIntPipe) id: number,
    @Body('aprobado_por') aprobadoPor: string,
  ) { return this.svc.aprobarCancelacion(id, aprobadoPor); }

  @Post(':id/rechazar-cancelacion')
  @UseGuards(RolesGuard)
  @Roles(RolUsuario.ADMIN, RolUsuario.SUPERVISOR)
  @ApiOperation({ summary: 'Rechazar solicitud de cancelación' })
  rechazarCancelacion(
    @Param('id', ParseIntPipe) id: number,
  ) { return this.svc.rechazarCancelacion(id); }

  // ── Tareas ────────────────────────────────────────────────────────────────
  @Get(':id/tareas')
  @ApiOperation({ summary: 'Tareas de una orden' })
  getTareas(@Param('id', ParseIntPipe) id: number) { return this.svc.getTareas(id); }

  @Put('tareas/:tareaId/estado')
  @ApiOperation({ summary: 'Cambiar estado de tarea' })
  estadoTarea(
    @Param('tareaId', ParseIntPipe) tareaId: number,
    @Body('estado') estado: EstadoTarea,
  ) { return this.svc.actualizarEstadoTarea(tareaId, estado); }

  @Put('tareas/:tareaId/asignar')
  @ApiOperation({ summary: 'Asignar responsable a tarea' })
  asignar(
    @Param('tareaId', ParseIntPipe) tareaId: number,
    @Body('responsable') responsable: string,
    @Body('tiempo_estimado') tiempo_estimado?: string,
  ) { return this.svc.asignarTarea(tareaId, responsable, tiempo_estimado); }

  // ── Lotes de producción ───────────────────────────────────────────────────
  @Get(':id/lotes')
  @ApiOperation({ summary: 'Lotes de una orden' })
  getLotes(@Param('id', ParseIntPipe) id: number) {
    return this.svc.getLotes(id);
  }

  @Get('departamento/:nombre')
  @ApiOperation({ summary: 'Lotes pendientes/activos por departamento' })
  lotesPorDepartamento(
    @Param('nombre') nombre: string,
    @Query('estado') estado?: EstadoLote,
  ) { return this.svc.getLotesPorDepartamento(decodeURIComponent(nombre), estado); }

  @Put('lotes/:loteId/estado')
  @ApiOperation({ summary: 'Cambiar estado de lote (acepta piezas_ok/retrabajo/descarte al completar)' })
  estadoLote(
    @Param('loteId', ParseIntPipe) loteId: number,
    @Body('estado')           estado:            EstadoLote,
    @Body('responsable')      responsable?:      string,
    @Body('piezas_ok')        piezas_ok?:        number,
    @Body('piezas_retrabajo') piezas_retrabajo?: number,
    @Body('piezas_descarte')  piezas_descarte?:  number,
  ) {
    const piezas = (piezas_ok != null || piezas_retrabajo != null || piezas_descarte != null)
      ? { piezas_ok: piezas_ok ?? 0, piezas_retrabajo: piezas_retrabajo ?? 0, piezas_descarte: piezas_descarte ?? 0 }
      : undefined;
    return this.svc.actualizarEstadoLote(loteId, estado, responsable, piezas);
  }

  @Put('lotes/:loteId/retomar')
  @ApiOperation({ summary: 'Retomar un lote parcialmente completado (faltantes)' })
  retomarLote(
    @Param('loteId', ParseIntPipe) loteId: number,
    @Body('responsable') responsable: string,
  ) { return this.svc.retomarLote(loteId, responsable); }

  @Put('lotes/:loteId/checkpoint')
  @ApiOperation({ summary: 'Marcar/desmarcar un checkpoint de un lote' })
  marcarCheckpoint(
    @Param('loteId', ParseIntPipe) loteId: number,
    @Body('checkpoint') checkpoint: string,
    @Body('completado') completado: boolean,
  ) { return this.svc.marcarCheckpoint(loteId, checkpoint, completado); }

  @Put('lotes/:loteId/asignar')
  @ApiOperation({ summary: 'Asignar responsable(s) y máquina a lote' })
  asignarLote(
    @Param('loteId', ParseIntPipe) loteId: number,
    @Body('responsable') responsable: string,
    @Body('notas') notas?: string,
    @Body('responsables') responsables?: string[],
    @Body('maquina') maquina?: string,
  ) { return this.svc.asignarLote(loteId, responsable, notas, responsables, maquina); }

  @Post('lotes/:loteId/pausar-lote')
  @ApiOperation({ summary: 'Pausar trabajo en un lote (operario)' })
  pausarLote(
    @Param('loteId', ParseIntPipe) loteId: number,
    @Body('motivo') motivo: string,
  ) { return this.svc.pausarLote(loteId, motivo); }

  @Post('lotes/:loteId/reanudar-lote')
  @ApiOperation({ summary: 'Reanudar trabajo en un lote (operario)' })
  reanudarLote(@Param('loteId', ParseIntPipe) loteId: number) {
    return this.svc.reanudarLote(loteId);
  }

  @Post('lotes/:loteId/dividir')
  @ApiOperation({ summary: 'Dividir un lote en sub-lotes para múltiples operarios/máquinas' })
  dividirLote(
    @Param('loteId', ParseIntPipe) loteId: number,
    @Body('divisiones') divisiones: Array<{ cantidad: number; responsable?: string; maquina?: string; lineas_asignadas?: number[] }>,
  ) { return this.svc.dividirLote(loteId, divisiones); }

  @Put('lotes/:loteId/tomar')
  @ApiOperation({ summary: 'Operario se auto-asigna un lote disponible' })
  tomarLote(
    @Param('loteId', ParseIntPipe) loteId: number,
    @Body('responsable') responsable: string,
  ) { return this.svc.tomarLote(loteId, responsable); }

  @Put('lotes/:loteId/confirmar')
  @ApiOperation({ summary: 'Firmar recepción de materiales (operario confirma cantidades recibidas)' })
  confirmarLote(
    @Param('loteId', ParseIntPipe) loteId: number,
    @Body() body: { confirmado_por: string; cantidad_confirmada: number; notas_recepcion?: string },
  ) { return this.svc.confirmarLote(loteId, body); }

  // ── DISEÑO: marcar listo con un clic (sin Iniciar/Completar/piezas OK) ───
  @Post('lotes/:loteId/diseno-listo')
  @ApiOperation({ summary: 'DISEÑO: marcar 1 diseño como listo (incremental hasta cantidad). Solo para lotes de departamentos DISEÑO*' })
  marcarDisenoListo(
    @Param('loteId', ParseIntPipe) loteId: number,
    @Body('responsable') responsable?: string,
  ) {
    return this.svc.marcarDisenoListo(loteId, responsable);
  }

  @Post('lotes/:loteId/diseno-deshacer')
  @ApiOperation({ summary: 'DISEÑO: deshacer último "marcar listo" (ventana 5 min)' })
  deshacerDisenoListo(
    @Param('loteId', ParseIntPipe) loteId: number,
  ) {
    return this.svc.deshacerDisenoListo(loteId);
  }

  @Put('lotes/:loteId/piezas')
  @ApiOperation({ summary: 'Actualizar piezas_ok con recálculo de estado de orden' })
  actualizarPiezas(
    @Param('loteId', ParseIntPipe) loteId: number,
    @Body('piezas_ok') piezasOk: number,
  ) { return this.svc.actualizarPiezasLote(loteId, piezasOk); }

  @Put('lotes/:loteId')
  @ApiOperation({ summary: 'Editar campos de un lote (ruta de producción)' })
  editarLote(
    @Param('loteId', ParseIntPipe) loteId: number,
    @Body() body: any,
  ) { return this.svc.editarLote(loteId, body); }

  @Delete('lotes/:loteId')
  @ApiOperation({ summary: 'Eliminar un lote no iniciado' })
  eliminarLote(
    @Param('loteId', ParseIntPipe) loteId: number,
  ) { return this.svc.eliminarLote(loteId); }

  // ── Procesos de lote ──────────────────────────────────────────────────────
  @Get('lotes/:loteId/procesos')
  @ApiOperation({ summary: 'Procesos de un lote' })
  getProcesos(@Param('loteId', ParseIntPipe) loteId: number) {
    return this.svc.getProcesosLote(loteId);
  }

  @Post('lotes/:loteId/procesos')
  @ApiOperation({ summary: 'Crear procesos para un lote' })
  crearProcesos(
    @Param('loteId', ParseIntPipe) loteId: number,
    @Body('nombres') nombres: string[],
  ) { return this.svc.crearProcesosParaLote(loteId, nombres); }

  @Post('procesos/:procesoId/iniciar')
  @ApiOperation({ summary: 'Iniciar un proceso' })
  iniciarProceso(
    @Param('procesoId', ParseIntPipe) procesoId: number,
    @Body('responsable') responsable?: string,
  ) { return this.svc.iniciarProceso(procesoId, responsable); }

  @Post('procesos/:procesoId/pausar')
  @ApiOperation({ summary: 'Pausar un proceso con motivo' })
  pausarProceso(
    @Param('procesoId', ParseIntPipe) procesoId: number,
    @Body('motivo') motivo: string,
  ) { return this.svc.pausarProceso(procesoId, motivo); }

  @Post('procesos/:procesoId/reanudar')
  @ApiOperation({ summary: 'Reanudar un proceso pausado' })
  reanudarProceso(@Param('procesoId', ParseIntPipe) procesoId: number) {
    return this.svc.reanudarProceso(procesoId);
  }

  @Post('procesos/:procesoId/completar')
  @ApiOperation({ summary: 'Completar un proceso' })
  completarProceso(@Param('procesoId', ParseIntPipe) procesoId: number) {
    return this.svc.completarProceso(procesoId);
  }

  @Post(':id/lotes')
  @ApiOperation({ summary: 'Agregar lote manualmente a una orden' })
  agregarLote(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: any,
  ) { return this.svc.agregarLote(id, body); }

  @Get(':id/materiales-detalle')
  @ApiOperation({ summary: 'Detalle de materiales: stock vs necesario por línea' })
  materialesDetalle(@Param('id', ParseIntPipe) id: number) {
    return this.svc.getMateriasDetalle(id);
  }

  @Post(':id/devolver-materiales')
  @UseGuards(RolesGuard)
  @Roles(RolUsuario.ADMIN, RolUsuario.SUPERVISOR)
  @ApiOperation({ summary: 'Devolver materiales al inventario al cancelar orden' })
  devolverMateriales(
    @Param('id', ParseIntPipe) id: number,
    @Body('items') items: { producto_id: number; cantidad: number }[],
    @Body('devuelto_por') devueltoPor: string,
  ) { return this.svc.devolverMateriales(id, items, devueltoPor); }

  @Get(':id/reservas')
  @ApiOperation({ summary: 'Reservas de inventario de una orden' })
  reservas(@Param('id', ParseIntPipe) id: number) {
    return this.svc.getReservas(id);
  }

  @Get(':id/sugerir-ruta')
  @ApiOperation({ summary: 'Sugerir ruta basada en técnicas de la orden y plantillas configuradas' })
  sugerirRuta(@Param('id', ParseIntPipe) id: number) {
    return this.svc.sugerirRuta(id);
  }

  @Post(':id/aplicar-plantilla')
  @ApiOperation({ summary: 'Aplicar una plantilla de ruta a la orden (crea todos los lotes)' })
  aplicarPlantilla(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { pasos: Array<{ departamento: string; tipo_lote: string; orden_ejecucion: number; tipo_ejecucion: string; tareas?: { nombre: string; rol?: string }[] }>; producto: string; cantidad?: number; marcar_diseno_completo?: boolean },
  ) {
    return this.svc.aplicarPlantillaRuta(id, body.pasos, body.producto, body.cantidad, body.marcar_diseno_completo);
  }

  @Post('migraciones/lotes-cantidad')
  @ApiOperation({ summary: 'Migración: recalcular cantidad de lotes desde lineas_produccion' })
  migrarCantidadesLotes() {
    return this.svc.migrarCantidadesLotes();
  }
}
