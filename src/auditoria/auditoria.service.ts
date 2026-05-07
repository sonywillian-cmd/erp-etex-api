import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { AuditoriaFinanciera } from './entities/auditoria-financiera.entity';

export interface RegistrarAuditoriaDto {
  modulo:         string;
  accion:         string;
  entidad_id?:    number | null;
  entidad_numero?: string | null;
  usuario_id?:    number | null;
  usuario_nombre?: string | null;
  usuario_rol?:   string | null;
  monto?:         number | null;
  datos?:         Record<string, any> | null;
  descripcion?:   string | null;
}

@Injectable()
export class AuditoriaService {
  constructor(
    @InjectRepository(AuditoriaFinanciera)
    private repo: Repository<AuditoriaFinanciera>,
    private ds: DataSource,
  ) {}

  /** Registra un evento. Nunca lanza excepción para no interrumpir el flujo principal. */
  async registrar(dto: RegistrarAuditoriaDto): Promise<void> {
    try {
      const registro = this.repo.create({
        modulo:         dto.modulo,
        accion:         dto.accion,
        entidad_id:     dto.entidad_id     ?? null,
        entidad_numero: dto.entidad_numero ?? null,
        usuario_id:     dto.usuario_id     ?? null,
        usuario_nombre: dto.usuario_nombre ?? null,
        usuario_rol:    dto.usuario_rol    ?? null,
        monto:          dto.monto          ?? null,
        datos:          dto.datos          ?? null,
        descripcion:    dto.descripcion    ?? null,
      });
      await this.repo.save(registro);
    } catch (e) {
      // La auditoría no debe bloquear ninguna operación de negocio
      console.error('[AuditoriaService] Error al registrar evento:', e?.message);
    }
  }

  /** Listar con filtros */
  async listar(filtros?: {
    modulo?:   string;
    accion?:   string;
    usuario?:  string;
    desde?:    string;
    hasta?:    string;
    entidad_id?: number;
  }): Promise<AuditoriaFinanciera[]> {
    const qb = this.repo.createQueryBuilder('a').orderBy('a.id', 'DESC').limit(500);
    if (filtros?.modulo)     qb.andWhere('a.modulo = :m',                 { m: filtros.modulo });
    if (filtros?.accion)     qb.andWhere('a.accion = :ac',                { ac: filtros.accion });
    if (filtros?.usuario)    qb.andWhere('a.usuario_nombre LIKE :u',      { u: `%${filtros.usuario}%` });
    if (filtros?.desde)      qb.andWhere('DATE(a.creado_en) >= :desde',   { desde: filtros.desde });
    if (filtros?.hasta)      qb.andWhere('DATE(a.creado_en) <= :hasta',   { hasta: filtros.hasta });
    if (filtros?.entidad_id) qb.andWhere('a.entidad_id = :eid',           { eid: filtros.entidad_id });
    return qb.getMany();
  }

  /** Crear la tabla si no existe (migración manual) */
  async crearTabla(): Promise<{ ok: boolean; mensaje: string }> {
    try {
      await this.ds.query(`
        CREATE TABLE IF NOT EXISTS auditoria_financiera (
          id              INT AUTO_INCREMENT PRIMARY KEY,
          modulo          VARCHAR(30)  NOT NULL,
          accion          VARCHAR(50)  NOT NULL,
          entidad_id      INT          NULL,
          entidad_numero  VARCHAR(50)  NULL,
          usuario_id      INT          NULL,
          usuario_nombre  VARCHAR(100) NULL,
          usuario_rol     VARCHAR(30)  NULL,
          monto           DECIMAL(15,2) NULL,
          datos           JSON         NULL,
          descripcion     VARCHAR(500) NULL,
          creado_en       DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
          INDEX idx_modulo    (modulo),
          INDEX idx_accion    (accion),
          INDEX idx_entidad   (entidad_id),
          INDEX idx_creado_en (creado_en)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
      `);
      return { ok: true, mensaje: 'Tabla auditoria_financiera creada/verificada correctamente.' };
    } catch (e) {
      return { ok: false, mensaje: e?.message };
    }
  }
}
