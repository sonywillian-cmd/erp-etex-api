import { Injectable, BadRequestException } from '@nestjs/common';
import { InjectRepository, InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource, In } from 'typeorm';
import { DanoProduccion, EstadoDano } from './dano-produccion.entity';
import { Movimiento, TipoMovimiento } from '../inventario/entities/movimiento.entity';
import { ReservaInventario } from '../produccion/entities/reserva-inventario.entity';
import { Producto } from '../productos/entities/producto.entity';

@Injectable()
export class DanosService {
  constructor(
    @InjectRepository(DanoProduccion)    private repo:         Repository<DanoProduccion>,
    @InjectRepository(Movimiento)        private movRepo:      Repository<Movimiento>,
    @InjectRepository(ReservaInventario) private reservasRepo: Repository<ReservaInventario>,
    @InjectRepository(Producto)          private prodRepo:     Repository<Producto>,
    @InjectDataSource()                  private dataSource:   DataSource,
  ) {}

  // ── Migración ─────────────────────────────────────────────────────────────
  async crearTabla(): Promise<{ message: string }> {
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS danos_produccion (
        id                    INT             NOT NULL AUTO_INCREMENT,
        lote_id               INT             NOT NULL,
        orden_id              INT             NOT NULL,
        orden_numero          VARCHAR(50)     NOT NULL,
        departamento          VARCHAR(100)    NOT NULL,
        producto              VARCHAR(200)    NOT NULL,
        descripcion           VARCHAR(200)    NULL,
        cantidad_danada       INT             NOT NULL,
        motivo                TEXT            NOT NULL,
        estado                VARCHAR(30)     NOT NULL DEFAULT 'reportado',
        producto_id           INT             NULL,
        variante_id           INT             NULL,
        reserva_id            INT             NULL,
        es_sustitucion        TINYINT(1)      NOT NULL DEFAULT 0,
        repuesto_producto_id  INT             NULL,
        repuesto_variante_id  INT             NULL,
        repuesto_descripcion  VARCHAR(200)    NULL,
        cantidad_repuesta     INT             NULL,
        costo_repuesto        DECIMAL(12,2)   NULL,
        reportado_por_id      INT             NOT NULL,
        reportado_por_nombre  VARCHAR(150)    NOT NULL,
        aprobado_por_id       INT             NULL,
        aprobado_por_nombre   VARCHAR(150)    NULL,
        notas                 TEXT            NULL,
        creado_en             DATETIME(6)     NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        actualizado_en        DATETIME(6)     NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (id),
        INDEX idx_dano_lote   (lote_id),
        INDEX idx_dano_orden  (orden_id),
        INDEX idx_dano_estado (estado)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    await this.dataSource.query(`
      ALTER TABLE danos_produccion ADD COLUMN IF NOT EXISTS reserva_id INT NULL DEFAULT NULL;
    `);
    return { message: 'Tabla danos_produccion verificada/creada correctamente.' };
  }

  // ── Consultas ─────────────────────────────────────────────────────────────
  async getAll(filtros?: { estado?: string; desde?: string; hasta?: string }): Promise<DanoProduccion[]> {
    const qb = this.repo.createQueryBuilder('d').orderBy('d.creado_en', 'DESC');
    if (filtros?.estado) qb.andWhere('d.estado = :estado', { estado: filtros.estado });
    if (filtros?.desde)  qb.andWhere('DATE(d.creado_en) >= :desde', { desde: filtros.desde });
    if (filtros?.hasta)  qb.andWhere('DATE(d.creado_en) <= :hasta', { hasta: filtros.hasta });
    return qb.getMany();
  }

  getByOrden(ordenId: number): Promise<DanoProduccion[]> {
    return this.repo.find({ where: { orden_id: ordenId }, order: { creado_en: 'DESC' } });
  }

  getByLote(loteId: number): Promise<DanoProduccion[]> {
    return this.repo.find({ where: { lote_id: loteId }, order: { creado_en: 'DESC' } });
  }

  getPendientesAprobacion(): Promise<DanoProduccion[]> {
    return this.repo.find({
      where: { estado: In(['reportado', 'aprobado_sustitucion']) },
      order: { creado_en: 'DESC' },
    });
  }

  // ── Reportar ──────────────────────────────────────────────────────────────
  async reportar(data: {
    lote_id:              number;
    orden_id:             number;
    orden_numero:         string;
    departamento:         string;
    producto:             string;
    descripcion?:         string;
    cantidad_danada:      number;
    motivo:               string;
    producto_id?:         number;
    variante_id?:         number;
    reportado_por_id:     number;
    reportado_por_nombre: string;
  }): Promise<DanoProduccion> {
    if (!data.cantidad_danada || data.cantidad_danada <= 0)
      throw new BadRequestException('La cantidad dañada debe ser mayor a 0');
    const dano = this.repo.create({
      lote_id:              data.lote_id,
      orden_id:             data.orden_id,
      orden_numero:         data.orden_numero,
      departamento:         data.departamento,
      producto:             data.producto,
      descripcion:          data.descripcion ?? null,
      cantidad_danada:      data.cantidad_danada,
      motivo:               data.motivo,
      estado:               'reportado',
      producto_id:          data.producto_id ?? null,
      variante_id:          data.variante_id ?? null,
      reserva_id:           null,
      es_sustitucion:       false,
      reportado_por_id:     data.reportado_por_id,
      reportado_por_nombre: data.reportado_por_nombre,
    });
    return this.repo.save(dano);
  }

  // ── Aprobar reposición (misma variante) ───────────────────────────────────
  // Al aprobar:
  //   1. Registra movimiento SALIDA (merma) si el producto maneja inventario
  //   2. Crea una nueva reserva ACTIVA para cubrir las piezas de reposición
  async aprobarReponer(id: number, userId: number, userName: string): Promise<DanoProduccion> {
    const dano = await this.repo.findOneOrFail({ where: { id } });
    if (dano.estado !== 'reportado')
      throw new BadRequestException(`El daño ya está en estado "${dano.estado}"`);

    // ── Impacto en inventario ────────────────────────────────────────────────
    if (dano.producto_id) {
      const producto = await this.prodRepo.findOne({ where: { id: dano.producto_id } });
      if (producto?.maneja_inventario) {
        // 1. Movimiento SALIDA — registra la merma
        const mov = this.movRepo.create({
          producto_id: dano.producto_id,
          variante_id: dano.variante_id ?? null,
          tipo:        TipoMovimiento.SALIDA,
          cantidad:    dano.cantidad_danada,
          referencia:  `DAÑO-${dano.orden_numero}`,
          nota:        `Merma por daño en producción (Daño #${dano.id}): ${dano.motivo}`,
        });
        await this.movRepo.save(mov);

        // Actualizar stock_actual del producto
        const nuevoStock = Math.max(0, (producto.stock_actual ?? 0) - dano.cantidad_danada);
        await this.prodRepo.update(dano.producto_id, { stock_actual: nuevoStock });

        // 2. Nueva reserva ACTIVA — aparta material para la reposición
        const reserva = this.reservasRepo.create({
          orden_id:          dano.orden_id,
          producto_id:       dano.producto_id,
          producto_nombre:   dano.producto,
          cantidad_reservada: dano.cantidad_danada,
          estado:            'activa' as any,
        });
        const savedReserva = await this.reservasRepo.save(reserva);
        dano.reserva_id = savedReserva.id;
      }
    }

    dano.estado              = 'aprobado_reponer';
    dano.aprobado_por_id     = userId;
    dano.aprobado_por_nombre = userName;
    dano.es_sustitucion      = false;
    return this.repo.save(dano);
  }

  // ── Aprobar sustitución (variante diferente) ──────────────────────────────
  async aprobarSustitucion(
    id: number,
    userId: number,
    userName: string,
    repuesto: {
      repuesto_producto_id: number;
      repuesto_variante_id: number;
      repuesto_descripcion: string;
    },
  ): Promise<DanoProduccion> {
    const dano = await this.repo.findOneOrFail({ where: { id } });
    if (dano.estado !== 'reportado')
      throw new BadRequestException(`El daño ya está en estado "${dano.estado}"`);

    // Misma lógica de inventario pero con el producto sustituto
    const pidSus = repuesto.repuesto_producto_id;
    if (pidSus) {
      const prodSus = await this.prodRepo.findOne({ where: { id: pidSus } });
      if (prodSus?.maneja_inventario) {
        const mov = this.movRepo.create({
          producto_id: dano.producto_id ?? pidSus,
          variante_id: dano.variante_id ?? null,
          tipo:        TipoMovimiento.SALIDA,
          cantidad:    dano.cantidad_danada,
          referencia:  `DAÑO-${dano.orden_numero}`,
          nota:        `Merma por daño en producción (Daño #${dano.id}): ${dano.motivo}`,
        });
        await this.movRepo.save(mov);
        if (dano.producto_id) {
          const prodOrig = await this.prodRepo.findOne({ where: { id: dano.producto_id } });
          if (prodOrig?.maneja_inventario) {
            const ns = Math.max(0, (prodOrig.stock_actual ?? 0) - dano.cantidad_danada);
            await this.prodRepo.update(dano.producto_id, { stock_actual: ns });
          }
        }

        const reserva = this.reservasRepo.create({
          orden_id:           dano.orden_id,
          producto_id:        pidSus,
          producto_nombre:    repuesto.repuesto_descripcion,
          cantidad_reservada: dano.cantidad_danada,
          estado:             'activa' as any,
        });
        const savedReserva = await this.reservasRepo.save(reserva);
        dano.reserva_id = savedReserva.id;
      }
    }

    dano.estado                 = 'aprobado_sustitucion';
    dano.aprobado_por_id        = userId;
    dano.aprobado_por_nombre    = userName;
    dano.es_sustitucion         = true;
    dano.repuesto_producto_id   = repuesto.repuesto_producto_id;
    dano.repuesto_variante_id   = repuesto.repuesto_variante_id;
    dano.repuesto_descripcion   = repuesto.repuesto_descripcion;
    return this.repo.save(dano);
  }

  // ── Rechazar ──────────────────────────────────────────────────────────────
  async rechazar(id: number, userId: number, userName: string, notas?: string): Promise<DanoProduccion> {
    const dano = await this.repo.findOneOrFail({ where: { id } });
    const nota = `[Rechazado por ${userName} el ${new Date().toLocaleDateString('es-DO')}]${notas ? ': ' + notas : ''}`;
    dano.notas  = dano.notas ? `${dano.notas}\n${nota}` : nota;
    dano.estado = 'reportado';
    return this.repo.save(dano);
  }

  // ── Resolver ──────────────────────────────────────────────────────────────
  // Marca el daño como resuelto y consume la reserva de reposición
  async resolver(
    id: number,
    userId: number,
    userName: string,
    data: { cantidad_repuesta: number; costo_repuesto: number },
  ): Promise<DanoProduccion> {
    const dano = await this.repo.findOneOrFail({ where: { id } });
    if (!['aprobado_reponer', 'aprobado_sustitucion'].includes(dano.estado))
      throw new BadRequestException('Solo se pueden resolver daños aprobados');

    // Consumir la reserva de reposición si existe
    if (dano.reserva_id) {
      await this.reservasRepo.update(dano.reserva_id, { estado: 'consumida' as any });
    }

    dano.estado            = 'resuelto';
    dano.cantidad_repuesta = data.cantidad_repuesta;
    dano.costo_repuesto    = data.costo_repuesto;
    if (!dano.aprobado_por_id) {
      dano.aprobado_por_id     = userId;
      dano.aprobado_por_nombre = userName;
    }
    return this.repo.save(dano);
  }

  // ── Sin stock ─────────────────────────────────────────────────────────────
  async marcarSinStock(id: number): Promise<DanoProduccion> {
    const dano = await this.repo.findOneOrFail({ where: { id } });
    dano.estado = 'sin_stock';
    return this.repo.save(dano);
  }
}
