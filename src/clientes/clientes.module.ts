import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ClientesService }    from './clientes.service';
import { ClientesController } from './clientes.controller';
import { CreditoService }        from './credito.service';
import { CreditoController }     from './credito.controller';
import { CreditoBotController }  from './credito-bot.controller';
import { ContactosService }      from './contactos.service';
import { ContactosController }   from './contactos.controller';
import { Cliente }            from './entities/cliente.entity';

@Module({
  imports:     [TypeOrmModule.forFeature([Cliente])],
  providers:   [ClientesService, CreditoService, ContactosService],
  // CreditoController va PRIMERO: sus rutas estáticas deben registrarse antes del comodín ':id'
  controllers: [CreditoController, CreditoBotController, ContactosController, ClientesController],
  exports:     [ClientesService, CreditoService],
})
export class ClientesModule {}
