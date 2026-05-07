import {
  Entity, PrimaryGeneratedColumn, Column,
  CreateDateColumn, UpdateDateColumn, Unique,
} from 'typeorm';

/**
 * Configuración de incentivo POR EMPLEADO POR DEPARTAMENTO.
 * John puede tener Serigrafía con meta=300 y Sublimación con meta=250,
 * cada una con sus propios precios por complejidad.
 */
@Entity('incentivos_empleado')
@Unique(['usuario_id', 'departamento'])
export class IncentivosEmpleado {
  @PrimaryGeneratedColumn()
  id: number;

  /** ID del usuario (FK lógica a usuarios.id) */
  @Column()
  usuario_id: number;

  /** Nombre del usuario — desnormalizado para queries rápidas sin JOIN */
  @Column({ length: 200 })
  usuario_nombre: string;

  /** Departamento al que aplica este incentivo */
  @Column({ length: 100 })
  departamento: string;

  /** ¿Incentivo activo para este empleado en este departamento? */
  @Column({ default: true })
  activo: boolean;

  /**
   * Meta de piezas por período.
   * El período (semanal/quincenal) se toma de usuarios.periodo_pago.
   */
  @Column({ type: 'int' })
  meta: number;

  /**
   * Precios por complejidad:
   * { exenta: 0, sencilla: 8.00, mediana: 15.00, avanzada: 25.00 }
   * exenta = trabajo sin incentivo (precio 0)
   */
  @Column({ type: 'json' })
  precios: { exenta: number; sencilla: number; mediana: number; avanzada: number };

  /** Fecha desde la que aplica este incentivo */
  @Column({ type: 'date', nullable: true })
  fecha_inicio: string | null;

  /** Nota interna del admin */
  @Column({ type: 'text', nullable: true })
  notas: string | null;

  @CreateDateColumn()
  creado_en: Date;

  @UpdateDateColumn()
  actualizado_en: Date;
}
