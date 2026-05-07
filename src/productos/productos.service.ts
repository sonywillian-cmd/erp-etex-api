import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Producto } from './entities/producto.entity';
import { TipoProducto, TipoProduccion } from './entities/producto.entity';
import { VarianteProducto } from './entities/variante-producto.entity';
import * as XLSX from 'xlsx';

@Injectable()
export class ProductosService {
  constructor(
    @InjectRepository(Producto) private repo: Repository<Producto>,
    @InjectRepository(VarianteProducto) private varRepo: Repository<VarianteProducto>,
  ) {}

  findAll(q?: { search?: string; categoria?: string; activo?: string }) {
    const qb = this.repo.createQueryBuilder('p').orderBy('p.nombre', 'ASC');
    if (q?.search)    qb.andWhere('(p.nombre LIKE :s OR p.sku LIKE :s)', { s: `%${q.search}%` });
    if (q?.categoria) qb.andWhere('p.categoria = :cat', { cat: q.categoria });
    if (q?.activo !== undefined) qb.andWhere('p.activo = :activo', { activo: q.activo === 'true' });
    return qb.getMany();
  }

  async findOne(id: number) {
    const p = await this.repo.findOne({ where: { id } });
    if (!p) throw new NotFoundException(`Producto #${id} no encontrado`);
    return p;
  }

  async create(data: Partial<Producto>) {
    const p = this.repo.create(data);
    try {
      const saved = await this.repo.save(p);
      // Generar variantes si viene con atributos
      if (saved.sku && Array.isArray(saved.atributos) && saved.atributos.length > 0) {
        await this.generarVariantes(saved.id, saved.sku, saved.atributos as any, Number(saved.costo ?? 0), Number(saved.precio_base ?? 0));
      }
      return saved;
    } catch (e: any) {
      if (e?.code === 'ER_DUP_ENTRY') {
        throw new ConflictException(`El SKU "${data.sku}" ya está registrado. Usa un SKU diferente.`);
      }
      throw e;
    }
  }

  async update(id: number, data: Partial<Producto>) {
    await this.findOne(id);

    // Limpiar campos que nunca deben modificarse vía update
    const { id: _id, creado_en: _ce, actualizado_en: _ae, ...safeData } = data as any;

    // Eliminar claves con valor undefined (TypeORM puede interpretarlos como NULL en algunos drivers)
    for (const key of Object.keys(safeData)) {
      if (safeData[key] === undefined) delete safeData[key];
    }

    // Si el único campo es atributos, permitir (es la actualización intencional desde la pestaña Atributos)
    // Si atributos NO viene en el payload (e.g. guardarInfo), no se toca
    // Si atributos viene explícitamente como null → se respeta (borrado intencional)

    try {
      // Use save() instead of update() to ensure JSON columns (atributos, tecnicas, etc.) serialize correctly
      const existing = await this.findOne(id);
      Object.assign(existing, safeData);
      const saved = await this.repo.save(existing);

      // Regenerar variantes si cambiaron los atributos, el SKU, el costo o el precio
      if ('atributos' in safeData || 'sku' in safeData || 'costo' in safeData || 'precio_base' in safeData) {
        const atribs = saved.atributos as any;
        if (saved.sku && Array.isArray(atribs) && atribs.length > 0) {
          await this.generarVariantes(saved.id, saved.sku, atribs, Number(saved.costo ?? 0), Number(saved.precio_base ?? 0));
        }
      }
      return saved;
    } catch (e: any) {
      if (e?.code === 'ER_DUP_ENTRY') {
        throw new ConflictException(`El SKU "${data.sku}" ya está registrado. Usa un SKU diferente.`);
      }
      throw e;
    }
  }

  async remove(id: number) {
    const p = await this.findOne(id);
    await this.repo.remove(p);
    return { message: `Producto #${id} eliminado` };
  }

