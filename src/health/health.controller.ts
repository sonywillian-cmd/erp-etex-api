import { Controller, Get } from '@nestjs/common';
import { HealthService } from './health.service';

/**
 * Health endpoints (publicos, sin JWT).
 * - GET /health         → check completo (DB + disco + memoria + backups)
 * - GET /health/alive   → liveness simple (solo confirma proceso vivo)
 *
 * Devuelven SIEMPRE HTTP 200 con el detalle en el body — asi un monitor
 * externo puede chequear `status === 'ok'` sin gestionar codigos no-200.
 */
@Controller('health')
export class HealthController {
  constructor(private readonly svc: HealthService) {}

  @Get()
  check() {
    return this.svc.check();
  }

  @Get('alive')
  alive() {
    return this.svc.alive();
  }
}
