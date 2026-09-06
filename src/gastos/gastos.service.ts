import { Injectable, NotFoundException, BadRequestException, ForbiddenException, Logger } from '@nestjs/common';
import { uploadsDir, uploadsUrl } from '../common/rutas-instancia';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource, Between } from 'typeorm';
import { GoogleGenAI } from '@google/genai';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import { Gasto, TipoGasto } from './gasto.entity';

// ─── OCR config (mismo prompt y schema que el bot de Telegram) ─────────────
const SCHEMA_FACTURA = {
  type: 'object',
  properties: {
    es_factura:         { type: 'boolean' },
    tiene_ncf:          { type: 'boolean' },
    tipo_sugerido:      { type: 'string', enum: ['formal', 'informal', 'personal'] },
    fecha:              { type: 'string', nullable: true },
    monto:              { type: 'number', nullable: true },
    subtotal:           { type: 'number', nullable: true },
    itbis:              { type: 'number', nullable: true },
    proveedor:          { type: 'string', nullable: true },
    rnc:                { type: 'string', nullable: true },
    ncf:                { type: 'string', nullable: true },
    tipo_ncf:           { type: 'string', nullable: true },
    categoria_sugerida: { type: 'string', nullable: true },
    descripcion:        { type: 'string', nullable: true },
    confianza:          { type: 'string', enum: ['alta', 'media', 'baja'] },
  },
  required: ['es_factura', 'tipo_sugerido', 'confianza'],
};

const PROMPT_OCR = `Eres un asistente experto en facturas y recibos de República Dominicana (RD). Analiza esta imagen y extrae los datos.

═══ NCF (CRÍTICO) ═══
El NCF (Número de Comprobante Fiscal) es OBLIGATORIAMENTE uno de estos formatos:
- "B" + 10 dígitos (ej: B0100001234) — NCF pre-impreso tradicional
- "E" + 10 a 11 dígitos (ej: E3100000771) — e-NCF (factura electrónica DGII)
La etiqueta en la factura suele ser: "NCF:", "e-NCF:", "Comprobante Fiscal:", "No. Comprobante:".

❌ NO CONFUNDAS con estos números (NO son NCF):
- "Numero Factura", "No. Factura", "FAC-", "FVT-", "INV-" → es número INTERNO del proveedor (ignóralo)
- "Orden de compra", "Cotización", "Pedido" → ignóralos
- "RNC" → es identificación del proveedor (campo separado)

Si NO ves un NCF con formato B########## o E############, deja ncf=null.

═══ Tipo NCF (B01 / B02 / B11 / B14 / B15) ═══
El tipo NCF son los PRIMEROS 3 caracteres del NCF:
- B01 / E31 = Crédito fiscal
- B02 / E32 = Consumidor final
- B11 / E41 = Proveedor informal
- B14 / E44 = Régimen especial
- B15 / E45 = Gubernamental
Para e-NCF: E31→B01, E32→B02, E41→B11, E44→B14, E45→B15.

═══ Clasificación tipo_sugerido ═══
- "formal"   si tiene NCF válido (B########## o E############).
- "informal" si NO tiene NCF pero es comercio (colmado, ferretería, parqueo, propinas, etc.).
- "personal" si parece compra personal (supermercado, restaurant, farmacia, gasolinera, ropa, hogar).

═══ Categorías típicas ═══
Materiales, Servicios, Combustible, Comida, Transporte, Alquiler, Mantenimiento,
Comunicaciones, Marketing, Salud, Hogar, Nómina, Mercancías, Otros.

═══ Reglas de campos ═══
- Si la imagen NO es factura/recibo: es_factura=false y los demás campos null.
- Montos siempre en DOP, sin símbolo de moneda, como número.
- fecha en formato YYYY-MM-DD. Si no es legible, deja null.
- rnc sin guiones, solo dígitos (9 o 11).
- ncf en MAYÚSCULAS y sin espacios.
- Si no estás seguro de subtotal o itbis, déjalos null.
- confianza="alta" si todos los datos clave son nítidos; "media" si algunos inferidos; "baja" si la imagen es borrosa.`;

