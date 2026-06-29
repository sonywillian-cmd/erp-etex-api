import { Module } from '@nestjs/common';
import { OperariosService }    from './operarios.service';
import { OperariosController } from './operarios.controller';

@Module({
  providers:   [OperariosService],
  controllers: [OperariosController],
})
export class OperariosModule {}
