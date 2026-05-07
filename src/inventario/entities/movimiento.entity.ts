import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

export enum TipoMovimiento { ENTRADA = 'entrada', SALIDA = 'salida', AJUSTE = 'ajuste' }

@Entity('movimientos_inventario')
export class Movimiento {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  producto_id: number;

  @Column({ nullable: true })
  variante_id: number;

  @Column({ type: 'enum', enum: TipoMovimiento })
  tipo: TipoMovimiento;

  @Column({ type: 'int' })
  cantidad: number;

  @Column({ nullable: true })
  referencia: string;

  @Column({ nullable: true })
  nota: string;

  @Column({ nullable: true })
  usuario_id: number;

  @CreateDateColumn()
  creado_en: Date;
}
