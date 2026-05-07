import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CotizacionesService }    from './cotizaciones.service';
import { CotizacionesController } from './cotizaciones.controller';
import { Cotizacion }             from './entities/cotizacion.entity';
import { LineaCotizacion }        from './entities/linea-cotizacion.entity';
import { VarianteProducto }       from '../productos/entities/variante-producto.entity';

@Module({
  imports:     [TypeOrmModule.forFeature([Cotizacion, LineaCotizacion, VarianteProducto])],
  providers:   [CotizacionesService],
  controllers: [CotizacionesController],
  exports:     [CotizacionesService],
})
export class CotizacionesModule {}
