import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index,
} from 'typeorm';

export enum ModuloAuditoria {
  CAJA        = 'caja',
  FACTURACION = 'facturacion',
  EGRESOS     = 'egresos',
  PRODUCCION  = 'produccion',
}

export enum AccionAuditoria {
  // Caja
  SESION_ABIERTA    = 'sesion_abierta',
  SESION_CERRADA    = 'sesion_cerrada',
  SESION_VALIDADA   = 'sesion_validada',
  // Egresos
  EGRESO_REGISTRADO = 'egreso_registrado',
  // Facturación
  FACTURA_CREADA        = 'factura_creada',
  FACTURA_ANULADA       = 'factura_anulada',
  FACTURA_ESTADO_CAMBIADO = 'factura_estado_cambiado',
  PAGO_REGISTRADO       = 'pago_registrado',
  PAGO_REVERTIDO        = 'pago_revertido',
  NOTA_CREDITO_EMITIDA  = 'nota_credito_emitida',
  PAGO_MASIVO           = 'pago_masivo',
  // Recibos / transferencias
  RECIBO_VALIDADO       = 'recibo_validado',
  RECIBO_DESVALIDADO    = 'recibo_desvalidado',
}

@Entity('auditoria_financiera')
export class AuditoriaFinanciera {
  @PrimaryGeneratedColumn()
  id: number;

  @Index()
  @Column({ type: 'varchar', length: 30 })
  modulo: string;

  @Index()
  @Column({ type: 'varchar', length: 50 })
  accion: string;

  @Index()
  @Column({ type: 'int', nullable: true })
  entidad_id: number | null;

  @Column({ type: 'varchar', length: 50, nullable: true })
  entidad_numero: string | null;

  @Column({ type: 'int', nullable: true })
  usuario_id: number | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  usuario_nombre: string | null;

  @Column({ type: 'varchar', length: 30, nullable: true })
  usuario_rol: string | null;

  @Column({ type: 'decimal', precision: 15, scale: 2, nullable: true })
  monto: number | null;

  @Column({ type: 'json', nullable: true })
  datos: Record<string, any> | null;

  @Column({ type: 'varchar', length: 500, nullable: true })
  descripcion: string | null;

  @CreateDateColumn()
  creado_en: Date;
}
