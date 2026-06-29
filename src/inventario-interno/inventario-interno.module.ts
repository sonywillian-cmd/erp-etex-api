import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { InsumoDepto }             from './entities/insumo-depto.entity';
import { InsumoUnidad }            from './entities/insumo-unidad.entity';
import { InsumoRequerimiento }     from './entities/insumo-requerimiento.entity';
import { InsumoRequerimientoItem } from './entities/insumo-requerimiento-item.entity';
import { InventarioInternoService }    from './inventario-interno.service';
import { InventarioInternoController } from './inventario-interno.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      InsumoDepto,
      InsumoUnidad,
      InsumoRequerimiento,
      InsumoRequerimientoItem,
    ]),
  ],
  controllers: [InventarioInternoController],
  providers:   [InventarioInternoService],
  exports:     [InventarioInternoService],
})
export class InventarioInternoModule {}
