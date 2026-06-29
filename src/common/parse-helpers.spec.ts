import {
  parsearMonto,
  categoriaToDgii606,
  metodoPagoToDgii,
  tipoIdentificacion,
  upper,
  fechaDgii,
  ncfFromSecuencia,
} from './parse-helpers';

/**
 * Tests de funciones puras de parsing.
 * Sin mocks, sin BD — input → output puro.
 * Estos tests deben ser RÁPIDOS y 100% confiables.
 */

describe('parsearMonto', () => {
  it.each([
    ['4567',       4567],
    ['4,567',      4567],         // separador miles US, 1 grupo
    ['4567.50',    4567.50],      // decimal punto
    ['1,234.56',   1234.56],      // formato US
    ['1.234,56',   1234.56],      // formato latino
    ['25,000.00',  25000.00],     // US con cero decimales
    ['25.000,00',  25000.00],     // latino con cero decimales
    ['1.234.567',  1234567],      // múltiples puntos = miles
    ['1,234,567',  1234567],      // múltiples comas = miles
    ['100',        100],
    ['0.50',       0.50],
    ['0,50',       0.50],         // 1 coma + 2 decimales → latino
  ])('parsea "%s" → %f', (input, esperado) => {
    expect(parsearMonto(input)).toBe(esperado);
  });

  it.each([
    [null],
    [undefined],
    [''],
    ['no hay número'],
    ['abc'],
  ])('devuelve null para input inválido: %s', (input) => {
    expect(parsearMonto(input as any)).toBe(null);
  });

  it('extrae monto de texto con palabras', () => {
    expect(parsearMonto('pago alquiler 25000 efectivo')).toBe(25000);
    expect(parsearMonto('factura claro 1,850.00 vence 30 jun')).toBe(1850);
  });
});

describe('categoriaToDgii606', () => {
  it.each([
    ['nomina', '01'],
    ['servicios', '02'],
    ['materia_prima', '02'],
    ['tecnologia', '02'],
    ['mantenimiento', '02'],
    ['alquiler', '03'],
    ['prestamos', '06'],
    ['impuestos', '11'],
    ['otros', '02'],
    ['NOMINA', '01'],          // case insensitive
    ['ALQUILER', '03'],
  ])('mapea categoría "%s" a código DGII %s', (cat, codigo) => {
    expect(categoriaToDgii606(cat)).toBe(codigo);
  });

  it('default 02 para categoría desconocida', () => {
    expect(categoriaToDgii606('inventada')).toBe('02');
    expect(categoriaToDgii606(null)).toBe('02');
    expect(categoriaToDgii606(undefined)).toBe('02');
  });
});

describe('metodoPagoToDgii', () => {
  it.each([
    ['efectivo', '01'],
    ['transferencia', '02'],
    ['cheque', '02'],
    ['tarjeta', '03'],
    ['credito', '04'],
    ['EFECTIVO', '01'],
  ])('mapea método "%s" a código DGII %s', (m, c) => {
    expect(metodoPagoToDgii(m)).toBe(c);
  });

  it('default 01 (efectivo) para desconocido', () => {
    expect(metodoPagoToDgii('bitcoin' as any)).toBe('01');
    expect(metodoPagoToDgii(null)).toBe('01');
  });
});

describe('tipoIdentificacion', () => {
  it('clasifica RNC 9 dígitos como tipo 2', () => {
    expect(tipoIdentificacion('131693679')).toBe('2');
    expect(tipoIdentificacion('131-69-3679')).toBe('2');   // con guiones
    expect(tipoIdentificacion('131036686')).toBe('2');
  });

  it('clasifica cédula 11 dígitos como tipo 1', () => {
    expect(tipoIdentificacion('02601390905')).toBe('1');
    expect(tipoIdentificacion('001-1234567-8')).toBe('1');
  });

  it('clasifica otros como tipo 3 (pasaporte)', () => {
    expect(tipoIdentificacion('AB1234')).toBe('3');
    expect(tipoIdentificacion('12345')).toBe('3');
    expect(tipoIdentificacion('')).toBe('3');
    expect(tipoIdentificacion(null)).toBe('3');
  });
});

describe('upper', () => {
  it('convierte string a mayúsculas', () => {
    expect(upper('hello world')).toBe('HELLO WORLD');
    expect(upper('Bordado')).toBe('BORDADO');
  });

  it('mantiene null/undefined sin alterar', () => {
    expect(upper(null)).toBe(null);
    expect(upper(undefined)).toBe(undefined);
  });

  it('no altera números ni booleanos', () => {
    expect(upper(123)).toBe(123);
    expect(upper(true)).toBe(true);
    expect(upper(0)).toBe(0);
  });

  it('no falla con string vacío', () => {
    expect(upper('')).toBe('');
  });
});

describe('fechaDgii', () => {
  it('formatea Date local a YYYYMMDD', () => {
    // Usamos constructor local (year, month, day) para evitar shifts UTC
    expect(fechaDgii(new Date(2026, 5, 4))).toBe('20260604');   // 4 junio
    expect(fechaDgii(new Date(2026, 0, 1))).toBe('20260101');   // 1 enero
    expect(fechaDgii(new Date(2026, 11, 31))).toBe('20261231'); // 31 diciembre
  });

  it('formatea string YYYY-MM-DD sin shift de timezone', () => {
    // Esta era la trampa: 'YYYY-MM-DD' a secas se parseaba como UTC y al leer
    // en hora local (RD = GMT-4) cambiaba el día. Lo arreglamos.
    expect(fechaDgii('2026-06-04')).toBe('20260604');
    expect(fechaDgii('2026-01-01')).toBe('20260101');
    expect(fechaDgii('2026-12-31')).toBe('20261231');
  });

  it('formatea string ISO con hora correctamente', () => {
    expect(fechaDgii('2026-06-04T15:30:00')).toBe('20260604');
  });

  it('devuelve "" para fechas inválidas', () => {
    expect(fechaDgii(null)).toBe('');
    expect(fechaDgii(undefined)).toBe('');
    expect(fechaDgii('')).toBe('');
    expect(fechaDgii('no es fecha')).toBe('');
  });
});

describe('ncfFromSecuencia', () => {
  it('genera NCF con 8 dígitos cero-padded', () => {
    expect(ncfFromSecuencia('B01', 3485)).toBe('B0100003485');
    expect(ncfFromSecuencia('B02', 1)).toBe('B0200000001');
    expect(ncfFromSecuencia('B14', 73)).toBe('B1400000073');
    expect(ncfFromSecuencia('B15', 63)).toBe('B1500000063');
  });

  it('maneja números grandes (hasta 99,999,999)', () => {
    expect(ncfFromSecuencia('B01', 99999999)).toBe('B0199999999');
  });
});
