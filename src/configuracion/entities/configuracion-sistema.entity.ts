import { Entity, PrimaryGeneratedColumn, Column, UpdateDateColumn } from 'typeorm';

@Entity('configuracion_sistema')
export class ConfiguracionSistema {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  clave: string;

  @Column({ type: 'text' })
  valor: string;

  @Column({ nullable: true })
  descripcion: string;

  @UpdateDateColumn()
  actualizado_en: Date;
}
