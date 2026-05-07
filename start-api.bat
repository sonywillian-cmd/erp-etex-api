@echo off
chcp 65001 >nul
cls

echo.
echo  ╔══════════════════════════════════════════════════╗
echo  ║          E-Tex 360  —  Iniciar API               ║
echo  ╚══════════════════════════════════════════════════╝
echo.
echo  Selecciona el ambiente de base de datos:
echo.
echo  [1]  PRODUCCION   (datos reales del negocio)
echo  [2]  DESARROLLO   (datos de prueba)
echo.
set /p CHOICE="  Tu opcion (1 o 2): "

if "%CHOICE%"=="1" (
    set ENV_FILE=.env.production
    echo.
    echo  ⚠️  Conectando a PRODUCCION ...
    echo  ⚠️  Cualquier cambio afectara datos reales.
) else if "%CHOICE%"=="2" (
    set ENV_FILE=.env.development
    echo.
    echo  ✅  Conectando a DESARROLLO ...
    echo  ✅  Puedes probar con libertad.
) else (
    echo.
    echo  Opcion no reconocida. Usando DESARROLLO por defecto.
    set ENV_FILE=.env.development
)

echo.
echo  Ambiente : %ENV_FILE%
echo  ─────────────────────────────────────────────────
echo.

npm run start:dev
