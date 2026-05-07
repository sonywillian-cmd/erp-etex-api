import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ReciboIngreso } from './entities/recibo-ingreso.entity';
import { RecibosService } from './recibos.service';
import { RecibosController } from './recibos.controller';

@Module({
  imports: [TypeOrmModule.forFeature([ReciboIngreso])],
  providers: [RecibosService],
  controllers: [RecibosController],
  exports: [RecibosService],
})
export class RecibosModule {}
