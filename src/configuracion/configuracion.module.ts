import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfiguracionService }    from './configuracion.service';
import { ConfiguracionPublicaController } from './configuracion-publica.controller';
import { ConfiguracionController } from './configuracion.controller';
import { Departamento }            from './entities/departamento.entity';
import { Tecnica }                 from './entities/tecnica.entity';
import { CategoriaProducto }       from './entities/categoria-producto.entity';
import { ConfiguracionSistema }    from './entities/configuracion-sistema.entity';
import { Marca }                   from './entities/marca.entity';
import { PlantillaRuta }           from './entities/plantilla-ruta.entity';
import { Maquina }                 from './entities/maquina.entity';
import { Feriado }                 from './entities/feriado.entity';
import { FlujoProduccion }         from '../produccion/entities/flujo-produccion.entity';
import { CuentaBanco }             from './entities/cuenta-banco.entity';

@Module({
  imports:     [TypeOrmModule.forFeature([Departamento, Tecnica, CategoriaProducto, ConfiguracionSistema, Marca, PlantillaRuta, Maquina, Feriado, FlujoProduccion, CuentaBanco])],
  providers:   [ConfiguracionService],
  controllers: [ConfiguracionController, ConfiguracionPublicaController],
  exports:     [ConfiguracionService],
})
export class ConfiguracionModule {}