  async duplicar(id: number) {
    const original = await this.findOne(id);

    // Generar SKU único para la copia: usa el SKU original e incrementa el último número
    const baseSku = original.sku ?? `PROD-${id}`;
    const numMatch = baseSku.match(/^(.*?)[-_]?(\d+)$/);
    let nuevoSku: string;
    if (numMatch) {
      const prefix = numMatch[1];
      let num = parseInt(numMatch[2], 10) + 1;
      const pad = numMatch[2].length; // preservar ceros: 01 → 02
      nuevoSku = `${prefix}-${String(num).padStart(pad, '0')}`;
      while (await this.repo.findOne({ where: { sku: nuevoSku } })) {
        nuevoSku = `${prefix}-${String(++num).padStart(pad, '0')}`;
      }
    } else {
      nuevoSku = `${baseSku}-2`;
      let counter = 2;
      while (await this.repo.findOne({ where: { sku: nuevoSku } })) {
        nuevoSku = `${baseSku}-${++counter}`;
      }
    }

    const { id: _id, creado_en: _ce, actualizado_en: _ae, stock_actual: _sa, ...campos } = original as any;

    const copia = this.repo.create({
      ...campos,
      nombre: `${original.nombre} (Copia)`,
      sku: nuevoSku,
      stock_actual: 0,
      activo: false, // inactivo hasta que el usuario lo revise
    });

    const saved = await this.repo.save(copia);

    // Copiar variantes si el original las tiene
    if (original.sku && Array.isArray(original.atributos) && (original.atributos as any[]).length > 0) {
      await this.generarVariantes((saved as any).id, nuevoSku, original.atributos as any, Number((saved as any).costo ?? 0), Number((saved as any).precio_base ?? 0));
    }

    return saved;
  }

  // Buscar para autocomplete en ventas
  buscar(q: string) {
    return this.repo.createQueryBuilder('p')
      .where('(p.nombre LIKE :q OR p.sku LIKE :q) AND p.activo = true', { q: `%${q}%` })
      .take(10)
      .getMany();
  }

  // ── Generador de variantes ────────────────────────────────────────────────
  private abbrev(val: string): string {
    const words = val.trim().split(/\s+/);
    if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
    return words.slice(0, 4).map(w => w[0]).join('').toUpperCase();
  }

  private cartesian<T>(arrays: T[][]): T[][] {
    return arrays.reduce<T[][]>(
      (acc, arr) => acc.flatMap(combo => arr.map(item => [...combo, item])),
      [[]]
    );
  }

  async generarVariantes(productoId: number, sku: string, atributos: { nombre: string; valores: string[] }[], costo: number, precio: number) {
    // Eliminar variantes anteriores del producto
    await this.varRepo.delete({ producto_id: productoId });

    if (!atributos || atributos.length === 0) {
      // Sin atributos: una variante base con el mismo SKU del producto
      await this.varRepo.save(this.varRepo.create({
        producto_id: productoId,
        sku,
        atributos: {},
        stock_actual: 0,
        costo,
        precio,
      }));
      return;
    }

    const nombres = atributos.map(a => a.nombre);
    const valores = atributos.map(a => a.valores);
    const combos  = this.cartesian(valores);

    const skusUsados = new Set<string>();
    const variantes: Partial<VarianteProducto>[] = [];

    for (const combo of combos) {
      const partes   = [sku, ...combo.map(v => this.abbrev(v))];
      let skuVar     = partes.join('-');
      let n          = 1;
      while (skusUsados.has(skuVar)) { skuVar = partes.join('-') + n++; }
      skusUsados.add(skuVar);

      variantes.push({
        producto_id:  productoId,
        sku:          skuVar,
        atributos:    Object.fromEntries(nombres.map((nm, i) => [nm, combo[i]])),
        stock_actual: 0,
        costo,
        precio,
      });
    }

    await this.varRepo.save(variantes.map(v => this.varRepo.create(v)));
  }

  // ── Variantes ─────────────────────────────────────────────────────────────
  findVariantes(productoId: number) {
    return this.varRepo.find({
      where: { producto_id: productoId, activo: true as any },
      order: { id: 'ASC' },
    });
  }

  async updateVariante(id: number, data: Partial<VarianteProducto>) {
    const v = await this.varRepo.findOne({ where: { id } });
    if (!v) throw new NotFoundException(`Variante #${id} no encontrada`);
    Object.assign(v, data);
    return this.varRepo.save(v);
  }

