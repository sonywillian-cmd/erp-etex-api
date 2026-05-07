-- Usuario administrador inicial E-Tex 360
-- Ejecutar en la base de datos erp_etex

INSERT INTO usuarios (email, nombre, password_hash, rol, activo)
VALUES (
  'sonyw22@etex.com',
  'SONYW22',
  '$2b$12$T2Ch1fg/hejUYAaHZ0gWUOiGuG83fus9bRo13Dh8nfJLyIOBgjrq2',
  'admin',
  true
)
ON CONFLICT (email) DO NOTHING;
