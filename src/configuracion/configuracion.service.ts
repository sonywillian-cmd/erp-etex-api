import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { Departamento }         from './entities/departamento.entity';
import { Tecnica }              from './entities/tecnica.entity';
import { CategoriaProducto }    from './entities/categoria-producto.entity';
import { ConfiguracionSistema } from './entities/configuracion-sistema.entity';
import { Marca }                from './entities/marca.entity';
import { PlantillaRuta, PlantillaPaso } from './entities/plantilla-ruta.entity';
import { Maquina }              from './entities/maquina.entity';
import { Feriado }              from './entities/feriado.entity';
import { FlujoProduccion }      from '../produccion/entities/flujo-produccion.entity';
import { CuentaBanco }          from './entities/cuenta-banco.entity';

@Injectable()
export class ConfiguracionService {
  constructor(
    @InjectRepository(Departamento)         private depRepo:    Repository<Departamento>,
    @InjectRepository(Tecnica)              private tecRepo:    Repository<Tecnica>,
    @InjectRepository(CategoriaProducto)    private catRepo:    Repository<CategoriaProducto>,
    @InjectRepository(ConfiguracionSistema) private cfgRepo:    Repository<ConfiguracionSistema>,
    @InjectRepository(Marca)               private marcaRepo:  Repository<Marca>,
    @InjectRepository(PlantillaRuta)       private plantillaRepo: Repository<PlantillaRuta>,
    @InjectRepository(Maquina)             private maquinaRepo:   Repository<Maquina>,
    @InjectRepository(Feriado)             private feriadoRepo:   Repository<Feriado>,
    @InjectRepository(FlujoProduccion)     private flujoRepo:     Repository<FlujoProduccion>,
    @InjectRepository(CuentaBanco)         private cuentaRepo:    Repository<CuentaBanco>,
    private ds: DataSource,
  ) {}

  // ── Departamentos ─────────────────────────────────────────────────────────
  async listarDepartamentos() {
    return this.depRepo.find({ order: { orden: 'ASC', nombre: 'ASC' } });
  }

  async crearDepartamento(data: { nombre: string; orden?: number }) {
    const existe = await this.depRepo.findOne({ where: { nombre: data.nombre } });
    if (existe) throw new ConflictException(`El departamento "${data.nombre}" ya existe`);
    const dep = this.depRepo.create({ nombre: data.nombre, orden: data.orden ?? 0 });
    return this.depRepo.save(dep);
  }

  async actualizarDepartamento(id: number, data: { nombre?: string; orden?: number; activo?: boolean; checkpoints?: string[] | null }) {
    const dep = await this.depRepo.findOne({ where: { id } });
    if (!dep) throw new NotFoundException(`Departamento #${id} no encontrado`);
    Object.assign(dep, data);
    return this.depRepo.save(dep);
  }

  async toggleDepartamento(id: number) {
    const dep = await this.depRepo.findOne({ where: { id } });
    if (!dep) throw new NotFoundException(`Departamento #${id} no encontrado`);
    dep.activo = !dep.activo;
    return this.depRepo.save(dep);
  }

  // ── Técnicas ──────────────────────────────────────────────────────────────
  async listarTecnicas(soloActivas = false) {
    const qb = this.tecRepo.createQueryBuilder('t');
    if (soloActivas) qb.where('t.activo = 1');
    return qb.orderBy('t.nombre', 'ASC').getMany();
  }

  async crearTecnica(data: {
    nombre: string;
    precio_default?: number;
    departamento_id?: number;
    departamento_nombre?: string;
  }) {
    const existe = await this.tecRepo.findOne({ where: { nombre: data.nombre } });
    if (existe) throw new ConflictException(`La técnica "${data.nombre}" ya existe`);
    const tec = this.tecRepo.create({
      nombre:              data.nombre,
      precio_default:      data.precio_default ?? 0,
      departamento_id:     data.departamento_id,
      departamento_nombre: data.departamento_nombre,
    });
    return this.tecRepo.save(tec);
  }

  async actualizarTecnica(id: number, data: {
    nombre?: string;
    precio_default?: number;
    departamento_id?: number;
    departamento_nombre?: string;
    activo?: boolean;
  }) {
    const tec = await this.tecRepo.findOne({ where: { id } });
    if (!tec) throw new NotFoundException(`Técnica #${id} no encontrada`);
    Object.assign(tec, data);
    return this.tecRepo.save(tec);
  }

  async toggleTecnica(id: number) {
    const tec = await this.tecRepo.findOne({ where: { id } });
    if (!tec) throw new NotFoundException(`Técnica #${id} no encontrada`);
    tec.activo = !tec.activo;
    return this.tecRepo.save(tec);
  }