  async createVariante(productoId: number, data: Partial<VarianteProducto>) {
    const variante = this.varRepo.create({ ...data, producto_id: productoId });
    try {
      return await this.varRepo.save(variante);
    } catch (e: any) {
      if (e?.code === 'ER_DUP_ENTRY') {
        throw new ConflictException(`El SKU "${data.sku}" ya está registrado. Usa un SKU diferente.`);
      }
      throw e;
    }
  }

  async deleteVariante(id: number) {
    const v = await this.varRepo.findOne({ where: { id } });
    if (!v) throw new NotFoundException(`Variante #${id} no encontrada`);
    await this.varRepo.remove(v);
    return { message: `Variante #${id} eliminada` };
  }

  async resetAllVariantes() {
    // Eliminar todas las variantes
    await this.varRepo.query('DELETE FROM variantes_producto');
    // Limpiar los atributos de todos los productos
    await this.repo.query("UPDATE productos SET atributos = NULL");
    return { message: 'Todas las variantes y atributos han sido reiniciados correctamente.' };
  }

  buscarVariantes(q: string) {
    return this.varRepo.createQueryBuilder('v')
      .innerJoin('productos', 'p', 'p.id = v.producto_id')
      .addSelect('p.nombre', 'p_nombre')
      .addSelect('p.aplica_itbis', 'p_itbis')
      .where('(v.sku LIKE :q OR p.nombre LIKE :q) AND v.activo = 1', { q: `%${q}%` })
      .take(20)
      .getRawAndEntities()
      .then(({ entities, raw }) =>
        entities.map((v, i) => ({
          ...v,
          producto_nombre: raw[i]?.p_nombre ?? '',
          aplica_itbis:    !!raw[i]?.p_itbis,
        }))
      );
  }

