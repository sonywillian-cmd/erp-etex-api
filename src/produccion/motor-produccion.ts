/**
 * Motor de producción configurable.
 *
 * Funciones puras que seleccionan el flujo adecuado y generan lotes en memoria,
 * listos para persistir en base de datos.
 *
 * Convención "$tecnica":
 *   Cuando un paso tiene departamento = "$tecnica" o nombre = "$tecnica",
 *   se expande en un lote por cada técnica presente en linea.tecnica
 *   (separadas por coma). El departamento real se resuelve con TECNICA_DEPTO.
 */

import { FlujoProduccion } from './entities/flujo-produccion.entity';
import { EstadoLote, TipoLote, TipoEjecucion } from './entities/lote-produccion.entity';
import { TipoProducto } from '../productos/entities/producto.entity';
import { SubtecnicaDef } from '../configuracion/entities/tecnica.entity';

// ─── Mapa técnica → departamento ─────────────────────────────────────────────

export const TECNICA_DEPTO: Record<string, string> = {
  'Bordado':       'Bordado',
  'DTF':           'DTF',
  'Sublimación':   'Sublimación',
  'Serigrafía':    'Serigrafía',
  'Confección':    'Costura',
  'Impresión UV':  'DTF',
  'Grabado Láser': 'Terminación',
};

// ─── Tipos públicos ───────────────────────────────────────────────────────────

export interface CriterioFlujo {
  tipo_producto:      TipoProducto | null;
  tipo_produccion:    string | null;
  /** Primera técnica de la línea (usada como criterio de matching) */
  tecnica:            string;
  incluye_aplicacion: boolean;
  incluye_confeccion: boolean;
  requiere_diseno:    boolean;
}

/** Lote construido en memoria antes de ser persistido */
export interface LoteEnMemoria {
  numero:          string;
  orden_id:        number;
  tipo_lote:       TipoLote;
  producto:        string;
  descripcion:     string;
  cantidad:        number;
  departamento:    string;
  tecnica:         string;
  tipo_ejecucion:  TipoEjecucion;
  orden_ejecucion: number;
  estado:          EstadoLote;
  lote_padre_id:   number | null;
  /** 'departamento' (default) o 'tarea' (sub-tarea del dept) */
  tipo:            'departamento' | 'tarea';
  /** Nombre de la sub-tarea. Solo aplica cuando tipo='tarea'. */
  tarea_nombre:    string | null;
  /** Condición de desbloqueo para lotes hijos de tipo='departamento' */
  desbloquear_al?: 'completado' | 'en_proceso';
  /** temp_id efectivo (original * 1000 + índice si el paso es dinámico) */
  _temp_id:    number;
  /** temp_id del paso padre (dept a dept); se convierte a ID real después del save */
  _depende_de: number | null;
  /**
   * temp_id del lote dept padre de esta TAREA.
   * Solo se define cuando tipo='tarea'. Se convierte a ID real en el save.
   */
  _dept_parent_temp_id?: number;
}

// ─── seleccionarFlujo ─────────────────────────────────────────────────────────

/**
 * Devuelve el flujo activo más específico que coincida con el criterio.
 *
 * "Más específico" = mayor número de campos no-null que coinciden.
 * Un campo null en el flujo actúa como comodín (acepta cualquier valor).
 */
export function seleccionarFlujo(
  flujos: FlujoProduccion[],
  criterio: CriterioFlujo,
): FlujoProduccion | null {
  let mejor: FlujoProduccion | null = null;
  let mejorScore = -1;

  for (const f of flujos) {
    if (!f.activo) continue;

    // Si el flujo especifica un valor, debe coincidir exactamente
    if (f.tipo_producto    !== null && f.tipo_producto    !== criterio.tipo_producto)    continue;
    if (f.tipo_produccion  !== null && f.tipo_produccion  !== criterio.tipo_produccion)  continue;
    if (f.tecnica          !== null && f.tecnica          !== criterio.tecnica)          continue;
    if (f.incluye_aplicacion !== null && f.incluye_aplicacion !== criterio.incluye_aplicacion) continue;
    if (f.incluye_confeccion !== null && f.incluye_confeccion !== criterio.incluye_confeccion) continue;
    if (f.requiere_diseno  !== null && f.requiere_diseno  !== criterio.requiere_diseno)  continue;

    // Contar especificidad
    const score = [
      f.tipo_producto, f.tipo_produccion, f.tecnica,
      f.incluye_aplicacion, f.incluye_confeccion, f.requiere_diseno,
    ].filter(v => v !== null).length;

    if (score > mejorScore) {
      mejorScore = score;
      mejor = f;
    }
  }

  return mejor;
}

// ─── generarLotesDesdeFlujo ───────────────────────────────────────────────────