  async eliminarTecnica(id: number) {
    const tec = await this.tecRepo.findOne({ where: { id } });
    if (!tec) throw new NotFoundException(`Técnica #${id} no encontrada`);
    await this.tecRepo.remove(tec);
    return { ok: true };
  }

  // ── Categorías de producto ─────────────────────────────────────────────────
  async listarCategorias() {
    return this.catRepo.find({ order: { orden: 'ASC', nombre: 'ASC' } });
  }

  async crearCategoria(data: { nombre: string; descripcion?: string; color?: string; orden?: number }) {
    const existe = await this.catRepo.findOne({ where: { nombre: data.nombre } });
    if (existe) throw new ConflictException(`La categoría "${data.nombre}" ya existe`);
    const cat = this.catRepo.create({ ...data, orden: data.orden ?? 0 });
    return this.catRepo.save(cat);
  }

  async actualizarCategoria(id: number, data: {
    nombre?: string; descripcion?: string; color?: string; orden?: number; activo?: boolean;
  }) {
    const cat = await this.catRepo.findOne({ where: { id } });
    if (!cat) throw new NotFoundException(`Categoría #${id} no encontrada`);
    Object.assign(cat, data);
    return this.catRepo.save(cat);
  }

  async toggleCategoria(id: number) {
    const cat = await this.catRepo.findOne({ where: { id } });
    if (!cat) throw new NotFoundException(`Categoría #${id} no encontrada`);
    cat.activo = !cat.activo;
    return this.catRepo.save(cat);
  }

  async eliminarCategoria(id: number) {
    const cat = await this.catRepo.findOne({ where: { id } });
    if (!cat) throw new NotFoundException(`Categoría #${id} no encontrada`);
    await this.catRepo.remove(cat);
    return { message: `Categoría "${cat.nombre}" eliminada` };
  }

  // ── Configuración del sistema (ITBIS, márgenes, etc.) ─────────────────────
  async getTodasConfig() {
    const items = await this.cfgRepo.find();
    // Inicializar tasa_itbis si no existe
    if (!items.find(i => i.clave === 'tasa_itbis')) {
      const nuevo = this.cfgRepo.create({ clave: 'tasa_itbis', valor: '18', descripcion: 'Tasa de ITBIS (%)' });
      const saved = await this.cfgRepo.save(nuevo);
      items.push(saved);
    }
    if (!items.find(i => i.clave === 'margen_default')) {
      const nuevo = this.cfgRepo.create({ clave: 'margen_default', valor: '30', descripcion: 'Margen de ganancia por defecto (%)' });
      const saved = await this.cfgRepo.save(nuevo);
      items.push(saved);
    }
    // Las claves del bot (bot_*) llevan secretos: solo se leen por /telegram/config (admin)
    return items.filter(c => !c.clave.startsWith('bot_')).reduce((acc, c) => ({ ...acc, [c.clave]: c.valor }), {} as Record<string, string>);
  }

  async setConfig(clave: string, valor: string, descripcion?: string) {
    let cfg = await this.cfgRepo.findOne({ where: { clave } });
    if (!cfg) {
      cfg = this.cfgRepo.create({ clave, valor, descripcion });
    } else {
      cfg.valor = valor;
      if (descripcion !== undefined) cfg.descripcion = descripcion;
    }
    return this.cfgRepo.save(cfg);
  }

  async getTasaITBIS(): Promise<number> {
    const cfg = await this.cfgRepo.findOne({ where: { clave: 'tasa_itbis' } });
    return cfg ? parseFloat(cfg.valor) : 18;
  }

  // ── Marcas ────────────────────────────────────────────────────────────────
  async listarMarcas(soloActivas = false) {
    const qb = this.marcaRepo.createQueryBuilder('m').orderBy('m.nombre', 'ASC');
    if (soloActivas) qb.where('m.activo = 1');
    return qb.getMany();
  }

  async crearMarca(data: { nombre: string; es_propia?: boolean; descripcion?: string }) {
    const existe = await this.marcaRepo.findOne({ where: { nombre: data.nombre } });
    if (existe) throw new ConflictException(`La marca "${data.nombre}" ya existe`);
    const marca = this.marcaRepo.create({
      nombre:     data.nombre,
      es_propia:  data.es_propia ?? false,
      descripcion: data.descripcion,
    });
    return this.marcaRepo.save(marca);
  }

  async actualizarMarca(id: number, data: { nombre?: string; es_propia?: boolean; descripcion?: string; activo?: boolean }) {
    const marca = await this.marcaRepo.findOne({ where: { id } });
    if (!marca) throw new NotFoundException(`Marca #${id} no encontrada`);
    Object.assign(marca, data);
    return this.marcaRepo.save(marca);
  }

