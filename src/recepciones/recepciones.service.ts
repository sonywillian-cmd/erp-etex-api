import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { InjectDataSource } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import {
  RecepcionDepartamento,
  ItemRecepcion,
} from './recepcion-departamento.entity';

@Injectable()
export class RecepcionesService {
  constructor(
    @InjectRepository(RecepcionDepartamento)
    private repo: Repository<RecepcionDepartamento>,
    @InjectDataSource() private dataSource: DataSource,
  ) {}

  async crearTabla(): Promise<{ message: string }> {
    await this.dataSource.query(`
      CREATE TABLE IF NOT EXISTS recepciones_departamento (
        id                    INT            NOT NULL AUTO_INCREMENT,
        lote_id               INT            NOT NULL,
        orden_id              INT            NOT NULL,
        orden_numero          VARCHAR(50)    NOT NULL,
        dpto_origen           VARCHAR(100)   NOT NULL,
        dpto_destino          VARCHAR(100)   NOT NULL,
        items                 JSON           NOT NULL,
        estado                VARCHAR(20)    NOT NULL DEFAULT 'pendiente',
        creado_en             DATETIME(6)    NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        confirmado_por_id     INT            NULL,
        confirmado_por_nombre VARCHAR(150)   NULL,
        confirmado_en         DATETIME       NULL,
        notas                 TEXT           NULL,
        PRIMARY KEY (id),
        INDEX idx_rec_lote    (lote_id),
        INDEX idx_rec_orden   (orden_id),
        INDEX idx_rec_dpto_destino (dpto_destino, estado)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    return { message: 'Tabla recepciones_departamento verificada/creada correctamente.' };
  }

  async crear(data: {
    lote_id: number;
    orden_id: number;
    orden_numero: string;
    dpto_origen: string;
    dpto_destino: string;
    items: ItemRecepcion[];
  }): Promise<RecepcionDepartamento> {
    const recepcion = this.repo.create({
      lote_id:      data.lote_id,
      orden_id:     data.orden_id,
      orden_numero: data.orden_numero,
      dpto_origen:  data.dpto_origen,
      dpto_destino: data.dpto_destino,
      items:        data.items,
      estado:       'pendiente',
    });
    return this.repo.save(recepcion);
  }

  async confirmar(
    id: number,
    userId: number,
    userName: string,
    itemsRecibidos: { lote_id: number; cantidad_recibida: number }[],
    notas?: string,
  ): Promise<RecepcionDepartamento> {
    const recepcion = await this.repo.findOneOrFail({ where: { id } });

    // Merge quantities received into items
    const itemsActualizados: ItemRecepcion[] = recepcion.items.map(item => {
      const recibido = itemsRecibidos.find(r => r.lote_id === item.lote_id);
      return {
        ...item,
        cantidad_recibida: recibido !== undefined ? recibido.cantidad_recibida : item.cantidad_recibida,
      };
    });

    // Determine estado: con_diferencias if any cantidad_recibida != cantidad_enviada
    const hayDiferencias = itemsActualizados.some(
      item =>
        item.cantidad_recibida !== null &&
        item.cantidad_recibida !== item.cantidad_enviada,
    );

    recepcion.items               = itemsActualizados;
    recepcion.estado              = hayDiferencias ? 'con_diferencias' : 'confirmada';
    recepcion.confirmado_por_id   = userId;
    recepcion.confirmado_por_nombre = userName;
    recepcion.confirmado_en       = new Date();
    if (notas !== undefined) recepcion.notas = notas;

    return this.repo.save(recepcion);
  }

  getPendientesByDpto(dpto: string): Promise<RecepcionDepartamento[]> {
    return this.repo.find({
      where: { dpto_destino: dpto, estado: 'pendiente' },
      order: { creado_en: 'DESC' },
    });
  }

  getByOrden(ordenId: number): Promise<RecepcionDepartamento[]> {
    return this.repo.find({
      where: { orden_id: ordenId },
      order: { creado_en: 'ASC' },
    });
  }

  getByLote(loteId: number): Promise<RecepcionDepartamento[]> {
    return this.repo.find({
      where: { lote_id: loteId },
      order: { creado_en: 'ASC' },
    });
  }
}
