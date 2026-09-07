import { Module } from '@nestjs/common';
import { ExportacionService } from './exportacion.service';
import { ExportacionController } from './exportacion.controller';

@Module({
  providers:   [ExportacionService],
  controllers: [ExportacionController],
})
export class ExportacionModule {}
