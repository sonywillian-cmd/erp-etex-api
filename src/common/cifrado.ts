import * as crypto from 'crypto';

/**
 * Cifrado simétrico para secretos guardados en la base (token del bot, clave de Gemini…).
 * AES-256-GCM con clave derivada de CONFIG_CIPHER_KEY (o, si falta, de JWT_SECRET).
 * Formato guardado: enc1:<iv>:<tag>:<datos>  (base64). Un respaldo de la base no expone los secretos.
 */
const PREFIJO = 'enc1:';

function clave(): Buffer {
  const semilla = process.env.CONFIG_CIPHER_KEY || process.env.JWT_SECRET;
  if (!semilla) throw new Error('Falta CONFIG_CIPHER_KEY (o JWT_SECRET) para cifrar secretos de configuración');
  return crypto.createHash('sha256').update(semilla).digest();
}

export function cifrar(texto: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', clave(), iv);
  const datos = Buffer.concat([c.update(texto, 'utf8'), c.final()]);
  return PREFIJO + [iv, c.getAuthTag(), datos].map(b => b.toString('base64')).join(':');
}

export function descifrar(valor: string | null | undefined): string {
  if (!valor) return '';
  if (!valor.startsWith(PREFIJO)) return valor;           // valor en claro (compatibilidad)
  const [iv, tag, datos] = valor.slice(PREFIJO.length).split(':').map(s => Buffer.from(s, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', clave(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(datos), d.final()]).toString('utf8');
}

/** Muestra solo el final del secreto: ••••••1234 */
export function enmascarar(secreto: string | null | undefined, visibles = 4): string {
  if (!secreto) return '';
  return '••••••' + secreto.slice(-visibles);
}
