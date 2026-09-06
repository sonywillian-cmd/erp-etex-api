import { Entity, PrimaryColumn, Column, CreateDateColumn, UpdateDateColumn } from 'typeorm';

/**
 * Vinculación efectiva entre un chat de Telegram y un usuario del ERP.
 * Un chat = un usuario. La PK es el chat_id (BIGINT como string para evitar overflow).
 */
@Entity('telegram_usuarios')
export class TelegramUsuario {
  @PrimaryColumn({ type: 'bigint' })
  chat_id: string;

  @Column({ type: 'int' })
  usuario_id: number;

  // Cacheamos el nombre para evitar JOIN en cada mensaje del bot
  @Column({ type: 'varchar', length: 150 })
  usuario_nombre: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  telegram_username: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  telegram_first_name: string | null;

  @CreateDateColumn()
  vinculado_en: Date;

  @UpdateDateColumn()
  actualizado_en: Date;
}
