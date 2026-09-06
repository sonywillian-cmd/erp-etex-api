/*M!999999\- enable the sandbox mode */ 

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*M!100616 SET @OLD_NOTE_VERBOSITY=@@NOTE_VERBOSITY, NOTE_VERBOSITY=0 */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `apertura_cajas` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `fecha` date NOT NULL,
  `monto_inicio` decimal(12,2) NOT NULL DEFAULT 0.00,
  `abierto_por` varchar(255) DEFAULT NULL,
  `estado` varchar(50) NOT NULL DEFAULT 'abierta',
  `abierto_en` datetime(6) NOT NULL DEFAULT current_timestamp(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_apertura_fecha` (`fecha`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `auditoria_financiera` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `modulo` varchar(30) NOT NULL,
  `accion` varchar(50) NOT NULL,
  `entidad_id` int(11) DEFAULT NULL,
  `entidad_numero` varchar(50) DEFAULT NULL,
  `usuario_id` int(11) DEFAULT NULL,
  `usuario_nombre` varchar(100) DEFAULT NULL,
  `usuario_rol` varchar(30) DEFAULT NULL,
  `monto` decimal(15,2) DEFAULT NULL,
  `datos` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`datos`)),
  `descripcion` varchar(500) DEFAULT NULL,
  `creado_en` datetime(6) NOT NULL DEFAULT current_timestamp(6),
  PRIMARY KEY (`id`),
  KEY `idx_modulo` (`modulo`),
  KEY `idx_accion` (`accion`),
  KEY `idx_entidad` (`entidad_id`),
  KEY `idx_creado_en` (`creado_en`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `bom_items` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `producto_id` int(11) NOT NULL,
  `material_id` int(11) NOT NULL,
  `material_nombre` varchar(255) DEFAULT NULL,
  `cantidad` decimal(10,4) NOT NULL DEFAULT 1.0000,
  `unidad` varchar(255) NOT NULL DEFAULT 'Pieza',
  `notas` varchar(255) DEFAULT NULL,
  `creado_en` datetime(6) NOT NULL DEFAULT current_timestamp(6),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `categorias_producto` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `nombre` varchar(255) NOT NULL,
  `descripcion` varchar(255) DEFAULT NULL,
  `color` varchar(255) DEFAULT NULL,
  `activo` tinyint(4) NOT NULL DEFAULT 1,
  `orden` int(11) NOT NULL DEFAULT 0,
  `creado_en` datetime(6) NOT NULL DEFAULT current_timestamp(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `IDX_3d61db5e43349fa4ab1f2d78f8` (`nombre`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `cierre_cajas` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `fecha` date NOT NULL,
  `efectivo_sistema` decimal(12,2) NOT NULL DEFAULT 0.00,
  `tarjeta_sistema` decimal(12,2) NOT NULL DEFAULT 0.00,
  `transferencia_sistema` decimal(12,2) NOT NULL DEFAULT 0.00,
  `cheque_sistema` decimal(12,2) NOT NULL DEFAULT 0.00,
  `efectivo_contado` decimal(12,2) NOT NULL DEFAULT 0.00,
  `tarjeta_contado` decimal(12,2) NOT NULL DEFAULT 0.00,
  `transferencia_contado` decimal(12,2) NOT NULL DEFAULT 0.00,
  `cheque_contado` decimal(12,2) NOT NULL DEFAULT 0.00,
  `notas` text DEFAULT NULL,
  `cerrado_por` varchar(255) DEFAULT NULL,
  `estado` varchar(50) NOT NULL DEFAULT 'abierto',
  `cerrado_en` datetime(6) NOT NULL DEFAULT current_timestamp(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_cierre_fecha` (`fecha`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `clientes` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `nombre` varchar(255) NOT NULL,
  `nombre_comercial` varchar(255) DEFAULT NULL,
  `representante` varchar(120) DEFAULT NULL,
  `tipo` enum('empresa','persona') NOT NULL DEFAULT 'empresa',
  `documento` varchar(255) DEFAULT NULL,
  `telefono` varchar(255) DEFAULT NULL,
  `telefono_alt` varchar(255) DEFAULT NULL,
  `email` varchar(255) DEFAULT NULL,
  `direccion` varchar(255) DEFAULT NULL,
  `ciudad` varchar(255) DEFAULT NULL,
  `provincia` varchar(255) DEFAULT NULL,
  `vendedor_id` int(11) DEFAULT NULL,
  `aplica_itbis` tinyint(4) NOT NULL DEFAULT 1,
  `ncf_tipo_default` varchar(5) DEFAULT NULL COMMENT 'Tipo NCF preferido: B01, B02, B14, B15. NULL = decidir al facturar',
  `terminos_pago` varchar(255) DEFAULT NULL,
  `estado` enum('activo','inactivo','prospecto') NOT NULL DEFAULT 'prospecto',
  `limite_credito` decimal(12,2) NOT NULL DEFAULT 0.00,
  `plazo_credito` int(11) DEFAULT NULL,
  `credito_estado` enum('sin_credito','pendiente','aprobado','rechazado','suspendido') NOT NULL DEFAULT 'sin_credito',
  `credito_aprobado_por` varchar(80) DEFAULT NULL,
  `credito_aprobado_en` datetime DEFAULT NULL,
  `notas` varchar(255) DEFAULT NULL,
  `creado_en` datetime(6) NOT NULL DEFAULT current_timestamp(6),
  `actualizado_en` datetime(6) NOT NULL DEFAULT current_timestamp(6) ON UPDATE current_timestamp(6),
  PRIMARY KEY (`id`),
  KEY `idx_ncf_default` (`ncf_tipo_default`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `cliente_contactos` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `cliente_id` int(11) NOT NULL,
  `nombre` varchar(120) NOT NULL,
  `cargo` varchar(80) DEFAULT NULL,
  `telefono` varchar(30) DEFAULT NULL,
  `email` varchar(120) DEFAULT NULL,
  `principal` tinyint(1) NOT NULL DEFAULT 0,
  `activo` tinyint(1) NOT NULL DEFAULT 1,
  `creado_en` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_cc_cliente` (`cliente_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `compromisos_ocurrencias` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `compromiso_id` int(11) NOT NULL,
  `fecha_vencimiento` date NOT NULL,
  `monto_estimado` decimal(12,2) NOT NULL DEFAULT 0.00,
  `monto_pagado` decimal(12,2) DEFAULT NULL,
  `estado` enum('pendiente','pagado','cancelado') NOT NULL DEFAULT 'pendiente',
  `fecha_pago` date DEFAULT NULL,
  `metodo_pago` varchar(50) DEFAULT NULL,
  `referencia` varchar(255) DEFAULT NULL,
  `gasto_id` int(11) DEFAULT NULL COMMENT 'Si se creó un gasto al pagar',
  `egreso_id` int(11) DEFAULT NULL COMMENT 'Si se creó un egreso de caja al pagar',
  `notas` text DEFAULT NULL,
  `pagado_por` varchar(255) DEFAULT NULL,
  `creado_en` datetime(6) NOT NULL DEFAULT current_timestamp(6),
  `actualizado_en` datetime(6) NOT NULL DEFAULT current_timestamp(6) ON UPDATE current_timestamp(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `idx_compromiso_fecha` (`compromiso_id`,`fecha_vencimiento`),
  KEY `idx_estado` (`estado`),
  KEY `idx_fecha` (`fecha_vencimiento`),
  KEY `idx_compromiso` (`compromiso_id`),
  CONSTRAINT `fk_compromiso` FOREIGN KEY (`compromiso_id`) REFERENCES `compromisos_recurrentes` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `compromisos_recurrentes` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `nombre` varchar(255) NOT NULL,
  `alias` text DEFAULT NULL COMMENT 'Palabras clave separadas por coma para identificar via bot',
  `categoria` varchar(100) NOT NULL,
  `clasificacion_contable` enum('costo','gasto') NOT NULL DEFAULT 'gasto',
  `monto_estimado` decimal(12,2) NOT NULL DEFAULT 0.00,
  `frecuencia` enum('mensual','semanal','quincenal','bimensual','trimestral','anual','unica') NOT NULL DEFAULT 'mensual',
  `dia_vencimiento` int(11) DEFAULT NULL COMMENT '1-31 si mensual, 0-6 si semanal (lunes=1, domingo=0), día del mes 1 o 15 si quincenal',
  `proveedor` varchar(255) DEFAULT NULL,
  `descripcion` text DEFAULT NULL,
  `metodo_pago_default` varchar(50) DEFAULT NULL,
  `cuenta_banco_id` int(11) DEFAULT NULL,
  `recordar_dias_antes` int(11) NOT NULL DEFAULT 5,
  `activo` tinyint(1) NOT NULL DEFAULT 1,
  `fecha_inicio` date DEFAULT NULL COMMENT 'Desde cuándo aplica este compromiso',
  `fecha_fin` date DEFAULT NULL COMMENT 'Hasta cuándo (NULL = indefinido)',
  `creado_por` varchar(255) DEFAULT NULL,
  `creado_en` datetime(6) NOT NULL DEFAULT current_timestamp(6),
  `actualizado_en` datetime(6) NOT NULL DEFAULT current_timestamp(6) ON UPDATE current_timestamp(6),
  PRIMARY KEY (`id`),
  KEY `idx_activo` (`activo`),
  KEY `idx_categoria` (`categoria`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `conduces_entrega` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `numero` varchar(30) NOT NULL,
  `orden_id` int(11) NOT NULL,
  `orden_numero` varchar(50) NOT NULL,
  `tipo` enum('parcial','total') NOT NULL DEFAULT 'total',
  `fecha` datetime NOT NULL,
  `entregado_por` varchar(255) DEFAULT NULL,
  `recibido_por` varchar(255) DEFAULT NULL,
  `items` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(`items`)),
  `notas` text DEFAULT NULL,
  `creado_en` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `numero` (`numero`),
  KEY `idx_conduce_orden` (`orden_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `configuracion_sistema` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `clave` varchar(255) NOT NULL,
  `valor` text NOT NULL,
  `descripcion` varchar(255) DEFAULT NULL,
  `actualizado_en` datetime(6) NOT NULL DEFAULT current_timestamp(6) ON UPDATE current_timestamp(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `IDX_0e9b47db25c1b7916c685fbb31` (`clave`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `cotizaciones` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `numero` varchar(255) NOT NULL,
  `cliente_id` int(11) NOT NULL,
  `vendedor_id` int(11) DEFAULT NULL,
  `estado` enum('borrador','enviada','aprobada','rechazada','convertida') NOT NULL DEFAULT 'borrador',
  `modo_precio` enum('bundled','desglosado') NOT NULL DEFAULT 'bundled',
  `aplica_itbis_global` tinyint(4) NOT NULL DEFAULT 1,
  `referencia` varchar(255) DEFAULT NULL,
  `fecha_vencimiento` date DEFAULT NULL,
  `subtotal` decimal(12,2) NOT NULL DEFAULT 0.00,
  `descuento_pct` decimal(12,2) NOT NULL DEFAULT 0.00,
  `itbis_monto` decimal(12,2) NOT NULL DEFAULT 0.00,
  `total` decimal(12,2) NOT NULL DEFAULT 0.00,
  `notas` text DEFAULT NULL,
  `terminos` varchar(255) DEFAULT NULL,
  `creado_en` datetime(6) NOT NULL DEFAULT current_timestamp(6),
  `actualizado_en` datetime(6) NOT NULL DEFAULT current_timestamp(6) ON UPDATE current_timestamp(6),
  `especificaciones` text DEFAULT NULL,
  `creado_por` varchar(255) DEFAULT NULL,
  `solicitado_por` varchar(120) DEFAULT NULL,
  `contacto_id` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `IDX_3bdc969a707929907861b09b6a` (`numero`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `cuentas_banco` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `banco` varchar(100) NOT NULL,
  `digitos` varchar(4) NOT NULL,
  `tipo_cuenta` varchar(20) NOT NULL DEFAULT 'corriente',
  `titular` varchar(150) DEFAULT NULL,
  `alias` varchar(80) DEFAULT NULL,
  `activo` tinyint(1) NOT NULL DEFAULT 1,
  `creado_en` datetime(6) NOT NULL DEFAULT current_timestamp(6),
  `actualizado_en` datetime(6) NOT NULL DEFAULT current_timestamp(6) ON UPDATE current_timestamp(6),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `cuentas_por_pagar` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `numero` varchar(50) DEFAULT NULL COMMENT 'Numero interno tipo CXP-2026-001',
  `proveedor_id` int(11) DEFAULT NULL,
  `proveedor_nombre` varchar(255) NOT NULL COMMENT 'Denormalizado, no requiere FK',
  `proveedor_rnc` varchar(20) DEFAULT NULL,
  `ncf` varchar(20) DEFAULT NULL COMMENT 'Numero de Comprobante Fiscal para DGII 606',
  `fecha_factura` date NOT NULL,
  `fecha_vencimiento` date DEFAULT NULL COMMENT 'NULL si es al contado',
  `dias_credito` int(11) DEFAULT NULL,
  `descripcion` text DEFAULT NULL,
  `monto_total` decimal(12,2) NOT NULL,
  `monto_pagado` decimal(12,2) NOT NULL DEFAULT 0.00,
  `saldo` decimal(12,2) GENERATED ALWAYS AS (`monto_total` - `monto_pagado`) VIRTUAL,
  `estado` enum('pendiente','parcial','pagada','cancelada') NOT NULL DEFAULT 'pendiente',
  `categoria` varchar(50) NOT NULL DEFAULT 'otros',
  `clasificacion_contable` enum('costo','gasto') NOT NULL DEFAULT 'gasto',
  `orden_compra_id` int(11) DEFAULT NULL,
  `foto_url` varchar(500) DEFAULT NULL COMMENT 'URL de la imagen de la factura',
  `gasto_formal_id` int(11) DEFAULT NULL COMMENT 'Si la factura tiene NCF, se contabiliza como gasto formal al crearla (estado pendiente_pago)',
  `notas` text DEFAULT NULL,
  `registrado_por_id` int(11) DEFAULT NULL,
  `registrado_por_nombre` varchar(255) DEFAULT NULL,
  `origen` enum('manual','bot','orden_compra','foto') NOT NULL DEFAULT 'manual',
  `creado_en` datetime(6) NOT NULL DEFAULT current_timestamp(6),
  `actualizado_en` datetime(6) NOT NULL DEFAULT current_timestamp(6) ON UPDATE current_timestamp(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `numero` (`numero`),
  UNIQUE KEY `uq_cxp_ncf` (`ncf`),
  KEY `idx_proveedor_id` (`proveedor_id`),
  KEY `idx_estado` (`estado`),
  KEY `idx_fecha_venc` (`fecha_vencimiento`),
  KEY `idx_ncf` (`ncf`),
  KEY `idx_oc` (`orden_compra_id`),
  KEY `idx_gasto_formal` (`gasto_formal_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `cuentas_por_pagar_abonos` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `cxp_id` int(11) NOT NULL,
  `fecha` date NOT NULL,
  `monto` decimal(12,2) NOT NULL,
  `metodo_pago` enum('efectivo','transferencia','cheque','tarjeta','otro') NOT NULL DEFAULT 'transferencia',
  `referencia` varchar(100) DEFAULT NULL COMMENT 'Numero de cheque, transferencia, etc',
  `cuenta_banco_id` int(11) DEFAULT NULL,
  `gasto_id` int(11) DEFAULT NULL COMMENT 'ID del gasto generado al registrar el abono',
  `notas` text DEFAULT NULL,
  `registrado_por_id` int(11) DEFAULT NULL,
  `registrado_por_nombre` varchar(255) DEFAULT NULL,
  `creado_en` datetime(6) NOT NULL DEFAULT current_timestamp(6),
  PRIMARY KEY (`id`),
  KEY `idx_cxp` (`cxp_id`),
  KEY `idx_fecha` (`fecha`),
  CONSTRAINT `cuentas_por_pagar_abonos_ibfk_1` FOREIGN KEY (`cxp_id`) REFERENCES `cuentas_por_pagar` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `danos_produccion` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `lote_id` int(11) NOT NULL,
  `orden_id` int(11) NOT NULL,
  `orden_numero` varchar(255) NOT NULL,
  `departamento` varchar(255) NOT NULL,
  `producto` varchar(255) NOT NULL,
  `descripcion` varchar(255) DEFAULT NULL,
  `cantidad_danada` int(11) NOT NULL,
  `motivo` text NOT NULL,
  `estado` varchar(30) NOT NULL DEFAULT 'reportado',
  `producto_id` int(11) DEFAULT NULL,
  `variante_id` int(11) DEFAULT NULL,
  `es_sustitucion` tinyint(1) NOT NULL DEFAULT 0,
  `repuesto_producto_id` int(11) DEFAULT NULL,
  `repuesto_variante_id` int(11) DEFAULT NULL,
  `repuesto_descripcion` varchar(255) DEFAULT NULL,
  `cantidad_repuesta` int(11) DEFAULT NULL,
  `costo_repuesto` decimal(12,2) DEFAULT NULL,
  `reportado_por_id` int(11) NOT NULL DEFAULT 0,
  `reportado_por_nombre` varchar(255) NOT NULL DEFAULT '',
  `aprobado_por_id` int(11) DEFAULT NULL,
  `aprobado_por_nombre` varchar(255) DEFAULT NULL,
  `notas` text DEFAULT NULL,
  `creado_en` datetime NOT NULL DEFAULT current_timestamp(),
  `actualizado_en` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `reserva_id` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `departamentos` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `nombre` varchar(255) NOT NULL,
  `activo` tinyint(4) NOT NULL DEFAULT 1,
  `orden` int(11) NOT NULL DEFAULT 0,
  `creado_en` datetime(6) NOT NULL DEFAULT current_timestamp(6),
  `actualizado_en` datetime(6) NOT NULL DEFAULT current_timestamp(6) ON UPDATE current_timestamp(6),
  `checkpoints` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`checkpoints`)),
  PRIMARY KEY (`id`),
  UNIQUE KEY `IDX_324052d75576efdbc10ba3e899` (`nombre`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `dispositivos_ponche` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `nombre` varchar(80) NOT NULL,
  `tipo` enum('zkteco','hikvision') NOT NULL,
  `modelo` varchar(60) DEFAULT NULL,
  `serial` varchar(60) DEFAULT NULL,
  `sucursal_id` int(11) DEFAULT NULL,
  `activo` tinyint(1) NOT NULL DEFAULT 1,
  `ultima_conexion` datetime DEFAULT NULL,
  `creado_en` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_serial` (`serial`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `egresos_caja` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `fecha` date NOT NULL,
  `monto` decimal(12,2) NOT NULL,
  `destinatario` varchar(255) NOT NULL,
  `categoria` enum('servicios','suministros','nomina','transporte','proveedores','mantenimiento','otros') NOT NULL DEFAULT 'otros',
  `clasificacion_contable` enum('costo','gasto') NOT NULL DEFAULT 'gasto',
  `comentario` text DEFAULT NULL,
  `registrado_por` varchar(255) DEFAULT NULL,
  `creado_en` datetime(6) NOT NULL DEFAULT current_timestamp(6),
  `sesion_caja_id` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `IDX_egresos_fecha` (`fecha`),
  KEY `idx_egreso_clasif` (`clasificacion_contable`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `empleados_documentos` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `empleado_id` int(11) NOT NULL,
  `tipo` enum('cedula','curriculum','certificado_medico','buena_conducta','certificacion_academica','foto_2x2','cuenta_bancaria','contrato','firma','foto_empleado','otro') NOT NULL,
  `nombre_archivo` varchar(255) NOT NULL,
  `url` varchar(500) NOT NULL,
  `mime_type` varchar(80) DEFAULT NULL,
  `tamano_bytes` int(11) DEFAULT NULL,
  `descripcion` varchar(255) DEFAULT NULL,
  `subido_por` varchar(120) DEFAULT NULL,
  `creado_en` datetime(6) NOT NULL DEFAULT current_timestamp(6),
  PRIMARY KEY (`id`),
  KEY `idx_doc_empleado` (`empleado_id`),
  KEY `idx_doc_tipo` (`tipo`),
  CONSTRAINT `fk_doc_empleado` FOREIGN KEY (`empleado_id`) REFERENCES `empleados_ficha` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `empleados_ficha` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `usuario_id` int(11) DEFAULT NULL,
  `codigo_empleado` varchar(20) DEFAULT NULL,
  `nombre_completo` varchar(150) NOT NULL,
  `cedula_pasaporte` varchar(20) DEFAULT NULL,
  `fecha_nacimiento` date DEFAULT NULL,
  `sexo` enum('masculino','femenino') DEFAULT NULL,
  `estado_civil` enum('soltero','casado','union_libre','divorciado','viudo') DEFAULT NULL,
  `nacionalidad` varchar(60) DEFAULT 'Dominicana',
  `direccion` varchar(255) DEFAULT NULL,
  `sector_ciudad` varchar(100) DEFAULT NULL,
  `telefono_personal` varchar(30) DEFAULT NULL,
  `telefono_alternativo` varchar(30) DEFAULT NULL,
  `correo_electronico` varchar(120) DEFAULT NULL,
  `emerg_nombre` varchar(150) DEFAULT NULL,
  `emerg_parentesco` varchar(60) DEFAULT NULL,
  `emerg_tel_principal` varchar(30) DEFAULT NULL,
  `emerg_tel_secundario` varchar(30) DEFAULT NULL,
  `emerg_direccion` varchar(255) DEFAULT NULL,
  `tiene_hijos` tinyint(1) NOT NULL DEFAULT 0,
  `cantidad_hijos` tinyint(4) DEFAULT NULL,
  `nivel_educativo` enum('primaria','secundaria','tecnico','universitario','postgrado','maestria','doctorado') DEFAULT NULL,
  `profesion` varchar(120) DEFAULT NULL,
  `carrera_estudiada` varchar(120) DEFAULT NULL,
  `institucion_educativa` varchar(150) DEFAULT NULL,
  `cursos_certificaciones` text DEFAULT NULL,
  `fecha_ingreso` date DEFAULT NULL,
  `departamento` varchar(80) DEFAULT NULL,
  `cargo` varchar(80) DEFAULT NULL,
  `supervisor_inmediato` varchar(120) DEFAULT NULL,
  `tipo_contrato` enum('fijo','indefinido','temporal','pasantia') DEFAULT NULL,
  `horario_trabajo` varchar(255) DEFAULT NULL,
  `salario` decimal(12,2) DEFAULT NULL,
  `sucursal` varchar(80) DEFAULT NULL,
  `centro_costo` varchar(80) DEFAULT NULL,
  `banco` varchar(80) DEFAULT NULL,
  `tipo_cuenta` enum('ahorro','corriente') DEFAULT NULL,
  `numero_cuenta` varchar(40) DEFAULT NULL,
  `titular_cuenta` varchar(150) DEFAULT NULL,
  `tipo_sangre` varchar(10) DEFAULT NULL,
  `tiene_condicion_medica` tinyint(1) NOT NULL DEFAULT 0,
  `condicion_medica_detalle` text DEFAULT NULL,
  `tiene_alergia` tinyint(1) NOT NULL DEFAULT 0,
  `alergia_detalle` text DEFAULT NULL,
  `ars` varchar(80) DEFAULT NULL,
  `afp` varchar(80) DEFAULT NULL,
  `habilidad_excel` tinyint(4) DEFAULT NULL,
  `habilidad_word` tinyint(4) DEFAULT NULL,
  `habilidad_powerpoint` tinyint(4) DEFAULT NULL,
  `habilidad_erp` tinyint(4) DEFAULT NULL,
  `habilidad_diseno_grafico` tinyint(4) DEFAULT NULL,
  `otros_conocimientos` text DEFAULT NULL,
  `pasatiempos` text DEFAULT NULL,
  `deportes_favoritos` text DEFAULT NULL,
  `metas_profesionales` text DEFAULT NULL,
  `expectativas_empresa` text DEFAULT NULL,
  `rec_computadora` tinyint(1) NOT NULL DEFAULT 0,
  `rec_laptop` tinyint(1) NOT NULL DEFAULT 0,
  `rec_telefono` tinyint(1) NOT NULL DEFAULT 0,
  `rec_uniforme` tinyint(1) NOT NULL DEFAULT 0,
  `rec_correo_corporativo` tinyint(1) NOT NULL DEFAULT 0,
  `rec_usuario_sistema` tinyint(1) NOT NULL DEFAULT 0,
  `rec_vehiculo` tinyint(1) NOT NULL DEFAULT 0,
  `rec_herramientas` tinyint(1) NOT NULL DEFAULT 0,
  `recursos_observaciones` text DEFAULT NULL,
  `doc_copia_cedula` tinyint(1) NOT NULL DEFAULT 0,
  `doc_curriculum` tinyint(1) NOT NULL DEFAULT 0,
  `doc_certificado_medico` tinyint(1) NOT NULL DEFAULT 0,
  `doc_buena_conducta` tinyint(1) NOT NULL DEFAULT 0,
  `doc_certif_academicas` tinyint(1) NOT NULL DEFAULT 0,
  `doc_foto_2x2` tinyint(1) NOT NULL DEFAULT 0,
  `doc_cuenta_bancaria` tinyint(1) NOT NULL DEFAULT 0,
  `doc_contrato_firmado` tinyint(1) NOT NULL DEFAULT 0,
  `declaracion_firmada` tinyint(1) NOT NULL DEFAULT 0,
  `fecha_firma` date DEFAULT NULL,
  `firmada_por_rrhh` varchar(120) DEFAULT NULL,
  `firma_url` varchar(255) DEFAULT NULL,
  `talla_camisa` varchar(10) DEFAULT NULL,
  `talla_pantalon` varchar(10) DEFAULT NULL,
  `talla_zapatos` varchar(10) DEFAULT NULL,
  `licencia_conducir` varchar(40) DEFAULT NULL,
  `licencia_vencimiento` date DEFAULT NULL,
  `foto_url` varchar(255) DEFAULT NULL,
  `estado` enum('activo','licencia','suspendido','baja') NOT NULL DEFAULT 'activo',
  `fecha_baja` date DEFAULT NULL,
  `motivo_baja` varchar(255) DEFAULT NULL,
  `notas` text DEFAULT NULL,
  `creado_por` varchar(120) DEFAULT NULL,
  `creado_en` datetime(6) NOT NULL DEFAULT current_timestamp(6),
  `actualizado_en` datetime(6) NOT NULL DEFAULT current_timestamp(6) ON UPDATE current_timestamp(6),
  `provincia` varchar(80) DEFAULT NULL,
  `ano_graduacion` varchar(10) DEFAULT NULL,
  `medicamentos` text DEFAULT NULL,
  `condiciones_medicas` text DEFAULT NULL,
  `metodo_pago` varchar(30) DEFAULT NULL,
  `periodo_pago` varchar(20) DEFAULT NULL,
  `numero_afp` varchar(40) DEFAULT NULL,
  `sfs_arl` varchar(80) DEFAULT NULL,
  `seguro_privado` varchar(120) DEFAULT NULL,
  `paga_bonos` tinyint(1) DEFAULT NULL,
  `paga_comisiones` tinyint(1) DEFAULT NULL,
  `paga_viaticos` tinyint(1) DEFAULT NULL,
  `notas_beneficios` text DEFAULT NULL,
  `amonestaciones` text DEFAULT NULL,
  `suspensiones` text DEFAULT NULL,
  `observaciones_disciplinarias` text DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `usuario_id` (`usuario_id`),
  UNIQUE KEY `codigo_empleado` (`codigo_empleado`),
  UNIQUE KEY `cedula_pasaporte` (`cedula_pasaporte`),
  KEY `idx_emp_estado` (`estado`),
  KEY `idx_emp_dept` (`departamento`),
  KEY `idx_emp_cedula` (`cedula_pasaporte`),
  KEY `idx_emp_usuario` (`usuario_id`),
  CONSTRAINT `fk_emp_usuario` FOREIGN KEY (`usuario_id`) REFERENCES `usuarios` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `empleados_vacaciones` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `empleado_id` int(11) NOT NULL,
  `periodo` varchar(10) NOT NULL,
  `dias_derecho` decimal(5,2) NOT NULL DEFAULT 14.00,
  `decision` enum('tomar','cobrar','mixto','sin_definir') NOT NULL DEFAULT 'sin_definir',
  `dias_tomados` decimal(5,2) NOT NULL DEFAULT 0.00,
  `fecha_inicio` date DEFAULT NULL,
  `fecha_fin` date DEFAULT NULL,
  `monto_a_pagar` decimal(12,2) DEFAULT NULL,
  `monto_pagado` decimal(12,2) NOT NULL DEFAULT 0.00,
  `estado_pago` enum('pendiente','parcial','pagada','no_aplica') NOT NULL DEFAULT 'pendiente',
  `fecha_pago` date DEFAULT NULL,
  `metodo_pago` varchar(30) DEFAULT NULL,
  `referencia` varchar(100) DEFAULT NULL,
  `notas` text DEFAULT NULL,
  `creado_por` varchar(120) DEFAULT NULL,
  `creado_en` datetime(6) NOT NULL DEFAULT current_timestamp(6),
  `actualizado_en` datetime(6) NOT NULL DEFAULT current_timestamp(6) ON UPDATE current_timestamp(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_emp_periodo` (`empleado_id`,`periodo`),
  KEY `idx_vac_empleado` (`empleado_id`),
  KEY `idx_vac_periodo` (`periodo`),
  KEY `idx_vac_estado` (`estado_pago`),
  CONSTRAINT `fk_vac_empleado` FOREIGN KEY (`empleado_id`) REFERENCES `empleados_ficha` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `facturas` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `numero` varchar(30) NOT NULL,
  `ncf` varchar(20) DEFAULT NULL,
  `tipo_ncf` enum('B01','B02','B14','B15','PROFORMA') NOT NULL,
  `orden_produccion_id` int(11) DEFAULT NULL,
  `cotizacion_id` int(11) DEFAULT NULL,
  `cliente_id` int(11) DEFAULT NULL,
  `cliente_nombre` varchar(255) DEFAULT NULL,
  `cliente_rnc` varchar(30) DEFAULT NULL,
  `cliente_direccion` varchar(500) DEFAULT NULL,
  `cliente_telefono` varchar(30) DEFAULT NULL,
  `atencion_a` varchar(120) DEFAULT NULL,
  `metodo_pago` enum('efectivo','tarjeta','transferencia','cheque','credito') DEFAULT NULL,
  `subtotal` decimal(12,2) NOT NULL DEFAULT 0.00,
  `descuento_pct` decimal(12,2) NOT NULL DEFAULT 0.00,
  `descuento_monto` decimal(12,2) NOT NULL DEFAULT 0.00,
  `itbis` decimal(12,2) NOT NULL DEFAULT 0.00,
  `total` decimal(12,2) NOT NULL DEFAULT 0.00,
  `total_pagado` decimal(12,2) NOT NULL DEFAULT 0.00,
  `saldo_pendiente` decimal(12,2) NOT NULL DEFAULT 0.00,
  `credito_a_favor` decimal(12,2) NOT NULL DEFAULT 0.00,
  `estado` enum('borrador','emitida','parcial','pagada','credito','anulada') NOT NULL DEFAULT 'borrador',
  `estado_dgii` enum('no_aplica','pendiente','enviada','aprobada','rechazada') NOT NULL DEFAULT 'no_aplica',
  `enviada_dgii_at` datetime DEFAULT NULL,
  `aprobada_dgii_at` datetime DEFAULT NULL,
  `track_id_dgii` varchar(64) DEFAULT NULL,
  `codigo_seguridad_dgii` varchar(16) DEFAULT NULL,
  `xml_eCF` longtext DEFAULT NULL,
  `mensaje_dgii` varchar(500) DEFAULT NULL,
  `fecha_vencimiento` date DEFAULT NULL,
  `notas` text DEFAULT NULL,
  `ecf_xml` longtext DEFAULT NULL,
  `ecf_estado` varchar(50) DEFAULT NULL,
  `creado_por` varchar(100) DEFAULT NULL,
  `fecha_emision` datetime(6) NOT NULL DEFAULT current_timestamp(6),
  `actualizado_en` datetime(6) NOT NULL DEFAULT current_timestamp(6) ON UPDATE current_timestamp(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_numero` (`numero`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `factura_lineas` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `factura_id` int(11) NOT NULL,
  `producto_id` int(11) DEFAULT NULL,
  `descripcion` varchar(500) NOT NULL,
  `cantidad` decimal(10,2) NOT NULL DEFAULT 1.00,
  `precio_unitario` decimal(12,2) NOT NULL,
  `itbis_pct` decimal(5,2) NOT NULL DEFAULT 0.00,
  `itbis_monto` decimal(12,2) NOT NULL DEFAULT 0.00,
  `subtotal` decimal(12,2) NOT NULL,
  `total` decimal(12,2) NOT NULL,
  PRIMARY KEY (`id`),
  KEY `fk_fl_factura` (`factura_id`),
  CONSTRAINT `fk_fl_factura` FOREIGN KEY (`factura_id`) REFERENCES `facturas` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `factura_ordenes` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `factura_id` int(11) NOT NULL,
  `orden_id` int(11) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_fo` (`factura_id`,`orden_id`),
  KEY `idx_fo_orden` (`orden_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `factura_pagos` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `factura_id` int(11) NOT NULL,
  `tipo` enum('anticipo','abono','total','credito') NOT NULL,
  `metodo` enum('efectivo','tarjeta','transferencia','cheque','credito') NOT NULL,
  `monto` decimal(12,2) NOT NULL,
  `fecha` date NOT NULL,
  `referencia` varchar(255) DEFAULT NULL,
  `banco_nombre` varchar(100) DEFAULT NULL,
  `cuenta_digitos` varchar(4) DEFAULT NULL,
  `cuenta_banco_id` int(11) DEFAULT NULL,
  `validado` tinyint(1) NOT NULL DEFAULT 0,
  `validado_por` varchar(100) DEFAULT NULL,
  `validado_en` datetime DEFAULT NULL,
  `nota` varchar(500) DEFAULT NULL,
  `creado_por` varchar(100) DEFAULT NULL,
  `creado_en` datetime(6) NOT NULL DEFAULT current_timestamp(6),
  `revertido` tinyint(1) NOT NULL DEFAULT 0,
  `revertido_motivo` varchar(255) DEFAULT NULL,
  `revertido_por` varchar(255) DEFAULT NULL,
  `revertido_en` datetime DEFAULT NULL,
  `sesion_caja_id` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `fk_fp_factura` (`factura_id`),
  CONSTRAINT `fk_fp_factura` FOREIGN KEY (`factura_id`) REFERENCES `facturas` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `feriados` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `fecha` date NOT NULL,
  `nombre` varchar(120) NOT NULL,
  `año` int(11) NOT NULL,
  `creado_en` datetime(6) NOT NULL DEFAULT current_timestamp(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_feriado_fecha` (`fecha`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `flujos_produccion` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `nombre` varchar(100) NOT NULL,
  `tipo_producto` varchar(50) DEFAULT NULL,
  `tipo_produccion` varchar(50) DEFAULT NULL,
  `tecnica` varchar(100) DEFAULT NULL,
  `incluye_aplicacion` tinyint(4) DEFAULT NULL,
  `incluye_confeccion` tinyint(4) DEFAULT NULL,
  `requiere_diseno` tinyint(4) DEFAULT NULL,
  `estructura_json` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(`estructura_json`)),
  `activo` tinyint(4) NOT NULL DEFAULT 1,
  `creado_en` datetime(6) NOT NULL DEFAULT current_timestamp(6),
  `actualizado_en` datetime(6) NOT NULL DEFAULT current_timestamp(6) ON UPDATE current_timestamp(6),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `gastos` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `tipo` varchar(20) NOT NULL,
  `clasificacion_contable` enum('costo','gasto') NOT NULL DEFAULT 'gasto',
  `fecha` date NOT NULL,
  `monto` decimal(12,2) NOT NULL,
  `descripcion` varchar(500) DEFAULT NULL,
  `categoria` varchar(100) DEFAULT NULL,
  `proveedor` varchar(200) DEFAULT NULL,
  `rnc` varchar(20) DEFAULT NULL,
  `ncf` varchar(30) DEFAULT NULL,
  `tipo_ncf` varchar(10) DEFAULT NULL,
  `subtotal` decimal(12,2) DEFAULT NULL,
  `itbis` decimal(12,2) DEFAULT NULL,
  `foto_url` varchar(500) DEFAULT NULL,
  `fotos_adicionales` longtext DEFAULT NULL,
  `registrado_por_id` int(11) NOT NULL,
  `registrado_por_nombre` varchar(150) NOT NULL,
  `metodo_pago` varchar(50) DEFAULT NULL,
  `estado` varchar(20) NOT NULL DEFAULT 'registrado',
  `notas` text DEFAULT NULL,
  `creado_en` datetime(6) NOT NULL DEFAULT current_timestamp(6),
  `actualizado_en` datetime(6) NOT NULL DEFAULT current_timestamp(6) ON UPDATE current_timestamp(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_gastos_ncf` (`ncf`),
  KEY `idx_gastos_tipo` (`tipo`),
  KEY `idx_gastos_fecha` (`fecha`),
  KEY `idx_gastos_ncf` (`ncf`),
  KEY `idx_clasificacion` (`clasificacion_contable`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `horario_plantillas` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `nombre` varchar(80) NOT NULL,
  `tolerancia_min` int(11) NOT NULL DEFAULT 10,
  `activo` tinyint(1) NOT NULL DEFAULT 1,
  `creado_en` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `horario_plantilla_dias` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `plantilla_id` int(11) NOT NULL,
  `dia_semana` tinyint(4) NOT NULL COMMENT '1=Lunes ... 7=Domingo',
  `labora` tinyint(1) NOT NULL DEFAULT 1,
  `entrada` time DEFAULT NULL,
  `salida_almuerzo` time DEFAULT NULL,
  `regreso_almuerzo` time DEFAULT NULL,
  `salida` time DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_pd` (`plantilla_id`,`dia_semana`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `incentivos_config` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `departamento` varchar(100) NOT NULL,
  `complejidad` enum('exenta','sencilla','mediana','avanzada') NOT NULL DEFAULT 'mediana',
  `precio_por_pieza` decimal(10,2) NOT NULL,
  `meta_semanal` int(11) NOT NULL,
  `activo` tinyint(1) NOT NULL DEFAULT 1,
  `creado_en` datetime(6) NOT NULL DEFAULT current_timestamp(6),
  `actualizado_en` datetime(6) NOT NULL DEFAULT current_timestamp(6) ON UPDATE current_timestamp(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_depto_comp` (`departamento`,`complejidad`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `incentivos_empleado` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `usuario_id` int(11) NOT NULL,
  `usuario_nombre` varchar(200) NOT NULL,
  `departamento` varchar(100) NOT NULL,
  `activo` tinyint(1) NOT NULL DEFAULT 1,
  `meta` int(11) NOT NULL,
  `precios` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(`precios`)),
  `fecha_inicio` date DEFAULT NULL,
  `notas` text DEFAULT NULL,
  `creado_en` datetime(6) NOT NULL DEFAULT current_timestamp(6),
  `actualizado_en` datetime(6) NOT NULL DEFAULT current_timestamp(6) ON UPDATE current_timestamp(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `UQ_usuario_depto` (`usuario_id`,`departamento`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `inventario_interno_insumos` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `departamento_id` int(11) NOT NULL,
  `departamento_nombre` varchar(100) NOT NULL,
  `nombre` varchar(150) NOT NULL,
  `descripcion` varchar(500) DEFAULT NULL,
  `unidad` varchar(50) NOT NULL DEFAULT 'unidad',
  `stock_minimo` int(11) NOT NULL DEFAULT 1,
  `activo` tinyint(1) NOT NULL DEFAULT 1,
  `creado_por` varchar(100) DEFAULT NULL,
  `creado_en` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `inventario_interno_requerimientos` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `departamento_id` int(11) NOT NULL,
  `departamento_nombre` varchar(100) NOT NULL,
  `estado` enum('pendiente','aprobado','rechazado','comprado','recibido') NOT NULL DEFAULT 'pendiente',
  `solicitado_por` varchar(100) NOT NULL,
  `notas_solicitud` text DEFAULT NULL,
  `aprobado_por` varchar(100) DEFAULT NULL,
  `aprobado_en` datetime DEFAULT NULL,
  `notas_admin` text DEFAULT NULL,
  `creado_en` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `inventario_interno_req_items` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `requerimiento_id` int(11) NOT NULL,
  `insumo_id` int(11) DEFAULT NULL,
  `nombre` varchar(150) NOT NULL,
  `unidad` varchar(50) NOT NULL,
  `cantidad_solicitada` int(11) NOT NULL DEFAULT 1,
  `cantidad_recibida` int(11) DEFAULT NULL,
  `notas` varchar(500) DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `requerimiento_id` (`requerimiento_id`),
  CONSTRAINT `inventario_interno_req_items_ibfk_1` FOREIGN KEY (`requerimiento_id`) REFERENCES `inventario_interno_requerimientos` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `inventario_interno_unidades` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `insumo_id` int(11) NOT NULL,
  `estado` enum('sellado','en_uso','agotado') NOT NULL DEFAULT 'sellado',
  `notas` varchar(500) DEFAULT NULL,
  `registrado_por` varchar(100) DEFAULT NULL,
  `modificado_por` varchar(100) DEFAULT NULL,
  `fecha_cambio_estado` datetime DEFAULT NULL,
  `creado_en` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `insumo_id` (`insumo_id`),
  CONSTRAINT `inventario_interno_unidades_ibfk_1` FOREIGN KEY (`insumo_id`) REFERENCES `inventario_interno_insumos` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `jornadas` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `usuario_id` int(11) NOT NULL,
  `fecha` date NOT NULL,
  `sucursal_id` int(11) DEFAULT NULL,
  `entrada` datetime DEFAULT NULL,
  `salida_almuerzo` datetime DEFAULT NULL,
  `regreso_almuerzo` datetime DEFAULT NULL,
  `salida` datetime DEFAULT NULL,
  `minutos_trabajados` int(11) NOT NULL DEFAULT 0,
  `minutos_almuerzo` int(11) NOT NULL DEFAULT 0,
  `tardanza_min` int(11) NOT NULL DEFAULT 0,
  `extra_min` int(11) NOT NULL DEFAULT 0,
  `estado` enum('abierta','completa','incompleta','corregida','sin_horario') NOT NULL DEFAULT 'abierta',
  `observacion` varchar(200) DEFAULT NULL,
  `calculado_en` datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_uj` (`usuario_id`,`fecha`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `lead_times_proveedores` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `orden_compra_id` int(11) DEFAULT NULL,
  `proveedor_id` int(11) DEFAULT NULL,
  `proveedor_nombre` varchar(255) DEFAULT NULL,
  `dias_estimados` int(11) DEFAULT NULL,
  `dias_reales` int(11) DEFAULT NULL,
  `fecha_orden` date DEFAULT NULL,
  `fecha_llegada` date DEFAULT NULL,
  `creado_en` datetime(6) NOT NULL DEFAULT current_timestamp(6),
  PRIMARY KEY (`id`),
  KEY `IDX_lt_proveedor` (`proveedor_id`),
  KEY `IDX_lt_oc` (`orden_compra_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `lineas_cotizacion` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `cotizacion_id` int(11) NOT NULL,
  `producto_id` int(11) DEFAULT NULL,
  `variante_id` int(11) DEFAULT NULL,
  `tecnica` varchar(255) DEFAULT NULL,
  `tecnicas_aplicadas` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`tecnicas_aplicadas`)),
  `descripcion` varchar(255) NOT NULL,
  `cantidad` decimal(10,2) NOT NULL DEFAULT 1.00,
  `precio_unitario` decimal(12,2) NOT NULL DEFAULT 0.00,
  `precio_base` decimal(12,2) NOT NULL DEFAULT 0.00,
  `descuento_pct` decimal(5,2) NOT NULL DEFAULT 0.00,
  `aplica_itbis` tinyint(4) NOT NULL DEFAULT 1,
  `porcentaje_itbis` decimal(5,2) NOT NULL DEFAULT 18.00,
  `subtotal_linea` decimal(12,2) NOT NULL DEFAULT 0.00,
  `itbis_monto` decimal(12,2) NOT NULL DEFAULT 0.00,
  `total_linea` decimal(12,2) NOT NULL DEFAULT 0.00,
  `orden` int(11) NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `lotes_produccion` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `numero` varchar(255) NOT NULL,
  `orden_id` int(11) NOT NULL,
  `tipo_lote` enum('fabricacion','proceso','servicio') NOT NULL,
  `producto` varchar(255) NOT NULL,
  `descripcion` varchar(255) DEFAULT NULL,
  `cantidad` decimal(10,2) NOT NULL DEFAULT 1.00,
  `departamento` varchar(255) DEFAULT NULL,
  `tecnica` varchar(255) DEFAULT NULL,
  `tipo_ejecucion` enum('paralelo','secuencial') NOT NULL DEFAULT 'paralelo',
  `orden_ejecucion` int(11) NOT NULL DEFAULT 0,
  `lote_padre_id` int(11) DEFAULT NULL,
  `estado` enum('pendiente','desbloqueado','en_proceso','completado','cancelado') NOT NULL DEFAULT 'desbloqueado',
  `responsable` varchar(255) DEFAULT NULL,
  `responsables` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`responsables`)),
  `notas` text DEFAULT NULL,
  `cantidad_confirmada` decimal(10,2) DEFAULT NULL,
  `confirmado_por` varchar(255) DEFAULT NULL,
  `confirmado_en` datetime DEFAULT NULL,
  `notas_recepcion` text DEFAULT NULL,
  `tiempo_inicio` datetime DEFAULT NULL,
  `tiempo_fin` datetime DEFAULT NULL,
  `creado_en` datetime(6) NOT NULL DEFAULT current_timestamp(6),
  `actualizado_en` datetime(6) NOT NULL DEFAULT current_timestamp(6) ON UPDATE current_timestamp(6),
  `checkpoints_completados` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`checkpoints_completados`)),
  `maquina` varchar(100) DEFAULT NULL,
  `pausas_lote` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`pausas_lote`)),
  `desbloquear_al` varchar(20) NOT NULL DEFAULT 'completado',
  `tipo` varchar(20) NOT NULL DEFAULT 'departamento',
  `tarea_nombre` varchar(100) DEFAULT NULL,
  `piezas_ok` int(11) DEFAULT NULL,
  `piezas_retrabajo` int(11) DEFAULT NULL,
  `piezas_descarte` int(11) DEFAULT NULL,
  `lineas_asignadas` longtext DEFAULT NULL COMMENT 'JSON array de índices de lineas_produccion de la orden asignadas a este sub-lote (null = todas)',
  `aplicaciones_por_pieza` int(11) NOT NULL DEFAULT 1,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `maquinas` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `nombre` varchar(100) NOT NULL,
  `departamento_id` int(11) NOT NULL,
  `descripcion` text DEFAULT NULL,
  `activo` tinyint(1) NOT NULL DEFAULT 1,
  `creado_en` datetime(6) NOT NULL DEFAULT current_timestamp(6),
  `actualizado_en` datetime(6) NOT NULL DEFAULT current_timestamp(6) ON UPDATE current_timestamp(6),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `marcajes` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `usuario_id` int(11) NOT NULL,
  `fecha_hora` datetime NOT NULL,
  `fecha` date NOT NULL,
  `tipo` enum('ENTRADA','SALIDA_ALMUERZO','REGRESO_ALMUERZO','SALIDA','EXTRA') NOT NULL,
  `origen` enum('celular','zkteco','hikvision','manual') NOT NULL DEFAULT 'celular',
  `sucursal_id` int(11) DEFAULT NULL,
  `dispositivo_id` int(11) DEFAULT NULL,
  `lat` decimal(10,7) DEFAULT NULL,
  `lng` decimal(10,7) DEFAULT NULL,
  `distancia_m` int(11) DEFAULT NULL,
  `ip` varchar(45) DEFAULT NULL,
  `dispositivo_hash` varchar(64) DEFAULT NULL,
  `estado` enum('ok','sospechoso','corregido','anulado') NOT NULL DEFAULT 'ok',
  `motivo_sospecha` varchar(200) DEFAULT NULL,
  `nota` varchar(200) DEFAULT NULL,
  `corregido_por` varchar(80) DEFAULT NULL,
  `corregido_en` datetime DEFAULT NULL,
  `creado_en` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_usuario_fecha` (`usuario_id`,`fecha`),
  KEY `idx_fecha` (`fecha`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `marcas` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `nombre` varchar(255) NOT NULL,
  `es_propia` tinyint(4) NOT NULL DEFAULT 0,
  `descripcion` varchar(255) DEFAULT NULL,
  `activo` tinyint(4) NOT NULL DEFAULT 1,
  `creado_en` datetime(6) NOT NULL DEFAULT current_timestamp(6),
  `actualizado_en` datetime(6) NOT NULL DEFAULT current_timestamp(6) ON UPDATE current_timestamp(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `IDX_29f5713899c32a96a8900143c6` (`nombre`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `movimientos_inventario` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `producto_id` int(11) NOT NULL,
  `variante_id` int(11) DEFAULT NULL,
  `variante_label` varchar(150) DEFAULT NULL,
  `tipo` enum('entrada','salida','ajuste') NOT NULL,
  `cantidad` int(11) NOT NULL,
  `referencia` varchar(255) DEFAULT NULL,
  `nota` varchar(255) DEFAULT NULL,
  `usuario_id` int(11) DEFAULT NULL,
  `creado_en` datetime(6) NOT NULL DEFAULT current_timestamp(6),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `ncf_secuencias` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `tipo` enum('B01','B02','B03','B04','B14','B15') NOT NULL,
  `desde` int(11) NOT NULL,
  `hasta` int(11) NOT NULL,
  `actual` int(11) NOT NULL DEFAULT 0,
  `activo` tinyint(1) NOT NULL DEFAULT 1,
  `notas` varchar(255) DEFAULT NULL,
  `creado_en` datetime(6) NOT NULL DEFAULT current_timestamp(6),
  `actualizado_en` datetime(6) NOT NULL DEFAULT current_timestamp(6) ON UPDATE current_timestamp(6),
  `fecha_vencimiento` date DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_tipo` (`tipo`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `notas_credito` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `ncf` varchar(20) NOT NULL,
  `ncf_referencia` varchar(20) NOT NULL,
  `factura_id` int(11) NOT NULL,
  `tipo` enum('parcial','total') NOT NULL,
  `motivo` enum('devolucion','ajuste_precio','descuento','anulacion') NOT NULL,
  `cliente_nombre` varchar(255) DEFAULT NULL,
  `cliente_rnc` varchar(30) DEFAULT NULL,
  `monto` decimal(12,2) NOT NULL,
  `itbis_monto` decimal(12,2) NOT NULL DEFAULT 0.00,
  `total` decimal(12,2) NOT NULL,
  `notas` text DEFAULT NULL,
  `creado_por` varchar(100) DEFAULT NULL,
  `fecha_emision` datetime(6) NOT NULL DEFAULT current_timestamp(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_ncf` (`ncf`),
  KEY `fk_nc_factura` (`factura_id`),
  CONSTRAINT `fk_nc_factura` FOREIGN KEY (`factura_id`) REFERENCES `facturas` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `notas_recordatorio` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `texto` text NOT NULL,
  `creado_por_id` int(11) NOT NULL,
  `creado_por_nombre` varchar(255) NOT NULL,
  `destinatarios` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`destinatarios`)),
  `cumplida_por` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`cumplida_por`)),
  `color` varchar(20) NOT NULL DEFAULT 'amarillo',
  `activa` tinyint(1) NOT NULL DEFAULT 1,
  `creada_en` datetime(6) NOT NULL DEFAULT current_timestamp(6),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `ordenes_compra` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `numero` varchar(255) NOT NULL,
  `proveedor` varchar(255) NOT NULL,
  `estado` enum('borrador','confirmada','en_transito','recibida','cancelada') NOT NULL DEFAULT 'borrador',
  `fecha_estimada` date DEFAULT NULL,
  `total` decimal(12,2) NOT NULL DEFAULT 0.00,
  `notas` varchar(255) DEFAULT NULL,
  `aplica_itbis` tinyint(1) NOT NULL DEFAULT 0,
  `usuario_id` int(11) DEFAULT NULL,
  `creado_en` datetime(6) NOT NULL DEFAULT current_timestamp(6),
  `actualizado_en` datetime(6) NOT NULL DEFAULT current_timestamp(6) ON UPDATE current_timestamp(6),
  `proveedor_id` int(11) DEFAULT NULL,
  `comprador` varchar(255) DEFAULT NULL,
  `referencia_proveedor` varchar(255) DEFAULT NULL,
  `fecha_limite` date DEFAULT NULL,
  `entrega_esperada` date DEFAULT NULL,
  `documento_origen` varchar(255) DEFAULT NULL,
  `orden_produccion_id` int(11) DEFAULT NULL,
  `lineas` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`lineas`)),
  `op_ids` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`op_ids`)),
  PRIMARY KEY (`id`),
  UNIQUE KEY `IDX_3111d653e42e410f84cb6d4683` (`numero`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `ordenes_produccion` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `numero` varchar(255) NOT NULL,
  `cotizacion_id` int(11) NOT NULL,
  `cliente_id` int(11) NOT NULL,
  `estado` enum('pendiente','en_diseno','en_produccion','en_terminacion','atraso','listo','listo_parcial','entregado','cancelado') NOT NULL DEFAULT 'pendiente',
  `semaforo` enum('normal','alerta','critico') NOT NULL DEFAULT 'normal',
  `fecha_comprometida` date NOT NULL,
  `creado_en` datetime(6) NOT NULL DEFAULT current_timestamp(6),
  `actualizado_en` datetime(6) NOT NULL DEFAULT current_timestamp(6) ON UPDATE current_timestamp(6),
  `especificaciones` text DEFAULT NULL,
  `notas` text DEFAULT NULL,
  `descuento_global_pct` decimal(5,2) NOT NULL DEFAULT 0.00,
  `adjuntos` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`adjuntos`)),
  `fecha_hora_entrega` datetime DEFAULT NULL,
  `lineas_produccion` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`lineas_produccion`)),
  `creado_por` varchar(255) DEFAULT NULL,
  `convertido_por` varchar(255) DEFAULT NULL,
  `tareas` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`tareas`)),
  `estado_produccion` enum('sin_iniciar','en_proceso','pausado','finalizado','cancelada') NOT NULL DEFAULT 'sin_iniciar',
  `estado_materiales` enum('disponible','parcial','en_espera') NOT NULL DEFAULT 'en_espera',
  `tiempo_inicio` datetime DEFAULT NULL,
  `tiempo_fin` datetime DEFAULT NULL,
  `responsable_principal` varchar(255) DEFAULT NULL,
  `responsables_secundarios` text DEFAULT NULL,
  `cancelacion_solicitada` tinyint(1) NOT NULL DEFAULT 0,
  `cancelacion_motivo` text DEFAULT NULL,
  `cancelacion_solicitado_por` varchar(255) DEFAULT NULL,
  `entregado_por` varchar(100) DEFAULT NULL,
  `fecha_entrega_real` datetime DEFAULT NULL,
  `notas_entrega` text DEFAULT NULL,
  `complejidad` enum('exenta','sencilla','mediana','avanzada') DEFAULT 'mediana',
  `tipo_ncf_default` varchar(20) DEFAULT NULL,
  `revision_fisica` varchar(120) DEFAULT NULL,
  `solicitado_por` varchar(120) DEFAULT NULL,
  `contacto_id` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `IDX_e7cbe6fb5898d3560afcb2ecc1` (`numero`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `pagos` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `numero` varchar(255) NOT NULL,
  `cliente_id` int(11) DEFAULT NULL,
  `cotizacion_id` int(11) DEFAULT NULL,
  `referencia` varchar(255) DEFAULT NULL,
  `metodo` enum('efectivo','tarjeta','transferencia','cheque') NOT NULL,
  `monto_total` decimal(12,2) NOT NULL,
  `itbis_monto` decimal(12,2) NOT NULL DEFAULT 0.00,
  `base_imponible` decimal(12,2) NOT NULL DEFAULT 0.00,
  `incluye_itbis` tinyint(4) NOT NULL DEFAULT 1,
  `banco` varchar(255) DEFAULT NULL,
  `referencia_banco` varchar(255) DEFAULT NULL,
  `estado` enum('pendiente','completado','parcial','anulado') NOT NULL DEFAULT 'completado',
  `notas` varchar(255) DEFAULT NULL,
  `usuario_id` int(11) DEFAULT NULL,
  `sesion_caja_id` int(11) DEFAULT NULL,
  `fecha_cobro` date DEFAULT NULL,
  `creado_en` datetime(6) NOT NULL DEFAULT current_timestamp(6),
  `lineas` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`lineas`)),
  PRIMARY KEY (`id`),
  UNIQUE KEY `IDX_8f671b426d446549d860654927` (`numero`),
  KEY `idx_pagos_sesion` (`sesion_caja_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `password_reset_solicitudes` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `usuario_id` int(11) DEFAULT NULL,
  `email` varchar(190) DEFAULT NULL,
  `estado` enum('pendiente','atendida','rechazada') NOT NULL DEFAULT 'pendiente',
  `ip` varchar(45) DEFAULT NULL,
  `atendida_por` varchar(120) DEFAULT NULL,
  `atendida_en` datetime(6) DEFAULT NULL,
  `creado_en` datetime(6) NOT NULL DEFAULT current_timestamp(6),
  PRIMARY KEY (`id`),
  KEY `idx_reset_estado` (`estado`),
  KEY `idx_reset_fecha` (`creado_en`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `pausas_produccion` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `orden_id` int(11) NOT NULL,
  `motivo` text NOT NULL,
  `fecha_inicio` datetime NOT NULL,
  `fecha_fin` datetime DEFAULT NULL,
  `creado_en` datetime(6) NOT NULL DEFAULT current_timestamp(6),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `plantillas_ruta` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `nombre` varchar(255) NOT NULL,
  `descripcion` varchar(255) DEFAULT NULL,
  `pasos` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(`pasos`)),
  `activo` tinyint(1) NOT NULL DEFAULT 1,
  `creado_en` datetime(6) NOT NULL DEFAULT current_timestamp(6),
  `actualizado_en` datetime(6) NOT NULL DEFAULT current_timestamp(6) ON UPDATE current_timestamp(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `nombre` (`nombre`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `procesos_lote` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `lote_id` int(11) NOT NULL,
  `nombre` varchar(100) NOT NULL,
  `orden` int(11) NOT NULL DEFAULT 0,
  `estado` enum('pendiente','en_proceso','completado') NOT NULL DEFAULT 'pendiente',
  `responsable` varchar(150) DEFAULT NULL,
  `tiempo_inicio` datetime DEFAULT NULL,
  `tiempo_fin` datetime DEFAULT NULL,
  `pausas` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`pausas`)),
  `notas` text DEFAULT NULL,
  `creado_en` datetime(6) NOT NULL DEFAULT current_timestamp(6),
  `actualizado_en` datetime(6) NOT NULL DEFAULT current_timestamp(6) ON UPDATE current_timestamp(6),
  PRIMARY KEY (`id`),
  KEY `idx_lote_id` (`lote_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `productos` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `nombre` varchar(255) NOT NULL,
  `descripcion` varchar(255) DEFAULT NULL,
  `sku` varchar(255) DEFAULT NULL,
  `categoria` varchar(255) DEFAULT NULL,
  `precio_base` decimal(12,2) NOT NULL DEFAULT 0.00,
  `costo` decimal(12,2) NOT NULL DEFAULT 0.00,
  `unidad` varchar(255) NOT NULL DEFAULT 'Pieza',
  `piezas_por_unidad` int(11) NOT NULL DEFAULT 1 COMMENT 'Piezas fisicas por unidad vendida (uniforme = camiseta+short = 2). Autocompleta las aplicaciones por tecnica al cotizar.',
  `aplica_itbis` tinyint(4) NOT NULL DEFAULT 1,
  `es_personalizable` tinyint(4) NOT NULL DEFAULT 1,
  `activo` tinyint(4) NOT NULL DEFAULT 1,
  `stock_actual` int(11) NOT NULL DEFAULT 0,
  `stock_minimo` int(11) NOT NULL DEFAULT 0,
  `proveedor` varchar(255) DEFAULT NULL,
  `notas` varchar(255) DEFAULT NULL,
  `creado_en` datetime(6) NOT NULL DEFAULT current_timestamp(6),
  `actualizado_en` datetime(6) NOT NULL DEFAULT current_timestamp(6) ON UPDATE current_timestamp(6),
  `margen_ganancia` decimal(5,2) NOT NULL DEFAULT 30.00,
  `precio_minimo` decimal(12,2) NOT NULL DEFAULT 0.00,
  `tipo_producto` enum('fisico_fabricado','fisico_comprado','servicio') NOT NULL DEFAULT 'fisico_comprado',
  `tecnica_default_id` int(11) DEFAULT NULL,
  `tipo_produccion` enum('fabricacion','proceso','fabricacion_proceso') DEFAULT NULL,
  `marca` varchar(255) DEFAULT NULL,
  `maneja_inventario` tinyint(1) NOT NULL DEFAULT 1,
  `atributos` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`atributos`)),
  `precios_por_talla` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`precios_por_talla`)),
  `tecnicas` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`tecnicas`)),
  `costos_por_talla` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`costos_por_talla`)),
  `tallas_por_rango` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`tallas_por_rango`)),
  PRIMARY KEY (`id`),
  UNIQUE KEY `IDX_805687bf24c1411756fbd37b2f` (`sku`),
  KEY `idx_tecnica_default` (`tecnica_default_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `proveedores` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `nombre` varchar(255) NOT NULL,
  `rnc` varchar(20) DEFAULT NULL,
  `persona_contacto` varchar(255) DEFAULT NULL,
  `telefono` varchar(255) DEFAULT NULL,
  `email` varchar(255) DEFAULT NULL,
  `direccion` text DEFAULT NULL,
  `notas` text DEFAULT NULL,
  `activo` tinyint(4) NOT NULL DEFAULT 1,
  `creado_en` datetime(6) NOT NULL DEFAULT current_timestamp(6),
  `actualizado_en` datetime(6) NOT NULL DEFAULT current_timestamp(6) ON UPDATE current_timestamp(6),
  PRIMARY KEY (`id`),
  KEY `idx_rnc` (`rnc`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `proveedor_productos` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `proveedor_id` int(11) NOT NULL,
  `producto_id` int(11) NOT NULL,
  `producto_nombre` varchar(255) DEFAULT NULL,
  `precio_compra` decimal(12,2) DEFAULT NULL,
  `tiempo_entrega` varchar(255) DEFAULT NULL,
  `codigo_proveedor` varchar(255) DEFAULT NULL,
  `creado_en` datetime(6) NOT NULL DEFAULT current_timestamp(6),
  PRIMARY KEY (`id`),
  KEY `FK_15f0d3ccc96599461419f12592f` (`proveedor_id`),
  CONSTRAINT `FK_15f0d3ccc96599461419f12592f` FOREIGN KEY (`proveedor_id`) REFERENCES `proveedores` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `recepciones_departamento` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `lote_id` int(11) NOT NULL,
  `orden_id` int(11) NOT NULL,
  `orden_numero` varchar(255) NOT NULL,
  `dpto_origen` varchar(255) NOT NULL,
  `dpto_destino` varchar(255) NOT NULL,
  `items` longtext NOT NULL,
  `estado` varchar(30) NOT NULL DEFAULT 'pendiente',
  `creado_en` datetime NOT NULL DEFAULT current_timestamp(),
  `confirmado_por_id` int(11) DEFAULT NULL,
  `confirmado_por_nombre` varchar(255) DEFAULT NULL,
  `confirmado_en` datetime DEFAULT NULL,
  `notas` text DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `recibos_ingreso` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `numero` varchar(50) NOT NULL,
  `tipo` enum('anticipo','abono','pago_total') NOT NULL,
  `orden_produccion_id` int(11) DEFAULT NULL,
  `factura_id` int(11) DEFAULT NULL,
  `factura_pago_id` int(11) DEFAULT NULL,
  `cliente_id` int(11) DEFAULT NULL,
  `cliente_nombre` varchar(255) DEFAULT NULL,
  `metodo` varchar(50) NOT NULL,
  `monto` decimal(12,2) NOT NULL,
  `fecha` date NOT NULL,
  `referencia` varchar(255) DEFAULT NULL,
  `banco_nombre` varchar(100) DEFAULT NULL,
  `cuenta_digitos` varchar(4) DEFAULT NULL,
  `cuenta_banco_id` int(11) DEFAULT NULL,
  `validado` tinyint(1) NOT NULL DEFAULT 0,
  `validado_por` varchar(100) DEFAULT NULL,
  `validado_en` datetime DEFAULT NULL,
  `notas` text DEFAULT NULL,
  `creado_por` varchar(255) DEFAULT NULL,
  `creado_en` datetime(6) NOT NULL DEFAULT current_timestamp(6),
  `sesion_caja_id` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `numero` (`numero`),
  KEY `IDX_recibos_factura` (`factura_id`),
  KEY `IDX_recibos_orden` (`orden_produccion_id`),
  KEY `IDX_recibos_fecha` (`fecha`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `registros_tiempo_operario` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `lote_id` int(11) NOT NULL,
  `orden_id` int(11) NOT NULL,
  `orden_numero` varchar(50) DEFAULT NULL,
  `operario_nombre` varchar(255) DEFAULT NULL,
  `departamento` varchar(100) DEFAULT NULL,
  `tecnica` varchar(100) DEFAULT NULL,
  `piezas_ok` int(11) NOT NULL DEFAULT 0,
  `piezas_retrabajo` int(11) NOT NULL DEFAULT 0,
  `piezas_descarte` int(11) NOT NULL DEFAULT 0,
  `duracion_minutos` int(11) DEFAULT NULL,
  `min_por_pieza` decimal(8,2) DEFAULT NULL,
  `fecha` date NOT NULL,
  `creado_en` datetime(6) NOT NULL DEFAULT current_timestamp(6),
  PRIMARY KEY (`id`),
  KEY `IDX_rto_lote` (`lote_id`),
  KEY `IDX_rto_orden` (`orden_id`),
  KEY `IDX_rto_operario` (`operario_nombre`),
  KEY `IDX_rto_departamento` (`departamento`),
  KEY `IDX_rto_fecha` (`fecha`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `reservas_inventario` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `orden_id` int(11) NOT NULL,
  `producto_id` int(11) NOT NULL,
  `producto_nombre` varchar(255) NOT NULL,
  `cantidad_reservada` decimal(12,2) NOT NULL,
  `estado` enum('activa','consumida','liberada') NOT NULL DEFAULT 'activa',
  `creado_en` datetime(6) NOT NULL DEFAULT current_timestamp(6),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `sesiones_caja` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `numero` varchar(50) NOT NULL,
  `usuario_nombre` varchar(255) DEFAULT NULL,
  `usuario_id` int(11) DEFAULT NULL,
  `estado` enum('borrador','abierta','por_validar','validada') NOT NULL DEFAULT 'abierta',
  `efectivo_inicial` decimal(12,2) NOT NULL DEFAULT 0.00,
  `efectivo_cobrado` decimal(12,2) NOT NULL DEFAULT 0.00,
  `efectivo_final_real` decimal(12,2) NOT NULL DEFAULT 0.00,
  `notas_cierre` text DEFAULT NULL,
  `cerrado_por` varchar(255) DEFAULT NULL,
  `validado_por` varchar(255) DEFAULT NULL,
  `fecha_apertura` datetime(6) NOT NULL DEFAULT current_timestamp(6),
  `fecha_cierre` datetime(6) DEFAULT NULL,
  `fecha_validacion` datetime(6) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `numero` (`numero`),
  KEY `IDX_sesiones_estado` (`estado`),
  KEY `IDX_sesiones_usuario` (`usuario_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `sesiones_log` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `usuario_id` int(11) DEFAULT NULL,
  `email` varchar(190) DEFAULT NULL,
  `ip` varchar(45) DEFAULT NULL,
  `exito` tinyint(1) NOT NULL DEFAULT 0,
  `motivo` varchar(60) DEFAULT NULL,
  `user_agent` varchar(255) DEFAULT NULL,
  `creado_en` datetime(6) NOT NULL DEFAULT current_timestamp(6),
  PRIMARY KEY (`id`),
  KEY `idx_sesiones_fecha` (`creado_en`),
  KEY `idx_sesiones_usuario` (`usuario_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `solicitudes_credito` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `cliente_id` int(11) NOT NULL,
  `orden_id` int(11) DEFAULT NULL,
  `solicitado_por_id` int(11) DEFAULT NULL,
  `solicitado_por_nombre` varchar(80) DEFAULT NULL,
  `limite_solicitado` decimal(12,2) NOT NULL DEFAULT 0.00,
  `plazo_solicitado` int(11) NOT NULL DEFAULT 30,
  `motivo` varchar(300) DEFAULT NULL,
  `estado` enum('pendiente','aprobada','rechazada') NOT NULL DEFAULT 'pendiente',
  `resuelto_por` varchar(80) DEFAULT NULL,
  `resuelto_en` datetime DEFAULT NULL,
  `respuesta` varchar(300) DEFAULT NULL,
  `creado_en` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_sc_cliente` (`cliente_id`),
  KEY `idx_sc_estado` (`estado`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `sucursales` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `nombre` varchar(80) NOT NULL,
  `direccion` varchar(200) DEFAULT NULL,
  `lat` decimal(10,7) DEFAULT NULL,
  `lng` decimal(10,7) DEFAULT NULL,
  `radio_m` int(11) NOT NULL DEFAULT 100,
  `ip_publica` varchar(255) DEFAULT NULL,
  `activo` tinyint(1) NOT NULL DEFAULT 1,
  `creado_en` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `tareas_produccion` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `orden_id` int(11) NOT NULL,
  `departamento` varchar(255) NOT NULL,
  `nombre` varchar(255) NOT NULL,
  `estado` enum('pendiente','en_proceso','completado') NOT NULL DEFAULT 'pendiente',
  `responsable` varchar(255) DEFAULT NULL,
  `tiempo_estimado` varchar(255) DEFAULT NULL,
  `fecha_inicio` datetime DEFAULT NULL,
  `fecha_fin` datetime DEFAULT NULL,
  `orden_ejecucion` int(11) NOT NULL DEFAULT 0,
  `creado_en` datetime(6) NOT NULL DEFAULT current_timestamp(6),
  `actualizado_en` datetime(6) NOT NULL DEFAULT current_timestamp(6) ON UPDATE current_timestamp(6),
  PRIMARY KEY (`id`),
  KEY `fk_tareas_orden` (`orden_id`),
  CONSTRAINT `fk_tareas_orden` FOREIGN KEY (`orden_id`) REFERENCES `ordenes_produccion` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `tecnicas` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `nombre` varchar(255) NOT NULL,
  `precio_default` decimal(12,2) NOT NULL DEFAULT 0.00,
  `unidad_de_trabajo` enum('por_pieza','por_lote','por_color') NOT NULL DEFAULT 'por_pieza',
  `departamento_id` int(11) DEFAULT NULL,
  `departamento_nombre` varchar(255) DEFAULT NULL,
  `activo` tinyint(4) NOT NULL DEFAULT 1,
  `creado_en` datetime(6) NOT NULL DEFAULT current_timestamp(6),
  `actualizado_en` datetime(6) NOT NULL DEFAULT current_timestamp(6) ON UPDATE current_timestamp(6),
  `subtecnicas` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`subtecnicas`)),
  PRIMARY KEY (`id`),
  UNIQUE KEY `IDX_e549a777085b8cba2f5f7b095a` (`nombre`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `telegram_codigos` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `codigo` varchar(10) NOT NULL,
  `usuario_id` int(11) NOT NULL,
  `expira_en` datetime NOT NULL,
  `usado` tinyint(1) NOT NULL DEFAULT 0,
  `creado_en` datetime(6) NOT NULL DEFAULT current_timestamp(6),
  PRIMARY KEY (`id`),
  UNIQUE KEY `codigo` (`codigo`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `telegram_usuarios` (
  `chat_id` bigint(20) NOT NULL,
  `usuario_id` int(11) NOT NULL,
  `usuario_nombre` varchar(150) NOT NULL,
  `telegram_username` varchar(100) DEFAULT NULL,
  `telegram_first_name` varchar(100) DEFAULT NULL,
  `vinculado_en` datetime(6) NOT NULL DEFAULT current_timestamp(6),
  `actualizado_en` datetime(6) NOT NULL DEFAULT current_timestamp(6) ON UPDATE current_timestamp(6),
  PRIMARY KEY (`chat_id`),
  KEY `idx_tg_usuario_id` (`usuario_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `usuarios` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `email` varchar(255) NOT NULL,
  `nombre` varchar(255) NOT NULL,
  `password_hash` varchar(255) NOT NULL,
  `rol` enum('admin','supervisor','vendedor','produccion','contador','operario') NOT NULL DEFAULT 'vendedor',
  `activo` tinyint(4) NOT NULL DEFAULT 1,
  `ultimo_acceso` datetime DEFAULT NULL,
  `creado_en` datetime(6) NOT NULL DEFAULT current_timestamp(6),
  `actualizado_en` datetime(6) NOT NULL DEFAULT current_timestamp(6) ON UPDATE current_timestamp(6),
  `departamento` varchar(100) DEFAULT NULL,
  `departamentos` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`departamentos`)),
  `periodo_pago` enum('semanal','quincenal') DEFAULT 'quincenal',
  `codigo_empleado` varchar(20) DEFAULT NULL,
  `cedula` varchar(15) DEFAULT NULL,
  `fecha_nacimiento` date DEFAULT NULL,
  `sexo` enum('M','F','otro') DEFAULT NULL,
  `estado_civil` enum('soltero','casado','union_libre','divorciado','viudo') DEFAULT NULL,
  `nacionalidad` varchar(100) DEFAULT 'Dominicana',
  `telefono` varchar(20) DEFAULT NULL,
  `direccion` text DEFAULT NULL,
  `foto_url` varchar(500) DEFAULT NULL,
  `contacto_emergencia_nombre` varchar(255) DEFAULT NULL,
  `contacto_emergencia_telefono` varchar(20) DEFAULT NULL,
  `contacto_emergencia_relacion` varchar(50) DEFAULT NULL,
  `fecha_ingreso` date DEFAULT NULL,
  `fecha_salida` date DEFAULT NULL,
  `cargo` varchar(100) DEFAULT NULL,
  `supervisor_id` int(11) DEFAULT NULL,
  `tipo_contrato` enum('indefinido','temporal','obra','servicio','prueba') DEFAULT NULL,
  `estatus_laboral` enum('activo','suspendido','vacaciones','licencia','cancelado') DEFAULT 'activo',
  `salario` decimal(12,2) DEFAULT NULL,
  `horario_asignado` varchar(100) DEFAULT NULL,
  `onboarding_token` varchar(64) DEFAULT NULL,
  `onboarding_token_expira` datetime DEFAULT NULL,
  `onboarding_completado_en` datetime DEFAULT NULL,
  `debe_cambiar_password` tinyint(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  UNIQUE KEY `IDX_446adfc18b35418aac32ae0b7b` (`email`),
  UNIQUE KEY `idx_onboarding_token` (`onboarding_token`),
  KEY `idx_codigo_empleado` (`codigo_empleado`),
  KEY `idx_cedula` (`cedula`),
  KEY `idx_supervisor` (`supervisor_id`),
  CONSTRAINT `fk_supervisor` FOREIGN KEY (`supervisor_id`) REFERENCES `usuarios` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `usuario_biometria` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `usuario_id` int(11) NOT NULL,
  `dispositivo_id` int(11) NOT NULL,
  `device_user_id` varchar(20) NOT NULL,
  `enrolado` tinyint(1) NOT NULL DEFAULT 0,
  `enrolado_en` datetime DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_ud` (`usuario_id`,`dispositivo_id`),
  UNIQUE KEY `uq_dev_uid` (`dispositivo_id`,`device_user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `usuario_horarios` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `usuario_id` int(11) NOT NULL,
  `plantilla_id` int(11) DEFAULT NULL,
  `dias_personalizados` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`dias_personalizados`)),
  `tolerancia_min` int(11) DEFAULT NULL,
  `sucursal_id` int(11) DEFAULT NULL,
  `sucursales_permitidas` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin DEFAULT NULL CHECK (json_valid(`sucursales_permitidas`)),
  `puede_movil` tinyint(1) NOT NULL DEFAULT 1,
  `vigente_desde` date NOT NULL,
  `vigente_hasta` date DEFAULT NULL,
  `creado_por` varchar(80) DEFAULT NULL,
  `creado_en` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_usuario` (`usuario_id`,`vigente_desde`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `usuario_moviles` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `usuario_id` int(11) NOT NULL,
  `hash` varchar(64) NOT NULL,
  `user_agent` varchar(255) DEFAULT NULL,
  `aprobado` tinyint(1) NOT NULL DEFAULT 1,
  `creado_en` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_um` (`usuario_id`,`hash`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `validaciones_fisicas` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `iniciada_por` varchar(80) DEFAULT NULL,
  `creado_en` datetime NOT NULL DEFAULT current_timestamp(),
  `cerrada_en` datetime DEFAULT NULL,
  `total_listas` int(11) NOT NULL DEFAULT 0,
  `encontradas` int(11) NOT NULL DEFAULT 0,
  `no_encontradas` int(11) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `validacion_fisica_items` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `validacion_id` int(11) NOT NULL,
  `orden_id` int(11) NOT NULL,
  `resultado` enum('encontrada','no_encontrada') NOT NULL,
  `escaneado_por` varchar(80) DEFAULT NULL,
  `creado_en` datetime NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_vi` (`validacion_id`,`orden_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_uca1400_ai_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!40101 SET character_set_client = utf8mb4 */;
CREATE TABLE `variantes_producto` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `producto_id` int(11) NOT NULL,
  `sku` varchar(255) NOT NULL,
  `atributos` longtext CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL CHECK (json_valid(`atributos`)),
  `stock_actual` int(11) NOT NULL DEFAULT 0,
  `costo` decimal(12,2) NOT NULL DEFAULT 0.00,
  `precio` decimal(12,2) NOT NULL DEFAULT 0.00,
  `activo` tinyint(1) NOT NULL DEFAULT 1,
  `creado_en` datetime(6) NOT NULL DEFAULT current_timestamp(6),
  `actualizado_en` datetime(6) NOT NULL DEFAULT current_timestamp(6) ON UPDATE current_timestamp(6),
  `stock_minimo` int(11) DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `IDX_86cae081c04f72309229a68b5d` (`sku`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*M!100616 SET NOTE_VERBOSITY=@OLD_NOTE_VERBOSITY */;