interface CrearGastoDto {
  tipo: TipoGasto;
  clasificacion_contable?: 'costo' | 'gasto';
  fecha: string;
  monto: number;
  descripcion?: string;
  categoria?: string;
  proveedor?: string;
  rnc?: string;
  ncf?: string;
  tipo_ncf?: string;
  subtotal?: number;
  itbis?: number;
  foto_url?: string;
  fotos_adicionales?: string[];
  metodo_pago?: string;
  notas?: string;
  registrado_por_id: number;
  registrado_por_nombre: string;
}

interface ListarFiltros {
  desde?: string;
  hasta?: string;
  tipo?: TipoGasto;
  categoria?: string;
  registrado_por_id?: number;
  busqueda?: string;
}

@Injectable()
export class GastosService {
  private readonly logger = new Logger('GastosService');
  private genai: GoogleGenAI | null = null;
  private readonly GEMINI_MODEL    = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  private readonly FOTO_UPLOAD_DIR = uploadsDir('gastos');   // carpeta pública de la instancia
  private readonly FOTO_BASE_URL   = uploadsUrl('gastos');

  constructor(
    @InjectRepository(Gasto) private repo: Repository<Gasto>,
    @InjectDataSource() private ds: DataSource,
  ) {
    if (process.env.GEMINI_API_KEY) {
      this.genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    } else {
      this.logger.warn('GEMINI_API_KEY no configurado — el OCR de facturas desde web no funcionará');
    }
  }

  // ─── OCR: aceptar 1 o N imágenes (multi-página) en una sola llamada Gemini
  async procesarFotosOCR(imagenes: { buffer: Buffer; mimeType: string }[]) {
    if (!this.genai) {
      throw new BadRequestException('OCR no disponible (GEMINI_API_KEY no configurado en el servidor)');
    }
    if (!imagenes || imagenes.length === 0) {
      throw new BadRequestException('Sin imágenes');
    }
    if (imagenes.length > 10) {
      throw new BadRequestException('Máximo 10 páginas por factura');
    }

    // 1. Validar + guardar todas las imágenes en disco
    const fotoUrls: string[] = [];
    for (const img of imagenes) {
      if (!img.buffer || img.buffer.length === 0) continue;
      if (img.buffer.length > 10 * 1024 * 1024) {
        throw new BadRequestException(`Una imagen es muy grande (máx 10 MB c/u)`);
      }
      const mime = img.mimeType || 'image/jpeg';
      if (!mime.startsWith('image/') && mime !== 'application/pdf') {
        throw new BadRequestException(`Tipo de archivo no soportado: ${mime}`);
      }
      try {
        const url = await this.guardarFoto(img.buffer, mime);
        fotoUrls.push(url);
      } catch (e: any) {
        this.logger.error('Error guardando foto: ' + e.message);
      }
    }

    // 2. OCR con Gemini (multi-imagen en una sola llamada)
    const parts: any[] = imagenes.map(img => ({
      inlineData: {
        mimeType: img.mimeType || 'image/jpeg',
        data: img.buffer.toString('base64'),
      },
    }));
    const promptMulti = imagenes.length > 1
      ? `Las ${imagenes.length} imágenes son páginas de UNA MISMA factura. ` +
        `Consolida toda la información (datos del proveedor, NCF, totales, etc.) ` +
        `combinando lo que esté en cada página. Devuelve UN solo JSON.\n\n` + PROMPT_OCR
      : PROMPT_OCR;
    parts.push({ text: promptMulti });

    let parsed: any;
    try {
      const resp = await this.genai.models.generateContent({
        model: this.GEMINI_MODEL,
        contents: [{ role: 'user', parts }],
        config: {
          responseMimeType: 'application/json',
          responseSchema: SCHEMA_FACTURA,
          temperature: 0.1,
        },
      });
      const txt = (resp.text || '').trim();
      if (!txt) throw new Error('Gemini devolvió respuesta vacía');
      parsed = JSON.parse(txt);
    } catch (e: any) {
      this.logger.error('Error OCR Gemini: ' + e.message);
      throw new BadRequestException(`No pude procesar la imagen: ${e.message}`);
    }

    // Mapear E## → B## para tipo_ncf
    if (parsed.tipo_ncf) {
      const map: Record<string, string> = { E31: 'B01', E32: 'B02', E41: 'B11', E44: 'B14', E45: 'B15' };
      const t = parsed.tipo_ncf.toUpperCase();
      if (map[t]) parsed.tipo_ncf = map[t];
    }

    return {
      foto_url:          fotoUrls[0] ?? null,
      fotos_adicionales: fotoUrls.length > 1 ? fotoUrls.slice(1) : null,
      paginas:           fotoUrls.length,
      es_factura:        parsed.es_factura,
      confianza:         parsed.confianza,
      tipo:              parsed.tipo_sugerido || 'informal',
      fecha:             parsed.fecha || new Date().toISOString().slice(0, 10),
      monto:             parsed.monto ?? null,
      subtotal:          parsed.subtotal ?? null,
      itbis:             parsed.itbis ?? null,
      proveedor:         parsed.proveedor ?? null,
      rnc:               parsed.rnc ?? null,
      ncf:               parsed.ncf ?? null,
      tipo_ncf:          parsed.tipo_ncf ?? null,
      categoria:         parsed.categoria_sugerida ?? null,
      descripcion:       parsed.descripcion ?? null,
    };
  }

