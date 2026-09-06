import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { FacturacionService }    from './facturacion.service';
import { FacturacionController } from './facturacion.controller';
import { FacturacionBotController } from './facturacion-bot.controller';
import { Factura }       from './entities/factura.entity';
import { FacturaLinea }  from './entities/factura-linea.entity';
import { FacturaPago }   from './entities/factura-pago.entity';
import { NotaCredito }   from './entities/nota-credito.entity';
import { NcfSecuencia }  from './entities/ncf-secuencia.entity';
import { RecibosModule } from '../recibos/recibos.module';
import { CajaModule }    from '../caja/caja.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Factura, FacturaLinea, FacturaPago, NotaCredito, NcfSecuencia]),
    RecibosModule,
    CajaModule,
  ],
  providers:   [FacturacionService],
  controllers: [FacturacionController, FacturacionBotController],
  exports:     [FacturacionService],
})
export class FacturacionModule {}
