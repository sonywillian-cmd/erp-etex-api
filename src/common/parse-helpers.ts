/**
 * Helpers puros de parsing — sin dependencias externas.
 * Compartidos entre módulos (CxP, compromisos, gastos, bot Telegram).
 *
 * Estos helpers son TESTEABLES sin mocks: input → output puro.
 */

/**
 * Parsea un monto en distintos formatos comunes en RD:
 * - "4567"        → 4567
 * - "4,567"       → 4567
 * - "4567.50"     → 4567.50
 * - "1,234.56"    → 1234.56   (formato US)
 * - "1.234,56"    → 1234.56   (formato latino)
 * - "1234.567"    → 1234567   (separadores de miles)
 *
 * Devuelve `null` si el texto no contiene número válido.
 */
export function parsearMonto(texto: string | null | undefined): number | null {
  if (!texto) return null;
  const match = String(texto).match(
    /(\d{1,3}(?:[\.,]\d{3})+(?:[\.,]\d{1,2})?|\d+(?:[\.,]\d{1,2})?)/,
  );
  if (!match) return null;

  let s = match[1];

  if (s.includes('.') && s.includes(',')) {
    // Ambos separadores: el ÚLTIMO es el decimal
    const lastDot = s.lastIndexOf('.');
    const lastCom = s.lastIndexOf(',');
    if (lastCom > lastDot) {
      // Formato latino: 1.234,56
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      // Formato US: 1,234.56
      s = s.replace(/,/g, '');
    }
  } else if (s.includes(',')) {
    const partes = s.split(',');
    // Si última parte tiene 2 dígitos y solo hay 1 coma → decimal latino
    if (partes[partes.length - 1].length <= 2 && partes.length === 2) {
      s = s.replace(',', '.');
    } else {
      // Separadores de miles: quitarlos
      s = s.replace(/,/g, '');
    }
  } else if (s.includes('.')) {
    const partes = s.split('.');
    if (partes.length > 2 || partes[partes.length - 1].length === 3) {
      // Múltiples puntos o grupo de 3 al final → separadores de miles
      s = s.replace(/\./g, '');
    }
  }

  const n = Number(s);
  return isNaN(n) ? null : n;
}

/**
 * Convierte categoría interna a código DGII de bienes/servicios para el reporte 606.
 * Códigos DGII: 01=Personal, 02=Trabajos/Servicios, 03=Arrendamientos,
 * 04=Activos Fijos, 05=Representación, 06=Financieros, ..., 11=Otras
 */
export function categoriaToDgii606(categoria: string | null | undefined): string {
  const mapa: Record<string, string> = {
    nomina: '01',
    servicios: '02',
    mantenimiento: '02',
    materia_prima: '02',
    tecnologia: '02',
    alquiler: '03',
    prestamos: '06',
    impuestos: '11',
    otros: '02',
  };
  return mapa[String(categoria || '').toLowerCase()] || '02';
}

/**
 * Convierte método de pago a código DGII forma de pago.
 * 01=Efectivo, 02=Cheques/Transferencias, 03=Tarjeta, 04=Crédito, 07=Mixto
 */
export function metodoPagoToDgii(metodo: string | null | undefined): string {
  const mapa: Record<string, string> = {
    efectivo: '01',
    transferencia: '02',
    cheque: '02',
    tarjeta: '03',
    credito: '04',
  };
  return mapa[String(metodo || '').toLowerCase()] || '01';
}

/**
 * Determina tipo de identificación DGII según longitud del documento.
 * 1=Cédula (11 dígitos), 2=RNC (9 dígitos), 3=Pasaporte/otro
 */
export function tipoIdentificacion(documento: string | null | undefined): string {
  const limpio = String(documento || '').replace(/[^0-9]/g, '');
  if (limpio.length === 9) return '2';   // RNC
  if (limpio.length === 11) return '1';  // Cédula
  return '3';                             // Pasaporte
}

/**
 * Convierte cualquier cosa a MAYÚSCULAS si es string, o pasa null/undefined sin alterar.
 * Útil para upserts donde los campos pueden ser opcionales.
 */
export function upper(v: any): any {
  if (v == null) return v;
  if (typeof v !== 'string') return v;
  return v.toUpperCase();
}

/**
 * Convierte una fecha (Date o string ISO) a formato DGII YYYYMMDD.
 * - Strings tipo "YYYY-MM-DD" se parsean como fecha CIVIL (sin TZ, evitando shifts).
 * - Strings con hora ISO (con T) se usan tal cual.
 * - Date objects se leen en LOCAL TIME (lo que la BD ya devolvió).
 * Devuelve "" si no es válida.
 */
export function fechaDgii(fecha: Date | string | null | undefined): string {
  if (!fecha) return '';

  let d: Date;
  if (fecha instanceof Date) {
    d = fecha;
  } else {
    const s = String(fecha);
    // Si es YYYY-MM-DD sin hora, parseamos sin TZ para evitar shift UTC
    const matchSoloFecha = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (matchSoloFecha) {
      d = new Date(Number(matchSoloFecha[1]), Number(matchSoloFecha[2]) - 1, Number(matchSoloFecha[3]));
    } else {
      d = new Date(s);
    }
  }

  if (isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}${m}${day}`;
}

/**
 * Genera un NCF a partir del tipo y número de secuencia.
 * Ejemplo: ncfFromSecuencia('B01', 3485) → 'B0100003485'
 */
export function ncfFromSecuencia(tipo: string, numero: number): string {
  return `${tipo}${String(numero).padStart(8, '0')}`;
}
