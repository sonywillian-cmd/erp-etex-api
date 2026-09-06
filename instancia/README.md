# Crear una instancia nueva de E-Tex 360 (un cliente = una instancia)

Un solo código, una instancia por cliente. Cada instancia tiene **su base de datos, su
`.env`, su carpeta de archivos, su bot de Telegram y su clave de IA**, pero corre el
mismo `dist` de la API, el mismo build del frontend y el mismo `bot.js`.

```
instancia/
├── schema.sql            estructura de las 77 tablas reales (sin datos, sin AUTO_INCREMENT)
├── seed-config.sql       configuración que SÍ se copia a un cliente nuevo (ver abajo)
├── generar-esquema.sh    regenera los dos .sql desde el servidor de E-Tex
├── crear-instancia.sh    crea la instancia: BD + semilla + admin + .env + pm2 + nginx
├── crear-admin.js        hash bcrypt del primer usuario (lo usa el script)
└── plantillas/           api.env · bot.env · frontend.env · ecosystem.config.js · nginx.conf
```

## Qué se copia y qué NO

| Se copia (semilla)                                   | NUNCA se copia                                         |
|------------------------------------------------------|--------------------------------------------------------|
| categorías de producto, departamentos, técnicas       | secuencias NCF (`ncf_secuencias`) — son de la DGII     |
| plantillas de ruta, máquinas, flujos de producción    | cuentas bancarias, usuarios, empleados, biometría      |
| feriados, plantillas de horario y sus días            | clientes, productos, variantes, órdenes, facturas      |
| unidades de inventario interno, incentivos_config     | sucursales (GPS/IP de E-Tex), Telegram vinculado       |
| `configuracion_sistema`: tasa_itbis, margen_default,  | logo, nombre, RNC, dirección, teléfono, colores        |
| pdf_mostrar_logo, permisos_roles, accesos_rapidos,    | claves `bot_*` (token, Gemini)                         |
| categorias_egreso, notif_config                       | tablas `_bak*`/`_bkp*` (139 en E-Tex)                  |

El catálogo de productos se deja vacío a propósito (decisión del 27 ago 2026).

## Uso

```bash
cp instancia/plantillas/instancia.env.example /ruta/printex.env   # y rellenar
bash instancia/crear-instancia.sh /ruta/printex.env
```

El script:

1. Crea la base de datos y el usuario MySQL si le das `MYSQL_ROOT_PASS` (en el VPS);
   si no, usa la BD que ya exista (hosting compartido: crearla en hPanel primero).
2. Se niega a tocar una base que ya tenga tablas (salvo `--forzar`).
3. Importa `schema.sql` y `seed-config.sql`.
4. Inserta la sucursal "PRINCIPAL", el nombre de la empresa y el usuario **admin**
   (con contraseña temporal que debe cambiar al entrar).
5. Escribe `api.env`, `bot.env`, `frontend.env` en `$BASE_DIR/<instancia>/` con secretos
   generados (JWT, cifrado de configuración, secreto del bot).
6. Genera `ecosystem.<instancia>.config.js` (pm2) y `nginx.<instancia>.conf`.

Después, en el servidor:

```bash
pm2 start $BASE_DIR/<instancia>/ecosystem.<instancia>.config.js && pm2 save
# nginx: copiar nginx.<instancia>.conf a sites-enabled, certbot para el dominio
```

Todo lo demás (logo, RNC, colores, NCF, cuentas, bot, Gemini) se configura desde
**Ajustes** dentro del sistema, sin tocar el servidor.

## Regenerar el esquema cuando cambie la base de E-Tex

```bash
bash instancia/generar-esquema.sh     # en el servidor de E-Tex, deja los .sql en /tmp/instancia
```
y copiar los dos archivos a esta carpeta (commit).

## Pendiente conocido

No hay sistema de migraciones: las columnas se agregan a mano. Por eso `schema.sql`
es la fuente de verdad de la estructura y hay que regenerarlo tras cada cambio de tabla.
