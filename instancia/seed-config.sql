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

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `categorias_producto` WRITE;
/*!40000 ALTER TABLE `categorias_producto` DISABLE KEYS */;
INSERT INTO `categorias_producto` (`id`, `nombre`, `descripcion`, `color`, `activo`, `orden`, `creado_en`) VALUES (1,'POLOSHIRT','CON CUELLO','#1e3a8a',1,0,'2026-04-03 17:46:20.616349'),
(2,'TSHIRT','CUELLO REDONDO O V','#1e3a8a',1,1,'2026-04-03 17:46:48.131107'),
(3,'CAMISAS',NULL,'#1e3a8a',1,2,'2026-04-03 17:47:00.728657'),
(4,'GORRAS',NULL,'#1e3a8a',1,3,'2026-04-06 16:38:52.947425'),
(5,'ABRIGOS',NULL,'#1e3a8a',1,4,'2026-04-12 07:17:45.711213'),
(6,'SERVICIO',NULL,'#1e3a8a',1,5,'2026-04-14 21:27:29.573121'),
(7,'CHALECOS',NULL,'#1e3a8a',1,6,'2026-04-14 21:28:16.688051'),
(8,'SUBLIMACION TEXTIL',NULL,'#1e3a8a',1,7,'2026-04-19 20:09:43.559469');
/*!40000 ALTER TABLE `categorias_producto` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `departamentos` WRITE;
/*!40000 ALTER TABLE `departamentos` DISABLE KEYS */;
INSERT INTO `departamentos` (`id`, `nombre`, `activo`, `orden`, `creado_en`, `actualizado_en`, `checkpoints`) VALUES (1,'DISEÑO DTF',1,0,'2026-04-03 06:36:56.757264','2026-04-11 14:25:34.000000','[]'),
(2,'BORDADO',1,1,'2026-04-03 06:36:56.757264','2026-04-10 23:11:10.000000',NULL),
(3,'IMPRESION DTF',1,2,'2026-04-03 06:36:56.757264','2026-04-04 04:42:56.000000',NULL),
(4,'SUBLIMACION',1,3,'2026-04-03 06:36:56.757264','2026-04-10 23:11:18.000000',NULL),
(5,'SERIGRAFIA DTF',1,4,'2026-04-03 06:36:56.757264','2026-04-10 23:11:32.000000',NULL),
(6,'CONFECCIONES',1,5,'2026-04-03 06:36:56.757264','2026-04-10 23:11:46.000000',NULL),
(7,'TERMINACION',1,6,'2026-04-03 06:36:56.757264','2026-04-10 23:11:58.000000',NULL),
(8,'DISEÑO BORDADO',1,7,'2026-04-12 04:55:13.397949','2026-04-12 04:55:13.397949',NULL),
(9,'DISEÑO SUBLIMACION',1,0,'2026-05-21 07:11:43.199460','2026-05-21 07:11:43.199460',NULL);
/*!40000 ALTER TABLE `departamentos` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `tecnicas` WRITE;
/*!40000 ALTER TABLE `tecnicas` DISABLE KEYS */;
INSERT INTO `tecnicas` (`id`, `nombre`, `precio_default`, `unidad_de_trabajo`, `departamento_id`, `departamento_nombre`, `activo`, `creado_en`, `actualizado_en`, `subtecnicas`) VALUES (1,'BORDADO',200.00,'por_pieza',2,'BORDADO',1,'2026-04-03 06:36:56.758569','2026-04-12 04:36:08.000000','[{\"nombre\":\"DISEÑO BORDADO\",\"rol\":\"\"},{\"nombre\":\"BORDADO EN MAQUINA\",\"rol\":\"\"}]'),
(3,'SUBLIMACION',200.00,'por_pieza',4,'SUBLIMACION',1,'2026-04-03 06:36:56.758569','2026-04-19 20:45:31.000000','[{\"nombre\":\"DISEÑO SUBLIMACION\",\"rol\":\"\"},{\"nombre\":\"IMPRESION Y PLANCHADO\",\"rol\":\"\"}]'),
(4,'SERIGRAFIA DTF',150.00,'por_pieza',5,'SERIGRAFIA DTF',1,'2026-04-03 06:36:56.758569','2026-04-12 04:40:15.000000','[{\"nombre\":\"DISEÑO E IMPRESION\",\"rol\":\"\"},{\"nombre\":\"PLANCHADO\",\"rol\":\"\"}]'),
(5,'CONFECCION',200.00,'por_pieza',6,'CONFECCIONES',1,'2026-04-03 06:36:56.758569','2026-04-12 04:36:31.000000',NULL),
(6,'IMPRESION UV',600.00,'por_pieza',3,'IMPRESION DTF',1,'2026-04-03 06:36:56.758569','2026-04-12 04:56:18.000000',NULL),
(12,'DISEÑO BORDADO',0.00,'por_lote',8,'DISEÑO BORDADO',1,'2026-05-19 10:49:45.062270','2026-05-19 11:51:05.575472',NULL),
(13,'DISEÑO SERIGRAFIA DTF',0.00,'por_lote',1,'DISEÑO DTF',1,'2026-05-19 11:08:30.512236','2026-05-19 11:51:44.009307',NULL),
(14,'DISEÑO SUBLIMACION',0.00,'por_lote',1,'DISEÑO DTF',1,'2026-05-19 11:08:30.512236','2026-05-19 11:51:44.009307',NULL);
/*!40000 ALTER TABLE `tecnicas` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `marcas` WRITE;
/*!40000 ALTER TABLE `marcas` DISABLE KEYS */;
/*!40000 ALTER TABLE `marcas` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `plantillas_ruta` WRITE;
/*!40000 ALTER TABLE `plantillas_ruta` DISABLE KEYS */;
INSERT INTO `plantillas_ruta` (`id`, `nombre`, `descripcion`, `pasos`, `activo`, `creado_en`, `actualizado_en`) VALUES (1,'BORDADO','','[{\"departamento\": \"BORDADO\", \"tipo_lote\": \"proceso\", \"orden_ejecucion\": 1, \"tipo_ejecucion\": \"secuencial\", \"tareas\": [{\"nombre\": \"DISEÑO DE BORDADO\", \"departamento\": \"DISEÑO BORDADO\"}, {\"nombre\": \"BORDADO EN MAQUINA\", \"departamento\": \"BORDADO\"}]}, {\"departamento\": \"TERMINACION\", \"tipo_lote\": \"proceso\", \"orden_ejecucion\": 2, \"tipo_ejecucion\": \"secuencial\"}]',1,'2026-04-11 14:49:24.674278','2026-05-19 18:37:47.915382'),
(2,'BORDADO Y SERIGRAFIA DTF','','[{\"departamento\":\"IMPRESION DTF\",\"tipo_lote\":\"fabricacion\",\"orden_ejecucion\":1,\"tipo_ejecucion\":\"secuencial\"},{\"departamento\":\"SERIGRAFIA DTF\",\"tipo_lote\":\"fabricacion\",\"orden_ejecucion\":2,\"tipo_ejecucion\":\"secuencial\"},{\"departamento\":\"BORDADO\",\"tipo_lote\":\"fabricacion\",\"orden_ejecucion\":3,\"tipo_ejecucion\":\"secuencial\"},{\"departamento\":\"TERMINACION\",\"tipo_lote\":\"fabricacion\",\"orden_ejecucion\":4,\"tipo_ejecucion\":\"secuencial\"}]',1,'2026-04-11 14:50:36.583779','2026-04-11 14:50:36.583779'),
(3,'SERIGRAFIA DTF','','[{\"departamento\":\"IMPRESION DTF\",\"tipo_lote\":\"fabricacion\",\"orden_ejecucion\":1,\"tipo_ejecucion\":\"secuencial\"},{\"departamento\":\"SERIGRAFIA DTF\",\"tipo_lote\":\"fabricacion\",\"orden_ejecucion\":1,\"tipo_ejecucion\":\"paralelo\"},{\"departamento\":\"TERMINACION\",\"tipo_lote\":\"fabricacion\",\"orden_ejecucion\":2,\"tipo_ejecucion\":\"secuencial\"}]',1,'2026-04-11 14:54:39.981666','2026-04-11 14:54:39.981666'),
(4,'SUBLIMADO TEXTIL','','[{\"departamento\": \"SUBLIMACION\", \"tipo_lote\": \"fabricacion\", \"orden_ejecucion\": 1, \"tipo_ejecucion\": \"secuencial\", \"tareas\": [{\"nombre\": \"DISEÑO\", \"departamento\": \"DISEÑO SUBLIMACION\"}, {\"nombre\": \"IMPRESION Y PLANCADO\", \"departamento\": \"SUBLIMACION\"}]}, {\"departamento\": \"CONFECCIONES\", \"tipo_lote\": \"fabricacion\", \"orden_ejecucion\": 1, \"tipo_ejecucion\": \"paralelo\"}, {\"departamento\": \"TERMINACION\", \"tipo_lote\": \"fabricacion\", \"orden_ejecucion\": 2, \"tipo_ejecucion\": \"secuencial\"}]',1,'2026-04-19 20:08:10.864955','2026-05-21 07:11:54.382200'),
(5,'CONFECCION Y BORDADO','CONFECCION EN TALLER','[{\"departamento\":\"CONFECCIONES\",\"tipo_lote\":\"fabricacion\",\"orden_ejecucion\":1,\"tipo_ejecucion\":\"secuencial\"},{\"departamento\":\"BORDADO\",\"tipo_lote\":\"proceso\",\"orden_ejecucion\":1,\"tipo_ejecucion\":\"paralelo\"},{\"departamento\":\"TERMINACION\",\"tipo_lote\":\"fabricacion\",\"orden_ejecucion\":2,\"tipo_ejecucion\":\"secuencial\"}]',1,'2026-07-09 18:50:16.404740','2026-07-09 18:50:27.000000');
/*!40000 ALTER TABLE `plantillas_ruta` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `maquinas` WRITE;
/*!40000 ALTER TABLE `maquinas` DISABLE KEYS */;
INSERT INTO `maquinas` (`id`, `nombre`, `departamento_id`, `descripcion`, `activo`, `creado_en`, `actualizado_en`) VALUES (1,'TAJIMA 1 CABEZA',2,NULL,1,'2026-04-11 20:09:23.476098','2026-04-11 20:09:23.476098'),
(2,'TAJIMA 12 CABEZAS',2,NULL,1,'2026-04-11 20:09:39.170651','2026-04-11 20:09:39.170651'),
(3,'TAJIMA 18 CABEZAS',2,NULL,1,'2026-04-11 20:09:51.293398','2026-04-11 20:09:51.293398');
/*!40000 ALTER TABLE `maquinas` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `feriados` WRITE;
/*!40000 ALTER TABLE `feriados` DISABLE KEYS */;
INSERT INTO `feriados` (`id`, `fecha`, `nombre`, `año`, `creado_en`) VALUES (1,'2026-01-01','Año Nuevo',2026,'2026-04-25 18:41:50.408545'),
(2,'2026-01-05','Santos Reyes',2026,'2026-04-25 18:41:50.408545'),
(3,'2026-01-21','Altagracia',2026,'2026-04-25 18:41:50.408545'),
(4,'2026-01-26','Duarte',2026,'2026-04-25 18:41:50.408545'),
(5,'2026-02-27','Independencia',2026,'2026-04-25 18:41:50.408545'),
(6,'2026-04-03','Viernes Santo',2026,'2026-04-25 18:41:50.408545'),
(7,'2026-05-04','Día del Trabajo',2026,'2026-04-25 18:41:50.408545'),
(8,'2026-06-04','Corpus Christi',2026,'2026-04-25 18:41:50.408545'),
(9,'2026-08-16','Restauración',2026,'2026-04-25 18:41:50.408545'),
(10,'2026-09-24','Mercedes',2026,'2026-04-25 18:41:50.408545'),
(11,'2026-11-09','Constitución',2026,'2026-04-25 18:41:50.408545'),
(12,'2026-12-25','Navidad',2026,'2026-04-25 18:41:50.408545');
/*!40000 ALTER TABLE `feriados` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `flujos_produccion` WRITE;
/*!40000 ALTER TABLE `flujos_produccion` DISABLE KEYS */;
INSERT INTO `flujos_produccion` (`id`, `nombre`, `tipo_producto`, `tipo_produccion`, `tecnica`, `incluye_aplicacion`, `incluye_confeccion`, `requiere_diseno`, `estructura_json`, `activo`, `creado_en`, `actualizado_en`) VALUES (1,'BORDADO',NULL,NULL,'BORDADO',NULL,NULL,NULL,'{\"pasos\": [{\"temp_id\": 1, \"nombre\": \"BORDADO\", \"departamento\": \"BORDADO\", \"tipo_lote\": \"proceso\", \"tipo_ejecucion\": \"secuencial\", \"orden_ejecucion\": 1, \"depende_de\": null, \"desbloquear_al\": \"completado\", \"tareas\": [{\"nombre\": \"Diseño\", \"rol\": \"Diseñador\", \"departamento\": \"DISEÑO BORDADO\"}, {\"nombre\": \"Bordado en máquina\", \"rol\": \"Operario\"}]}, {\"temp_id\": 2, \"nombre\": \"TERMINACION\", \"departamento\": \"Terminación\", \"tipo_lote\": \"proceso\", \"tipo_ejecucion\": \"secuencial\", \"orden_ejecucion\": 2, \"depende_de\": 1, \"desbloquear_al\": \"en_proceso\", \"tareas\": []}]}',1,'2026-04-12 03:48:24.000000','2026-05-12 16:27:27.013616');
/*!40000 ALTER TABLE `flujos_produccion` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `horario_plantillas` WRITE;
/*!40000 ALTER TABLE `horario_plantillas` DISABLE KEYS */;
INSERT INTO `horario_plantillas` (`id`, `nombre`, `tolerancia_min`, `activo`, `creado_en`) VALUES (1,'HORARIO DE OFICINA',10,1,'2026-07-06 22:24:52'),
(2,'HORARIO DEL TALLER',10,1,'2026-07-12 17:56:05');
/*!40000 ALTER TABLE `horario_plantillas` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `horario_plantilla_dias` WRITE;
/*!40000 ALTER TABLE `horario_plantilla_dias` DISABLE KEYS */;
INSERT INTO `horario_plantilla_dias` (`id`, `plantilla_id`, `dia_semana`, `labora`, `entrada`, `salida_almuerzo`, `regreso_almuerzo`, `salida`) VALUES (1,1,1,1,'08:00:00','12:30:00','14:00:00','18:00:00'),
(2,1,2,1,'08:00:00','12:30:00','14:00:00','18:00:00'),
(3,1,3,1,'08:00:00','12:30:00','14:00:00','18:00:00'),
(4,1,4,1,'08:00:00','12:30:00','14:00:00','18:00:00'),
(5,1,5,1,'08:00:00','12:30:00','14:00:00','18:00:00'),
(6,1,6,1,'08:00:00',NULL,NULL,'13:00:00'),
(7,1,7,0,NULL,NULL,NULL,NULL),
(8,2,1,1,'07:30:00','12:00:00','13:00:00','17:30:00'),
(9,2,2,1,'07:30:00','12:00:00','13:00:00','17:30:00'),
(10,2,3,1,'07:30:00','12:00:00','13:00:00','17:30:00'),
(11,2,4,1,'07:30:00','12:00:00','13:00:00','17:30:00'),
(12,2,5,1,'07:30:00','12:00:00','13:00:00','17:30:00'),
(13,2,6,0,NULL,NULL,NULL,NULL),
(14,2,7,0,NULL,NULL,NULL,NULL);
/*!40000 ALTER TABLE `horario_plantilla_dias` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `inventario_interno_unidades` WRITE;
/*!40000 ALTER TABLE `inventario_interno_unidades` DISABLE KEYS */;
INSERT INTO `inventario_interno_unidades` (`id`, `insumo_id`, `estado`, `notas`, `registrado_por`, `modificado_por`, `fecha_cambio_estado`, `creado_en`) VALUES (1,1,'en_uso','','NAYELI','HANZEL','2026-06-06 17:40:04','2026-06-03 22:12:59'),
(2,1,'sellado','','NAYELI',NULL,NULL,'2026-06-03 22:12:59'),
(3,1,'sellado','','NAYELI',NULL,NULL,'2026-06-03 22:12:59'),
(4,1,'sellado','','NAYELI',NULL,NULL,'2026-06-03 22:12:59'),
(5,1,'sellado','','NAYELI',NULL,NULL,'2026-06-03 22:12:59'),
(6,1,'sellado','','NAYELI',NULL,NULL,'2026-06-03 22:12:59'),
(7,7,'agotado','','NAYELI','HANZEL','2026-06-08 18:57:44','2026-06-03 22:16:45'),
(8,7,'sellado','','NAYELI',NULL,NULL,'2026-06-03 22:16:45'),
(9,7,'sellado','','NAYELI',NULL,NULL,'2026-06-03 22:16:45'),
(10,7,'sellado','','NAYELI',NULL,NULL,'2026-06-03 22:16:45'),
(11,7,'sellado','','NAYELI',NULL,NULL,'2026-06-03 22:16:45'),
(12,3,'sellado','','NAYELI',NULL,NULL,'2026-06-03 22:17:04'),
(13,5,'sellado','','NAYELI',NULL,NULL,'2026-06-03 22:17:11'),
(14,4,'sellado','','NAYELI',NULL,NULL,'2026-06-03 22:17:17'),
(15,6,'sellado','','NAYELI',NULL,NULL,'2026-06-03 22:17:39'),
(16,6,'sellado','','NAYELI',NULL,NULL,'2026-06-03 22:17:39'),
(17,6,'sellado','','NAYELI',NULL,NULL,'2026-06-03 22:17:49'),
(18,6,'sellado','','NAYELI',NULL,NULL,'2026-06-03 22:17:49'),
(19,2,'sellado','','HANZEL',NULL,NULL,'2026-06-06 18:01:21');
/*!40000 ALTER TABLE `inventario_interno_unidades` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `incentivos_config` WRITE;
/*!40000 ALTER TABLE `incentivos_config` DISABLE KEYS */;
INSERT INTO `incentivos_config` (`id`, `departamento`, `complejidad`, `precio_por_pieza`, `meta_semanal`, `activo`, `creado_en`, `actualizado_en`) VALUES (1,'BORDADO','mediana',2.00,500,1,'2026-07-14 22:03:01.069392','2026-07-14 22:03:01.069392');
/*!40000 ALTER TABLE `incentivos_config` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*M!100616 SET NOTE_VERBOSITY=@OLD_NOTE_VERBOSITY */;

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

