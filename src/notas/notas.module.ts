import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotaRecordatorio } from './nota-recordatorio.entity';
import { NotasService } from './notas.service';
import { NotasController } from './notas.controller';

@Module({
  imports: [TypeOrmModule.forFeature([NotaRecordatorio])],
  providers: [NotasService],
  controllers: [NotasController],
  exports: [NotasService],
})
export class NotasModule {}
