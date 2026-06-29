import { Module }        from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReciboIngreso }    from './entities/recibo-ingreso.entity';
import { RecibosService }   from './recibos.service';
import { RecibosController } from './recibos.controller';
import { CajaModule }       from '../caja/caja.module';

@Module({
  imports: [TypeOrmModule.forFeature([ReciboIngreso]), CajaModule],
  providers:   [RecibosService],
  controllers: [RecibosController],
  exports:     [RecibosService],
})
export class RecibosModule {}
