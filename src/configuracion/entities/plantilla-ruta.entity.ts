import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

export interface TareaPlantilla {
  nombre: string;
  rol?: string;
}

export interface PlantillaPaso {
  departamento: string;
  tipo_lote: 'fabricacion' | 'proceso' | 'servicio';
  orden_ejecucion: number;   // steps with same number = parallel
  tipo_ejecucion: 'paralelo' | 'secuencial';
  tareas?: TareaPlantilla[];
}

@Entity('plantillas_ruta')
export class PlantillaRuta {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  nombre: string;

  @Column({ nullable: true, type: 'varchar', length: 255 })
  descripcion: string;

  @Column({ type: 'json' })
  pasos: PlantillaPaso[];

  @Column({ default: true })
  activo: boolean;

  @CreateDateColumn()
  creado_en: Date;

  @UpdateDateColumn()
  actualizado_en: Date;
}