export interface LineasMotor {
  producto:           string;
  descripcion:        string;
  /** Puede ser "DTF, Bordado" — se parte por coma al expandir */
  tecnica:            string;
  cantidad:           number;
  tipo_producto:      TipoProducto | null;
  requiere_diseno:    boolean;
  incluye_aplicacion: boolean;
  incluye_confeccion: boolean;
}

export function generarLotesDesdeFlujo(params: {
  flujo:        FlujoProduccion;
  ordenId:      number;
  ordenNumero:  string;
  seqInicial:   number;
  linea:        LineasMotor;
  /** Mapa nombre-técnica → subtécnicas configuradas */
  tecnicasMap?: Map<string, SubtecnicaDef[]>;
}): { lotes: LoteEnMemoria[]; nextSeq: number } {
  const { flujo, ordenId, ordenNumero, seqInicial, linea, tecnicasMap } = params;

  const tecnicas = linea.tecnica
    ? [...new Set(linea.tecnica.split(',').map(t => t.trim()).filter(Boolean))]
    : [''];

  const lotes: LoteEnMemoria[] = [];
  let seq = seqInicial;

  /**
   * Mapa: temp_id_original → lista de temp_ids efectivos.
   * Necesario para resolver depende_de cuando un paso se expande en varios lotes.
   */
  const tempIdMap = new Map<number, number[]>();

  // Primera pasada: calcular qué temp_ids existen tras la expansión
  for (const paso of flujo.estructura_json.pasos) {
    if (paso.condicional && !(linea as unknown as Record<string, unknown>)[paso.condicional]) continue;

    const esDinamico = paso.departamento === '$tecnica' || paso.nombre === '$tecnica';
    if (esDinamico) {
      tempIdMap.set(paso.temp_id, tecnicas.map((_, i) => paso.temp_id * 1000 + i));
    } else {
      tempIdMap.set(paso.temp_id, [paso.temp_id]);
    }
  }

  // Segunda pasada: generar lotes
  for (const paso of flujo.estructura_json.pasos) {
    if (paso.condicional && !(linea as unknown as Record<string, unknown>)[paso.condicional]) continue;

    const esDinamico = paso.departamento === '$tecnica' || paso.nombre === '$tecnica';

    // temp_id efectivo(s) del paso padre, para resolver depende_de
    // Normalizar: la BD puede guardar number O number[] por el JSON dinámico
    const dependeDeRaw = paso.depende_de as unknown;
    const dependeDeNum: number | null = dependeDeRaw === null || dependeDeRaw === undefined
      ? null
      : Array.isArray(dependeDeRaw)
        ? (dependeDeRaw as number[])[0] ?? null
        : (dependeDeRaw as number);
    const padreEfectivos = dependeDeNum !== null
      ? (tempIdMap.get(dependeDeNum) ?? null)
      : null;
    // El lote hijo depende del último efectivo del padre
    const padreEfectivo = padreEfectivos ? padreEfectivos[padreEfectivos.length - 1] : null;

    if (esDinamico) {
      tecnicas.forEach((tec, i) => {
        const depto = TECNICA_DEPTO[tec] ?? tec ?? 'Producción';
        const estadoInicial = padreEfectivo !== null ? EstadoLote.PENDIENTE : EstadoLote.DESBLOQUEADO;
        const deptTempId    = paso.temp_id * 1000 + i;

        // Lote departamento
        lotes.push({
          numero:          `${ordenNumero}-L${seq}`,
          orden_id:        ordenId,
          tipo_lote:       paso.tipo_lote as TipoLote,
          producto:        linea.producto,
          descripcion:     linea.descripcion,
          cantidad:        linea.cantidad,
          departamento:    depto,
          tecnica:         tec,
          tipo_ejecucion:  paso.tipo_ejecucion as TipoEjecucion,
          orden_ejecucion: paso.orden_ejecucion,
          estado:          estadoInicial,
          lote_padre_id:   null,
          tipo:            'departamento',
          tarea_nombre:    null,
          desbloquear_al:  (paso.desbloquear_al ?? 'completado') as 'completado' | 'en_proceso',
          _temp_id:        deptTempId,
          _depende_de:     padreEfectivo,
        });
        seq++;

        // Sub-tareas: primero desde técnica, luego desde flujo como fallback
        const subtecnicas = (tecnicasMap?.get(tec) ?? paso.tareas ?? []);
        if (subtecnicas.length > 0) {
          subtecnicas.forEach((tarea, ti) => {
            lotes.push({
              numero:               `${ordenNumero}-L${seq}`,
              orden_id:             ordenId,
              tipo_lote:            paso.tipo_lote as TipoLote,
              producto:             linea.producto,
              descripcion:          linea.descripcion,
              cantidad:             linea.cantidad,
              departamento:         depto,
              tecnica:              tec,
              tipo_ejecucion:       paso.tipo_ejecucion as TipoEjecucion,
              orden_ejecucion:      paso.orden_ejecucion,
              estado:               estadoInicial,
              lote_padre_id:        null,
              tipo:                 'tarea',
              tarea_nombre:         tarea.nombre,
              _temp_id:             deptTempId * 100000 + ti,
              _depende_de:          null,
              _dept_parent_temp_id: deptTempId,
            });
            seq++;
          });
        }
      });
    } else {
      const estadoInicial = padreEfectivo !== null ? EstadoLote.PENDIENTE : EstadoLote.DESBLOQUEADO;
      const deptTempId    = paso.temp_id;

      // Lote departamento
      lotes.push({
        numero:          `${ordenNumero}-L${seq}`,
        orden_id:        ordenId,
        tipo_lote:       paso.tipo_lote as TipoLote,
        producto:        linea.producto,
        descripcion:     linea.descripcion,
        cantidad:        linea.cantidad,
        departamento:    paso.departamento,
        tecnica:         paso.nombre,
        tipo_ejecucion:  paso.tipo_ejecucion as TipoEjecucion,
        orden_ejecucion: paso.orden_ejecucion,
        estado:          estadoInicial,
        lote_padre_id:   null,
        tipo:            'departamento',
        tarea_nombre:    null,
        desbloquear_al:  (paso.desbloquear_al ?? 'completado') as 'completado' | 'en_proceso',
        _temp_id:        deptTempId,
        _depende_de:     padreEfectivo,
      });
      seq++;

      // Sub-tareas: primero desde técnica, luego desde flujo como fallback
      const subtecnicasFijas = (tecnicasMap?.get(paso.nombre) ?? tecnicasMap?.get(paso.departamento) ?? paso.tareas ?? []);
      if (subtecnicasFijas.length > 0) {
        subtecnicasFijas.forEach((tarea, ti) => {
          lotes.push({
            numero:               `${ordenNumero}-L${seq}`,
            orden_id:             ordenId,
            tipo_lote:            paso.tipo_lote as TipoLote,
            producto:             linea.producto,
            descripcion:          linea.descripcion,
            cantidad:             linea.cantidad,
            departamento:         paso.departamento,
            tecnica:              paso.nombre,
            tipo_ejecucion:       paso.tipo_ejecucion as TipoEjecucion,
            orden_ejecucion:      paso.orden_ejecucion,
            estado:               estadoInicial,
            lote_padre_id:        null,
            tipo:                 'tarea',
            tarea_nombre:         tarea.nombre,
            _temp_id:             deptTempId * 100000 + ti,
            _depende_de:          null,
            _dept_parent_temp_id: deptTempId,
          });
          seq++;
        });
      }
    }
  }

  return { lotes, nextSeq: seq };
}

