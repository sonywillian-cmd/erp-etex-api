import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { NotaRecordatorio } from './nota-recordatorio.entity';

@Injectable()
export class NotasService {
  constructor(
    @InjectRepository(NotaRecordatorio)
    private repo: Repository<NotaRecordatorio>,
    @InjectDataSource()
    private ds: DataSource,
  ) {}

  // ── Crear tabla si no existe ──────────────────────────────────────────────
  async crearTabla() {
    await this.ds.query(`
      CREATE TABLE IF NOT EXISTS notas_recordatorio (
        id                INT AUTO_INCREMENT PRIMARY KEY,
        texto             TEXT NOT NULL,
        creado_por_id     INT NOT NULL,
        creado_por_nombre VARCHAR(150) NOT NULL,
        destinatarios     JSON NULL,
        cumplida_por      JSON NULL,
        activa            TINYINT(1) NOT NULL DEFAULT 1,
        creada_en         DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);
    return { ok: true };
  }

  // ── Obtener notas visibles para un usuario ────────────────────────────────
  async getMisNotas(userId: number) {
    const todas = await this.repo.find({
      where: { activa: true },
      order: { creada_en: 'DESC' },
    });

    return todas.filter(n => {
      const esMia = n.creado_por_id === userId;
      const esDestinatario = Array.isArray(n.destinatarios) && n.destinatarios.includes(userId);
      if (!esMia && !esDestinatario) return false;

      // Ocultar si ya la cumplí
      const yaCumplida = Array.isArray(n.cumplida_por) && n.cumplida_por.includes(userId);
      return !yaCumplida;
    });
  }

  // ── Contar notas pendientes (para badge) ──────────────────────────────────
  async contarPendientes(userId: number) {
    const notas = await this.getMisNotas(userId);
    return { count: notas.length };
  }

  // ── Crear nota ────────────────────────────────────────────────────────────
  async crear(data: {
    texto: string;
    creado_por_id: number;
    creado_por_nombre: string;
    destinatarios?: number[];
    color?: string;
  }) {
    const nota = this.repo.create({
      texto: data.texto,
      creado_por_id: data.creado_por_id,
      creado_por_nombre: data.creado_por_nombre,
      destinatarios: data.destinatarios || [],
      cumplida_por: [],
      color: data.color || 'amarillo',
      activa: true,
    });
    return this.repo.save(nota);
  }

  // ── Marcar como cumplida para el usuario actual ───────────────────────────
  async cumplir(id: number, userId: number) {
    const nota = await this.repo.findOne({ where: { id } });
    if (!nota) throw new NotFoundException('Nota no encontrada');

    const cumplida = Array.isArray(nota.cumplida_por) ? nota.cumplida_por : [];
    if (!cumplida.includes(userId)) {
      cumplida.push(userId);
    }
    nota.cumplida_por = cumplida;

    // Si el creador la cumple y no tiene destinatarios, desactivar
    if (nota.creado_por_id === userId && (!nota.destinatarios || nota.destinatarios.length === 0)) {
      nota.activa = false;
    }

    return this.repo.save(nota);
  }

  // ── Eliminar nota (solo creador o admin) ──────────────────────────────────
  async eliminar(id: number, userId: number, rol: string) {
    const nota = await this.repo.findOne({ where: { id } });
    if (!nota) throw new NotFoundException('Nota no encontrada');
    if (nota.creado_por_id !== userId && rol !== 'admin' && rol !== 'supervisor') {
      throw new ForbiddenException('No tienes permiso para eliminar esta nota');
    }
    nota.activa = false;
    return this.repo.save(nota);
  }
}