SET @OLD_AUTOCOMMIT=@@AUTOCOMMIT, @@AUTOCOMMIT=0;
LOCK TABLES `configuracion_sistema` WRITE;
/*!40000 ALTER TABLE `configuracion_sistema` DISABLE KEYS */;
INSERT INTO `configuracion_sistema` (`id`, `clave`, `valor`, `descripcion`, `actualizado_en`) VALUES (1,'tasa_itbis','18','Tasa de ITBIS (%)','2026-04-03 17:43:10.381233'),
(2,'margen_default','30','Margen de ganancia por defecto (%)','2026-04-03 17:43:10.386221'),
(3,'permisos_roles','{\"supervisor\":[\"clientes\",\"productos\",\"ventas\",\"produccion\",\"inventario\",\"compras\",\"caja\",\"inicio\",\"facturacion\"],\"vendedor\":[\"clientes\",\"productos\",\"ventas\",\"produccion\",\"inventario\",\"facturacion\",\"caja\"],\"contador\":[\"contabilidad\"],\"operario\":[\"produccion\"]}','Permisos de módulos por rol','2026-08-17 17:10:52.000000'),
(13,'pdf_mostrar_logo','true','Mostrar logo en PDF','2026-04-12 21:03:37.931503'),
(14,'accesos_rapidos','[{\"id\":\"ventas\",\"label\":\"Ventas\",\"href\":\"/ventas\",\"iconId\":\"ShoppingCart\",\"color\":\"#1e3a8a\",\"desc\":\"Cotizaciones y pedidos\"},{\"id\":\"produccion\",\"label\":\"Producción\",\"href\":\"/produccion/taller\",\"iconId\":\"Factory\",\"color\":\"#d97706\",\"desc\":\"Órdenes de producción\"},{\"id\":\"clientes\",\"label\":\"Clientes\",\"href\":\"/clientes\",\"iconId\":\"Users\",\"color\":\"#0891b2\",\"desc\":\"Gestión de clientes\"},{\"id\":\"caja\",\"label\":\"Caja y Pagos\",\"href\":\"/caja\",\"iconId\":\"Wallet\",\"color\":\"#dc2626\",\"desc\":\"Cobros y pagos\"},{\"id\":\"catalogo\",\"label\":\"Catálogo\",\"href\":\"/productos\",\"iconId\":\"Package\",\"color\":\"#059669\",\"desc\":\"Productos y precios\"}]',NULL,'2026-04-27 01:28:06.000000'),
(15,'notif_config','{\"ordenes_criticas\":{\"activa\":true,\"intervalo_horas\":8},\"ordenes_vencidas\":{\"activa\":true,\"intervalo_horas\":4},\"cotizaciones\":{\"activa\":true,\"intervalo_horas\":24,\"dias_umbral\":3},\"stock_bajo\":{\"activa\":false,\"intervalo_horas\":24}}',NULL,'2026-07-22 16:36:20.000000'),
(16,'categorias_egreso','[\"envio_de_pedido\",\"agua\",\"gasoil_planta\",\"gasolina_empleado\",\"comida_empleado\",\"sumistro_oficina\",\"insumo_taller\",\"pagos\"]',NULL,'2026-05-29 22:27:33.000000');
/*!40000 ALTER TABLE `configuracion_sistema` ENABLE KEYS */;
UNLOCK TABLES;
COMMIT;
SET AUTOCOMMIT=@OLD_AUTOCOMMIT;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*M!100616 SET NOTE_VERBOSITY=@OLD_NOTE_VERBOSITY */;

