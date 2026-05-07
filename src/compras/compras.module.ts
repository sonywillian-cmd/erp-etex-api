import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ComprasService }       from './compras.service';
import { ComprasController }    from './compras.controller';
import { OrdenCompra }          from './entities/orden-compra.entity';
import { Proveedor }            from './entities/proveedor.entity';
import { ProveedorProducto }    from './entities/proveedor-producto.entity';
import { ProveedoresService }   from './proveedores.service';
import { ProveedoresController } from './proveedores.controller';
import { Producto }             from '../productos/entities/producto.entity';
import { VarianteProducto }     from '../productos/entities/variante-producto.entity';
import { Movimiento }           from '../inventario/entities/movimiento.entity';
import { MetricasModule }       from '../metricas/metricas.module';

@Module({
  imports:     [TypeOrmModule.forFeature([OrdenCompra, Proveedor, ProveedorProducto, Producto, VarianteProducto, Movimiento]), MetricasModule],
  providers:   [ComprasService, ProveedoresService],
  controllers: [ProveedoresController, ComprasController],
  exports:     [ProveedoresService],
})
export class ComprasModule {}
