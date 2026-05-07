import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { ROLES_KEY } from './decorators';
import { RolUsuario } from '../auth/entities/usuario.entity';

/** Guard JWT — aplica a todos los endpoints que lo usen */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}

/** Guard de roles — úsalo junto con JwtAuthGuard */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<RolUsuario[]>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required || required.length === 0) return true;   // sin @Roles → acceso libre (post JWT)
    const { user } = ctx.switchToHttp().getRequest();
    return required.includes(user?.rol);
  }
}