  async toggleMarca(id: number) {
    const marca = await this.marcaRepo.findOne({ where: { id } });
    if (!marca) throw new NotFoundException(`Marca #${id} no encontrada`);
    marca.activo = !marca.activo;
    return this.marcaRepo.save(marca);
  }

  async eliminarMarca(id: number) {
    const marca = await this.marcaRepo.findOne({ where: { id } });
    if (!marca) throw new NotFoundException(`Marca #${id} no encontrada`);
    await this.marcaRepo.remove(marca);
    return { message: `Marca "${marca.nombre}" eliminada` };
  }

  // ── Plantillas de Ruta ────────────────────────────────────────────────────
  async listarPlantillas() {
    return this.plantillaRepo.find({ order: { nombre: 'ASC' } });
  }

  async crearPlantilla(data: { nombre: string; descripcion?: string; pasos: PlantillaPaso[] }) {
    const existe = await this.plantillaRepo.findOne({ where: { nombre: data.nombre } });
    if (existe) throw new ConflictException(`La plantilla "${data.nombre}" ya existe`);
    const p = this.plantillaRepo.create(data);
    return this.plantillaRepo.save(p);
  }

  async actualizarPlantilla(id: number, data: { nombre?: string; descripcion?: string; pasos?: PlantillaPaso[]; activo?: boolean }) {
    const p = await this.plantillaRepo.findOne({ where: { id } });
    if (!p) throw new NotFoundException(`Plantilla #${id} no encontrada`);
    Object.assign(p, data);
    return this.plantillaRepo.save(p);
  }

  async eliminarPlantilla(id: number) {
    const p = await this.plantillaRepo.findOne({ where: { id } });
    if (!p) throw new NotFoundException(`Plantilla #${id} no encontrada`);
    await this.plantillaRepo.remove(p);
    return { message: `Plantilla "${p.nombre}" eliminada` };
  }

  // ── Máquinas ──────────────────────────────────────────────────────────────
  async listarMaquinas(departamentoId?: number, departamentoNombre?: string) {
    const deptos = await this.depRepo.find();
    const depMap  = new Map(deptos.map(d => [d.id, d.nombre]));
    const depNombreMap = new Map(deptos.map(d => [d.nombre.toLowerCase(), d.id]));

    let filtroDeptoId = departamentoId;
    if (!filtroDeptoId && departamentoNombre) {
      filtroDeptoId = depNombreMap.get(departamentoNombre.toLowerCase());
      // Se pidió filtrar por un departamento que NO existe (ej. "LIMPIEZA DE BORDADO",
      // que no está registrado): devolver cero máquinas en vez de todas, para no
      // ofrecerle máquinas de bordado a operarios que no las usan.
      if (!filtroDeptoId) return [];
    }

    const where: Record<string, unknown> = { activo: true };
    if (filtroDeptoId) where['departamento_id'] = filtroDeptoId;

    const maquinas = await this.maquinaRepo.find({
      where,
      order: { departamento_id: 'ASC', nombre: 'ASC' },
    });

    return maquinas.map(m => ({
      ...m,
      departamento_nombre: depMap.get(m.departamento_id) ?? null,
    }));
  }

  async crearMaquina(data: { nombre: string; departamento_id: number; descripcion?: string }) {
    const depto = await this.depRepo.findOne({ where: { id: data.departamento_id } });
    if (!depto) throw new NotFoundException(`Departamento #${data.departamento_id} no encontrado`);
    const m = this.maquinaRepo.create({ ...data, activo: true });
    const saved = await this.maquinaRepo.save(m);
    return { ...saved, departamento_nombre: depto.nombre };
  }

  async actualizarMaquina(id: number, data: { nombre?: string; departamento_id?: number; descripcion?: string; activo?: boolean }) {
    const m = await this.maquinaRepo.findOne({ where: { id } });
    if (!m) throw new NotFoundException(`Máquina #${id} no encontrada`);
    if (data.departamento_id) {
      const depto = await this.depRepo.findOne({ where: { id: data.departamento_id } });
      if (!depto) throw new NotFoundException(`Departamento #${data.departamento_id} no encontrado`);
    }
    Object.assign(m, data);
    const saved = await this.maquinaRepo.save(m);
    const depto = await this.depRepo.findOne({ where: { id: saved.departamento_id } });
    return { ...saved, departamento_nombre: depto?.nombre ?? null };
  }

  async eliminarMaquina(id: number) {
    const m = await this.maquinaRepo.findOne({ where: { id } });
    if (!m) throw new NotFoundException(`Máquina #${id} no encontrada`);
    await this.maquinaRepo.remove(m);
    return { message: `Máquina "${m.nombre}" eliminada` };
  }

