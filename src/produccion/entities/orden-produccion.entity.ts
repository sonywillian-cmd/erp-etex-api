import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';
import { ComplejidadOrden } from '../../incentivos/entities/incentivo-config.entity';

export { ComplejidadOrden };

export enum EstadoOrden {
  PENDIENTE      = 'pendiente',
  EN_DISENO      = 'en_diseno',
  EN_PRODUCCION  = 'en_produccion',
  EN_TERMINACION = 'en_terminacion',
  ATRASO         = 'atraso',
  LISTO          = 'listo',
  LISTO_PARCIAL  = 'listo_parcial',
  ENTREGADO      = 'entregado',
}

export enum Semaforo { NORMAL = 'normal', ALERTA = 'alerta', CRITICO = 'critico' }

export enum EstadoProduccion {
  SIN_INICIAR = 'sin_iniciar',
  EN_PROCESO  = 'en_proceso',
  PAUSADO     = 'pausado',
  FINALIZADO  = 'finalizado',
  CANCELADA   = 'cancelada',
}

export enum EstadoMateriales {
  DISPONIBLE = 'disponible',
  PARCIAL    = 'parcial',
  EN_ESPERA  = 'en_espera',
}

@Entity('ordenes_produccion')
export class OrdenProduccion {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  numero: string;

  @Column()
  cotizacion_id: number;

  @Column()
  cliente_id: number;

  @Column({ type: 'enum', enum: EstadoOrden, default: EstadoOrden.PENDIENTE })
  estado: EstadoOrden;

  @Column({ type: 'enum', enum: Semaforo, default: Semaforo.NORMAL })
  semaforo: Semaforo;

  // Fecha original (DATE) — se mantiene por compatibilidad
  @Column({ type: 'date' })
  fecha_comprometida: Date;

  // Timestamp preciso de entrega (DATETIME) — campo principal
  @Column({ type: 'datetime', nullable: true })
  fecha_hora_entrega: Date;

  @Column({ nullable: true, type: 'text' })
  especificaciones: string;

  // Notas internas (copiadas desde la cotización y visibles a operarios)
  @Column({ nullable: true, type: 'text' })
  notas: string;

  // Líneas estructuradas copiadas desde la cotización
  @Column({ type: 'json', nullable: true })
  lineas_produccion: { producto: string; producto_id?: number; descripcion: string; tecnica: string; cantidad: number }[];

  // Trazabilidad de usuarios
  @Column({ nullable: true })
  creado_por: string;

  @Column({ nullable: true })
  convertido_por: string;

  @Column({ type: 'json', nullable: true })
  adjuntos: string[];

  // Campo legacy (tareas como JSON) — deprecado, usar tabla tareas_produccion
  @Column({ type: 'json', nullable: true })
  tareas: any;

  // ── Control de producción ──────────────────────────────────────────────────
  @Column({ type: 'enum', enum: EstadoProduccion, default: EstadoProduccion.SIN_INICIAR })
  estado_produccion: EstadoProduccion;

  @Column({ type: 'enum', enum: EstadoMateriales, default: EstadoMateriales.EN_ESPERA })
  estado_materiales: EstadoMateriales;

  @Column({ type: 'datetime', nullable: true })
  tiempo_inicio: Date;

  @Column({ type: 'datetime', nullable: true })
  tiempo_fin: Date;

  // ── Responsables ───────────────────────────────────────────────────────────
  @Column({ nullable: true })
  responsable_principal: string;

  @Column({ type: 'simple-array', nullable: true })
  responsables_secundarios: string[];

  // ── Entrega ────────────────────────────────────────────────────────────────
  @Column({ nullable: true })
  entregado_por: string;

  @Column({ type: 'datetime', nullable: true })
  fecha_entrega_real: Date;

  @Column({ nullable: true, type: 'text' })
  notas_entrega: string;

  // ── Incentivos ─────────────────────────────────────────────────────────────
  /** Complejidad del diseño/trabajo — determina precio por pieza en incentivos */
  @Column({ type: 'enum', enum: ComplejidadOrden, default: ComplejidadOrden.MEDIANA, nullable: true })
  complejidad: ComplejidadOrden;

  // ── Cancelación ────────────────────────────────────────────────────────────
  @Column({ default: false })
  cancelacion_solicitada: boolean;

  @Column({ nullable: true, type: 'text' })
  cancelacion_motivo: string;

  @Column({ nullable: true })
  cancelacion_solicitado_por: string;

  // ── NCF por defecto (establecido al convertir la cotización) ───────────────
  @Column({ nullable: true })
  tipo_ncf_default: string;

  @CreateDateColumn()
  creado_en: Date;

  @UpdateDateColumn()
  actualizado_en: Date;
}
