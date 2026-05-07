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
    echo.
    echo  Ambiente : PRODUCCION
    echo  ─────────────────────────────────────────────────
    echo.
    npm run start:dev

) else if "%CHOICE%"=="2" (
    set ENV_FILE=.env.development
    echo.
    echo  ✅  Abriendo tunel SSH al VPS ...

    REM Abrir tunel SSH: localhost:3307 → VPS MySQL 3306
    start "" /B ssh -i "%USERPROFILE%\.ssh\erp_deploy" -p 65002 ^
        -o StrictHostKeyChecking=no ^
        -o ServerAliveInterval=60 ^
        -L 3307:127.0.0.1:3306 ^
        u372536694@82.25.89.128 -N

    timeout /t 4 /nobreak >nul

    echo  ✅  Tunel activo. Conectando a DESARROLLO ...
    echo.
    echo  Ambiente : DESARROLLO
    echo  ─────────────────────────────────────────────────
    echo.
    npm run start:dev

) else (
    echo.
    echo  Opcion no reconocida. Saliendo.
    pause
)
