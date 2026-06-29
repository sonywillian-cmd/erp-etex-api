import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn,
} from 'typeorm';
import { TipoProducto, TipoProduccion } from '../../productos/entities/producto.entity';

/** Sub-tarea dentro de un paso de flujo (ej: "Diseño", "Bordado en máquina") */
export interface TareaFlujo {
  nombre: string;
  /** Rol sugerido para la asignación: 'diseñador', 'operario', 'terminador', etc. */
  rol?: string;
  descripcion?: string;
  /**
   * Departamento específico para este sub-tarea.
   * Si se omite, hereda el departamento del paso padre.
   * Permite que cada sub-tarea aparezca solo a los empleados del departamento correcto
   * en su vista de mis-tareas (ej: "Diseño" → "DISEÑO BORDADO", "Bordado en máquina" → "BORDADO").
   */
  departamento?: string;
}

/** Un paso dentro del JSON de flujo */
export interface PasoFlujo {
  /** Identificador temporal para resolver dependencias en memoria */
  temp_id: number;
  nombre: string;
  departamento: string;
  tipo_lote: 'fabricacion' | 'proceso' | 'servicio';
  tipo_ejecucion: 'paralelo' | 'secuencial';
  orden_ejecucion: number;
  /** temp_id del paso padre (null = sin dependencia) */
  depende_de: number | null;
  /** Nombre de la condición que activa este paso. Si la condición es false, se omite el paso.
   *  Valores soportados: 'requiere_diseno' | 'incluye_aplicacion' | 'incluye_confeccion'
   */
  condicional?: string | null;
  /**
   * Sub-tareas del departamento.
   * Si se define, se crean lotes hijo (tipo='tarea') para cada sub-tarea.
   * El lote padre (tipo='departamento') se gestiona automáticamente.
   */
  tareas?: TareaFlujo[];
  /**
   * Condición de desbloqueo del lote siguiente.
   * 'completado' (default): el hijo se desbloquea al completar este paso.
   * 'en_proceso': el hijo se desbloquea en cuanto este paso inicia.
   */
  desbloquear_al?: 'completado' | 'en_proceso';
}

export interface EstructuraFlujo {
  pasos: PasoFlujo[];
}

/**
 * Flujo de producción configurable.
 * Define la secuencia de lotes que se generan para un tipo de producto + técnica.
 *
 * Campos de matching (null = "cualquiera"):
 *   tipo_producto    → TipoProducto enum
 *   tipo_produccion  → TipoProduccion enum
 *   tecnica          → nombre exacto de la técnica
 *   incluye_aplicacion / incluye_confeccion → filtros adicionales
 *
 * Selección: se elige el flujo activo con mayor número de campos no-null que coincidan.
 */
@Entity('flujos_produccion')
export class FlujoProduccion {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ length: 100 })
  nombre: string;

  /** null = aplica a cualquier tipo de producto */
  @Column({ type: 'varchar', length: 50, nullable: true, default: null })
  tipo_producto: TipoProducto | null;

  /** null = aplica a cualquier tipo de producción */
  @Column({ type: 'varchar', length: 50, nullable: true, default: null })
  tipo_produccion: TipoProduccion | null;

  /** null = aplica a cualquier técnica */
  @Column({ type: 'varchar', length: 100, nullable: true, default: null })
  tecnica: string | null;

  /** null = no se evalúa este criterio */
  @Column({ type: 'tinyint', nullable: true, default: null })
  incluye_aplicacion: boolean | null;

  /** null = no se evalúa este criterio */
  @Column({ type: 'tinyint', nullable: true, default: null })
  incluye_confeccion: boolean | null;

  /** null = no se evalúa este criterio */
  @Column({ type: 'tinyint', nullable: true, default: null })
  requiere_diseno: boolean | null;

  @Column({ type: 'json' })
  estructura_json: EstructuraFlujo;

  @Column({ default: true })
  activo: boolean;

  @CreateDateColumn()
  creado_en: Date;

  @UpdateDateColumn()
  actualizado_en: Date;
}
