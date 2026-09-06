import { Controller, Get } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { ConfiguracionSistema } from './entities/configuracion-sistema.entity';

/**
 * Identidad visual de la instancia, SIN autenticación: la necesita la pantalla de
 * login antes de que exista sesión (logo, nombre y colores de la empresa).
 * Solo expone claves inofensivas; nada de secretos ni datos fiscales.
 */
const CLAVES_PUBLICAS = ['nombre_empresa', 'logo_empresa', 'apariencia_color_identidad', 'apariencia_color_primario'];

@Controller('configuracion')
export class ConfiguracionPublicaController {
  constructor(@InjectRepository(ConfiguracionSistema) private cfgRepo: Repository<ConfiguracionSistema>) {}

  @Get('publica')
  async publica() {
    const items = await this.cfgRepo.find({ where: { clave: In(CLAVES_PUBLICAS) } });
    return items.reduce((acc, c) => ({ ...acc, [c.clave]: c.valor }), {} as Record<string, string>);
  }
}