  async importarDesdeExcel(buffer: Buffer): Promise<{ importados: number; errores: { fila: number; sku: string; error: string }[] }> {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheet = workbook.Sheets['Productos'];
    if (!sheet) {
      return { importados: 0, errores: [{ fila: 0, sku: '', error: 'No se encontró la hoja "Productos" en el archivo' }] };
    }

    // Get raw rows as arrays to manually pick headers from row 3 (index 2)
    const rawRows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });

    if (rawRows.length < 3) {
      return { importados: 0, errores: [{ fila: 0, sku: '', error: 'El archivo no tiene el formato esperado' }] };
    }

    // Row index 2 (row 3) = column headers
    const headers: string[] = (rawRows[2] as any[]).map((h: any) => (h ? String(h).trim() : ''));

    // Rows index 7+ (row 8+) = actual data (rows 4-7 are labels/examples/separator)
    const dataRows = rawRows.slice(7);

    const errores: { fila: number; sku: string; error: string }[] = [];
    const entidades: Partial<Producto>[] = [];

    for (let i = 0; i < dataRows.length; i++) {
      const rowIndex = i + 8; // 1-based Excel row number
      const row = dataRows[i] as any[];

      // Build a map of header -> value
      const cell = (headerName: string): any => {
        const colIdx = headers.indexOf(headerName);
        if (colIdx === -1) return undefined;
        const val = row[colIdx];
        return val !== undefined && val !== null && val !== '' ? val : undefined;
      };

      const nombre = cell('nombre') ? String(cell('nombre')).trim() : undefined;
      const sku    = cell('sku')    ? String(cell('sku')).trim()    : undefined;

      if (!nombre || !sku) continue; // skip empty rows silently

      try {
        // Map tipo_producto
        const tipoProductoRaw = cell('tipo_producto');
        let tipo_producto: TipoProducto = TipoProducto.FISICO_COMPRADO;
        if (tipoProductoRaw) {
          const tp = String(tipoProductoRaw).trim().toLowerCase();
          if (tp === 'fisico_fabricado' || tp === 'físico_fabricado') tipo_producto = TipoProducto.FISICO_FABRICADO;
          else if (tp === 'servicio') tipo_producto = TipoProducto.SERVICIO;
        }

        // Map tipo_produccion
        const tipoProduccionRaw = cell('tipo_produccion');
        let tipo_produccion: TipoProduccion | null = null;
        if (tipoProduccionRaw) {
          const tp = String(tipoProduccionRaw).trim().toLowerCase();
          if (tp === 'fabricacion' || tp === 'fabricación') tipo_produccion = TipoProduccion.FABRICACION;
          else if (tp === 'proceso') tipo_produccion = TipoProduccion.PROCESO;
          else if (tp === 'fabricacion_proceso' || tp === 'fabricación_proceso') tipo_produccion = TipoProduccion.FABRICACION_PROCESO;
        }

        // Map tecnicas: comma-separated string -> string[]
        const tecnicasRaw = cell('tecnicas');
        let tecnicas: string[] | null = null;
        if (tecnicasRaw) {
          tecnicas = String(tecnicasRaw).split(',').map((t: string) => t.trim()).filter((t: string) => t.length > 0);
          if (tecnicas.length === 0) tecnicas = null;
        }

        // Map atributos: "TALLAS:XS,S,M,L|COLOR:Blanco,Negro" -> [{nombre, valores}]
        const atributosRaw = cell('atributos');
        let atributos: { nombre: string; valores: string[] }[] | null = null;
        if (atributosRaw) {
          const grupos = String(atributosRaw).split('|').filter((g: string) => g.trim().length > 0);
          atributos = grupos.map((grupo: string) => {
            const sepIdx = grupo.indexOf(':');
            if (sepIdx === -1) return { nombre: grupo.trim(), valores: [] };
            const nombre = grupo.substring(0, sepIdx).trim();
            const valores = grupo.substring(sepIdx + 1).split(',').map((v: string) => v.trim()).filter((v: string) => v.length > 0);
            return { nombre, valores };
          });
          if (atributos.length === 0) atributos = null;
        }

        // Numeric helpers
        const toNum = (v: any, fallback?: number): number | null => {
          if (v === undefined || v === null) return fallback !== undefined ? fallback : null;
          const n = parseFloat(String(v));
          return isNaN(n) ? (fallback !== undefined ? fallback : null) : n;
        };

        const entity: Partial<Producto> = {
          nombre,
          sku,
          descripcion:      cell('descripcion')  ? String(cell('descripcion')).trim()  : undefined,
          categoria:        cell('categoria')     ? String(cell('categoria')).trim()    : undefined,
          marca:            cell('marca')         ? String(cell('marca')).trim()        : undefined,
          tipo_producto,
          tipo_produccion,
          tecnicas,
          precio_base:      toNum(cell('precio_base'), 0) as number,
          costo:            toNum(cell('costo'), 0) as number,
          margen_ganancia:  toNum(cell('margen_ganancia'), 30) as number,
          precio_minimo:    toNum(cell('precio_minimo'), 0) as number,
          unidad:           cell('unidad') ? String(cell('unidad')).trim() : 'Pieza',
          aplica_itbis:     cell('aplica_itbis') ? String(cell('aplica_itbis')).trim().toUpperCase() === 'SI' : false,
          es_personalizable: cell('es_personalizable') ? String(cell('es_personalizable')).trim().toUpperCase() === 'SI' : false,
          stock_minimo:     toNum(cell('stock_minimo'), 0) as number,
          proveedor:        cell('proveedor') ? String(cell('proveedor')).trim() : undefined,
          notas:            cell('notas')     ? String(cell('notas')).trim()     : undefined,
          atributos,
        };

        entidades.push(entity);
      } catch (err: any) {
        errores.push({ fila: rowIndex, sku: sku ?? '', error: err?.message ?? String(err) });
      }
    }

    // Save in bulk, catching individual duplicate SKU errors
    let importados = 0;
    for (let i = 0; i < entidades.length; i++) {
      try {
        const p = this.repo.create(entidades[i]);
        await this.repo.save(p);
        importados++;
      } catch (e: any) {
        const fila = i + 8;
        const skuVal = entidades[i].sku ?? '';
        if (e?.code === 'ER_DUP_ENTRY') {
          errores.push({ fila, sku: skuVal, error: `El SKU "${skuVal}" ya está registrado` });
        } else {
          errores.push({ fila, sku: skuVal, error: e?.message ?? String(e) });
        }
      }
    }

    return { importados, errores };
  }
}
