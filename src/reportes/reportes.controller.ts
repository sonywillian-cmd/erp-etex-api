import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ReportesService } from './reportes.service';
import { RolesGuard } from '../common/guards';

@ApiTags('reportes')
@UseGuards(RolesGuard)
@Controller('reportes')
export class ReportesController {
  constructor(private readonly svc: ReportesService) {}

  @Get('tablero')
  @ApiOperation({ summary: 'Datos completos para el tablero analítico' })
  getTablero(
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
  ) {
    return this.svc.getTablero(desde, hasta);
  }
}
