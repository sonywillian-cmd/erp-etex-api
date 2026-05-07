import { Injectable, UnauthorizedException, ConflictException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { Usuario, RolUsuario } from './entities/usuario.entity';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(Usuario) private repo: Repository<Usuario>,
    private jwt: JwtService,
  ) {}

  // ── Login ──────────────────────────────────────────────────────────────────
  async login(dto: LoginDto) {
    const user = await this.repo
      .createQueryBuilder('u')
      .addSelect('u.password_hash')
      .where('u.email = :email AND u.activo = 1', { email: dto.email })
      .getOne();

    if (!user) throw new UnauthorizedException('Credenciales incorrectas');

    const valid = await bcrypt.compare(dto.password, user.password_hash);
    if (!valid) throw new UnauthorizedException('Credenciales incorrectas');

    await this.repo.update(user.id, { ultimo_acceso: new Date() });

    const token = this.jwt.sign({
      sub:           user.id,
      email:         user.email,
      rol:           user.rol,
      departamentos: user.departamentos ?? [],
    });
    return {
      access_token: token,
      user: {
        id:            user.id,
        nombre:        user.nombre,
        email:         user.email,
        rol:           user.rol,
        departamentos: user.departamentos ?? [],
      },
    };
  }

  // ── Perfil del usuario autenticado ────────────────────────────────────────
  async me(userId: number) {
    return this.repo.findOneOrFail({ where: { id: userId } });
  }

  // ── Listar usuarios ────────────────────────────────────────────────────────
  async listar() {
    return this.repo.find({ order: { nombre: 'ASC' } });
  }

  // ── Crear usuario ─────────────────────────────────────────────────────────
  async crear(data: {
    email: string; nombre: string; password: string;
    rol: RolUsuario; departamentos?: number[] | null;
  }) {
    const existe = await this.repo.findOne({ where: { email: data.email } });
    if (existe) throw new ConflictException('El email ya está registrado');

    const hash = await bcrypt.hash(data.password, 12);
    const usuario = this.repo.create({
      email:         data.email,
      nombre:        data.nombre,
      password_hash: hash,
      rol:           data.rol,
      departamentos: data.departamentos ?? null,
    });
    await this.repo.save(usuario);
    const { password_hash, ...safe } = usuario as any;
    return safe;
  }

  // ── Actualizar usuario (admin) ─────────────────────────────────────────────
  async actualizar(id: number, data: {
    nombre?: string; email?: string; rol?: RolUsuario;
    departamentos?: number[] | null; activo?: boolean;
  }) {
    const user = await this.repo.findOne({ where: { id } });
    if (!user) throw new NotFoundException(`Usuario #${id} no encontrado`);
    Object.assign(user, data);
    await this.repo.save(user);
    const { password_hash, ...safe } = user as any;
    return safe;
  }

  // ── Reset contraseña (admin) ───────────────────────────────────────────────
  async resetPasswordAdmin(id: number, nueva: string) {
    const user = await this.repo.findOne({ where: { id } });
    if (!user) throw new NotFoundException(`Usuario #${id} no encontrado`);
    const hash = await bcrypt.hash(nueva, 12);
    await this.repo.update(id, { password_hash: hash });
    return { message: 'Contraseña restablecida' };
  }

  // ── Cambiar mi contraseña ──────────────────────────────────────────────────
  async cambiarPassword(userId: number, actual: string, nueva: string) {
    const user = await this.repo
      .createQueryBuilder('u')
      .addSelect('u.password_hash')
      .where('u.id = :id', { id: userId })
      .getOne();

    const valid = await bcrypt.compare(actual, user.password_hash);
    if (!valid) throw new UnauthorizedException('La contraseña actual es incorrecta');

    const hash = await bcrypt.hash(nueva, 12);
    await this.repo.update(userId, { password_hash: hash });
    return { message: 'Contraseña actualizada' };
  }
}
