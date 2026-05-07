/**
 * Migración: Terminación se desbloquea cuando la técnica anterior inicia (en_proceso)
 *
 * Cambia `desbloquear_al` a 'en_proceso' para todos los lotes de departamento
 * 'Terminación' que todavía están pendientes o desbloqueados.
 *
 * Ejecución:
 *   cd erp-etex-api
 *   npx ts-node -r tsconfig-paths/register src/migrations/terminacion-desbloquear-al.ts
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

    // Verificar que la columna existe
    const [cols] = await conn.execute<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'lotes_produccion' AND COLUMN_NAME = 'desbloquear_al'`
    );
    if (cols[0].cnt === 0) {
      console.error('❌ Columna desbloquear_al no existe en lotes_produccion');
      process.exit(1);
    }

    // Actualizar lotes de Terminación pendientes/desbloqueados
    const [result] = await conn.execute<mysql.ResultSetHeader>(
      `UPDATE lotes_produccion
       SET desbloquear_al = 'en_proceso'
       WHERE departamento = 'Terminación'
         AND tipo = 'departamento'
         AND estado IN ('pendiente', 'desbloqueado')
         AND desbloquear_al != 'en_proceso'`
    );

    console.log(`✅ ${result.affectedRows} lote(s) de Terminación actualizados a desbloquear_al='en_proceso'`);
    console.log('\n🎉 Migración completada exitosamente');
  } finally {
    await conn.end();
  }
}

run().catch(err => {
  console.error('❌ Error en migración:', err);
  process.exit(1);
});
