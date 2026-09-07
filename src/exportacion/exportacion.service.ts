import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Readable } from 'stream';
import * as fs from 'fs';
import * as ExcelJS from 'exceljs';
import * as archiver from 'archiver';
import { uploadsDir } from '../common/rutas-instancia';

/**
 * "Mis datos": la empresa se descarga TODA su información cuando quiera.
 *
 *  - Excel completo  → un archivo con una hoja por módulo, para leer y analizar.
 *  - Copia técnica   → .zip con el volcado SQL de la base + las fotos subidas,
 *                      pensado para migrar a otro sistema o guardar un respaldo propio.
 *
 * Nada de esto sale nunca:
 *  - contraseñas (ni siquiera cifradas) ni tokens de invitación,
 *  - datos biométricos del ponche,
 *  - los secretos del bot guardados en configuración (token de Telegram y clave de IA).
 */

/** Tablas que NO se exportan: datos biométricos y tokens de un solo uso. */
const TABLAS_EXCLUIDAS = ['usuario_biometria', 'password_reset_solicitudes'];

/** Columnas que se vacían aunque su tabla sí se exporte. */
const COLUMNAS_SANITIZADAS: Record<string, string[]> = {
  usuarios: ['password_hash', 'onboarding_token', 'onboarding_token_expira'],
};

/** Filas concretas que se omiten: las claves del bot llevan token y clave de IA cifrados. */
const FILAS_OMITIDAS: Record<string, (fila: any) => boolean> = {
  configuracion_sistema: (f) => String(f.clave ?? '').startsWith('bot_'),
};

/** Hojas del Excel: nombre visible y consulta. Se usa SELECT * para no depender de nombres de columna. */
const HOJAS: { hoja: string; tabla: string; sql: string }[] = [
  { hoja: 'Clientes',            tabla: 'clientes',            sql: 'SELECT * FROM clientes ORDER BY nombre' },
  { hoja: 'Contactos',           tabla: 'cliente_contactos',   sql: 'SELECT cc.*, c.nombre AS cliente FROM cliente_contactos cc LEFT JOIN clientes c ON c.id = cc.cliente_id ORDER BY cc.cliente_id' },
  { hoja: 'Productos',           tabla: 'productos',           sql: 'SELECT * FROM productos ORDER BY nombre' },
  { hoja: 'Variantes',           tabla: 'variantes_producto',  sql: 'SELECT v.*, p.nombre AS producto FROM variantes_producto v LEFT JOIN productos p ON p.id = v.producto_id ORDER BY v.producto_id' },
  { hoja: 'Cotizaciones',        tabla: 'cotizaciones',        sql: 'SELECT c.*, cl.nombre AS cliente FROM cotizaciones c LEFT JOIN clientes cl ON cl.id = c.cliente_id ORDER BY c.id' },
  { hoja: 'Líneas cotización',   tabla: 'lineas_cotizacion',   sql: 'SELECT l.*, c.numero AS cotizacion FROM lineas_cotizacion l LEFT JOIN cotizaciones c ON c.id = l.cotizacion_id ORDER BY l.cotizacion_id, l.orden' },
  { hoja: 'Órdenes producción',  tabla: 'ordenes_produccion',  sql: 'SELECT o.*, cl.nombre AS cliente FROM ordenes_produccion o LEFT JOIN clientes cl ON cl.id = o.cliente_id ORDER BY o.id' },
  { hoja: 'Tareas producción',   tabla: 'tareas_produccion',   sql: 'SELECT t.*, o.numero AS orden FROM tareas_produccion t LEFT JOIN ordenes_produccion o ON o.id = t.orden_id ORDER BY t.orden_id, t.orden_ejecucion' },
  { hoja: 'Facturas',            tabla: 'facturas',            sql: 'SELECT * FROM facturas ORDER BY id' },
  { hoja: 'Líneas factura',      tabla: 'factura_lineas',      sql: 'SELECT l.*, f.numero AS factura FROM factura_lineas l LEFT JOIN facturas f ON f.id = l.factura_id ORDER BY l.factura_id' },
  { hoja: 'Pagos de facturas',   tabla: 'factura_pagos',       sql: 'SELECT p.*, f.numero AS factura FROM factura_pagos p LEFT JOIN facturas f ON f.id = p.factura_id ORDER BY p.id' },
  { hoja: 'Notas de crédito',    tabla: 'notas_credito',       sql: 'SELECT * FROM notas_credito ORDER BY id' },
  { hoja: 'Recibos de ingreso',  tabla: 'recibos_ingreso',     sql: 'SELECT * FROM recibos_ingreso ORDER BY id' },
  { hoja: 'Cuentas por pagar',   tabla: 'cuentas_por_pagar',   sql: 'SELECT * FROM cuentas_por_pagar ORDER BY id' },
  { hoja: 'Abonos a CxP',        tabla: 'cuentas_por_pagar_abonos', sql: 'SELECT * FROM cuentas_por_pagar_abonos ORDER BY id' },
  { hoja: 'Gastos',              tabla: 'gastos',              sql: 'SELECT * FROM gastos ORDER BY id' },
  { hoja: 'Egresos de caja',     tabla: 'egresos_caja',        sql: 'SELECT * FROM egresos_caja ORDER BY id' },
  { hoja: 'Sesiones de caja',    tabla: 'sesiones_caja',       sql: 'SELECT * FROM sesiones_caja ORDER BY id' },
  { hoja: 'Órdenes de compra',   tabla: 'ordenes_compra',      sql: 'SELECT * FROM ordenes_compra ORDER BY id' },
  { hoja: 'Proveedores',         tabla: 'proveedores',         sql: 'SELECT * FROM proveedores ORDER BY id' },
  { hoja: 'Movimientos invent.', tabla: 'movimientos_inventario', sql: 'SELECT * FROM movimientos_inventario ORDER BY id' },
  { hoja: 'Usuarios',            tabla: 'usuarios',            sql: 'SELECT * FROM usuarios ORDER BY id' },
  { hoja: 'Ficha de empleados',  tabla: 'empleados_ficha',     sql: 'SELECT * FROM empleados_ficha ORDER BY id' },
  { hoja: 'Marcajes (ponche)',   tabla: 'marcajes',            sql: 'SELECT m.*, u.nombre AS empleado FROM marcajes m LEFT JOIN usuarios u ON u.id = m.usuario_id ORDER BY m.id' },
  { hoja: 'Jornadas',            tabla: 'jornadas',            sql: 'SELECT * FROM jornadas ORDER BY id' },
  { hoja: 'Configuración',       tabla: 'configuracion_sistema', sql: "SELECT clave, valor FROM configuracion_sistema WHERE clave NOT LIKE 'bot_%' AND clave <> 'logo_empresa' ORDER BY clave" },
];

