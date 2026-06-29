import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EmpleadosService }    from './empleados.service';
import { EmpleadosController } from './empleados.controller';
import { EmpleadoFicha }       from './entities/empleado-ficha.entity';
import { EmpleadoVacacion }    from './entities/empleado-vacacion.entity';
import { EmpleadoDocumento }   from './entities/empleado-documento.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([EmpleadoFicha, EmpleadoVacacion, EmpleadoDocumento]),
  ],
  providers:   [EmpleadosService],
  controllers: [EmpleadosController],
  exports:     [EmpleadosService],
})
export class EmpleadosModule {}