  // ── Migración: crear tabla maquinas si no existe ──────────────────────────
  async crearTablaMaquinas() {
    await this.ds.query(`
      CREATE TABLE IF NOT EXISTS maquinas (
        id             INT AUTO_INCREMENT PRIMARY KEY,
        nombre         VARCHAR(100) NOT NULL,
        departamento_id INT NOT NULL,
        descripcion    TEXT NULL,
        activo         TINYINT(1) NOT NULL DEFAULT 1,
        creado_en      DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        actualizado_en DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);
    return { ok: true, message: 'Tabla maquinas lista' };
  }

  // ── Flujos de producción (motor configurable) ─────────────────────────────
  async listarFlujos() {
    return this.flujoRepo.find({ order: { id: 'ASC' } });
  }

  async crearFlujo(data: Partial<FlujoProduccion>) {
    const flujo = this.flujoRepo.create(data);
    return this.flujoRepo.save(flujo);
  }

  async actualizarFlujo(id: number, data: Partial<FlujoProduccion>) {
    const flujo = await this.flujoRepo.findOne({ where: { id } });
    if (!flujo) throw new NotFoundException(`Flujo #${id} no encontrado`);
    Object.assign(flujo, data);
    return this.flujoRepo.save(flujo);
  }

  async eliminarFlujo(id: number) {
    const flujo = await this.flujoRepo.findOne({ where: { id } });
    if (!flujo) throw new NotFoundException(`Flujo #${id} no encontrado`);
    await this.flujoRepo.remove(flujo);
    return { message: `Flujo "${flujo.nombre}" eliminado` };
  }

  // ── Feriados ──────────────────────────────────────────────────────────────
  async listarFeriados(año?: number) {
    const where = año ? { año } : {};
    return this.feriadoRepo.find({ where, order: { fecha: 'ASC' } });
  }

  async crearFeriado(data: { fecha: string; nombre: string; año: number }) {
    const existe = await this.feriadoRepo.findOne({ where: { fecha: data.fecha } });
    if (existe) throw new ConflictException(`Ya existe un feriado en la fecha ${data.fecha}`);
    const f = this.feriadoRepo.create(data);
    return this.feriadoRepo.save(f);
  }

  async eliminarFeriado(id: number) {
    const f = await this.feriadoRepo.findOne({ where: { id } });
    if (!f) throw new NotFoundException(`Feriado #${id} no encontrado`);
    await this.feriadoRepo.remove(f);
    return { ok: true };
  }

  async crearTablaFeriados() {
    await this.ds.query(`
      CREATE TABLE IF NOT EXISTS feriados (
        id        INT AUTO_INCREMENT PRIMARY KEY,
        fecha     DATE NOT NULL,
        nombre    VARCHAR(120) NOT NULL,
        año       INT NOT NULL,
        creado_en DATETIME(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        UNIQUE KEY uk_feriado_fecha (fecha)
      ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
    `);
    return { ok: true, message: 'Tabla feriados lista' };
  }

  // ── Cuentas bancarias ────────────────────────────────────────────────────
  async listarCuentas(soloActivas = false) {
    const qb = this.cuentaRepo.createQueryBuilder('c').orderBy('c.banco', 'ASC');
    if (soloActivas) qb.where('c.activo = 1');
    return qb.getMany();
  }

  async crearCuenta(data: {
    banco: string; digitos: string; tipo_cuenta?: string;
    titular?: string; alias?: string;
  }) {
    const c = this.cuentaRepo.create({
      banco:       data.banco,
      digitos:     data.digitos.slice(-4),
      tipo_cuenta: data.tipo_cuenta ?? 'corriente',
      titular:     data.titular,
      alias:       data.alias,
    });
    return this.cuentaRepo.save(c);
  }

  async actualizarCuenta(id: number, data: {
    banco?: string; digitos?: string; tipo_cuenta?: string;
    titular?: string; alias?: string; activo?: boolean;
  }) {
    const c = await this.cuentaRepo.findOne({ where: { id } });
    if (!c) throw new NotFoundException(`Cuenta #${id} no encontrada`);
    if (data.digitos) data.digitos = data.digitos.slice(-4);
    Object.assign(c, data);
    return this.cuentaRepo.save(c);
  }

  async eliminarCuenta(id: number) {
    const c = await this.cuentaRepo.findOne({ where: { id } });
    if (!c) throw new NotFoundException(`Cuenta #${id} no encontrada`);
    await this.cuentaRepo.remove(c);
    return { ok: true };
  }
}
