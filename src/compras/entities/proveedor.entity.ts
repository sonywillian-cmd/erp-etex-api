import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, UpdateDateColumn, OneToMany } from 'typeorm';
import { ProveedorProducto } from './proveedor-producto.entity';

@Entity('proveedores')
export class Proveedor {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  nombre: string;

  @Column({ nullable: true })
  persona_contacto: string;

  @Column({ nullable: true })
  telefono: string;

  @Column({ nullable: true })
  email: string;

  @Column({ nullable: true, type: 'text' })
  direccion: string;

  @Column({ nullable: true, type: 'text' })
  notas: string;

  @Column({ default: true })
  activo: boolean;

  @OneToMany(() => ProveedorProducto, vp => vp.proveedor, { cascade: true, eager: false })
  productos: ProveedorProducto[];

  @CreateDateColumn()
  creado_en: Date;

  @UpdateDateColumn()
  actualizado_en: Date;
}
