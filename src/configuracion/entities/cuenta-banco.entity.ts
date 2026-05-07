import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

@Entity('cuentas_banco')
export class CuentaBanco {
  @PrimaryGeneratedColumn()
  id: number;

  /** Nombre del banco: "Banco Popular", "BHD León", etc. */
  @Column()
  banco: string;

  /** Últimos 4 dígitos de la cuenta */
  @Column({ length: 4 })
  digitos: string;

  /** Tipo de cuenta */
  @Column({ default: 'corriente' })
  tipo_cuenta: string; // corriente | ahorros

  /** Nombre del titular */
  @Column({ nullable: true })
  titular: string;

  /** Alias corto para mostrar en listas */
  @Column({ nullable: true })
  alias: string;

  @Column({ default: true })
  activo: boolean;

  @CreateDateColumn()
  creado_en: Date;

  @UpdateDateColumn()
  actualizado_en: Date;
}
