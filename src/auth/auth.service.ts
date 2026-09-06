import { Injectable, UnauthorizedException, ConflictException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { Usuario, RolUsuario } from './entities/usuario.entity';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(Usuario) private repo: Repository<Usuario>,
    private jwt: JwtService,
    private ds: DataSource,
  ) {
    this.asegurarTablaSesiones();
    this.asegurarInfraReset();
  }

  // Infra para "olvidé contraseña" mediado por admin:
  //  - columna debe_cambiar_password: obliga a cambiarla en el próximo login
  //  - tabla de solicitudes de reset (el empleado pide, el admin atiende)
  private async asegurarInfraReset() {
    try {
      await this.ds.query(
        `ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS debe_cambiar_password TINYINT(1) NOT NULL DEFAULT 0`);
    } catch { /* ya existe */ }
    try {
      await this.ds.query(`
        CREATE TABLE IF NOT EXISTS password_reset_solicitudes (
          id INT AUTO_INCREMENT PRIMARY KEY,
          usuario_id INT NULL,
          email VARCHAR(190) NULL,
          estado ENUM('pendiente','atendida','rechazada') NOT NULL DEFAULT 'pendiente',
          ip VARCHAR(45) NULL,
          atendida_por VARCHAR(120) NULL,
          atendida_en DATETIME(6) NULL,
          creado_en DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
          INDEX idx_reset_estado (estado),
          INDEX idx_reset_fecha (creado_en)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    } catch { /* si falla, no romper arranque */ }
  }

  // ── Olvidé contraseña: el empleado solicita (público) ─────────────────────
  // Respuesta genérica siempre: no revela si el email existe.
  async solicitarReset(email: string, ip?: string) {
    const correo = String(email ?? '').trim().toLowerCase();
    if (correo) {
      try {
        const rows = await this.ds.query(
          `SELECT id FROM usuarios WHERE LOWER(email) = ? AND activo = 1 LIMIT 1`, [correo]);
        const usuarioId = rows[0]?.id ?? null;
        // Evitar acumular pendientes duplicadas del mismo correo
        const yaPend = await this.ds.query(
          `SELECT id FROM password_reset_solicitudes WHERE email = ? AND estado = 'pendiente' LIMIT 1`, [correo]);
        if (!yaPend.length) {
          await this.ds.query(
            `INSERT INTO password_reset_solicitudes (usuario_id, email, ip) VALUES (?,?,?)`,
            [usuarioId, correo.slice(0, 190), (ip ?? '').slice(0, 45)]);
        }
      } catch { /* nunca romper: respuesta genérica igual */ }
    }
    return { ok: true, mensaje: 'Si la cuenta existe, tu supervisor recibió la solicitud para restablecer tu contraseña.' };
  }

  // ── Admin: ver solicitudes pendientes ─────────────────────────────────────
  async listarSolicitudesReset() {
    return this.ds.query(`
      SELECT s.id, s.email, COALESCE(u.nombre, s.email) AS usuario, u.rol,
             DATE_FORMAT(s.creado_en, '%Y-%m-%d %H:%i') AS fecha
        FROM password_reset_solicitudes s
        LEFT JOIN usuarios u ON u.id = s.usuario_id
       WHERE s.estado = 'pendiente'
       ORDER BY s.id DESC LIMIT 100`);
  }

  // ── Admin: atender solicitud → genera contraseña temporal ─────────────────
  async atenderSolicitudReset(id: number, por: string) {
    const rows = await this.ds.query(
      `SELECT * FROM password_reset_solicitudes WHERE id = ? LIMIT 1`, [id]);
    if (!rows.length) throw new NotFoundException('Solicitud no encontrada');
    const sol = rows[0];
    if (sol.estado !== 'pendiente') throw new ConflictException('La solicitud ya fue atendida');
    if (!sol.usuario_id) {
      await this.ds.query(`UPDATE password_reset_solicitudes SET estado='rechazada', atendida_por=?, atendida_en=NOW() WHERE id=?`, [por, id]);
      throw new NotFoundException('El correo de la solicitud no corresponde a un usuario activo');
    }
    const temporal = this.generarTemporal();
    const hash = await bcrypt.hash(temporal, 12);
    await this.ds.query(
      `UPDATE usuarios SET password_hash = ?, debe_cambiar_password = 1 WHERE id = ?`, [hash, sol.usuario_id]);
    await this.ds.query(
      `UPDATE password_reset_solicitudes SET estado='atendida', atendida_por=?, atendida_en=NOW() WHERE id=?`, [por, id]);
    const u = await this.ds.query(`SELECT nombre, email FROM usuarios WHERE id = ?`, [sol.usuario_id]);
    return { ok: true, usuario_nombre: u[0]?.nombre ?? sol.email, temporal };
  }

  // Contraseña temporal fácil de dictar (sin caracteres confusos)
  private generarTemporal(): string {
    const abc = 'ABCDEFGHJKMNPQRSTUVWXYZ';
    const num = '23456789';
    let s = '';
    for (let i = 0; i < 4; i++) s += abc[Math.floor(Math.random() * abc.length)];
    for (let i = 0; i < 3; i++) s += num[Math.floor(Math.random() * num.length)];
    return s;
  }

  // Bitácora de sesiones: registra cada intento de login (éxito o fallo) con IP.
  private async asegurarTablaSesiones() {
    try {
      await this.ds.query(`
        CREATE TABLE IF NOT EXISTS sesiones_log (
          id INT AUTO_INCREMENT PRIMARY KEY,
          usuario_id INT NULL,
          email VARCHAR(190) NULL,
          ip VARCHAR(45) NULL,
          exito TINYINT(1) NOT NULL DEFAULT 0,
          motivo VARCHAR(60) NULL,
          user_agent VARCHAR(255) NULL,
          creado_en DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
          INDEX idx_sesiones_fecha (creado_en),
          INDEX idx_sesiones_usuario (usuario_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
    } catch { /* si falla, el login no debe romperse */ }
  }

  private async registrarSesion(d: { usuario_id?: number | null; email?: string; ip?: string; exito: boolean; motivo?: string; user_agent?: string }) {
    try {
      await this.ds.query(
        `INSERT INTO sesiones_log (usuario_id, email, ip, exito, motivo, user_agent) VALUES (?,?,?,?,?,?)`,
        [d.usuario_id ?? null, (d.email ?? '').slice(0, 190), (d.ip ?? '').slice(0, 45),
         d.exito ? 1 : 0, (d.motivo ?? '').slice(0, 60) || null, (d.user_agent ?? '').slice(0, 255) || null],
      );
    } catch { /* nunca romper el login por la bitácora */ }
  }

  async listarSesiones(limite = 200) {
    return this.ds.query(
      `SELECT s.id, s.usuario_id, COALESCE(u.nombre, s.email) AS usuario, s.email, s.ip,
              s.exito, s.motivo, DATE_FORMAT(s.creado_en, '%Y-%m-%d %H:%i:%s') AS fecha
         FROM sesiones_log s LEFT JOIN usuarios u ON u.id = s.usuario_id
        ORDER BY s.id DESC LIMIT ?`, [Math.min(1000, Math.max(1, limite))]);
  }

  // ── Login ──────────────────────────────────────────────────────────────────
  async login(dto: LoginDto, ip?: string, userAgent?: string) {
    const user = await this.repo
      .createQueryBuilder('u')
      .addSelect('u.password_hash')
      .where('u.email = :email', { email: dto.email })
      .getOne();

    if (!user) {
      await this.registrarSesion({ email: dto.email, ip, exito: false, motivo: 'email_no_existe', user_agent: userAgent });
      throw new UnauthorizedException('Credenciales incorrectas');
    }
    if (!user.activo) {
      await this.registrarSesion({ usuario_id: user.id, email: dto.email, ip, exito: false, motivo: 'cuenta_deshabilitada', user_agent: userAgent });
      throw new UnauthorizedException('Credenciales incorrectas');
    }

    const valid = await bcrypt.compare(dto.password, user.password_hash);
    if (!valid) {
      await this.registrarSesion({ usuario_id: user.id, email: dto.email, ip, exito: false, motivo: 'password_incorrecta', user_agent: userAgent });
      throw new UnauthorizedException('Credenciales incorrectas');
    }

    await this.repo.update(user.id, { ultimo_acceso: new Date() });
    await this.registrarSesion({ usuario_id: user.id, email: dto.email, ip, exito: true, motivo: 'ok', user_agent: userAgent });

    const token = this.jwt.sign({
      sub:           user.id,
      email:         user.email,
      rol:           user.rol,
      departamentos: user.departamentos ?? [],
    });
    // ¿Contraseña temporal? → el front lo obliga a cambiarla
    let debeCambiar = false;
    try {
      const f = await this.ds.query(`SELECT debe_cambiar_password AS d FROM usuarios WHERE id = ?`, [user.id]);
      debeCambiar = Number(f[0]?.d ?? 0) === 1;
    } catch { /* columna aún no existe: no obligar */ }

    return {
      access_token: token,
      user: {
        id:            user.id,
        nombre:        user.nombre,
        email:         user.email,
        rol:           user.rol,
        departamentos: user.departamentos ?? [],
        debe_cambiar_password: debeCambiar,
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
    // Ya cambió su temporal → quitar la obligación
    try { await this.ds.query(`UPDATE usuarios SET debe_cambiar_password = 0 WHERE id = ?`, [userId]); } catch {}
    return { message: 'Contraseña actualizada' };
  }
}
