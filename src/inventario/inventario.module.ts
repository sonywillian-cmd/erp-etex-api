import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InventarioService }    from './inventario.service';
import { InventarioController } from './inventario.controller';
import { Movimiento }           from './entities/movimiento.entity';
import { Producto }             from '../productos/entities/producto.entity';
import { ReservaInventario }    from '../produccion/entities/reserva-inventario.entity';

@Module({
  imports:     [TypeOrmModule.forFeature([Movimiento, Producto, ReservaInventario])],
  providers:   [InventarioService],
  controllers: [InventarioController],
})
export class InventarioModule {}
