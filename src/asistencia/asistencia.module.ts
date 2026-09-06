import { Module } from '@nestjs/common';
import { AsistenciaService } from './asistencia.service';
import { AsistenciaController } from './asistencia.controller';
import { RelojesController } from './relojes.controller';

@Module({
  providers:   [AsistenciaService],
  controllers: [AsistenciaController, RelojesController],
  exports:     [AsistenciaService],
})
export class AsistenciaModule {}
