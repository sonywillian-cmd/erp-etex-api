import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export enum EstadoLote {
  PENDIENTE    = 'pendiente',    // bloqueado, esperando lote padre
  DESBLOQUEADO = 'desbloqueado', // disponible para iniciar
  EN_PROCESO   = 'en_proceso',
  COMPLETADO   = 'completado',
  CANCELADO    = 'cancelado',
}

export enum TipoLote {
  FABRICACION = 'fabricacion', // confección desde cero
  PROCESO     = 'proceso',     // personalización sobre existente
  SERVICIO    = 'servicio',    // el cliente trae las piezas
}

export enum TipoEjecucion {
  PARALELO    = 'paralelo',    // puede correr junto a otros lotes del mismo producto
  SECUENCIAL  = 'secuencial',  // debe esperar a que su lote_padre_id esté completado
}

@Entity('lotes_produccion')
export class LoteProduccion {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  numero: string; // ej: OP-2024-001-L1

  @Column()
  orden_id: number;

  @Column({ type: 'enum', enum: TipoLote })
  tipo_lote: TipoLote;

  @Column()
  producto: string;

  @Column({ nullable: true })
  descripcion: string;

  @Column({ type: 'decimal', precision: 10, scale: 2, default: 1 })
  cantidad: number;

  // Decoraciones aplicadas por prenda (bordado pecho + manga = 2, serigrafía
  // frente + atrás = 2, etc.). Total producido por el operario = piezas_ok ×
  // aplicaciones_por_pieza. Default 1 (una sola aplicación).
  @Column({ type: 'int', default: 1 })
  aplicaciones_por_pieza: number;

  @Column({ nullable: true })
  departamento: string;

  @Column({ nullable: true })
  tecnica: string;

  @Column({ type: 'enum', enum: TipoEjecucion, default: TipoEjecucion.PARALELO })
  tipo_ejecucion: TipoEjecucion;

  @Column({ type: 'int', default: 0 })
  orden_ejecucion: number;

  // Si tiene padre, este lote no se desbloquea hasta que el padre esté completado
  @Column({ nullable: true, type: 'int' })
  lote_padre_id: number | null;

  @Column({ type: 'enum', enum: EstadoLote, default: EstadoLote.DESBLOQUEADO })
  estado: EstadoLote;

  @Column({ nullable: true })
  responsable: string;

  /** Múltiples responsables (nombres de usuarios registrados) */
  @Column({ type: 'json', nullable: true })
  responsables: string[] | null;

  /**
   * Índices de las líneas de la orden asignadas a este (sub)lote cuando se
   * divide un lote "por producto/línea". Permite saber qué prendas concretas
   * trabajó cada operario. Null = el lote cubre todas las líneas del producto.
   */
  @Column({ type: 'json', nullable: true })
  lineas_asignadas: number[] | null;

  /** Máquina o puesto asignado para este lote */
  @Column({ nullable: true, type: 'varchar', length: 100 })
  maquina: string | null;

  @Column({ nullable: true, type: 'text' })
  notas: string;

  // ── Firma de recepción de materiales (confirmado por el operario) ──────────
  @Column({ type: 'decimal', precision: 10, scale: 2, nullable: true })
  cantidad_confirmada: number | null;

  @Column({ nullable: true })
  confirmado_por: string | null;

  @Column({ type: 'datetime', nullable: true })
  confirmado_en: Date | null;

  @Column({ nullable: true, type: 'text' })
  notas_recepcion: string | null;

  @Column({ type: 'datetime', nullable: true })
  tiempo_inicio: Date | null;

  @Column({ type: 'datetime', nullable: true })
  tiempo_fin: Date | null;

  /** Checkpoints completados del departamento para este lote */
  @Column({ type: 'json', nullable: true })
  checkpoints_completados: string[] | null;

  /** Pausas del operario en este lote: [{motivo, inicio, fin}] */
  @Column({ type: 'json', nullable: true })
  pausas_lote: { motivo: string; inicio: string; fin: string | null }[] | null;

  /**
   * Condición para desbloquear el lote hijo que depende de éste.
   * 'completado' (default): el hijo se desbloquea al completar este lote.
   * 'en_proceso': el hijo se desbloquea en cuanto este lote inicia.
   */
  @Column({ type: 'varchar', length: 20, default: 'completado' })
  desbloquear_al: 'completado' | 'en_proceso';

  /**
   * Tipo de lote:
   * 'departamento' (default): lote que representa el trabajo completo de un departamento.
   * 'tarea': sub-tarea dentro de un departamento (ej: "Diseño", "Bordado en máquina").
   *   lote_padre_id apunta al lote 'departamento' padre.
   */
  @Column({ type: 'varchar', length: 20, default: 'departamento' })
  tipo: 'departamento' | 'tarea';

  /** Nombre de la tarea (solo para tipo='tarea'). Ej: "Diseño", "Bordado en máquina". */
  @Column({ type: 'varchar', length: 100, nullable: true })
  tarea_nombre: string | null;

  // ── Calidad — capturada al completar el lote ───────────────────────────────
  @Column({ type: 'int', nullable: true })
  piezas_ok: number | null;

  @Column({ type: 'int', nullable: true })
  piezas_retrabajo: number | null;

  @Column({ type: 'int', nullable: true })
  piezas_descarte: number | null;

  @CreateDateColumn()
  creado_en: Date;

  @UpdateDateColumn()
  actualizado_en: Date;
}
