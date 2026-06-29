import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { IncentivosConfig, ComplejidadOrden, PeriodoPago } from './entities/incentivo-config.entity';
import { IncentivosEmpleado } from './entities/incentivo-empleado.entity';
import { Usuario } from '../auth/entities/usuario.entity';

// ── DTOs ──────────────────────────────────────────────────────────────────────

export interface UpsertConfigDto {
  departamento:     string;
  complejidad:      ComplejidadOrden;
  precio_por_pieza: number;
  meta_semanal:     number;
  activo?:          boolean;
}

export interface UpsertEmpleadoDto {
  usuario_id:    number;
  usuario_nombre: string;
  departamento:  string;
  activo?:       boolean;
  meta:          number;
  precios:       { exenta: number; sencilla: number; mediana: number; avanzada: number };
  fecha_inicio?: string | null;
  notas?:        string | null;
}

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class IncentivosService {
  constructor(
    @InjectRepository(IncentivosConfig)    private configRepo:    Repository<IncentivosConfig>,
    @InjectRepository(IncentivosEmpleado)  private empleadoRepo:  Repository<IncentivosEmpleado>,
    @InjectRepository(Usuario)             private usuariosRepo:  Repository<Usuario>,
    private ds: DataSource,
  ) {}

  // ══════════════════════════════════════════════════════════════════════════
  // PLANTILLAS POR DEPARTAMENTO (defaults para pre-llenar empleado)
  // ══════════════════════════════════════════════════════════════════════════

  async getConfig(): Promise<IncentivosConfig[]> {
    return this.configRepo.find({ order: { departamento: 'ASC', complejidad: 'ASC' } });
  }

  async upsertConfig(dto: UpsertConfigDto): Promise<IncentivosConfig> {
    const existing = await this.configRepo.findOne({
      where: { departamento: dto.departamento, complejidad: dto.complejidad },
    });
    if (existing) {
      await this.configRepo.update(existing.id, {
        precio_por_pieza: dto.precio_por_pieza,
        meta_semanal:     dto.meta_semanal,
        activo:           dto.activo ?? existing.activo,
      });
      return this.configRepo.findOne({ where: { id: existing.id } }) as Promise<IncentivosConfig>;
    }
    const nueva = this.configRepo.create({ ...dto, activo: dto.activo ?? true });
    return this.configRepo.save(nueva);
  }

  async deleteConfig(id: number): Promise<void> {
    await this.configRepo.delete(id);
  }

  /** Plantilla de un depto: precios y meta para pre-llenar formulario */
  async getPlantillaDepartamento(departamento: string) {
    const rows = await this.configRepo.find({
      where: { departamento, activo: true },
    });
    if (rows.length === 0) return null;
    const precios: Record<string, number> = {};
    let metaSemanal = 0;
    for (const r of rows) {
      precios[r.complejidad] = Number(r.precio_por_pieza);
      metaSemanal = r.meta_semanal; // same for all complexities in dept
    }
    return {
      meta_semanal: metaSemanal,
      precios: {
        exenta:   precios['exenta']   ?? 0,
        sencilla: precios['sencilla'] ?? 0,
        mediana:  precios['mediana']  ?? 0,
        avanzada: precios['avanzada'] ?? 0,
      },
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // INCENTIVOS POR EMPLEADO
  // ══════════════════════════════════════════════════════════════════════════

  /** Todos los registros de incentivo de un empleado */
  async getEmpleadoIncentivos(usuarioId: number): Promise<IncentivosEmpleado[]> {
    return this.empleadoRepo.find({
      where: { usuario_id: usuarioId },
      order: { departamento: 'ASC' },
    });
  }

  /** Crear o actualizar el incentivo de un empleado en un departamento */
  async upsertEmpleadoIncentivo(dto: UpsertEmpleadoDto): Promise<IncentivosEmpleado> {
    const existing = await this.empleadoRepo.findOne({
      where: { usuario_id: dto.usuario_id, departamento: dto.departamento },
    });
    if (existing) {
      await this.empleadoRepo.update(existing.id, {
        activo:       dto.activo ?? existing.activo,
        meta:         dto.meta,
        precios:      dto.precios,
        fecha_inicio: dto.fecha_inicio ?? existing.fecha_inicio,
        notas:        dto.notas ?? existing.notas,
        usuario_nombre: dto.usuario_nombre,
      });
      return this.empleadoRepo.findOne({ where: { id: existing.id } }) as Promise<IncentivosEmpleado>;
    }
    const nuevo = this.empleadoRepo.create({
      ...dto,
      activo:       dto.activo ?? true,
      fecha_inicio: dto.fecha_inicio ?? new Date().toISOString().split('T')[0],
    });
    return this.empleadoRepo.save(nuevo);
  }

  async toggleEmpleadoIncentivo(id: number, activo: boolean): Promise<IncentivosEmpleado> {
    const rec = await this.empleadoRepo.findOne({ where: { id } });
    if (!rec) throw new NotFoundException(`Incentivo #${id} no encontrado`);
    await this.empleadoRepo.update(id, { activo });
    return this.empleadoRepo.findOne({ where: { id } }) as Promise<IncentivosEmpleado>;
  }

  async deleteEmpleadoIncentivo(id: number): Promise<void> {
    await this.empleadoRepo.delete(id);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // CÁLCULO DE INCENTIVOS
  // ══════════════════════════════════════════════════════════════════════════

  private calcularPeriodo(periodoPago: PeriodoPago): { desde: string; hasta: string; label: string } {
    const hoy = new Date();
    const y = hoy.getFullYear();
    const m = hoy.getMonth();
    const d = hoy.getDate();

    if (periodoPago === PeriodoPago.SEMANAL) {
      const dow = hoy.getDay();
      const lunes = new Date(hoy);
      lunes.setDate(d - ((dow + 6) % 7));
      const domingo = new Date(lunes);
      domingo.setDate(lunes.getDate() + 6);
      return {
        desde: lunes.toISOString().split('T')[0],
        hasta: domingo.toISOString().split('T')[0],
        label: `Semana ${lunes.toLocaleDateString('es-DO', { day: '2-digit', month: 'short' })} – ${domingo.toLocaleDateString('es-DO', { day: '2-digit', month: 'short' })}`,
      };
    } else {
      if (d <= 15) {
        const fin = new Date(y, m, 15);
        return {
          desde: `${y}-${String(m + 1).padStart(2, '0')}-01`,
          hasta: fin.toISOString().split('T')[0],
          label: `1 – 15 ${hoy.toLocaleDateString('es-DO', { month: 'long', year: 'numeric' })}`,
        };
      } else {
        const finMes = new Date(y, m + 1, 0);
        return {
          desde: `${y}-${String(m + 1).padStart(2, '0')}-16`,
          hasta: finMes.toISOString().split('T')[0],
          label: `16 – ${finMes.getDate()} ${hoy.toLocaleDateString('es-DO', { month: 'long', year: 'numeric' })}`,
        };
      }
    }
  }

  /**
   * Calcula el rendimiento completo de un empleado (para el admin — incluye $$$).
   */
  async getRendimientoEmpleado(
    usuarioId: number,
    fechaDesde?: string,
    fechaHasta?: string,
  ) {
    const usuario = await this.usuariosRepo.findOne({ where: { id: usuarioId } });
    if (!usuario) throw new NotFoundException(`Usuario #${usuarioId} no encontrado`);

    const periodoPago = (usuario.periodo_pago as PeriodoPago) ?? PeriodoPago.QUINCENAL;
    const periodo     = this.calcularPeriodo(periodoPago);
    const desde       = fechaDesde ?? periodo.desde;
    const hasta       = fechaHasta ?? periodo.hasta;

    // Configs activas del empleado
    const configs = await this.empleadoRepo.find({
      where: { usuario_id: usuarioId, activo: true },
    });

    if (configs.length === 0) {
      // Sin incentivos configurados: calcular calificativo de todas formas,
      // basado solo en puntualidad (sin meta de piezas que cumplir).
      const puntualidad = await this.calcularPuntualidad(usuario.nombre, desde, hasta);
      const pctP  = puntualidad.pct_a_tiempo;
      const razon = puntualidad.total_ordenes > 0
        ? `${puntualidad.a_tiempo} de ${puntualidad.total_ordenes} ${puntualidad.total_ordenes === 1 ? 'orden' : 'órdenes'} a tiempo`
        : 'Sin órdenes este período';
      let calificativo: { letra: string; score: number; descripcion: string; razon: string };
      if (pctP >= 90)      calificativo = { letra: 'A', score: pctP, descripcion: 'Excelente',   razon };
      else if (pctP >= 75) calificativo = { letra: 'B', score: pctP, descripcion: 'Bueno',       razon };
      else if (pctP >= 55) calificativo = { letra: 'C', score: pctP, descripcion: 'Regular',     razon };
      else                 calificativo = { letra: 'D', score: pctP, descripcion: 'Por mejorar', razon };

      // Contar piezas reales por departamento (solo piezas_ok registradas explícitamente > 0)
      const piezasPorDepto: { departamento: string; total: string }[] = await this.ds.query(
        `SELECT l.departamento, COALESCE(SUM(l.piezas_ok), 0) AS total
         FROM lotes_produccion l
         WHERE l.responsable = ?
           AND l.estado = 'completado'
           AND l.piezas_ok IS NOT NULL
           AND l.piezas_ok > 0
           AND DATE(l.tiempo_fin) BETWEEN ? AND ?
         GROUP BY l.departamento`,
        [usuario.nombre, desde, hasta],
      );
      const totalPiezasSinIncentivo = piezasPorDepto.reduce((s, r) => s + Number(r.total), 0);
      const deptsSinIncentivo = piezasPorDepto.map(r => ({
        departamento:   r.departamento,
        meta:           0,
        total_piezas:   Number(r.total),
        pct_meta:       0,
        meta_alcanzada: false,
      }));

      return {
        usuario_id:       usuarioId,
        usuario_nombre:   usuario.nombre,
        periodo_pago:     periodoPago,
        periodo_label:    periodo.label,
        fecha_desde:      desde,
        fecha_hasta:      hasta,
        incentivo_activo: false,
        total_piezas:     totalPiezasSinIncentivo,
        bono_total:       0,
        calificativo,
        puntualidad,
        departamentos:    deptsSinIncentivo,
      };
    }

    // Lotes del empleado en el período, con complejidad de la orden
    const nombreEmpleado = usuario.nombre;
    const lotes: {
      departamento: string;
      complejidad:  string;
      piezas_ok:    number;
      tiempo_fin:   string;
    }[] = await this.ds.query(`
      SELECT
        l.departamento,
        COALESCE(o.complejidad, 'mediana') AS complejidad,
        CAST(COALESCE(l.piezas_ok, 0) AS UNSIGNED) AS piezas_ok,
        l.tiempo_fin
      FROM lotes_produccion l
      JOIN ordenes_produccion o ON o.id = l.orden_id
      WHERE l.responsable = ?
        AND l.estado = 'completado'
        AND l.piezas_ok IS NOT NULL
        AND l.piezas_ok > 0
        AND DATE(l.tiempo_fin) BETWEEN ? AND ?
    `, [nombreEmpleado, desde, hasta]);

    // Puntualidad
    const puntualidad = await this.calcularPuntualidad(nombreEmpleado, desde, hasta);

    // Calcular por departamento
    const deptoMap = new Map<string, IncentivosEmpleado>();
    configs.forEach(c => deptoMap.set(c.departamento, c));

    // Agrupar lotes por (departamento, complejidad)
    const piezasMap = new Map<string, Map<string, number>>();
    for (const l of lotes) {
      if (!piezasMap.has(l.departamento)) piezasMap.set(l.departamento, new Map());
      const byComp = piezasMap.get(l.departamento)!;
      byComp.set(l.complejidad, (byComp.get(l.complejidad) ?? 0) + Number(l.piezas_ok));
    }

    const factorPeriodo = periodoPago === PeriodoPago.QUINCENAL ? 2 : 1;
    let bono_total       = 0;
    let total_piezas_all = 0;
    const departamentos: any[] = [];

    for (const cfg of configs) {
      const byComp      = piezasMap.get(cfg.departamento) ?? new Map<string, number>();
      const total_piezas = [...byComp.values()].reduce((a, b) => a + b, 0);
      total_piezas_all  += total_piezas;
      const meta         = cfg.meta * factorPeriodo;
      const meta_alcanzada = meta > 0 && total_piezas >= meta;
      const pct_meta     = meta > 0 ? Math.round((total_piezas / meta) * 100) : 0;

      const desglose: any[] = [];
      let bono_depto = 0;

      for (const comp of ['exenta', 'sencilla', 'mediana', 'avanzada'] as const) {
        const piezas = byComp.get(comp) ?? 0;
        const precio = Number((cfg.precios as any)[comp] ?? 0);
        const subtotal = meta_alcanzada ? piezas * precio : 0;
        bono_depto += subtotal;
        desglose.push({ complejidad: comp, piezas, precio, subtotal, meta_alcanzada });
      }

      bono_total += bono_depto;
      departamentos.push({
        departamento:    cfg.departamento,
        meta,
        total_piezas,
        pct_meta,
        meta_alcanzada,
        bono_departamento: bono_depto,
        desglose,
        config_id: cfg.id,
      });
    }

    const pctMeta = departamentos.length > 0
      ? departamentos.reduce((s, d) => s + d.pct_meta, 0) / departamentos.length
      : 0;

    return {
      usuario_id:       usuarioId,
      usuario_nombre:   nombreEmpleado,
      periodo_pago:     periodoPago,
      periodo_label:    periodo.label,
      fecha_desde:      desde,
      fecha_hasta:      hasta,
      incentivo_activo: true,
      total_piezas:     total_piezas_all,
      bono_total,
      calificativo: (() => {
        const cal   = this.calcCalificativo(pctMeta, puntualidad.pct_a_tiempo, desde, hasta, total_piezas_all);
        const razon = puntualidad.total_ordenes > 0
          ? `${puntualidad.a_tiempo} de ${puntualidad.total_ordenes} ${puntualidad.total_ordenes === 1 ? 'orden' : 'órdenes'} a tiempo`
          : 'Sin órdenes este período';
        return { ...cal, razon };
      })(),
      puntualidad,
      departamentos,
    };
  }

  /**
   * Progreso del período actual para el widget del EMPLEADO.
   * No incluye montos — solo piezas, meta, % y si la alcanzó.
   */
  async getMiProgreso(usuarioId: number) {
    const rendimiento = await this.getRendimientoEmpleado(usuarioId);

    // Índice rápido de puntualidad por departamento
    const puntByDept = new Map<string, any>(
      (rendimiento.puntualidad?.por_departamento ?? []).map((d: any) => [d.departamento, d]),
    );

    return {
      incentivo_activo:  rendimiento.incentivo_activo,
      periodo_label:     rendimiento.periodo_label,
      periodo_pago:      rendimiento.periodo_pago,
      calificativo:      rendimiento.calificativo,
      total_piezas:      rendimiento.total_piezas,
      total_ordenes:     rendimiento.puntualidad?.total_ordenes ?? 0,
      ordenes_a_tiempo:  rendimiento.puntualidad?.a_tiempo      ?? 0,
      departamentos:     rendimiento.departamentos.map((d: any) => {
        const pt = puntByDept.get(d.departamento);
        return {
          departamento:     d.departamento,
          meta:             d.meta,
          total_piezas:     d.total_piezas,
          pct_meta:         d.pct_meta,
          meta_alcanzada:   d.meta_alcanzada,
          total_ordenes:    pt?.total_ordenes ?? 0,
          ordenes_a_tiempo: pt?.a_tiempo      ?? 0,
          pct_a_tiempo:     pt?.pct_a_tiempo  ?? 100,
          // Sin bono — el empleado no ve el dinero
        };
      }),
    };
  }

  /**
   * Resumen de todos los empleados con incentivo activo (para el admin).
   */
  async getResumenTodos(params: {
    departamento?: string;
    fechaDesde?:   string;
    fechaHasta?:   string;
  } = {}) {
    let qb = this.empleadoRepo
      .createQueryBuilder('ie')
      .where('ie.activo = true')
      .select('DISTINCT ie.usuario_id', 'usuario_id');

    if (params.departamento) {
      qb = qb.andWhere('ie.departamento = :dept', { dept: params.departamento });
    }

    const rows: { usuario_id: number }[] = await qb.getRawMany();
    const resultados = await Promise.all(
      rows.map(r => this.getRendimientoEmpleado(r.usuario_id, params.fechaDesde, params.fechaHasta)),
    );
    return resultados
      .filter(r => r.incentivo_activo)
      .sort((a, b) => b.bono_total - a.bono_total);
  }

  private async calcularPuntualidad(responsable: string, desde: string, hasta: string) {
    // Agregado global
    const rows: { total: number; a_tiempo: number }[] = await this.ds.query(`
      SELECT
        COUNT(DISTINCT l.orden_id)                                         AS total,
        SUM(CASE
          WHEN o.fecha_hora_entrega IS NULL THEN 1
          WHEN l.tiempo_fin <= o.fecha_hora_entrega THEN 1
          ELSE 0
        END)                                                               AS a_tiempo
      FROM lotes_produccion l
      JOIN ordenes_produccion o ON o.id = l.orden_id
      WHERE l.responsable = ?
        AND l.estado = 'completado'
        AND DATE(l.tiempo_fin) BETWEEN ? AND ?
    `, [responsable, desde, hasta]);

    // Desglose por departamento
    const rowsDept: { departamento: string; total: number; a_tiempo: number }[] =
      await this.ds.query(`
        SELECT
          l.departamento,
          COUNT(DISTINCT l.orden_id)                                       AS total,
          SUM(CASE
            WHEN o.fecha_hora_entrega IS NULL THEN 1
            WHEN l.tiempo_fin <= o.fecha_hora_entrega THEN 1
            ELSE 0
          END)                                                             AS a_tiempo
        FROM lotes_produccion l
        JOIN ordenes_produccion o ON o.id = l.orden_id
        WHERE l.responsable = ?
          AND l.estado = 'completado'
          AND DATE(l.tiempo_fin) BETWEEN ? AND ?
        GROUP BY l.departamento
      `, [responsable, desde, hasta]);

    const total    = Number(rows[0]?.total    ?? 0);
    const a_tiempo = Number(rows[0]?.a_tiempo ?? 0);

    return {
      total_ordenes: total,
      a_tiempo,
      tarde:         total - a_tiempo,
      pct_a_tiempo:  total > 0 ? Math.round((a_tiempo / total) * 100) : 100,
      por_departamento: rowsDept.map(r => {
        const tot = Number(r.total    ?? 0);
        const at  = Number(r.a_tiempo ?? 0);
        return {
          departamento:  r.departamento,
          total_ordenes: tot,
          a_tiempo:      at,
          tarde:         tot - at,
          pct_a_tiempo:  tot > 0 ? Math.round((at / tot) * 100) : 100,
        };
      }),
    };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // HISTORIAL DE RENDIMIENTO (empleado — sin montos)
  // ══════════════════════════════════════════════════════════════════════════

  async getMiHistorial(usuarioId: number) {
    const usuario = await this.usuariosRepo.findOne({ where: { id: usuarioId } });
    if (!usuario) throw new NotFoundException(`Usuario #${usuarioId} no encontrado`);

    const periodoPago = (usuario.periodo_pago as PeriodoPago) ?? PeriodoPago.QUINCENAL;
    const nombre = usuario.nombre;

    // 1. Gráfica diaria — últimos 30 días
    const graficaRaw: { fecha: string; total: number; a_tiempo: number }[] =
      await this.ds.query(`
        SELECT
          DATE(l.tiempo_fin)       AS fecha,
          COUNT(DISTINCT l.orden_id) AS total,
          SUM(CASE
            WHEN o.fecha_hora_entrega IS NULL THEN 1
            WHEN l.tiempo_fin <= o.fecha_hora_entrega THEN 1
            ELSE 0
          END)                     AS a_tiempo
        FROM lotes_produccion l
        JOIN ordenes_produccion o ON o.id = l.orden_id
        WHERE l.responsable = ?
          AND l.estado = 'completado'
          AND DATE(l.tiempo_fin) >= DATE_SUB(CONVERT_TZ(NOW(), '+00:00', '-04:00'), INTERVAL 30 DAY)
        GROUP BY DATE(l.tiempo_fin)
        ORDER BY fecha ASC
      `, [nombre]);

    const grafica = graficaRaw.map(r => ({
      fecha:    r.fecha,
      pct:      Number(r.total) > 0 ? Math.round((Number(r.a_tiempo) / Number(r.total)) * 100) : 0,
      total:    Number(r.total),
      a_tiempo: Number(r.a_tiempo),
    }));

    const promedio30d = grafica.length > 0
      ? Math.round(grafica.reduce((s, d) => s + d.pct, 0) / grafica.length)
      : 100;

    // 2. Resumen del período actual
    const periodoActual = this.calcularPeriodo(periodoPago);
    const punt = await this.calcularPuntualidad(nombre, periodoActual.desde, periodoActual.hasta);

    const pendientesRows: { total: string }[] = await this.ds.query(`
      SELECT COUNT(DISTINCT l.orden_id) AS total
      FROM lotes_produccion l
      WHERE l.responsable = ?
        AND l.estado NOT IN ('completado', 'cancelado')
    `, [nombre]);
    const pendientes = Number(pendientesRows[0]?.total ?? 0);

    const pct = punt.pct_a_tiempo;
    const resumen = {
      a_tiempo:  punt.a_tiempo,
      atrasadas: punt.tarde,
      pendientes,
      total:     punt.total_ordenes + pendientes,
      pct,
    };

    const mensaje =
      pct >= 90 ? '¡Excelente trabajo! Mantén este ritmo.' :
      pct >= 75 ? '¡Vas por buen camino! Sigue así para mejorar tu calificación.' :
      pct >= 55 ? 'Puedes mejorar. Intenta completar las órdenes a tiempo.' :
                  'Necesitas mejorar tu puntualidad. Habla con tu supervisor.';

    // 3. Historial — últimos 5 períodos anteriores
    const periodosAnt = this.generarPeriodosAnteriores(periodoPago, 5);
    const historial = await Promise.all(
      periodosAnt.map(async per => {
        const p2 = await this.calcularPuntualidad(nombre, per.desde, per.hasta);
        const s   = p2.pct_a_tiempo;
        const letra       = s >= 90 ? 'A' : s >= 75 ? 'B' : s >= 55 ? 'C' : 'D';
        const descripcion = s >= 90 ? 'Excelente' : s >= 75 ? 'Bueno' : s >= 55 ? 'Regular' : 'Por mejorar';
        return { ...per, letra, descripcion, score: s, ordenes: p2.total_ordenes };
      }),
    );

    return { grafica, promedio_30d: promedio30d, resumen, mensaje, historial, periodo_actual: periodoActual };
  }

  private generarPeriodosAnteriores(
    periodoPago: PeriodoPago,
    n: number,
  ): Array<{ desde: string; hasta: string; label: string }> {
    const periodos: Array<{ desde: string; hasta: string; label: string }> = [];
    const hoy  = new Date();
    let year   = hoy.getFullYear();
    let month  = hoy.getMonth(); // 0-indexed
    const dia  = hoy.getDate();

    if (periodoPago === PeriodoPago.QUINCENAL) {
      let enSegundaQuincena = dia > 15;

      for (let i = 0; i < n; i++) {
        if (enSegundaQuincena) {
          // Período anterior: primera quincena del mismo mes
          const mm    = String(month + 1).padStart(2, '0');
          const desde = `${year}-${mm}-01`;
          const hasta = `${year}-${mm}-15`;
          const mn    = new Date(year, month, 1).toLocaleDateString('es-DO', { month: 'short' });
          periodos.push({ desde, hasta, label: `1 – 15 ${mn}` });
          enSegundaQuincena = false;
        } else {
          // Período anterior: segunda quincena del mes anterior
          month--;
          if (month < 0) { month = 11; year--; }
          const lastDay = new Date(year, month + 1, 0).getDate();
          const mm      = String(month + 1).padStart(2, '0');
          const desde   = `${year}-${mm}-16`;
          const hasta   = `${year}-${mm}-${String(lastDay).padStart(2, '0')}`;
          const mn      = new Date(year, month, 1).toLocaleDateString('es-DO', { month: 'short' });
          periodos.push({ desde, hasta, label: `16 – ${lastDay} ${mn}` });
          enSegundaQuincena = true;
        }
      }
    } else {
      // Semanal: ir hacia atrás semana a semana
      const dow   = hoy.getDay();
      const lunes = new Date(hoy);
      lunes.setDate(dia - ((dow + 6) % 7));

      for (let i = 0; i < n; i++) {
        lunes.setDate(lunes.getDate() - 7);
        const dom   = new Date(lunes);
        dom.setDate(lunes.getDate() + 6);
        const desde = lunes.toISOString().split('T')[0];
        const hasta = dom.toISOString().split('T')[0];
        const label = `${lunes.toLocaleDateString('es-DO', { day: '2-digit', month: 'short' })} – ${dom.toLocaleDateString('es-DO', { day: '2-digit', month: 'short' })}`;
        periodos.push({ desde, hasta, label });
      }
    }

    return periodos;
  }

  private calcCalificativo(
    pctMeta:       number,
    pctPuntualidad: number,
    desde:         string,
    hasta:         string,
    totalPiezas:   number,
  ): { letra: string; score: number; descripcion: string } {
    // Sin producción registrada → todos arrancan en A
    if (totalPiezas === 0) {
      return { letra: 'A', score: 100, descripcion: 'Excelente' };
    }

    // Fracción del período ya transcurrida (0 = primer día, 1 = último día)
    const hoy           = new Date();
    const inicio        = new Date(desde);
    const fin           = new Date(hasta);
    const diasTotales   = Math.max(1, (fin.getTime() - inicio.getTime()) / 86400000);
    const diasPasados   = Math.min(diasTotales, Math.max(0, (hoy.getTime() - inicio.getTime()) / 86400000));
    const fraccion      = diasPasados / diasTotales;

    // Ritmo: comparar avance real vs avance esperado en este punto del período.
    // Si van a la par → ritmo 100. Si van retrasados → ritmo < 100.
    const pctEsperado = fraccion * 100; // % de la meta que deberían tener ya
    const ritmo = pctEsperado > 0
      ? Math.min((pctMeta / pctEsperado) * 100, 100)
      : 100; // inicio del período → todo en orden

    const score = Math.round(ritmo * 0.7 + pctPuntualidad * 0.3);

    if (score >= 90) return { letra: 'A', score, descripcion: 'Excelente' };
    if (score >= 75) return { letra: 'B', score, descripcion: 'Bueno' };
    if (score >= 55) return { letra: 'C', score, descripcion: 'Regular' };
    return { letra: 'D', score, descripcion: 'Por mejorar' };
  }
}
