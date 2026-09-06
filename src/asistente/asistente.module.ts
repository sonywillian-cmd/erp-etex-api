import { Module } from '@nestjs/common';
import { AsistenteService } from './asistente.service';
import { AsistenteController } from './asistente.controller';
import { ClientesModule } from '../clientes/clientes.module';
import { CotizacionesModule } from '../cotizaciones/cotizaciones.module';
import { GastosModule } from '../gastos/gastos.module';
import { FacturacionModule } from '../facturacion/facturacion.module';
import { TelegramModule } from '../telegram/telegram.module';

@Module({
  imports: [ClientesModule, CotizacionesModule, GastosModule, FacturacionModule, TelegramModule],
  providers: [AsistenteService],
  controllers: [AsistenteController],
  exports: [AsistenteService],
})
export class AsistenteModule {}