  // ── Alias retro-compatible: OCR de 1 sola imagen ─────────────────────────
  async procesarFotoOCR(buffer: Buffer, mimeType: string) {
    return this.procesarFotosOCR([{ buffer, mimeType }]);
  }

  // ─── Guardar foto en disco (Apache la sirve estática) ───────────────────
  private async guardarFoto(buffer: Buffer, mimeType: string): Promise<string> {
    const ahora = new Date();
    const año = ahora.getFullYear();
    const mes = String(ahora.getMonth() + 1).padStart(2, '0');
    const dir = path.join(this.FOTO_UPLOAD_DIR, String(año), mes);
    await fs.mkdir(dir, { recursive: true });
    const ext = mimeType.includes('pdf') ? 'pdf' : mimeType.includes('png') ? 'png' : mimeType.includes('webp') ? 'webp' : 'jpg';
    const uuid = crypto.randomUUID();
    const filename = `${uuid}.${ext}`;
    await fs.writeFile(path.join(dir, filename), buffer);
    return `${this.FOTO_BASE_URL}/${año}/${mes}/${filename}`;
  }

  // ── Migración: crear tabla ────────────────────────────────────────────────
  async crearTabla() {
    await this.ds.query(`
      CREATE TABLE IF NOT EXISTS gastos (
        id                     INT AUTO_INCREMENT PRIMARY KEY,
        tipo                   VARCHAR(20) NOT NULL,
        fecha                  DATE NOT NULL,
        monto                  DECIMAL(12,2) NOT NULL,
        descripcion            VARCHAR(500) NULL,
        categoria              VARCHAR(100) NULL,
        proveedor              VARCHAR(200) NULL,
        rnc                    VARCHAR(20)  NULL,
        ncf                    VARCHAR(30)  NULL,
        tipo_ncf               VARCHAR(10)  NULL,
        subtotal               DECIMAL(12,2) NULL,
        itbis                  DECIMAL(12,2) NULL,
        foto_url               VARCHAR(500) NULL,
        registrado_por_id      INT NOT NULL,
        registrado_por_nombre  VARCHAR(150) NOT NULL,
        metodo_pago            VARCHAR(50)  NULL,
        estado                 VARCHAR(20)  NOT NULL DEFAULT 'registrado',
        notas                  TEXT NULL,
        creado_en              DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        actualizado_en         DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        INDEX idx_gastos_tipo  (tipo),
        INDEX idx_gastos_fecha (fecha),
        INDEX idx_gastos_ncf   (ncf)
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);
    return { ok: true };
  }

  // ── Listar con filtros ────────────────────────────────────────────────────
  async listar(filtros: ListarFiltros) {
    const qb = this.repo.createQueryBuilder('g');

    if (filtros.desde && filtros.hasta) {
      qb.andWhere('g.fecha BETWEEN :desde AND :hasta', {
        desde: filtros.desde, hasta: filtros.hasta,
      });
    } else if (filtros.desde) {
      qb.andWhere('g.fecha >= :desde', { desde: filtros.desde });
    } else if (filtros.hasta) {
      qb.andWhere('g.fecha <= :hasta', { hasta: filtros.hasta });
    }

    if (filtros.tipo)       qb.andWhere('g.tipo = :tipo', { tipo: filtros.tipo });
    if (filtros.categoria)  qb.andWhere('g.categoria = :cat', { cat: filtros.categoria });
    if (filtros.registrado_por_id) {
      qb.andWhere('g.registrado_por_id = :uid', { uid: filtros.registrado_por_id });
    }
    if (filtros.busqueda) {
      qb.andWhere(
        '(g.descripcion LIKE :q OR g.proveedor LIKE :q OR g.ncf LIKE :q OR g.notas LIKE :q)',
        { q: `%${filtros.busqueda}%` },
      );
    }

    qb.orderBy('g.fecha', 'DESC').addOrderBy('g.id', 'DESC');
    return qb.getMany();
  }

  // ── Resumen / dashboard del mes ───────────────────────────────────────────
  async resumen(desde: string, hasta: string) {
    const todos = await this.repo.find({
      where: { fecha: Between(desde, hasta) },
    });

    const totales = { formal: 0, informal: 0, personal: 0, total: 0, itbis_deducible: 0 };
    const porCategoria: Record<string, number> = {};
    const porTipoYCategoria: Record<string, Record<string, number>> = {
      formal: {}, informal: {}, personal: {},
    };

    for (const g of todos) {
      const monto = Number(g.monto);
      totales[g.tipo] = (totales[g.tipo] ?? 0) + monto;
      totales.total += monto;

      // ITBIS deducible: solo de formales con NCF tipo B01, B11, B15
      if (g.tipo === 'formal' && g.itbis && ['B01', 'B11', 'B15'].includes(g.tipo_ncf ?? '')) {
        totales.itbis_deducible += Number(g.itbis);
      }

      const cat = g.categoria || 'Sin categoría';
      porCategoria[cat] = (porCategoria[cat] ?? 0) + monto;
      porTipoYCategoria[g.tipo][cat] = (porTipoYCategoria[g.tipo][cat] ?? 0) + monto;
    }

    return {
      periodo: { desde, hasta },
      totales,
      por_categoria: Object.entries(porCategoria)
        .map(([cat, monto]) => ({ categoria: cat, monto }))
        .sort((a, b) => b.monto - a.monto),
      por_tipo_y_categoria: porTipoYCategoria,
      cantidad: todos.length,
    };
  }

  // ── Promedio mensual de gastos personales (últimos N meses) ───────────────
  async promedioPersonal(meses = 3) {
    const desde = new Date();
    desde.setMonth(desde.getMonth() - meses);
    const desdeStr = desde.toISOString().slice(0, 10);

    const rows = await this.ds.query(
      `SELECT
         DATE_FORMAT(fecha, '%Y-%m') AS mes,
         SUM(monto)                  AS total
       FROM gastos
       WHERE tipo = 'personal' AND fecha >= ?
       GROUP BY mes
       ORDER BY mes ASC`,
      [desdeStr],
    );

    const totales = rows.map((r: any) => Number(r.total));
    const promedio = totales.length ? totales.reduce((s: number, n: number) => s + n, 0) / totales.length : 0;
    return { meses_analizados: totales.length, promedio_mensual: promedio, detalle: rows };
  }

  // ── Crear gasto ───────────────────────────────────────────────────────────
  async crear(data: CrearGastoDto) {
    if (!data.tipo || !['formal', 'informal', 'personal'].includes(data.tipo)) {
      throw new BadRequestException('Tipo inválido. Debe ser: formal, informal o personal');
    }
    if (!data.fecha) throw new BadRequestException('Fecha es obligatoria');
    if (!data.monto || Number(data.monto) <= 0) {
      throw new BadRequestException('Monto debe ser mayor a 0');
    }

    // Validación anti-duplicado solo para formales con NCF
    if (data.tipo === 'formal' && data.ncf && data.rnc) {
      const dup = await this.repo.findOne({ where: { ncf: data.ncf, rnc: data.rnc } });
      if (dup) {
        throw new BadRequestException(`Ya existe un gasto con NCF ${data.ncf} de ${data.rnc} (#${dup.id})`);
      }
    }

    const g = this.repo.create({
      tipo: data.tipo,
      clasificacion_contable: data.clasificacion_contable === 'costo' ? 'costo' : 'gasto',
      fecha: data.fecha,
      monto: Number(data.monto),
      descripcion: data.descripcion ?? null,
      categoria: data.categoria ?? null,
      proveedor: data.proveedor ?? null,
      rnc: data.rnc ?? null,
      ncf: data.ncf ?? null,
      tipo_ncf: data.tipo_ncf ?? null,
      subtotal: data.subtotal != null ? Number(data.subtotal) : null,
      itbis: data.itbis != null ? Number(data.itbis) : null,
      foto_url: data.foto_url ?? null,
      fotos_adicionales: Array.isArray(data.fotos_adicionales) && data.fotos_adicionales.length > 0
        ? data.fotos_adicionales : null,
      metodo_pago: data.metodo_pago ?? null,
      notas: data.notas ?? null,
      registrado_por_id: data.registrado_por_id,
      registrado_por_nombre: data.registrado_por_nombre,
      estado: 'registrado',
    });
    return this.repo.save(g);
  }

