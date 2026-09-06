import * as path from 'path';
import * as os from 'os';
import * as dotenv from 'dotenv';

// Este módulo se evalúa al importar los controladores, ANTES de que ConfigModule cargue el .env,
// así que carga el .env de la instancia aquí mismo (no pisa variables ya presentes en el entorno).
dotenv.config({ path: process.env.ENV_FILE || '.env' });

/**
 * Rutas y URLs que cambian por instancia (E-Tex, Printex, …).
 * Todo sale del .env de la instancia; nada del dominio o del usuario del servidor
 * vive en el código.
 *
 *   FRONTEND_URL        https://etex360erp.com          (obligatoria: dominio público)
 *   UPLOADS_DIR         /home/<usuario>/domains/<dominio>/public_html/uploads
 *   UPLOADS_BASE_URL    https://<dominio>/uploads        (por defecto FRONTEND_URL + /uploads)
 *   BACKUP_DIR          /home/<usuario>/backups          (por defecto ~/backups)
 *
 * Compatibilidad con los nombres viejos: FOTO_UPLOAD_DIR / FOTO_BASE_URL (gastos)
 * y FOTO_EMPLEADOS_DIR / FOTO_EMPLEADOS_BASE_URL (empleados) siguen mandando si existen.
 */
const sinBarra = (s: string) => s.replace(/\/+$/, '');

export const frontendUrl = () => sinBarra(process.env.FRONTEND_URL || 'http://localhost:3000');

const uploadsRootDir = () => process.env.UPLOADS_DIR
  || (process.env.FOTO_UPLOAD_DIR ? path.dirname(process.env.FOTO_UPLOAD_DIR) : path.join(process.cwd(), 'uploads'));

const uploadsRootUrl = () => sinBarra(process.env.UPLOADS_BASE_URL
  || (process.env.FOTO_BASE_URL ? process.env.FOTO_BASE_URL.replace(/\/gastos\/?$/, '') : `${frontendUrl()}/uploads`));

/** Carpeta física de una subcarpeta de uploads (gastos, empleados, …). */
export function uploadsDir(sub: 'gastos' | 'empleados' | string): string {
  if (sub === 'gastos'    && process.env.FOTO_UPLOAD_DIR)    return process.env.FOTO_UPLOAD_DIR;
  if (sub === 'empleados' && process.env.FOTO_EMPLEADOS_DIR) return process.env.FOTO_EMPLEADOS_DIR;
  return path.join(uploadsRootDir(), sub);
}

/** URL pública de esa misma subcarpeta. */
export function uploadsUrl(sub: 'gastos' | 'empleados' | string): string {
  if (sub === 'gastos'    && process.env.FOTO_BASE_URL)           return sinBarra(process.env.FOTO_BASE_URL);
  if (sub === 'empleados' && process.env.FOTO_EMPLEADOS_BASE_URL) return sinBarra(process.env.FOTO_EMPLEADOS_BASE_URL);
  return `${uploadsRootUrl()}/${sub}`;
}

export const backupDir = () => process.env.BACKUP_DIR || path.join(os.homedir(), 'backups');

/** Orígenes CORS: FRONTEND_URL (+www), CORS_ORIGINS (coma; los que empiezan por ^ son regex) y desarrollo local. */
export function origenesCors(): (string | RegExp)[] {
  const extra = (process.env.CORS_ORIGINS ?? '')
    .split(',').map(s => s.trim()).filter(Boolean)
    .map(s => (s.startsWith('^') ? new RegExp(s) : sinBarra(s)));
  const front = frontendUrl();
  return [
    front, front.replace('://', '://www.'),
    ...extra,
    /^https:\/\/([a-z0-9-]+\.)?etex360\.com$/,   // dominio del producto: <cliente>.etex360.com
    'http://localhost:3000', 'http://127.0.0.1:3000',
  ];
}
