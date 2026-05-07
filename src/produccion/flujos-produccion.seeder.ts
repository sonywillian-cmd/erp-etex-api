import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FlujoProduccion } from './entities/flujo-produccion.entity';
import { TipoProducto, TipoProduccion } from '../productos/entities/producto.entity';

/**
 * Inserta los flujos de producción base la primera vez que arranca el módulo.
 * Si ya existe al menos un flujo en la tabla, no hace nada.
 */
@Injectable()
export class FlujosSeedService implements OnModuleInit {
  private readonly logger = new Logger(FlujosSeedService.name);

  constructor(
    @InjectRepository(FlujoProduccion)
    private readonly repo: Repository<FlujoProduccion>,
  ) {}

  async onModuleInit() {
    const count = await this.repo.count();
    if (count > 0) return;
    await this.seed();
  }

  private async seed() {
    this.logger.log('Insertando flujos de producción base...');

    const flujos: Partial<FlujoProduccion>[] = [
      // ── 1. Solo fabricación (confección sin técnicas) ─────────────────────
      {
        nombre: 'Fabricación sola',
        tipo_producto:      TipoProducto.FISICO_FABRICADO,
        tipo_produccion:    TipoProduccion.FABRICACION,
        tecnica:            null,
        incluye_aplicacion: null,
        incluye_confeccion: null,
        requiere_diseno:    null,
        estructura_json: {
          pasos: [
            {
              temp_id: 1,
              nombre: 'Confección',
              departamento: 'Costura',
              tipo_lote: 'fabricacion',
              tipo_ejecucion: 'paralelo',
              orden_ejecucion: 0,
              depende_de: null,
            },
            {
              temp_id: 99,
              nombre: 'Terminación',
              departamento: 'Terminación',
              tipo_lote: 'proceso',
              tipo_ejecucion: 'secuencial',
              orden_ejecucion: 99,
              depende_de: 1,
            },
          ],
        },
        activo: true,
      },

      // ── 2. Fabricación + técnicas encadenadas ─────────────────────────────
      {
        nombre: 'Fabricación con proceso',
        tipo_producto:      TipoProducto.FISICO_FABRICADO,
        tipo_produccion:    TipoProduccion.FABRICACION_PROCESO,
        tecnica:            null,
        incluye_aplicacion: null,
        incluye_confeccion: null,
        requiere_diseno:    null,
        estructura_json: {
          pasos: [
            {
              temp_id: 1,
              nombre: 'Confección',
              departamento: 'Costura',
              tipo_lote: 'fabricacion',
              tipo_ejecucion: 'secuencial',
              orden_ejecucion: 0,
              depende_de: null,
            },
            {
              // $tecnica → se expande en un lote por cada técnica de la línea
              temp_id: 2,
              nombre: '$tecnica',
              departamento: '$tecnica',
              tipo_lote: 'proceso',
              tipo_ejecucion: 'secuencial',
              orden_ejecucion: 1,
              depende_de: 1,
            },
            {
              temp_id: 99,
              nombre: 'Terminación',
              departamento: 'Terminación',
              tipo_lote: 'proceso',
              tipo_ejecucion: 'secuencial',
              orden_ejecucion: 99,
              depende_de: 2,
            },
          ],
        },
        activo: true,
      },

      // ── 3. Solo técnicas sobre pieza fabricada ────────────────────────────
      {
        nombre: 'Proceso sobre fabricado',
        tipo_producto:      TipoProducto.FISICO_FABRICADO,
        tipo_produccion:    TipoProduccion.PROCESO,
        tecnica:            null,
        incluye_aplicacion: null,
        incluye_confeccion: null,
        requiere_diseno:    null,
        estructura_json: {
          pasos: [
            {
              temp_id: 1,
              nombre: '$tecnica',
              departamento: '$tecnica',
              tipo_lote: 'proceso',
              tipo_ejecucion: 'paralelo',
              orden_ejecucion: 0,
              depende_de: null,
            },
            {
              temp_id: 99,
              nombre: 'Terminación',
              departamento: 'Terminación',
              tipo_lote: 'proceso',
              tipo_ejecucion: 'secuencial',
              orden_ejecucion: 99,
              depende_de: 1,
            },
          ],
        },
        activo: true,
      },

      // ── 4. Aplicación / personalización sobre pieza comprada ──────────────
      {
        nombre: 'Aplicación sobre comprado',
        tipo_producto:      TipoProducto.FISICO_COMPRADO,
        tipo_produccion:    null,
        tecnica:            null,
        incluye_aplicacion: null,
        incluye_confeccion: null,
        requiere_diseno:    null,
        estructura_json: {
          pasos: [
            {
              temp_id: 1,
              nombre: '$tecnica',
              departamento: '$tecnica',
              tipo_lote: 'proceso',
              tipo_ejecucion: 'paralelo',
              orden_ejecucion: 0,
              depende_de: null,
            },
            {
              temp_id: 99,
              nombre: 'Terminación',
              departamento: 'Terminación',
              tipo_lote: 'proceso',
              tipo_ejecucion: 'secuencial',
              orden_ejecucion: 99,
              depende_de: 1,
            },
          ],
        },
        activo: true,
      },

      // ── 5. Servicio (el cliente trae las piezas) ──────────────────────────
      {
        nombre: 'Servicio',
        tipo_producto:      TipoProducto.SERVICIO,
        tipo_produccion:    null,
        tecnica:            null,
        incluye_aplicacion: null,
        incluye_confeccion: null,
        requiere_diseno:    null,
        estructura_json: {
          pasos: [
            {
              temp_id: 1,
              nombre: '$tecnica',
              departamento: '$tecnica',
              tipo_lote: 'servicio',
              tipo_ejecucion: 'paralelo',
              orden_ejecucion: 0,
              depende_de: null,
            },
            {
              temp_id: 99,
              nombre: 'Terminación',
              departamento: 'Terminación',
              tipo_lote: 'proceso',
              tipo_ejecucion: 'secuencial',
              orden_ejecucion: 99,
              depende_de: 1,
            },
          ],
        },
        activo: true,
      },

      // ── 6. Genérico (fallback con flujo, tipo_producto desconocido) ────────
      {
        nombre: 'Genérico',
        tipo_producto:      null,
        tipo_produccion:    null,
        tecnica:            null,
        incluye_aplicacion: null,
        incluye_confeccion: null,
        requiere_diseno:    null,
        estructura_json: {
          pasos: [
            {
              temp_id: 1,
              nombre: '$tecnica',
              departamento: '$tecnica',
              tipo_lote: 'proceso',
              tipo_ejecucion: 'paralelo',
              orden_ejecucion: 0,
              depende_de: null,
            },
            {
              temp_id: 99,
              nombre: 'Terminación',
              departamento: 'Terminación',
              tipo_lote: 'proceso',
              tipo_ejecucion: 'secuencial',
              orden_ejecucion: 99,
              depende_de: 1,
            },
          ],
        },
        activo: true,
      },
    ];

    await this.repo.save(flujos as FlujoProduccion[]);
    this.logger.log(`${flujos.length} flujos de producción insertados.`);
  }
}
