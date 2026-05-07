import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditoriaService }    from './auditoria.service';
import { AuditoriaController } from './auditoria.controller';
import { AuditoriaFinanciera } from './entities/auditoria-financiera.entity';

@Global()
@Module({
  imports:     [TypeOrmModule.forFeature([AuditoriaFinanciera])],
  providers:   [AuditoriaService],
  controllers: [AuditoriaController],
  exports:     [AuditoriaService],
})
export class AuditoriaModule {}
