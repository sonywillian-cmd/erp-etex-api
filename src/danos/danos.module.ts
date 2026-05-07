import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DanosService }        from './danos.service';
import { DanosController }     from './danos.controller';
import { DanoProduccion }      from './dano-produccion.entity';
import { RolesGuard }          from '../common/guards';
import { Movimiento }          from '../inventario/entities/movimiento.entity';
import { ReservaInventario }   from '../produccion/entities/reserva-inventario.entity';
import { Producto }            from '../productos/entities/producto.entity';

@Module({
  imports: [TypeOrmModule.forFeature([DanoProduccion, Movimiento, ReservaInventario, Producto])],
  providers:   [DanosService, RolesGuard],
  controllers: [DanosController],
  exports:     [DanosService],
})
export class DanosModule {}
