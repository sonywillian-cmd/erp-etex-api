import { Module } from '@nestjs/common';
import { MaterialesOrdenService } from './materiales-orden.service';

/**
 * Cálculo único de materiales por talla y color. Lo usan producción (al crear y
 * editar órdenes) y compras (al generar y recibir órdenes de compra). Vive aparte
 * para que ninguno de los dos módulos tenga que importar al otro.
 */
@Module({
  providers: [MaterialesOrdenService],
  exports:   [MaterialesOrdenService],
})
export class MaterialesModule {}
