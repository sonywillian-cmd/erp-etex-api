/**
 * Migración: Mejora términos de crédito en clientes.
 *
 * Cambios:
 *   1. Agrega columna `plazo_credito` INT NULL a `clientes`
 *   2. Normaliza `terminos_pago`: mapea valores legacy a "contado" o "credito"
 *
 * Ejecución:
 *   cd erp-etex-api
 *   npx ts-node -r tsconfig-paths/register src/migrations/agregar-plazo-credito-clientes.ts
 */

import 'dotenv/config';
import * as mysql from 'mysql2/promise';

async function run() {
  const conn = await mysql.createConnection({
    host:     process.env.DB_HOST     ?? 'localhost',
    port:     parseInt(process.env.DB_PORT ?? '3306'),
    user:     process.env.DB_USER     ?? 'root',
    password: process.env.DB_PASS     ?? '',
    database: process.env.DB_NAME     ?? 'erp_etex',
  });

  try {
    console.log('🔌 Conectado a la base de datos');

    // ── 1. Agregar columna plazo_credito ─────────────────────────────────────
    const [rows] = await conn.execute<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'clientes' AND COLUMN_NAME = 'plazo_credito'`
    );
    if (rows[0].cnt === 0) {
      await conn.execute(
        `ALTER TABLE clientes ADD COLUMN plazo_credito INT NULL AFTER limite_credito`
      );
      console.log('✅ Columna `plazo_credito` agregada a clientes');
    } else {
      console.log('ℹ️  Columna `plazo_credito` ya existe');
    }

    // ── 2. Normalizar terminos_pago legacy → contado / credito ───────────────
    // Valores que implican crédito
    const creditoValues = ['30 días', '60 días', '90 días', 'credito', 'crédito', 'a credito', 'a crédito'];
    // Todo lo demás → contado
    const placeholders = creditoValues.map(() => '?').join(', ');

    const [updated] = await conn.execute<mysql.ResultSetHeader>(
      `UPDATE clientes
       SET terminos_pago = 'credito'
       WHERE terminos_pago IN (${placeholders})`,
      creditoValues
    );
    console.log(`✅ ${updated.affectedRows} cliente(s) marcados como "credito"`);

    const [updated2] = await conn.execute<mysql.ResultSetHeader>(
      `UPDATE clientes
       SET terminos_pago = 'contado'
       WHERE terminos_pago IS NOT NULL
         AND terminos_pago NOT IN ('contado', 'credito')`
    );
    console.log(`✅ ${updated2.affectedRows} cliente(s) normalizados a "contado"`);

    console.log('\n🎉 Migración completada exitosamente');
  } finally {
    await conn.end();
  }
}

run().catch(err => {
  console.error('❌ Error en migración:', err);
  process.exit(1);
});
