import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProduccionService }    from './produccion.service';
import { ProduccionController } from './produccion.controller';
import { OrdenProduccion }      from './entities/orden-produccion.entity';
import { ConduceEntrega }       from './entities/conduce-entrega.entity';
import { TareaProduccion }      from './entities/tarea-produccion.entity';
import { PausaProduccion }      from './entities/pausa-produccion.entity';
import { LoteProduccion }       from './entities/lote-produccion.entity';
import { ProcesoLote }          from './entities/proceso-lote.entity';
import { FlujoProduccion }      from './entities/flujo-produccion.entity';
import { ReservaInventario }    from './entities/reserva-inventario.entity';
import { Movimiento }           from '../inventario/entities/movimiento.entity';
import { Producto }             from '../productos/entities/producto.entity';
import { FlujosSeedService }    from './flujos-produccion.seeder';
import { RolesGuard }           from '../common/guards';
import { Usuario }              from '../auth/entities/usuario.entity';
import { Departamento }         from '../configuracion/entities/departamento.entity';
import { Tecnica }              from '../configuracion/entities/tecnica.entity';
import { PlantillaRuta }        from '../configuracion/entities/plantilla-ruta.entity';
import { RecepcionesModule }    from '../recepciones/recepciones.module';
import { DanosModule }          from '../danos/danos.module';
import { MetricasModule }       from '../metricas/metricas.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      OrdenProduccion, TareaProduccion, PausaProduccion,
      LoteProduccion, FlujoProduccion, ReservaInventario,
      Movimiento, Producto, ProcesoLote, Usuario, Departamento, Tecnica, PlantillaRuta,
      ConduceEntrega,
    ]),
    RecepcionesModule,
    DanosModule,
    MetricasModule,
  ],
  providers:   [ProduccionService, FlujosSeedService, RolesGuard],
  controllers: [ProduccionController],
})
export class ProduccionModule {}
