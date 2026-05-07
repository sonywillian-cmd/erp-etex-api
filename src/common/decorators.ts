import { SetMetadata, createParamDecorator, ExecutionContext } from '@nestjs/common';
import { RolUsuario } from '../auth/entities/usuario.entity';

export const ROLES_KEY = 'roles';

/** @Roles(RolUsuario.ADMIN, RolUsuario.VENDEDOR) */
export const Roles = (...roles: RolUsuario[]) => SetMetadata(ROLES_KEY, roles);

/** Inyecta el usuario autenticado: @CurrentUser() user: Usuario */
export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
