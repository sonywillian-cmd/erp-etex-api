import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MetricasService }            from './metricas.service';
import { MetricasController }         from './metricas.controller';
import { RegistroTiempoOperario }     from './entities/registro-tiempo-operario.entity';
import { LeadTimeProveedor }          from './entities/lead-time-proveedor.entity';

@Module({
  imports: [TypeOrmModule.forFeature([RegistroTiempoOperario, LeadTimeProveedor])],
  providers:   [MetricasService],
  controllers: [MetricasController],
  exports:     [MetricasService],
})
export class MetricasModule {}