  // ── Actualizar gasto ──────────────────────────────────────────────────────
  async actualizar(id: number, data: Partial<CrearGastoDto>, userId: number, rol: string) {
    const g = await this.repo.findOne({ where: { id } });
    if (!g) throw new NotFoundException(`Gasto #${id} no encontrado`);

    // Solo el creador o admin puede editar
    if (g.registrado_por_id !== userId && !['admin', 'supervisor'].includes(rol)) {
      throw new ForbiddenException('No tienes permiso para editar este gasto');
    }

    Object.assign(g, {
      ...(data.tipo        !== undefined ? { tipo: data.tipo } : {}),
      ...(data.clasificacion_contable !== undefined ? { clasificacion_contable: data.clasificacion_contable === 'costo' ? 'costo' : 'gasto' } : {}),
      ...(data.fecha       !== undefined ? { fecha: data.fecha } : {}),
      ...(data.monto       !== undefined ? { monto: Number(data.monto) } : {}),
      ...(data.descripcion !== undefined ? { descripcion: data.descripcion } : {}),
      ...(data.categoria   !== undefined ? { categoria: data.categoria } : {}),
      ...(data.proveedor   !== undefined ? { proveedor: data.proveedor } : {}),
      ...(data.rnc         !== undefined ? { rnc: data.rnc } : {}),
      ...(data.ncf         !== undefined ? { ncf: data.ncf } : {}),
      ...(data.tipo_ncf    !== undefined ? { tipo_ncf: data.tipo_ncf } : {}),
      ...(data.subtotal    !== undefined ? { subtotal: data.subtotal != null ? Number(data.subtotal) : null } : {}),
      ...(data.itbis       !== undefined ? { itbis: data.itbis != null ? Number(data.itbis) : null } : {}),
      ...(data.foto_url    !== undefined ? { foto_url: data.foto_url } : {}),
      ...(data.metodo_pago !== undefined ? { metodo_pago: data.metodo_pago } : {}),
      ...(data.notas       !== undefined ? { notas: data.notas } : {}),
    });
    return this.repo.save(g);
  }

