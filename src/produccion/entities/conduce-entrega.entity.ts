import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

export enum TipoConduce {
  PARCIAL = 'parcial',
  TOTAL   = 'total',
}

export interface ConduceItem {
  linea_idx:             number;
  producto:              string;
  descripcion:           string;
  tecnica:               string;
  cantidad_pedida:       number;
  cantidad_ya_entregada: number;
  cantidad_entregada:    number;
}

@Entity('conduces_entrega')
export class ConduceEntrega {
  @PrimaryGeneratedColumn()
  id: number;

  /** CD-2026-001 — numeración global secuencial */
  @Column({ unique: true })
  numero: string;

  @Column()
  orden_id: number;

  /** OP-2026-002 — desnormalizado para el documento impreso */
  @Column()
  orden_numero: string;

  @Column({ type: 'enum', enum: TipoConduce, default: TipoConduce.TOTAL })
  tipo: TipoConduce;

  @Column({ type: 'datetime' })
  fecha: Date;

  @Column({ nullable: true })
  entregado_por: string;

  @Column({ nullable: true })
  recibido_por: string;

  @Column({ type: 'json' })
  items: ConduceItem[];

  @Column({ nullable: true, type: 'text' })
  notas: string;

  @CreateDateColumn()
  creado_en: Date;
}
