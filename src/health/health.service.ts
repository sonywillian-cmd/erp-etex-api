import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import * as os from 'os';
import * as fs from 'fs';

export type Estado = 'ok' | 'degraded' | 'down';

export interface HealthCheckResult {
  status: Estado;
  uptime_seconds: number;
  timestamp: string;
  version: string;
  checks: {
    api: { status: Estado };
    database: { status: Estado; latency_ms: number | null; error: string | null };
    disk: { status: Estado; usado_pct: number | null; libre_gb: number | null };
    memoria: { status: Estado; usado_pct: number; libre_mb: number };
    backups: { status: Estado; ultimo_backup: string | null; horas_desde: number | null };
  };
}

const STARTED_AT = Date.now();

@Injectable()
export class HealthService {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  /** Healthcheck consolidado. Devuelve siempre 200 con detalle interno. */
  async check(): Promise<HealthCheckResult> {
    const [db, disk, backups] = await Promise.all([
      this.checkDb(),
      this.checkDisk(),
      this.checkBackups(),
    ]);
    const mem = this.checkMemory();

    // Estado global: down si DB cae; degraded si algún check secundario degrada; ok si todo bien
    let status: Estado = 'ok';
    if (db.status === 'down') status = 'down';
    else if (
      db.status === 'degraded' ||
      disk.status !== 'ok' ||
      mem.status !== 'ok' ||
      backups.status !== 'ok'
    ) {
      status = 'degraded';
    }

    return {
      status,
      uptime_seconds: Math.floor((Date.now() - STARTED_AT) / 1000),
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '1.0.0',
      checks: {
        api: { status: 'ok' },
        database: db,
        disk,
        memoria: mem,
        backups,
      },
    };
  }

  /** Liveness — solo confirma que el proceso responde */
  alive(): { status: 'ok'; uptime_seconds: number } {
    return {
      status: 'ok',
      uptime_seconds: Math.floor((Date.now() - STARTED_AT) / 1000),
    };
  }

  private async checkDb(): Promise<HealthCheckResult['checks']['database']> {
    const t0 = Date.now();
    try {
      await this.ds.query('SELECT 1');
      const latency = Date.now() - t0;
      return {
        status: latency > 1500 ? 'degraded' : 'ok',
        latency_ms: latency,
        error: null,
      };
    } catch (e: any) {
      return {
        status: 'down',
        latency_ms: null,
        error: (e && e.message) || 'unknown',
      };
    }
  }

  private async checkDisk(): Promise<HealthCheckResult['checks']['disk']> {
    try {
      const path = process.cwd();
      const stats = fs.statfsSync ? (fs as any).statfsSync(path) : null;
      if (!stats) {
        return { status: 'ok', usado_pct: null, libre_gb: null };
      }
      const totalBytes = stats.blocks * stats.bsize;
      const libreBytes = stats.bavail * stats.bsize;
      const usadoPct = Math.round(((totalBytes - libreBytes) / totalBytes) * 100);
      const libreGb = Math.round((libreBytes / 1024 / 1024 / 1024) * 10) / 10;

      let status: Estado = 'ok';
      if (usadoPct >= 95) status = 'down';
      else if (usadoPct >= 85) status = 'degraded';

      return { status, usado_pct: usadoPct, libre_gb: libreGb };
    } catch {
      return { status: 'ok', usado_pct: null, libre_gb: null };
    }
  }

  private checkMemory(): HealthCheckResult['checks']['memoria'] {
    const total = os.totalmem();
    const libre = os.freemem();
    const usadoPct = Math.round(((total - libre) / total) * 100);
    const libreMb = Math.round(libre / 1024 / 1024);

    let status: Estado = 'ok';
    if (usadoPct >= 95) status = 'degraded';
    return { status, usado_pct: usadoPct, libre_mb: libreMb };
  }

  private async checkBackups(): Promise<HealthCheckResult['checks']['backups']> {
    try {
      const dir = process.env.BACKUP_DIR || '/home/u372536694/backups';
      if (!fs.existsSync(dir)) {
        return { status: 'degraded', ultimo_backup: null, horas_desde: null };
      }
      const files = fs
        .readdirSync(dir)
        .filter((f) => f.startsWith('erp_backup_') && f.endsWith('.tar.gz'))
        .map((f) => {
          const stat = fs.statSync(`${dir}/${f}`);
          return { f, mtime: stat.mtimeMs };
        })
        .sort((a, b) => b.mtime - a.mtime);
      if (!files.length) {
        return { status: 'degraded', ultimo_backup: null, horas_desde: null };
      }
      const ultimo = files[0];
      const horasDesde = Math.round((Date.now() - ultimo.mtime) / 1000 / 3600);
      let status: Estado = 'ok';
      if (horasDesde > 48) status = 'down';
      else if (horasDesde > 30) status = 'degraded';
      return {
        status,
        ultimo_backup: new Date(ultimo.mtime).toISOString(),
        horas_desde: horasDesde,
      };
    } catch {
      return { status: 'degraded', ultimo_backup: null, horas_desde: null };
    }
  }
}
