import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProductosService }    from './productos.service';
import { ProductosController } from './productos.controller';
import { Producto }            from './entities/producto.entity';
import { BomItem }             from './entities/bom-item.entity';
import { VarianteProducto }    from './entities/variante-producto.entity';

@Module({
  imports:     [TypeOrmModule.forFeature([Producto, BomItem, VarianteProducto])],
  providers:   [ProductosService],
  controllers: [ProductosController],
  exports:     [ProductosService, TypeOrmModule],
})
export class ProductosModule {}
