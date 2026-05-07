import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

@Entity('notas_recordatorio')
export class NotaRecordatorio {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'text' })
  texto: string;

  @Column()
  creado_por_id: number;

  @Column()
  creado_por_nombre: string;

  // IDs de usuarios destinatarios (vacío = solo personal)
  @Column({ type: 'json', nullable: true })
  destinatarios: number[];

  // IDs de usuarios que ya la marcaron como cumplida
  @Column({ type: 'json', nullable: true })
  cumplida_por: number[];

  // Color del post-it: amarillo | azul | rosa | verde | naranja
  @Column({ type: 'varchar', length: 20, default: 'amarillo' })
  color: string;

  @Column({ default: true })
  activa: boolean;

  @CreateDateColumn()
  creada_en: Date;
}
