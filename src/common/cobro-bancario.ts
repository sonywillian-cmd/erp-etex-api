import { BadRequestException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';

/**
 * Candado de cobros bancarios.
 *
 * Todo cobro por TRANSFERENCIA o CHEQUE cae en una cuenta nuestra, así que debe
 * decir en cuál. Sin eso el panel "Validar transferencias" no se puede cuadrar
 * contra el estado de cuenta del banco.
 *
 * La regla vive en el backend a propósito: el frontend ya la pedía en algunas
 * pantallas, pero el bot de Telegram, el asistente, el pago masivo y cualquier
 * llamada directa a la API la saltaban. Aquí no la salta nadie.
 */

/** Métodos cuyo dinero entra a una cuenta bancaria de la empresa. */
export const METODOS_CON_CUENTA_DESTINO = ['transferencia', 'cheque'];

export interface DatosBancarios {
  metodo?: string | null;
  cuenta_banco_id?: number | null;
  banco_nombre?: string | null;
  cuenta_digitos?: string | null;
}

export interface CuentaResuelta {
  cuenta_banco_id: number;
  banco_nombre:    string;
  cuenta_digitos:  string;
}

/**
 * Exige y resuelve la cuenta de destino cuando el método lo requiere.
 * Devuelve el banco y los dígitos ya normalizados desde el catálogo —así el
 * nombre del banco nunca queda escrito a mano ni distinto entre pantallas—,
 * o `null` si el método no necesita cuenta (efectivo, tarjeta, crédito).
 */
export async function resolverCuentaDestino(
  ds: DataSource | EntityManager,
  dto: DatosBancarios,
): Promise<CuentaResuelta | null> {
  const metodo = String(dto.metodo ?? '').toLowerCase();
  if (!METODOS_CON_CUENTA_DESTINO.includes(metodo)) return null;

  const esCheque = metodo === 'cheque';
  if (!dto.cuenta_banco_id) {
    throw new BadRequestException(
      esCheque
        ? 'Selecciona la cuenta bancaria donde se depositó el cheque.'
        : 'Selecciona la cuenta bancaria que recibió la transferencia. Sin ella no se puede certificar contra el banco.',
    );
  }

  const [cta] = await ds.query(
    `SELECT id, banco, digitos, activo FROM cuentas_banco WHERE id = ?`,
    [dto.cuenta_banco_id],
  );
  if (!cta) throw new BadRequestException('La cuenta bancaria indicada no existe.');
  if (!cta.activo) {
    throw new BadRequestException(`La cuenta ${cta.banco} está inactiva. Elige una cuenta activa (Ajustes → Cuentas de banco).`);
  }

  return {
    cuenta_banco_id: Number(cta.id),
    banco_nombre:    cta.banco,
    cuenta_digitos:  cta.digitos ?? '',
  };
}
