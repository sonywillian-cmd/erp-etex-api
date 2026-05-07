import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClientesService }    from './clientes.service';
import { ClientesController } from './clientes.controller';
import { Cliente }            from './entities/cliente.entity';

@Module({
  imports:     [TypeOrmModule.forFeature([Cliente])],
  providers:   [ClientesService],
  controllers: [ClientesController],
  exports:     [ClientesService],
})
export class ClientesModule {}
