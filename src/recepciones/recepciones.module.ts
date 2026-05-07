import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RecepcionesService }    from './recepciones.service';
import { RecepcionesController } from './recepciones.controller';
import { RecepcionDepartamento } from './recepcion-departamento.entity';
import { RolesGuard }            from '../common/guards';

@Module({
  imports: [TypeOrmModule.forFeature([RecepcionDepartamento])],
  providers:   [RecepcionesService, RolesGuard],
  controllers: [RecepcionesController],
  exports:     [RecepcionesService],
})
export class RecepcionesModule {}
