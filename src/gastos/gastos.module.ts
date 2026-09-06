import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Gasto } from './gasto.entity';
import { GastosService } from './gastos.service';
import { GastosController } from './gastos.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Gasto])],
  providers: [GastosService],
  controllers: [GastosController],
  exports: [GastosService],
})
export class GastosModule {}
