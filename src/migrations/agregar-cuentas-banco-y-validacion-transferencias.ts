/**
 * Migración: Cuentas bancarias + validación de transferencias
 *
 * Cambios:
 *   1. Crea tabla `cuentas_banco`
 *   2. Agrega columnas de transferencia y validación a `recibos_ingreso`
 *   3. Agrega columnas de transferencia y validación a `factura_pagos`
 *
 * Ejecución:
 *   cd erp-etex-api
 *   npx ts-node -r tsconfig-paths/register src/migrations/agregar-cuentas-banco-y-validacion-transferencias.ts
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

    // ── 1. Crear tabla cuentas_banco ────────────────────────────────────────
    const [tbl] = await conn.execute<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'cuentas_banco'`
    );
    if (tbl[0].cnt === 0) {
      await conn.execute(`
        CREATE TABLE cuentas_banco (
          id             INT          NOT NULL AUTO_INCREMENT,
          banco          VARCHAR(100) NOT NULL,
          digitos        VARCHAR(4)   NOT NULL,
          tipo_cuenta    VARCHAR(20)  NOT NULL DEFAULT 'corriente',
          titular        VARCHAR(150) NULL,
          alias          VARCHAR(80)  NULL,
          activo         TINYINT(1)   NOT NULL DEFAULT 1,
          creado_en      DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
          actualizado_en DATETIME(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
          PRIMARY KEY (id)
        ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci
      `);
      console.log('✅ Tabla `cuentas_banco` creada');
    } else {
      console.log('ℹ️  Tabla `cuentas_banco` ya existe');
    }

    // ── 2. Columnas en recibos_ingreso ───────────────────────────────────────
    const colsRecibos = [
      { name: 'banco_nombre',    sql: `ADD COLUMN banco_nombre    VARCHAR(100) NULL AFTER referencia` },
      { name: 'cuenta_digitos',  sql: `ADD COLUMN cuenta_digitos  VARCHAR(4)   NULL AFTER banco_nombre` },
      { name: 'cuenta_banco_id', sql: `ADD COLUMN cuenta_banco_id INT          NULL AFTER cuenta_digitos` },
      { name: 'validado',        sql: `ADD COLUMN validado        TINYINT(1)   NOT NULL DEFAULT 0 AFTER cuenta_banco_id` },
      { name: 'validado_por',    sql: `ADD COLUMN validado_por    VARCHAR(100) NULL AFTER validado` },
      { name: 'validado_en',     sql: `ADD COLUMN validado_en     DATETIME     NULL AFTER validado_por` },
    ];

    for (const col of colsRecibos) {
      const [r] = await conn.execute<mysql.RowDataPacket[]>(
        `SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'recibos_ingreso' AND COLUMN_NAME = ?`,
        [col.name]
      );
      if (r[0].cnt === 0) {
        await conn.execute(`ALTER TABLE recibos_ingreso ${col.sql}`);
        console.log(`✅ Columna \`${col.name}\` agregada a recibos_ingreso`);
      } else {
        console.log(`ℹ️  Columna \`${col.name}\` ya existe en recibos_ingreso`);
      }
    }

    // ── 3. Columnas en factura_pagos ─────────────────────────────────────────
    const colsPagos = [
      { name: 'banco_nombre',    sql: `ADD COLUMN banco_nombre    VARCHAR(100) NULL AFTER referencia` },
      { name: 'cuenta_digitos',  sql: `ADD COLUMN cuenta_digitos  VARCHAR(4)   NULL AFTER banco_nombre` },
      { name: 'cuenta_banco_id', sql: `ADD COLUMN cuenta_banco_id INT          NULL AFTER cuenta_digitos` },
      { name: 'validado',        sql: `ADD COLUMN validado        TINYINT(1)   NOT NULL DEFAULT 0 AFTER cuenta_banco_id` },
      { name: 'validado_por',    sql: `ADD COLUMN validado_por    VARCHAR(100) NULL AFTER validado` },
      { name: 'validado_en',     sql: `ADD COLUMN validado_en     DATETIME     NULL AFTER validado_por` },
    ];

    for (const col of colsPagos) {
      const [r] = await conn.execute<mysql.RowDataPacket[]>(
        `SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'factura_pagos' AND COLUMN_NAME = ?`,
        [col.name]
      );
      if (r[0].cnt === 0) {
        await conn.execute(`ALTER TABLE factura_pagos ${col.sql}`);
        console.log(`✅ Columna \`${col.name}\` agregada a factura_pagos`);
      } else {
        console.log(`ℹ️  Columna \`${col.name}\` ya existe en factura_pagos`);
      }
    }

    console.log('\n🎉 Migración completada exitosamente');
  } finally {
    await conn.end();
  }
}

run().catch(err => {
  console.error('❌ Error en migración:', err);
  process.exit(1);
});