  // ── Eliminar gasto ────────────────────────────────────────────────────────
  async eliminar(id: number, userId: number, rol: string) {
    const g = await this.repo.findOne({ where: { id } });
    if (!g) throw new NotFoundException(`Gasto #${id} no encontrado`);
    if (g.registrado_por_id !== userId && !['admin', 'supervisor'].includes(rol)) {
      throw new ForbiddenException('No tienes permiso para eliminar este gasto');
    }
    await this.repo.remove(g);
    return { ok: true };
  }

  // ── Obtener uno ───────────────────────────────────────────────────────────
  async findOne(id: number) {
    const g = await this.repo.findOne({ where: { id } });
    if (!g) throw new NotFoundException(`Gasto #${id} no encontrado`);
    return g;
  }

  // ── Categorías sugeridas (las usadas previamente + defaults) ──────────────
  async categorias() {
    const defaults = [
      'Materiales', 'Servicios', 'Combustible', 'Comida', 'Transporte',
      'Alquiler', 'Nómina', 'Mantenimiento', 'Comunicaciones', 'Marketing',
      'Impuestos', 'Bancarios', 'Salud', 'Educación', 'Hogar', 'Otros',
    ];
    const usadas = await this.ds.query(
      `SELECT DISTINCT categoria FROM gastos WHERE categoria IS NOT NULL AND categoria != ''`,
    );
    const set = new Set<string>([...defaults, ...usadas.map((r: any) => r.categoria)]);
    return [...set].sort();
  }
}
