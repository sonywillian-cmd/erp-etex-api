import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IncentivosService }    from './incentivos.service';
import { IncentivosController } from './incentivos.controller';
import { IncentivosConfig }     from './entities/incentivo-config.entity';
import { IncentivosEmpleado }   from './entities/incentivo-empleado.entity';
import { Usuario }              from '../auth/entities/usuario.entity';
import { RolesGuard }           from '../common/guards';

@Module({
  imports: [
    TypeOrmModule.forFeature([IncentivosConfig, IncentivosEmpleado, Usuario]),
  ],
  providers:   [IncentivosService, RolesGuard],
  controllers: [IncentivosController],
  exports:     [IncentivosService],
})
export class IncentivosModule {}
