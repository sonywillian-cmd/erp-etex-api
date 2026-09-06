import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, OneToMany } from 'typeorm';

export enum TipoProducto {
  FISICO_FABRICADO = 'fisico_fabricado', // se confecciona en el taller (puede llevar técnicas)
  FISICO_COMPRADO  = 'fisico_comprado',  // se compra a proveedor y se vende o personaliza
  SERVICIO         = 'servicio',         // trabajo sobre pieza del cliente, sin stock
}

export enum TipoProduccion {
  FABRICACION          = 'fabricacion',          // solo confección
  PROCESO              = 'proceso',              // solo técnicas (DTF, bordado, etc.)
  FABRICACION_PROCESO  = 'fabricacion_proceso',  // confección + técnicas encadenadas
}

@Entity('productos')
export class Producto {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  nombre: string;

  @Column({ nullable: true })
  descripcion: string;

  @Column({ nullable: true, unique: true })
  sku: string;

  @Column({ nullable: true })
  categoria: string;

  @Column({ nullable: true })
  marca: string;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  precio_base: number;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  costo: number;

  @Column({ default: 'Pieza' })
  unidad: string;

  /** Piezas físicas por unidad vendida (un uniforme = camiseta + short = 2).
   *  Autocompleta las "aplicaciones por técnica" al cotizar, que es lo que se
   *  le cuenta al operario en producción. */
  @Column({ type: 'int', default: 1 })
  piezas_por_unidad: number;

  @Column({ default: true })
  aplica_itbis: boolean;

  @Column({ default: true })
  es_personalizable: boolean;

  @Column({ default: true })
  activo: boolean;

  @Column({ default: true })
  maneja_inventario: boolean;

  @Column({ type: 'int', default: 0 })
  stock_actual: number;

  @Column({ type: 'int', default: 0 })
  stock_minimo: number;

  @Column({ nullable: true })
  proveedor: string;

  @Column({ nullable: true })
  notas: string;

  // ── Sistema de precios ──────────────────────────────────────────────────────
  @Column({ type: 'decimal', precision: 5, scale: 2, default: 30 })
  margen_ganancia: number;   // % de margen sobre el costo

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 })
  precio_minimo: number;     // precio mínimo permitido de venta

  // ── Atributos de variantes: [{"nombre":"Color","valores":["Rojo","Azul"]}] ──
  @Column({ type: 'json', nullable: true })
  atributos: { nombre: string; valores: string[] }[] | null;

  // ── Precios por rango de talla: {"#16":275,"S-XL":300,"XXL":320} ───────────
  @Column({ type: 'json', nullable: true })
  precios_por_talla: Record<string, number> | null;

  // ── Costos por rango de talla: {"#16":120,"S-XL":135,"XXL":150} ─────────────
  @Column({ type: 'json', nullable: true })
  costos_por_talla: Record<string, number> | null;

  // ── Tallas por rango: {"S-XL":["S","M","L","XL"],"XXL":["XXL"],"#16":["16"]} ─
  @Column({ type: 'json', nullable: true })
  tallas_por_rango: Record<string, string[]> | null;

  // ── Técnicas compatibles ────────────────────────────────────────────────────
  @Column({ type: 'json', nullable: true })
  tecnicas: string[] | null;

  // ── Clasificación de producto ────────────────────────────────────────────────
  @Column({ type: 'enum', enum: TipoProducto, default: TipoProducto.FISICO_COMPRADO })
  tipo_producto: TipoProducto;

  // Solo aplica cuando tipo_producto = fisico_fabricado
  @Column({ type: 'enum', enum: TipoProduccion, nullable: true })
  tipo_produccion: TipoProduccion | null;

  @CreateDateColumn()
  creado_en: Date;

  @UpdateDateColumn()
  actualizado_en: Date;
}