@Injectable()
export class ExportacionService {
  private readonly logger = new Logger('Exportacion');

  constructor(@InjectDataSource() private ds: DataSource) {}

  /** Quita de una fila lo que nunca debe salir del sistema. */
  private sanitizar(tabla: string, fila: any): any {
    const cols = COLUMNAS_SANITIZADAS[tabla];
    if (!cols) return fila;
    const copia = { ...fila };
    for (const c of cols) if (c in copia) copia[c] = null;
    return copia;
  }

  /** Cuántos registros lleva cada hoja: la pantalla muestra qué se va a descargar. */
  async resumen() {
    const filas: { hoja: string; registros: number }[] = [];
    for (const h of HOJAS) {
      try {
        const [r] = await this.ds.query(`SELECT COUNT(*) AS n FROM \`${h.tabla}\``);
        filas.push({ hoja: h.hoja, registros: Number(r?.n ?? 0) });
      } catch { /* tabla ausente en una instancia nueva */ }
    }
    return { hojas: filas, total: filas.reduce((a, f) => a + f.registros, 0), generado: new Date().toISOString() };
  }

  // ══════════════════════ Excel legible ══════════════════════
  async excelCompleto(): Promise<Buffer> {
    const wb = new ExcelJS.Workbook();
    wb.creator = 'E-Tex 360';
    wb.created = new Date();

    for (const h of HOJAS) {
      let filas: any[];
      try { filas = await this.ds.query(h.sql); }
      catch (e: any) { this.logger.warn(`Hoja ${h.hoja} omitida: ${e.message}`); continue; }

      // El nombre de hoja de Excel admite 31 caracteres y no acepta : \ / ? * [ ]
      const ws = wb.addWorksheet(h.hoja.replace(/[:\\/?*[\]]/g, ' ').slice(0, 31));
      const omitir = FILAS_OMITIDAS[h.tabla];
      const limpias = filas.map(f => this.sanitizar(h.tabla, f)).filter(f => !omitir || !omitir(f));

      if (limpias.length === 0) { ws.addRow(['(sin registros)']); continue; }

      const columnas = Object.keys(limpias[0]);
      ws.columns = columnas.map(c => ({ header: c, key: c, width: Math.min(38, Math.max(12, c.length + 4)) }));
      for (const f of limpias) {
        const fila: any = {};
        for (const c of columnas) {
          const v = f[c];
          // Los objetos y arreglos (columnas JSON) se escriben como texto legible
          fila[c] = v !== null && typeof v === 'object' && !(v instanceof Date) ? JSON.stringify(v) : v;
        }
        ws.addRow(fila);
      }
      const cab = ws.getRow(1);
      cab.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cab.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E3A8A' } };
      ws.views = [{ state: 'frozen', ySplit: 1 }];
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: columnas.length } };
    }

    if (wb.worksheets.length === 0) wb.addWorksheet('Sin datos').addRow(['No hay información para exportar']);
    return (await wb.xlsx.writeBuffer()) as unknown as Buffer;   // ExcelJS declara su propio Buffer
  }

  // ══════════════════════ Copia técnica (.zip) ══════════════════════
  /** Escapa un valor al formato SQL de MySQL/MariaDB. */
  private valorSql(v: any): string {
    if (v === null || v === undefined) return 'NULL';
    if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
    if (typeof v === 'boolean') return v ? '1' : '0';
    if (Buffer.isBuffer(v)) return `0x${v.toString('hex')}`;
    if (v instanceof Date) return `'${v.toISOString().slice(0, 19).replace('T', ' ')}'`;
    const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, '\\n').replace(/\r/g, '\\r')
      .replace(/\x00/g, '\\0').replace(/\x1a/g, '\\Z')}'`;
  }

  /** Genera el volcado SQL tabla por tabla, sin cargarlo entero en memoria. */
  private async *volcadoSql(): AsyncGenerator<string> {
    const fecha = new Date().toISOString().slice(0, 19).replace('T', ' ');
    yield `-- Copia de datos de E-Tex 360 · generada el ${fecha}\n`
        + `-- Restaurar:  mysql -u USUARIO -p BASE < datos.sql\n`
        + `-- No incluye contraseñas, datos biométricos ni las claves del bot.\n\n`
        + `SET FOREIGN_KEY_CHECKS=0;\nSET NAMES utf8mb4;\n\n`;

    const tablas: { n: string }[] = await this.ds.query(
      `SELECT table_name AS n FROM information_schema.tables
       WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'
         AND table_name NOT REGEXP 'bak|bkp|backup|_old|_tmp|_test|_prueba'
       ORDER BY table_name`);

    for (const { n: tabla } of tablas) {
      if (TABLAS_EXCLUIDAS.includes(tabla)) { yield `-- (omitida por privacidad: ${tabla})\n\n`; continue; }
      const [crear] = await this.ds.query(`SHOW CREATE TABLE \`${tabla}\``);
      const ddl = crear['Create Table'] ?? crear['Create View'];
      yield `\n-- ── ${tabla} ──\nDROP TABLE IF EXISTS \`${tabla}\`;\n${ddl};\n`;

      const [{ n: total }] = await this.ds.query(`SELECT COUNT(*) AS n FROM \`${tabla}\``);
      const omitir = FILAS_OMITIDAS[tabla];
      const LOTE = 500;
      for (let offset = 0; offset < Number(total); offset += LOTE) {
        const filas: any[] = await this.ds.query(`SELECT * FROM \`${tabla}\` LIMIT ${LOTE} OFFSET ${offset}`);
        const limpias = filas.map(f => this.sanitizar(tabla, f)).filter(f => !omitir || !omitir(f));
        if (!limpias.length) continue;
        const columnas = Object.keys(limpias[0]);
        const valores = limpias.map(f => `(${columnas.map(c => this.valorSql(f[c])).join(',')})`).join(',\n');
        yield `INSERT INTO \`${tabla}\` (${columnas.map(c => `\`${c}\``).join(',')}) VALUES\n${valores};\n`;
      }
    }
    yield `\nSET FOREIGN_KEY_CHECKS=1;\n`;
  }

  /** Arma el .zip (SQL + fotos) directamente sobre la respuesta HTTP. */
  copiaTecnica(destino: NodeJS.WritableStream): Promise<void> {
    const zip = archiver('zip', { zlib: { level: 9 } });
    const listo = new Promise<void>((resolve, reject) => {
      zip.on('error', reject);
      destino.on('close', () => resolve());
      destino.on('finish', () => resolve());
    });
    zip.pipe(destino as any);

    zip.append(Readable.from(this.volcadoSql()), { name: 'datos.sql' });
    for (const carpeta of ['gastos', 'empleados']) {
      const ruta = uploadsDir(carpeta);
      if (fs.existsSync(ruta)) zip.directory(ruta, `archivos/${carpeta}`);
    }
    zip.append(
      'Copia de datos de E-Tex 360\n\n'
      + '  datos.sql       Base de datos completa (estructura + registros).\n'
      + '                  Restaurar: mysql -u USUARIO -p BASE < datos.sql\n'
      + '  archivos/       Fotos de gastos, facturas de compra y empleados.\n\n'
      + 'Por seguridad NO se incluyen: contraseñas de usuarios, datos biométricos\n'
      + 'del ponche ni las claves del bot de Telegram y de la inteligencia artificial.\n'
      + 'Los usuarios deberán definir contraseña nueva si estos datos se cargan en otro sistema.\n',
      { name: 'LEEME.txt' });

    zip.finalize();
    return listo;
  }
}
