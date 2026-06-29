/**
 * Utilidades de fecha en zona horaria local (America/Santo_Domingo = UTC-4).
 * El servidor corre en UTC, pero el negocio opera en RD (UTC-4, sin DST).
 */

const OFFSET_MS = -4 * 60 * 60 * 1000; // UTC-4 en milisegundos

/** Devuelve un Date ajustado a UTC-4 */
export function ahoraLocal(): Date {
  return new Date(Date.now() + OFFSET_MS);
}

/** Devuelve la fecha local como string YYYY-MM-DD */
export function fechaHoyLocal(): string {
  const d = ahoraLocal();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/** Devuelve el primer día del mes actual en UTC-4 como YYYY-MM-DD */
export function primerDiaMesLocal(): string {
  const d = ahoraLocal();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  return `${y}-${m}-01`;
}
