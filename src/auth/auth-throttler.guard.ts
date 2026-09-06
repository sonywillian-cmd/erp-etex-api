import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Freno a fuerza bruta en login y solicitud de reset.
 *
 * Cuenta los intentos por CORREO, no por IP: toda la oficina sale a internet
 * por la misma conexión, así que un límite por IP bloquearía a todos por el
 * error de una sola persona. Por correo, cada cuenta tiene su propio cupo y
 * un atacante no puede probar miles de contraseñas contra un usuario aunque
 * rote de dirección. Si no viene correo, se cae al IP.
 */
@Injectable()
export class AuthThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const email = String(req?.body?.email ?? '').trim().toLowerCase();
    if (email) return `email:${email}`;
    const xff = String(req?.headers?.['x-forwarded-for'] ?? '').split(',')[0].trim();
    return `ip:${xff || req?.ip || 'desconocida'}`;
  }
}
