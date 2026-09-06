import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TelegramUsuario } from './telegram-usuario.entity';
import { TelegramCodigo } from './telegram-codigo.entity';
import { TelegramService } from './telegram.service';
import { TelegramController } from './telegram.controller';

@Module({
  imports: [TypeOrmModule.forFeature([TelegramUsuario, TelegramCodigo])],
  providers: [TelegramService],
  controllers: [TelegramController],
  exports: [TelegramService],
})
export class TelegramModule {}
