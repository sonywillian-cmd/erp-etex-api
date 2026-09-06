import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

/**
 * Códigos temporales de vinculación. El usuario genera uno desde el ERP web,
 * lo ingresa en el bot, y se intercambia por una fila en `telegram_usuarios`.
 */
@Entity('telegram_codigos')
export class TelegramCodigo {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', length: 10, unique: true })
  codigo: string;

  @Column({ type: 'int' })
  usuario_id: number;

  @Column({ type: 'datetime' })
  expira_en: Date;

  @Column({ type: 'tinyint', default: 0 })
  usado: number;

  @CreateDateColumn()
  creado_en: Date;
}
