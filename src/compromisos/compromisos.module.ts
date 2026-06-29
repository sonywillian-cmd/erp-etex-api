import { Module } from '@nestjs/common';
import { CompromisosService } from './compromisos.service';
import { CompromisosController } from './compromisos.controller';

@Module({
  providers: [CompromisosService],
  controllers: [CompromisosController],
  exports: [CompromisosService],
})
export class CompromisosModule {}