// ─── generarLoteFallback ──────────────────────────────────────────────────────

/** Genera un lote genérico cuando ningún flujo coincide con los criterios */
export function generarLoteFallback(params: {
  ordenId:     number;
  ordenNumero: string;
  seq:         number;
  linea: {
    producto:      string;
    descripcion:   string;
    tecnica:       string;
    cantidad:      number;
    tipo_producto: TipoProducto | null;
  };
}): { lotes: LoteEnMemoria[]; nextSeq: number } {
  const { ordenId, ordenNumero, seq, linea } = params;

  const tipoLote =
    linea.tipo_producto === TipoProducto.SERVICIO         ? TipoLote.SERVICIO    :
    linea.tipo_producto === TipoProducto.FISICO_FABRICADO ? TipoLote.FABRICACION :
    TipoLote.PROCESO;

  return {
    lotes: [{
      numero:          `${ordenNumero}-L${seq}`,
      orden_id:        ordenId,
      tipo_lote:       tipoLote,
      producto:        linea.producto,
      descripcion:     linea.descripcion,
      cantidad:        linea.cantidad,
      departamento:    'Producción',
      tecnica:         linea.tecnica || '',
      tipo_ejecucion:  TipoEjecucion.PARALELO,
      orden_ejecucion: 0,
      estado:          EstadoLote.DESBLOQUEADO,
      lote_padre_id:   null,
      tipo:            'departamento' as const,
      tarea_nombre:    null,
      _temp_id:        1,
      _depende_de:     null,
    }],
    nextSeq: seq + 1,
  };
}

// ─── construirMapaTempId ──────────────────────────────────────────────────────

/**
 * Construye un mapa local temp_id → id_real para un grupo de lotes de la MISMA línea.
 * Los arrays deben estar alineados por índice (savedLotes[i] corresponde a memLotes[i]).
 */
export function construirMapaTempId(
  savedLotes: { id: number }[],
  memLotes:   LoteEnMemoria[],
): Map<number, number> {
  const map = new Map<number, number>();
  for (let i = 0; i < savedLotes.length; i++) {
    map.set(memLotes[i]._temp_id, savedLotes[i].id);
  }
  return map;
}
