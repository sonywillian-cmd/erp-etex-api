import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule }        from './auth/auth.module';
import { ClientesModule }    from './clientes/clientes.module';
import { ProductosModule }   from './productos/productos.module';
import { CotizacionesModule }from './cotizaciones/cotizaciones.module';
import { ProduccionModule }  from './produccion/produccion.module';
import { InventarioModule }  from './inventario/inventario.module';
import { CajaModule }        from './caja/caja.module';
import { ComprasModule }        from './compras/compras.module';
import { ConfiguracionModule }  from './configuracion/configuracion.module';
import { NotasModule }          from './notas/notas.module';
import { RecepcionesModule }    from './recepciones/recepciones.module';
import { DanosModule }          from './danos/danos.module';
import { FacturacionModule }    from './facturacion/facturacion.module';
import { RecibosModule }        from './recibos/recibos.module';
import { MetricasModule }       from './metricas/metricas.module';
import { AuditoriaModule }      from './auditoria/auditoria.module';
import { IncentivosModule }     from './incentivos/incentivos.module';
import { ReportesModule }          from './reportes/reportes.module';
import { InventarioInternoModule }  from './inventario-interno/inventario-interno.module';
import { CxpModule }                from './cxp/cxp.module';
import { CompromisosModule }        from './compromisos/compromisos.module';
import { HealthModule }             from './health/health.module';
import { EmpleadosModule }          from './empleados/empleados.module';
import { OperariosModule }          from './operarios/operarios.module';
import { AsistenciaModule }         from './asistencia/asistencia.module';

@Module({
  imports: [
    // ── Variables de entorno ──────────────────────────────────────────────
    // ENV_FILE se define en start-api.bat: '.env.production' o '.env.development'
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: process.env.ENV_FILE || '.env',
    }),

    // ── PostgreSQL via TypeORM ────────────────────────────────────────────
    TypeOrmModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (cfg: ConfigService) => ({
        type: 'mysql',
        host:     cfg.get('DB_HOST',     'localhost'),
        port:     cfg.get<number>('DB_PORT', 3306),
        username: cfg.get('DB_USER',     'root'),
        password: cfg.get('DB_PASS',     ''),
        database: cfg.get('DB_NAME',     'erp_etex'),
        entities:    [__dirname + '/**/*.entity{.ts,.js}'],
        synchronize: false,
        logging:     cfg.get('NODE_ENV') === 'development' ? ['error'] : ['error'],
        charset:     'utf8mb4',
      }),
      inject: [ConfigService],
    }),

    // ── Módulos de negocio ────────────────────────────────────────────────
    AuthModule,
    ClientesModule,
    ProductosModule,
    CotizacionesModule,
    ProduccionModule,
    InventarioModule,
    CajaModule,
    ComprasModule,
    ConfiguracionModule,
    NotasModule,
    RecepcionesModule,
    DanosModule,
    AuditoriaModule,
    FacturacionModule,
    RecibosModule,
    MetricasModule,
    IncentivosModule,
    ReportesModule,
    InventarioInternoModule,
    CxpModule,
    CompromisosModule,
    HealthModule,
    EmpleadosModule,
    OperariosModule,
    AsistenciaModule,
  ],
})
export class AppModule {}
