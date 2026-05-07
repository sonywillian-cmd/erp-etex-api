import { Module }          from '@nestjs/common';
import { TypeOrmModule }   from '@nestjs/typeorm';
import { CajaService }     from './caja.service';
import { CajaController }  from './caja.controller';
import { Pago }            from './entities/pago.entity';
import { EgresoCaja }      from './entities/egreso-caja.entity';
import { SesionCaja }      from './entities/sesion-caja.entity';
import { Producto }        from '../productos/entities/producto.entity';
import { Movimiento }      from '../inventario/entities/movimiento.entity';

@Module({
  imports:     [TypeOrmModule.forFeature([Pago, EgresoCaja, SesionCaja, Producto, Movimiento])],
  providers:   [CajaService],
  controllers: [CajaController],
})
export class CajaModule {}
