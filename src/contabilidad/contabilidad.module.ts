import { Module } from '@nestjs/common';
import { ContabilidadService } from './contabilidad.service';
import { ContabilidadController } from './contabilidad.controller';

@Module({
  providers: [ContabilidadService],
  controllers: [ContabilidadController],
  exports: [ContabilidadService],
})
export class ContabilidadModule {}
