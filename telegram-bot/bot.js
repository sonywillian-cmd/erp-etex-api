/**
 * Bot de Telegram — Registro de gastos para ERP E-Tex 360.
 *
 * Flujo:
 *   1. Usuario envía /vincular CODIGO  → backend asocia chat_id ↔ usuario_id.
 *   2. Usuario envía foto de factura/recibo:
 *        - Bot descarga la foto, la envía a Gemini con prompt estructurado.
 *        - Gemini devuelve JSON con tipo, monto, fecha, NCF, etc.
 *        - Bot muestra resumen con botones inline para confirmar/editar/cancelar.
 *   3. Al confirmar → POST /telegram/bot/gasto al backend → gasto registrado.
 */

require('dotenv').config();
const { Telegraf, Markup } = require('telegraf');
const { GoogleGenAI }      = require('@google/genai');
const axios                = require('axios');
const fs                   = require('fs').promises;
const path                 = require('path');
const crypto               = require('crypto');

// ─── Configuración ──────────────────────────────────────────────────────────
const TOKEN              = process.env.TELEGRAM_BOT_TOKEN;
const GEMINI_KEY         = process.env.GEMINI_API_KEY;
const GEMINI_MODEL       = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
const ERP_API_URL        = (process.env.ERP_API_URL || '').replace(/\/$/, '');
const BOT_SHARED_SECRET  = process.env.TELEGRAM_BOT_SHARED_SECRET;
// Directorio en disco donde guardar las fotos (Apache las sirve estáticas)
const FOTO_UPLOAD_DIR    = process.env.FOTO_UPLOAD_DIR || '/home/u372536694/domains/etex360erp.com/public_html/uploads/gastos';
const FOTO_BASE_URL      = (process.env.FOTO_BASE_URL || 'https://etex360erp.com/uploads/gastos').replace(/\/$/, '');

if (!TOKEN)             { console.error('FATAL: falta TELEGRAM_BOT_TOKEN');        process.exit(1); }
if (!GEMINI_KEY)        { console.error('FATAL: falta GEMINI_API_KEY');            process.exit(1); }
if (!ERP_API_URL)       { console.error('FATAL: falta ERP_API_URL');               process.exit(1); }
if (!BOT_SHARED_SECRET) { console.error('FATAL: falta TELEGRAM_BOT_SHARED_SECRET'); process.exit(1); }

const bot     = new Telegraf(TOKEN);
const genai   = new GoogleGenAI({ apiKey: GEMINI_KEY });
const erpApi  = axios.create({
  baseURL: ERP_API_URL,
  headers: { 'x-bot-secret': BOT_SHARED_SECRET, 'Content-Type': 'application/json' },
  timeout: 30000,
});

// ─── Estado en memoria ──────────────────────────────────────────────────────
// Borradores con datos OCR procesados, esperando confirmación del usuario.
// Map<chatId, { gasto: {...}, fotoUrls: string[], confianza?: string }>
const borradores = new Map();

// Buffer para álbumes de Telegram (media_group_id) — agrupar fotos del mismo mensaje
// Map<mediaGroupId, { ctx, photos: [{fileId, buffer, mimeType}], timer }>
const mediaGroupBuffers = new Map();

// Borradores de facturación esperando confirmación (botón inline).
// Map<callbackId, { chat_id, payload, usuario_nombre }>
const facturasPendientes = new Map();

// Cobros conversacionales ("cobré 5000 de la orden 768")
// Map<chatId, { monto, contexto, metodo, cuenta, referencia, esperando, cuentasCache }>
const cobrosPendientes = new Map();

// ─── Helpers ────────────────────────────────────────────────────────────────
async function resolverChat(chatId) {
  try {
    const r = await erpApi.get('/telegram/bot/resolver-chat', { params: { chat_id: chatId } });
    return r.data; // { chat_id, usuario_id, usuario_nombre } o null
  } catch (e) {
    console.error('resolverChat error:', e?.response?.data || e.message);
    return null;
  }
}

function fmtRD(n) {
  const v = Number(n || 0);
  return 'RD$ ' + v.toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Convierte PCM 16-bit mono → WAV añadiendo el header RIFF.
 * Gemini TTS devuelve PCM raw, Telegram necesita un formato con header.
 */
function pcmToWav(pcmBase64, sampleRate = 24000, channels = 1, bitsPerSample = 16) {
  const pcm = Buffer.from(pcmBase64, 'base64');
  const byteRate   = sampleRate * channels * bitsPerSample / 8;
  const blockAlign = channels * bitsPerSample / 8;
  const dataSize   = pcm.length;
  const out = Buffer.alloc(44 + dataSize);
  out.write('RIFF', 0);
  out.writeUInt32LE(36 + dataSize, 4);
  out.write('WAVE', 8);
  out.write('fmt ', 12);
  out.writeUInt32LE(16, 16);              // fmt chunk size
  out.writeUInt16LE(1, 20);                // PCM format
  out.writeUInt16LE(channels, 22);
  out.writeUInt32LE(sampleRate, 24);
  out.writeUInt32LE(byteRate, 28);
  out.writeUInt16LE(blockAlign, 32);
  out.writeUInt16LE(bitsPerSample, 34);
  out.write('data', 36);
  out.writeUInt32LE(dataSize, 40);
  pcm.copy(out, 44);
  return out;
}

/**
 * Genera audio TTS desde texto usando Gemini 2.5 Flash Preview TTS.
 * Devuelve un Buffer WAV listo para enviar a Telegram, o null si falla.
 */
async function generarVoz(texto) {
  if (!texto) return null;
  // Limpiar HTML/markdown y espacios
  const limpio = String(texto)
    .replace(/<[^>]+>/g, '')
    .replace(/[*_~`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (limpio.length < 5 || limpio.length > 1500) return null;
  try {
    const resp = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${GEMINI_KEY}`,
      {
        contents: [{ parts: [{ text: limpio }] }],
        generationConfig: {
          responseModalities: ['AUDIO'],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Sulafat' } }, // voz cálida
          },
        },
      },
      { timeout: 20000 },
    );
    const audioB64 = resp.data?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    if (!audioB64) return null;
    return pcmToWav(audioB64, 24000, 1, 16);
  } catch (e) {
    console.error('TTS error:', e?.response?.data?.error?.message || e.message);
    return null;
  }
}

/**
 * Decide si un mensaje debería convertirse a voz.
 * Filtra mensajes de estado/intermedios para evitar audios innecesarios.
 */
function shouldVoice(texto) {
  if (!texto) return false;
  const limpio = String(texto).replace(/<[^>]+>/g, '').trim();
  if (limpio.length < 15) return false;
  // Skip "procesando…", "analizando…", etc.
  if (/^(🎙️|🔍|📝|📄|⏳)\s*(procesando|analizando|preparando|emitiendo|creando|buscando)/i.test(limpio)) return false;
  // Skip "Pensando…" o similares
  if (/(procesando|analizando|preparando)…?$/i.test(limpio)) return false;
  return true;
}

/**
 * Guarda la imagen en /uploads/gastos/YYYY/MM/{uuid}.jpg y devuelve la URL pública.
 * Apache de Hostinger sirve esa ruta directo.
 */
async function guardarImagen(buffer, ext = 'jpg') {
  const ahora = new Date();
  const año = ahora.getFullYear();
  const mes = String(ahora.getMonth() + 1).padStart(2, '0');
  const dir = path.join(FOTO_UPLOAD_DIR, String(año), mes);
  await fs.mkdir(dir, { recursive: true });
  const uuid = crypto.randomUUID();
  const filename = `${uuid}.${ext}`;
  const filepath = path.join(dir, filename);
  await fs.writeFile(filepath, buffer);
  return `${FOTO_BASE_URL}/${año}/${mes}/${filename}`;
}

// ─── Schema y prompt OCR (Gemini con responseSchema) ────────────────────────
const SCHEMA_FACTURA = {
  type: 'object',
  properties: {
    es_factura:         { type: 'boolean' },
    tiene_ncf:          { type: 'boolean' },
    tipo_sugerido:      { type: 'string', enum: ['formal', 'informal', 'personal'] },
    fecha:              { type: 'string', nullable: true },         // YYYY-MM-DD
    monto:              { type: 'number', nullable: true },
    subtotal:           { type: 'number', nullable: true },
    itbis:              { type: 'number', nullable: true },
    proveedor:          { type: 'string', nullable: true },
    rnc:                { type: 'string', nullable: true },
    ncf:                { type: 'string', nullable: true },
    tipo_ncf:           { type: 'string', nullable: true },         // B01, B02, B11, B14, B15
    categoria_sugerida: { type: 'string', nullable: true },
    descripcion:        { type: 'string', nullable: true },
    confianza:          { type: 'string', enum: ['alta', 'media', 'baja'] },
  },
  required: ['es_factura', 'tipo_sugerido', 'confianza'],
};

const PROMPT_OCR = `Eres un asistente experto en facturas y recibos de República Dominicana (RD). Analiza esta imagen y extrae los datos.

═══ NCF (CRÍTICO) ═══
El NCF (Número de Comprobante Fiscal) es OBLIGATORIAMENTE uno de estos formatos:
- "B" + 10 dígitos (ej: B0100001234) — NCF pre-impreso tradicional
- "E" + 10 a 11 dígitos (ej: E3100000771) — e-NCF (factura electrónica DGII)
La etiqueta en la factura suele ser: "NCF:", "e-NCF:", "Comprobante Fiscal:", "No. Comprobante:".

❌ NO CONFUNDAS con estos números (NO son NCF):
- "Numero Factura", "No. Factura", "FAC-", "FVT-", "INV-" → es número INTERNO del proveedor (ignóralo)
- "Orden de compra", "Cotización", "Pedido" → ignóralos
- "RNC" → es identificación del proveedor (campo separado)

Si NO ves un NCF con formato B########## o E############, deja ncf=null.

═══ Tipo NCF (B01 / B02 / B11 / B14 / B15) ═══
El tipo NCF son los PRIMEROS 3 caracteres del NCF:
- B01 / E31 = Crédito fiscal (da derecho a deducir ITBIS)
- B02 / E32 = Consumidor final
- B11 / E41 = Proveedor informal
- B14 / E44 = Régimen especial
- B15 / E45 = Gubernamental
Para e-NCF: E31→B01, E32→B02, E41→B11, E44→B14, E45→B15.

═══ Clasificación tipo_sugerido ═══
- "formal"   si tiene NCF válido (B########## o E############).
- "informal" si NO tiene NCF pero es comercio (colmado, ferretería, parqueo, propinas, etc.).
- "personal" si parece compra personal (supermercado, restaurant, farmacia, gasolinera, ropa, hogar).

═══ Categorías típicas ═══
Materiales, Servicios, Combustible, Comida, Transporte, Alquiler, Mantenimiento,
Comunicaciones, Marketing, Salud, Hogar, Nómina, Mercancías, Otros.

═══ Reglas de campos ═══
- Si la imagen NO es factura/recibo: es_factura=false y los demás campos null.
- Montos siempre en DOP (peso dominicano), sin símbolo de moneda, como número.
- fecha en formato YYYY-MM-DD. Si no es legible, deja null.
- rnc sin guiones, solo dígitos (9 o 11).
- ncf en MAYÚSCULAS y sin espacios.
- Si no estás seguro de subtotal o itbis, déjalos null (no inventes).
- confianza="alta" si todos los datos clave (monto, fecha, proveedor) son nítidos; "media" si algunos son inferidos; "baja" si la imagen es borrosa/incompleta.`;

async function analizarImagenes(imagenes /* [{buffer, mimeType}] */) {
  if (!imagenes || imagenes.length === 0) throw new Error('Sin imágenes');
  const parts = imagenes.map(img => ({
    inlineData: {
      mimeType: img.mimeType || 'image/jpeg',
      data: img.buffer.toString('base64'),
    },
  }));
  const promptMulti = imagenes.length > 1
    ? `Las ${imagenes.length} imágenes son páginas de UNA MISMA factura. ` +
      `Consolida toda la información (proveedor, NCF, totales) combinando ` +
      `lo que esté en cada página. Devuelve UN solo JSON.\n\n` + PROMPT_OCR
    : PROMPT_OCR;
  parts.push({ text: promptMulti });

  const resp = await genai.models.generateContent({
    model: GEMINI_MODEL,
    contents: [{ role: 'user', parts }],
    config: {
      responseMimeType: 'application/json',
      responseSchema:   SCHEMA_FACTURA,
      temperature:      0.1,
    },
  });
  const txt = (resp.text || '').trim();
  if (!txt) throw new Error('Gemini devolvió respuesta vacía');
  return JSON.parse(txt);
}

// ─── Render del resumen para confirmación ───────────────────────────────────
function renderResumen(g) {
  const lineas = [];
  lineas.push(`📄 <b>Resumen de la factura</b>`);
  lineas.push('');
  if (g.proveedor)   lineas.push(`<b>Proveedor:</b> ${g.proveedor}`);
  if (g.rnc)         lineas.push(`<b>RNC:</b> ${g.rnc}`);
  if (g.ncf)         lineas.push(`<b>NCF:</b> ${g.tipo_ncf || ''} · ${g.ncf}`);
  if (g.fecha)       lineas.push(`<b>Fecha:</b> ${g.fecha}`);
  if (g.categoria)   lineas.push(`<b>Categoría:</b> ${g.categoria}`);
  if (g.descripcion) lineas.push(`<b>Concepto:</b> ${g.descripcion}`);
  lineas.push('');
  if (g.subtotal != null) lineas.push(`Subtotal: ${fmtRD(g.subtotal)}`);
  if (g.itbis    != null) lineas.push(`ITBIS:    ${fmtRD(g.itbis)}${g.itbis_autocalc ? ' ⚠️ (calculado 18% — verifica)' : ''}`);
  lineas.push(`<b>Total:    ${fmtRD(g.monto)}</b>`);
  lineas.push('');
  const tipoEmoji = { formal: '📋', informal: '💼', personal: '👤' }[g.tipo] || '📝';
  lineas.push(`Tipo: ${tipoEmoji} <b>${g.tipo.toUpperCase()}</b>`);
  return lineas.join('\n');
}

function botonesConfirmacion(tipoActual, conPaginas = false) {
  // Nueva UX: en vez de "Confirmar" directo, preguntar crédito vs contado.
  // Tipo (formal/informal/personal) se mantiene como configuración manual.
  const tipos = ['formal', 'informal', 'personal'];
  const otros = tipos.filter(t => t !== tipoActual);
  const emoji = { formal: '📋', informal: '💼', personal: '👤' };
  const filas = [
    [
      Markup.button.callback('💵 AL CONTADO', 'foto_contado'),
      Markup.button.callback('📅 A CRÉDITO',  'foto_credito'),
    ],
    [
      Markup.button.callback('✏️ Editar datos', 'editar'),
      Markup.button.callback('❌ Cancelar', 'cancelar'),
    ],
    [
      Markup.button.callback(`${emoji[otros[0]]} cambiar a ${otros[0]}`, `tipo:${otros[0]}`),
      Markup.button.callback(`${emoji[otros[1]]} cambiar a ${otros[1]}`, `tipo:${otros[1]}`),
    ],
  ];
  if (conPaginas) {
    filas.push([Markup.button.callback('📄 Agregar otra página', 'agregar_pagina')]);
  }
  return Markup.inlineKeyboard(filas);
}

// ─── Edición manual de los datos OCR antes de confirmar ─────────────────────
const CAMPOS_EDITABLES = {
  ncf:         'NCF / Comprobante',
  rnc:         'RNC del proveedor',
  proveedor:   'Proveedor',
  monto:       'Total (RD$)',
  fecha:       'Fecha',
  descripcion: 'Concepto',
};

// Deriva el tipo NCF (B01/B02/B11/B14/B15) desde el NCF (B########## o E############)
function derivarTipoNcf(ncf) {
  if (!ncf) return null;
  const u = String(ncf).toUpperCase().replace(/\s+/g, '');
  if (/^B\d{10}$/.test(u)) return u.slice(0, 3);
  if (/^E\d{10,11}$/.test(u)) {
    const map = { E31: 'B01', E32: 'B02', E41: 'B11', E44: 'B14', E45: 'B15' };
    return map[u.slice(0, 3)] || null;
  }
  return null;
}

function tecladoEditar() {
  return Markup.inlineKeyboard([
    [ Markup.button.callback('📋 NCF', 'edit:ncf'),        Markup.button.callback('🆔 RNC', 'edit:rnc') ],
    [ Markup.button.callback('🏢 Proveedor', 'edit:proveedor'), Markup.button.callback('💰 Total', 'edit:monto') ],
    [ Markup.button.callback('📅 Fecha', 'edit:fecha'),    Markup.button.callback('📝 Concepto', 'edit:descripcion') ],
    [ Markup.button.callback('⬅️ Volver', 'edit:volver') ],
  ]);
}

// ─── Comandos ───────────────────────────────────────────────────────────────
bot.start(async (ctx) => {
  const v = await resolverChat(String(ctx.chat.id));
  if (v) {
    return ctx.reply(
      `👋 Hola ${v.usuario_nombre}!\n\n` +
      `Ya estás vinculado al ERP. Envíame una foto de cualquier factura o recibo y la registro como gasto automáticamente.\n\n` +
      `Comandos:\n` +
      `/estado - Ver tu vinculación\n` +
      `/cancelar - Cancelar el gasto en proceso\n\n` +
      `💰 Cobros: escribe "cobré 5000 de la orden 768"`
    );
  }
  return ctx.reply(
    `👋 ¡Hola! Soy el bot de gastos de E-Tex 360.\n\n` +
    `Para empezar, genera un código en el ERP:\n` +
    `   Caja y pagos → Gastos & Salidas → botón "Telegram"\n\n` +
    `Luego envíame: /vincular 123456 (tu código)`
  );
});

bot.command('vincular', async (ctx) => {
  const partes = ctx.message.text.split(/\s+/);
  if (partes.length < 2) {
    return ctx.reply('Uso: /vincular CODIGO\n\nGenera tu código en el ERP: Caja y pagos → Gastos & Salidas → Telegram');
  }
  const codigo = partes[1].trim();
  try {
    const r = await erpApi.post('/telegram/bot/vincular', {
      chat_id: String(ctx.chat.id),
      codigo,
      telegram_username:   ctx.from.username || null,
      telegram_first_name: ctx.from.first_name || null,
    });
    return ctx.reply(
      `✅ ¡Vinculado correctamente!\n\n` +
      `Cuenta ERP: ${r.data.usuario_nombre}\n\n` +
      `Ya puedes enviarme fotos de facturas para registrarlas como gastos.`
    );
  } catch (e) {
    const msg = e?.response?.data?.message || e.message;
    return ctx.reply(`❌ No pude vincularte: ${msg}`);
  }
});

bot.command('estado', async (ctx) => {
  const v = await resolverChat(String(ctx.chat.id));
  if (!v) return ctx.reply('No estás vinculado. Usa /vincular CODIGO');
  return ctx.reply(`✅ Vinculado a: <b>${v.usuario_nombre}</b> (id ${v.usuario_id})`, { parse_mode: 'HTML' });
});

bot.command('cancelar', async (ctx) => {
  if (borradores.delete(ctx.chat.id)) {
    return ctx.reply('Borrador cancelado.');
  }
  return ctx.reply('No hay nada que cancelar.');
});

// ─── Reporte mensual ────────────────────────────────────────────────────────
// Formatea el JSON del endpoint en un mensaje HTML compacto para Telegram.
function formatearReporteMensual(d) {
  const fmtRD = n => 'RD$ ' + Number(n || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const num = n => Number(n || 0);

  const mesNombres = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  const [y, m] = d.mes.split('-').map(Number);
  const mesLeg = `${mesNombres[m - 1]} ${y}`;

  const totalIngresos = num(d.ingresos.total);
  const totalGastos = (d.gastos?.por_tipo ?? []).reduce((s, g) => s + num(g.total), 0);
  const diferencia = totalIngresos - totalGastos;

  // Top 5 estados de produccion
  const topEstados = (d.ordenes_por_estado || []).slice(0, 5)
    .map(e => `  • ${e.estado}: <b>${e.cant}</b>`).join('\n');

  // Top clientes
  const topCli = (d.top_clientes || []).slice(0, 5)
    .map((c, i) => `${i + 1}. ${c.nombre} — ${fmtRD(c.cotizado)}`)
    .join('\n');

  // Gastos por tipo
  const gastosLineas = (d.gastos?.por_tipo || [])
    .map(g => `  • ${g.tipo}: ${fmtRD(g.total)} (${g.cant})`).join('\n');

  return [
    `📊 <b>Reporte de ${mesLeg}</b>`,
    ``,
    `💰 <b>Ingresos:</b> ${fmtRD(totalIngresos)} (${num(d.ingresos.recibos)} cobros)`,
    `  💵 Efectivo: ${fmtRD(d.ingresos.efectivo)}`,
    `  🏦 Transferencia: ${fmtRD(d.ingresos.transferencia)}`,
    `  💳 Tarjeta: ${fmtRD(d.ingresos.tarjeta)}`,
    ``,
    `🔴 <b>Por cobrar:</b> ${fmtRD(d.saldo_pendiente.monto)} (${num(d.saldo_pendiente.facturas)} facturas)`,
    `💸 <b>Gastos:</b> ${fmtRD(totalGastos)}${gastosLineas ? '\n' + gastosLineas : ''}`,
    `${diferencia >= 0 ? '📈' : '📉'} <b>Diferencia:</b> ${fmtRD(diferencia)}`,
    ``,
    `📦 <b>Volumen:</b>`,
    `  • Cotizaciones: <b>${num(d.volumen.cotizaciones)}</b>`,
    `  • Órdenes: <b>${num(d.volumen.ordenes)}</b>`,
    `  • Facturas: <b>${num(d.volumen.facturas_emitidas)}</b>`,
    `  • Clientes nuevos: <b>${num(d.volumen.clientes_nuevos)}</b>`,
    ``,
    `🏭 <b>Producción:</b>`,
    topEstados,
    num(d.atrasadas) > 0 ? `\n⚠️ <b>${num(d.atrasadas)} órdenes en atraso</b>` : '',
    ``,
    topCli ? `🏆 <b>Top 5 clientes:</b>\n${topCli}` : '',
  ].filter(Boolean).join('\n');
}

async function pedirYEnviarReporte(chatId, mes) {
  try {
    const r = await erpApi.get('/asistente/bot/reporte-mensual', { params: { mes } });
    const texto = formatearReporteMensual(r.data);
    await bot.telegram.sendMessage(chatId, texto, { parse_mode: 'HTML' });
    return true;
  } catch (e) {
    console.error('Error reporte mensual:', e?.response?.data || e.message);
    await bot.telegram.sendMessage(chatId, `❌ Error generando reporte: ${e?.response?.data?.message || e.message}`).catch(() => {});
    return false;
  }
}

bot.command('reporte', async (ctx) => {
  const v = await resolverChat(String(ctx.chat.id));
  if (!v) return ctx.reply('No estás vinculado. Usa /vincular CODIGO');

  // Argumentos opcionales: /reporte 2026-05  (sin args → mes actual)
  const partes = ctx.message.text.split(/\s+/);
  let mes = partes[1];
  if (!mes || !/^\d{4}-\d{2}$/.test(mes)) {
    const d = new Date();
    mes = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }
  await ctx.reply(`📊 Generando reporte de ${mes}…`);
  await pedirYEnviarReporte(String(ctx.chat.id), mes);
});

// ─── Scheduler: enviar reporte el día 1 a las 9:00 a admins/supervisores ───
let ultimoEnvioReporte = null; // 'YYYY-MM' del último reporte enviado
async function chequearReporteAutomatico() {
  const ahora = new Date();
  // Disparar SOLO el día 1 entre 9:00 y 9:59
  if (ahora.getDate() !== 1 || ahora.getHours() !== 9) return;

  // El reporte es del MES ANTERIOR (mayo se envía el 1 de junio)
  const anterior = new Date(ahora.getFullYear(), ahora.getMonth() - 1, 1);
  const mesAnterior = `${anterior.getFullYear()}-${String(anterior.getMonth() + 1).padStart(2, '0')}`;

  if (ultimoEnvioReporte === mesAnterior) return; // ya enviado

  console.log(`[scheduler] Disparando reporte mensual ${mesAnterior}`);
  try {
    const r = await erpApi.get('/asistente/bot/admins-chat-ids');
    const admins = r.data || [];
    if (admins.length === 0) {
      console.log('[scheduler] No hay admins vinculados a Telegram');
      return;
    }
    for (const a of admins) {
      await pedirYEnviarReporte(a.chat_id, mesAnterior);
    }
    ultimoEnvioReporte = mesAnterior;
    console.log(`[scheduler] Reporte ${mesAnterior} enviado a ${admins.length} admin(s)`);
  } catch (e) {
    console.error('[scheduler] error:', e?.response?.data || e.message);
  }
}
// Chequear cada 30 min — la condición interna decide si dispara
setInterval(chequearReporteAutomatico, 30 * 60 * 1000);
// También al arrancar (por si pm2 reinició justo en la hora correcta)
setTimeout(chequearReporteAutomatico, 60 * 1000);

// ─── Descargar foto de Telegram → Buffer ────────────────────────────────────
async function descargarFotoTelegram(ctx, fileId) {
  const link = await ctx.telegram.getFileLink(fileId);
  const resp = await axios.get(link.href, { responseType: 'arraybuffer' });
  return { buffer: Buffer.from(resp.data), mimeType: 'image/jpeg' };
}

// ─── Combinar varias fotos (JPG/PNG) en UN PDF multipágina (1 foto = 1 página) ──
const { PDFDocument } = require('pdf-lib');
async function construirPDFdeFotos(buffers) {
  const pdf = await PDFDocument.create();
  for (const buf of buffers) {
    let img;
    try { img = await pdf.embedJpg(buf); }
    catch { img = await pdf.embedPng(buf); }
    const page = pdf.addPage([img.width, img.height]);
    page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
  }
  return Buffer.from(await pdf.save());
}

// ─── Procesar una o varias páginas como UNA SOLA factura ────────────────────
async function procesarFactura(ctx, fotos /* [{buffer, mimeType}] */, fotosExistentes = []) {
  const cantidadPaginas = fotos.length + fotosExistentes.length;
  await ctx.reply(`🔍 Analizando ${cantidadPaginas === 1 ? 'la factura' : `${cantidadPaginas} páginas`}... (3–8 seg)`);

  // Almacenar el adjunto: 2+ páginas → un solo PDF multipágina; 1 página → imagen.
  let foto_url = null;
  let fotos_adicionales = null;
  try {
    if (fotos.length >= 2) {
      const pdfBuffer = await construirPDFdeFotos(fotos.map(f => f.buffer));
      foto_url = await guardarImagen(pdfBuffer, 'pdf');
    } else {
      const urls = [...fotosExistentes];
      for (const f of fotos) urls.push(await guardarImagen(f.buffer));
      foto_url = urls[0] || null;
      fotos_adicionales = urls.length > 1 ? urls.slice(1) : null;
    }
  } catch (e) {
    console.error('Error guardando adjunto:', e.message);
    const urls = [...fotosExistentes];
    for (const f of fotos) { try { urls.push(await guardarImagen(f.buffer)); } catch {} }
    foto_url = urls[0] || null;
    fotos_adicionales = urls.length > 1 ? urls.slice(1) : null;
  }

  // Análisis con Gemini (multi-imagen en una sola llamada)
  let parsed;
  try {
    parsed = await analizarImagenes(fotos);
  } catch (e) {
    console.error('OCR error:', e);
    return ctx.reply('❌ No pude procesar la imagen. ¿Está nítida y bien encuadrada? Vuelve a intentar.');
  }

  if (!parsed.es_factura) {
    return ctx.reply(
      '🤔 No reconozco esta imagen como una factura o recibo.\n\n' +
      'Tómala con buena luz, encuadrada y nítida — incluyendo el total y la fecha.'
    );
  }

  const hoy = new Date().toISOString().slice(0, 10);
  const gasto = {
    tipo:              parsed.tipo_sugerido || 'informal',
    fecha:             parsed.fecha || hoy,
    monto:             parsed.monto || 0,
    subtotal:          parsed.subtotal,
    itbis:             parsed.itbis,
    proveedor:         parsed.proveedor,
    rnc:               parsed.rnc,
    ncf:               parsed.ncf,
    tipo_ncf:          parsed.tipo_ncf,
    categoria:         parsed.categoria_sugerida,
    descripcion:       parsed.descripcion,
    foto_url,
    fotos_adicionales,
  };

  if (!gasto.monto || gasto.monto <= 0) {
    return ctx.reply(
      '⚠️ No pude leer el monto total de la factura. ¿Está visible y nítido? Vuelve a tomar la foto.'
    );
  }

  // ── Auto-ITBIS: si es factura FISCAL (NCF B01/E31/…) y el OCR no leyó el ITBIS,
  //    calcular el 18% incluido en el monto. El usuario puede ajustarlo antes de confirmar.
  const esFiscal = /^(B0[12]|B1[145]|E3[12]|E4[45])/.test(String(gasto.ncf || '').toUpperCase().trim());
  const itbisVacio = gasto.itbis == null || Number(gasto.itbis) === 0;
  if (esFiscal && itbisVacio && gasto.monto > 0) {
    const base  = gasto.monto / 1.18;
    gasto.itbis = Number((gasto.monto - base).toFixed(2));
    gasto.subtotal = Number(base.toFixed(2));
    gasto.itbis_autocalc = true; // marca para avisar en el resumen
  }

  // Guardar borrador y mostrar resumen
  borradores.set(ctx.chat.id, { gasto, fotoUrls: foto_url ? [foto_url] : [], confianza: parsed.confianza });
  const confianzaIcon = parsed.confianza === 'alta' ? '🟢' : parsed.confianza === 'media' ? '🟡' : '🔴';
  const paginasInfo = cantidadPaginas > 1 ? `\n📄 <b>${cantidadPaginas} páginas</b> combinadas en un PDF` : '';
  await ctx.reply(
    renderResumen(gasto) + paginasInfo + `\n\n${confianzaIcon} Confianza OCR: <b>${parsed.confianza || 'media'}</b>\n\n<i>Confirma, cambia el tipo o agrega más páginas:</i>`,
    { parse_mode: 'HTML', ...botonesConfirmacion(gasto.tipo, true) },
  );
}

// ─── Recepción de fotos (1 sola o álbum) ────────────────────────────────────
bot.on('photo', async (ctx) => {
  const chatId = String(ctx.chat.id);
  const v = await resolverChat(chatId);
  if (!v) {
    return ctx.reply(
      '⚠️ Primero debes vincularte.\n\n' +
      'Genera tu código en el ERP (Caja y pagos → Gastos → Telegram) y envíame:\n' +
      '/vincular CODIGO'
    );
  }

  const mediaGroupId = ctx.message.media_group_id;
  const photo = ctx.message.photo[ctx.message.photo.length - 1]; // mayor tamaño

  // ─── Modo ÁLBUM: agrupar fotos del mismo media_group_id ───
  if (mediaGroupId) {
    try {
      const { buffer, mimeType } = await descargarFotoTelegram(ctx, photo.file_id);
      const existing = mediaGroupBuffers.get(mediaGroupId);
      if (existing) {
        clearTimeout(existing.timer);
        existing.photos.push({ buffer, mimeType });
        existing.timer = setTimeout(() => procesarBufferAlbum(mediaGroupId), 2500);
      } else {
        const entry = {
          ctx,
          photos: [{ buffer, mimeType }],
          timer: setTimeout(() => procesarBufferAlbum(mediaGroupId), 2500),
        };
        mediaGroupBuffers.set(mediaGroupId, entry);
      }
    } catch (e) {
      console.error('Error en álbum:', e);
      return ctx.reply('❌ Error procesando el álbum. Intenta de nuevo.');
    }
    return;
  }

  // ─── Modo "AGREGAR PÁGINA": si hay borrador esperando más páginas ───
  const borradorPendiente = borradores.get(ctx.chat.id);
  if (borradorPendiente?.esperandoMasPaginas) {
    try {
      const { buffer, mimeType } = await descargarFotoTelegram(ctx, photo.file_id);
      // Re-procesar con la nueva página agregada
      borradorPendiente.esperandoMasPaginas = false;
      const fotosExistentes = borradorPendiente.fotoUrls || [];
      // Pasamos las fotos previas como URLs (ya guardadas) + la nueva como buffer
      // Para Gemini necesitamos los buffers de TODAS — recolectarlos no es trivial
      // Simplificación: solo enviamos a Gemini la foto nueva + las URLs ya guardadas como referencia
      // Mejor: re-descargar las anteriores. Pero por simplicidad usamos solo la nueva.
      // ALTERNATIVA: guardamos los buffers en el borrador para re-procesar.
      const buffersPrevios = borradorPendiente.buffersPrevios || [];
      const todosBuffers = [...buffersPrevios, { buffer, mimeType }];
      borradorPendiente.buffersPrevios = todosBuffers;
      await procesarFactura(ctx, todosBuffers, []);
      return;
    } catch (e) {
      console.error('Error agregando página:', e);
      return ctx.reply('❌ Error agregando la página. Intenta de nuevo.');
    }
  }

  // ─── Modo SOLO 1 FOTO (default) ───
  try {
    const { buffer, mimeType } = await descargarFotoTelegram(ctx, photo.file_id);
    // Guardamos el buffer en el borrador por si luego quiere agregar más páginas
    const r = await procesarFactura(ctx, [{ buffer, mimeType }], []);
    const borr = borradores.get(ctx.chat.id);
    if (borr) borr.buffersPrevios = [{ buffer, mimeType }];
    return r;
  } catch (e) {
    console.error('photo handler error:', e);
    return ctx.reply('❌ Error procesando la imagen. Intenta de nuevo.');
  }
});

// ─── Procesar buffer de álbum (después del timeout) ─────────────────────────
async function procesarBufferAlbum(mediaGroupId) {
  const buf = mediaGroupBuffers.get(mediaGroupId);
  mediaGroupBuffers.delete(mediaGroupId);
  if (!buf || !buf.ctx) return;
  try {
    await procesarFactura(buf.ctx, buf.photos, []);
    // Guardar buffers en borrador por si luego agrega más
    const borr = borradores.get(buf.ctx.chat.id);
    if (borr) borr.buffersPrevios = buf.photos;
  } catch (e) {
    console.error('Error procesando álbum:', e);
    try { await buf.ctx.reply('❌ Error procesando el álbum.'); } catch {}
  }
}

// ─── Callbacks de botones inline ────────────────────────────────────────────
bot.action(/^tipo:(formal|informal|personal)$/, async (ctx) => {
  const nuevoTipo = ctx.match[1];
  const borrador = borradores.get(ctx.chat.id);
  if (!borrador) {
    await ctx.answerCbQuery('Borrador no encontrado');
    return ctx.editMessageText('⚠️ El borrador expiró. Envía la foto de nuevo.');
  }
  borrador.gasto.tipo = nuevoTipo;
  // Si pasa a informal/personal, limpiar campos formales
  if (nuevoTipo !== 'formal') {
    borrador.gasto.ncf = null;
    borrador.gasto.rnc = null;
    borrador.gasto.tipo_ncf = null;
    borrador.gasto.subtotal = null;
    borrador.gasto.itbis = null;
  }
  await ctx.answerCbQuery(`Cambiado a ${nuevoTipo}`);
  await ctx.editMessageText(
    renderResumen(borrador.gasto) + '\n\n<i>Confirma o cambia el tipo:</i>',
    { parse_mode: 'HTML', ...botonesConfirmacion(borrador.gasto.tipo) },
  );
});

bot.action('cancelar', async (ctx) => {
  borradores.delete(ctx.chat.id);
  await ctx.answerCbQuery('Cancelado');
  return ctx.editMessageText('❌ Gasto cancelado. Envía otra foto cuando quieras.');
});

// ─── EDITAR: menú de campos ──────────────────────────────────────────────────
bot.action('editar', async (ctx) => {
  const borrador = borradores.get(ctx.chat.id);
  if (!borrador) {
    await ctx.answerCbQuery('Borrador no encontrado');
    return ctx.editMessageText('⚠️ El borrador expiró. Envía la foto de nuevo.');
  }
  await ctx.answerCbQuery();
  return ctx.editMessageText(
    renderResumen(borrador.gasto) + '\n\n<i>¿Qué dato quieres corregir?</i>',
    { parse_mode: 'HTML', ...tecladoEditar() },
  );
});

// Volver del menú de edición al resumen con botones de confirmación
bot.action('edit:volver', async (ctx) => {
  const borrador = borradores.get(ctx.chat.id);
  if (!borrador) {
    await ctx.answerCbQuery('Borrador no encontrado');
    return ctx.editMessageText('⚠️ El borrador expiró. Envía la foto de nuevo.');
  }
  borrador.editando = null;
  await ctx.answerCbQuery();
  return ctx.editMessageText(
    renderResumen(borrador.gasto) + '\n\n<i>Confirma, cambia el tipo o agrega más páginas:</i>',
    { parse_mode: 'HTML', ...botonesConfirmacion(borrador.gasto.tipo, true) },
  );
});

// Elegir un campo a editar → pedir el nuevo valor por texto
bot.action(/^edit:(ncf|rnc|proveedor|monto|fecha|descripcion)$/, async (ctx) => {
  const campo = ctx.match[1];
  const borrador = borradores.get(ctx.chat.id);
  if (!borrador) {
    await ctx.answerCbQuery('Borrador no encontrado');
    return ctx.editMessageText('⚠️ El borrador expiró. Envía la foto de nuevo.');
  }
  borrador.editando = campo;
  await ctx.answerCbQuery();
  const actual = borrador.gasto[campo];
  const ejemplos = {
    ncf:         'Ej: <code>B0100001234</code> o <code>E310000000771</code> (o escribe "ninguno" para dejarlo sin NCF)',
    rnc:         'Solo números, ej: <code>131234567</code>',
    proveedor:   'Nombre del comercio / proveedor',
    monto:       'Solo el número, ej: <code>1850.00</code>',
    fecha:       'Formato AAAA-MM-DD, ej: <code>2026-06-18</code>',
    descripcion: 'Breve concepto del gasto',
  };
  return ctx.reply(
    `✏️ Editando <b>${CAMPOS_EDITABLES[campo]}</b>\n` +
    `Valor actual: <b>${actual != null && actual !== '' ? actual : '(vacío)'}</b>\n\n` +
    `Escríbeme el nuevo valor.\n<i>${ejemplos[campo]}</i>`,
    { parse_mode: 'HTML' },
  );
});

bot.action('agregar_pagina', async (ctx) => {
  const borr = borradores.get(ctx.chat.id);
  if (!borr) {
    await ctx.answerCbQuery('Borrador no encontrado');
    return ctx.editMessageText('⚠️ El borrador expiró. Envía la foto de nuevo.');
  }
  borr.esperandoMasPaginas = true;
  await ctx.answerCbQuery('Listo, envía la siguiente página');
  return ctx.reply('📄 Envía ahora la siguiente página de la factura. La analizaré junto con las anteriores.');
});

// Formatea el error del API para el bot; el prefijo 'ncf_duplicado:' se muestra
// como aviso de factura duplicada en vez de un error genérico.
function mensajeErrorApi(e) {
  const raw = e?.response?.data?.message || e?.message || 'Error desconocido';
  const m = Array.isArray(raw) ? raw.join(', ') : String(raw);
  if (m.startsWith('ncf_duplicado:')) {
    return `⚠️ <b>Factura duplicada — no se registró</b>\n${m.slice('ncf_duplicado:'.length)}`;
  }
  return `❌ Error al guardar: ${m}`;
}

// AL CONTADO → flujo actual (registra gasto directo)
bot.action('foto_contado', async (ctx) => {
  const borrador = borradores.get(ctx.chat.id);
  if (!borrador) {
    await ctx.answerCbQuery('Borrador no encontrado');
    return ctx.editMessageText('⚠️ El borrador expiró. Envía la foto de nuevo.');
  }
  await ctx.answerCbQuery('Registrando al contado…');
  try {
    const payload = {
      chat_id: String(ctx.chat.id),
      ...borrador.gasto,
      // Red de seguridad: si por alguna razón el gasto perdió la foto, recuperar
      // la que quedó guardada en el borrador (fotoUrls) antes de registrar.
      foto_url: borrador.gasto.foto_url || borrador.fotoUrls?.[0] || null,
      notas: 'Registrado via Telegram (al contado)',
    };
    if (!payload.foto_url) {
      console.warn('[gasto contado] registrado SIN foto_url', { chat: ctx.chat.id, proveedor: borrador.gasto.proveedor, ncf: borrador.gasto.ncf });
    }
    Object.keys(payload).forEach(k => payload[k] == null && delete payload[k]);

    const r = await erpApi.post('/telegram/bot/gasto', payload);
    borradores.delete(ctx.chat.id);
    return ctx.editMessageText(
      `✅ <b>Gasto registrado AL CONTADO</b> (#${r.data.gasto_id})\n\n` +
      renderResumen(borrador.gasto),
      { parse_mode: 'HTML' },
    );
  } catch (e) {
    console.error('foto_contado error:', e?.response?.data?.message || e.message);
    return ctx.editMessageText(mensajeErrorApi(e), { parse_mode: 'HTML' });
  }
});

// A CRÉDITO → pide fecha de vencimiento y registra en CxP
const facturasCreditoPendientes = new Map(); // chatId → borrador completo

bot.action('foto_credito', async (ctx) => {
  const borrador = borradores.get(ctx.chat.id);
  if (!borrador) {
    await ctx.answerCbQuery('Borrador no encontrado');
    return ctx.editMessageText('⚠️ El borrador expiró. Envía la foto de nuevo.');
  }
  await ctx.answerCbQuery();
  // Pasar borrador al estado de "esperando fecha de vencimiento"
  facturasCreditoPendientes.set(String(ctx.chat.id), borrador);
  const g = borrador.gasto;
  const fmtRDLocal = (n) => 'RD$ ' + Number(n || 0).toLocaleString('es-DO', { minimumFractionDigits: 2 });
  return ctx.editMessageText(
    `📅 <b>Registrar a crédito</b>\n\n` +
    `🏢 ${g.proveedor || '(sin proveedor)'}\n` +
    `💰 ${fmtRDLocal(g.monto)}\n` +
    (g.ncf ? `📋 NCF: ${g.ncf}\n` : '🟡 Sin NCF\n') +
    `\n<b>¿Cuándo vence?</b> Responde con la fecha:\n` +
    `• <code>15 jun</code> · <code>30 días</code> · <code>15/07</code>\n` +
    `• O presiona un botón:`,
    {
      parse_mode: 'HTML',
      reply_markup: Markup.inlineKeyboard([
        [
          Markup.button.callback('15 días', 'credito_vence:15'),
          Markup.button.callback('30 días', 'credito_vence:30'),
        ],
        [
          Markup.button.callback('45 días', 'credito_vence:45'),
          Markup.button.callback('60 días', 'credito_vence:60'),
        ],
        [Markup.button.callback('❌ Cancelar', 'cancelar')],
      ]).reply_markup,
    },
  );
});

// Botones de días para vencimiento
bot.action(/^credito_vence:(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const dias = Number(ctx.match[1]);
  const borrador = facturasCreditoPendientes.get(String(ctx.chat.id));
  if (!borrador) return ctx.editMessageText('⚠️ Sesión expirada.');
  facturasCreditoPendientes.delete(String(ctx.chat.id));
  borradores.delete(ctx.chat.id);

  const fechaVenc = new Date(Date.now() + dias * 86400000).toISOString().slice(0, 10);
  return registrarFacturaCreditoConFoto(ctx, borrador, fechaVenc);
});

async function registrarFacturaCreditoConFoto(ctx, borrador, fechaVenc) {
  await ctx.editMessageText('💾 Guardando en cuentas por pagar…');
  const g = borrador.gasto;
  try {
    const r = await erpApi.post('/cxp/bot/foto', {
      chat_id: String(ctx.chat.id),
      proveedor_nombre: g.proveedor || 'PROVEEDOR',
      proveedor_rnc: g.rnc || null,
      ncf: g.ncf || null,
      fecha_factura: g.fecha || new Date().toISOString().slice(0, 10),
      fecha_vencimiento: fechaVenc,
      monto_total: g.monto,
      itbis: g.itbis ?? null,
      subtotal: g.subtotal ?? null,
      descripcion: g.descripcion || null,
      categoria: g.categoria || null,
      foto_url: g.foto_url || borrador.fotoUrls?.[0] || null,
      al_contado: false,
    });
    const d = r.data;
    const fmtRDLocal = (n) => 'RD$ ' + Number(n || 0).toLocaleString('es-DO', { minimumFractionDigits: 2 });
    let respuesta = `✅ <b>Factura a crédito registrada</b>\n\n` +
      `📄 ${d.numero}\n` +
      `🏢 ${d.proveedor_nombre}\n` +
      `💰 ${fmtRDLocal(d.monto_total)}\n` +
      `📅 Vence: ${String(d.fecha_vencimiento).slice(0,10)}\n`;
    if (d.gasto_formal_id) {
      respuesta += `\n📋 Gasto formal #${d.gasto_formal_id} contabilizado (NCF: ${d.ncf})\n`;
      respuesta += `🟡 Estado: pendiente_pago. Se actualiza cuando se complete el pago.`;
    } else {
      respuesta += `\n📌 Aparece en el calendario.\n🔔 Para abonar: <code>abono ${d.numero} MONTO</code>`;
    }
    return ctx.reply(respuesta, { parse_mode: 'HTML' });
  } catch (e) {
    console.error('credito error:', e?.response?.data?.message || e.message);
    return ctx.reply(mensajeErrorApi(e), { parse_mode: 'HTML' });
  }
}

// ════════════════════════════════════════════════════════════════════════════
// ASISTENTE: procesar comando del usuario (texto o voz)
// ════════════════════════════════════════════════════════════════════════════

async function procesarComandoAsistente(ctx, payload /* { texto } o { audio_base64, audio_mime } */) {
  const chatId = String(ctx.chat.id);
  const v = await resolverChat(chatId);
  if (!v) {
    return ctx.reply(
      '⚠️ Primero debes vincularte. Genera tu código en el ERP\n' +
      '(Caja y pagos → Gastos & Salidas → Telegram) y envíalo aquí.'
    );
  }

  await ctx.sendChatAction('typing');

  // 1. Interpretar
  let intent;
  try {
    const r = await erpApi.post('/asistente/bot/interpretar', payload);
    intent = r.data;
  } catch (e) {
    const msg = e?.response?.data?.message || e.message;
    return ctx.reply(`❌ No pude interpretar: ${msg}`);
  }

  // 2. Ejecutar según la acción.
  // Nota: NO mostramos `intent.mensaje_usuario` para acciones que ya producen
  // su propia respuesta — sería redundante y a veces Telegram lo entrega
  // desordenado. Solo se muestra para saludo / fallback / acciones sin output.
  const accionesConOutputPropio = new Set([
    'crear_cliente', 'buscar_cliente', 'cotizar',
    'consultar_orden', 'consultar_metrica',
    'gasto', 'facturar',
  ]);
  const debeMostrarMensajeLLM = intent.mensaje_usuario &&
    !accionesConOutputPropio.has(intent.accion);

  if (debeMostrarMensajeLLM) {
    await ctx.reply(intent.mensaje_usuario);
  }

  try {
    switch (intent.accion) {
      case 'crear_cliente':
        return await flowCrearCliente(ctx, intent, v);
      case 'buscar_cliente':
        return await flowBuscarCliente(ctx, intent);
      case 'cotizar':
        return await flowCotizar(ctx, intent, v);
      case 'consultar_orden':
        return await flowConsultarOrden(ctx, intent);
      case 'consultar_metrica':
        return await flowConsultarMetrica(ctx, intent);
      case 'gasto':
        return await flowGastoTexto(ctx, intent, v);
      case 'facturar':
        return await flowFacturar(ctx, intent, v);
      case 'saludo':
        return; // ya respondió con mensaje_usuario
      default:
        return ctx.reply(
          'No estoy seguro de qué quieres. Prueba:\n' +
          '• <b>Cotiza a [cliente] X [productos] a [precio]</b>\n' +
          '• <b>Crear cliente [nombre] RNC [#]</b>\n' +
          '• <b>Cómo va OP-XXX</b> o <b>Cómo va 040</b>\n' +
          '• <b>Gasto: [descripción] [monto]</b>\n' +
          '• <b>Factura la OP-XXX</b>',
          { parse_mode: 'HTML' }
        );
    }
  } catch (e) {
    const msg = e?.response?.data?.message || e.message;
    return ctx.reply(`❌ Error: ${msg}`);
  }
}

// ─── Flows ────────────────────────────────────────────────────────────────
async function flowCrearCliente(ctx, intent, vinculacion) {
  const c = intent.cliente || {};
  if (!c.nombre && !c.rnc && !c.cedula) {
    return ctx.reply('Para crear el cliente necesito al menos el nombre y RNC/cédula. Ej: <b>Crear cliente Industrias García RNC 131036686</b>', { parse_mode: 'HTML' });
  }
  try {
    const r = await erpApi.post('/asistente/bot/cliente', {
      nombre: c.nombre,
      rnc: c.rnc,
      cedula: c.cedula,
      tipo: c.tipo || (c.rnc ? 'empresa' : 'persona'),
      telefono: c.telefono,
      email: c.email,
      direccion: c.direccion,
    });
    const cli = r.data.cliente;
    let msg = `✅ <b>Cliente creado:</b> ${cli.nombre} (#${cli.id})`;
    if (cli.documento) msg += `\n📋 ${cli.tipo === 'empresa' ? 'RNC' : 'Cédula'}: ${cli.documento}`;
    if (cli.telefono) msg += `\n📞 ${cli.telefono}`;
    return ctx.reply(msg, { parse_mode: 'HTML' });
  } catch (e) {
    return ctx.reply(`❌ ${e?.response?.data?.message || e.message}`);
  }
}

async function flowBuscarCliente(ctx, intent) {
  const q = intent.consulta_query || intent.cliente?.nombre || '';
  if (!q) return ctx.reply('¿A quién quieres buscar?');
  const r = await erpApi.get('/asistente/bot/buscar-cliente', { params: { q } });
  const matches = r.data.matches || [];
  if (matches.length === 0) {
    return ctx.reply(`No encontré clientes con "${q}". Di <b>Crear cliente ${q} RNC [#]</b> para agregarlo.`, { parse_mode: 'HTML' });
  }
  const lista = matches.slice(0, 5).map((c, i) =>
    `${i + 1}. <b>${c.nombre}</b>${c.documento ? ` · ${c.documento}` : ''}${c.telefono ? ` · ${c.telefono}` : ''}`,
  ).join('\n');
  return ctx.reply(`🔍 Encontré ${matches.length} cliente(s):\n\n${lista}`, { parse_mode: 'HTML' });
}

async function flowCotizar(ctx, intent, vinculacion) {
  const cliNombre = intent.cliente?.nombre;
  const items = intent.items || [];
  if (!cliNombre) return ctx.reply('Para cotizar necesito saber a quién. Ej: <b>Cotiza a García 30 polos M a 250</b>', { parse_mode: 'HTML' });
  if (items.length === 0) return ctx.reply(`¿Qué productos cotizar a ${cliNombre}?`);

  // Buscar cliente
  const r = await erpApi.get('/asistente/bot/buscar-cliente', { params: { q: cliNombre } });
  const matches = r.data.matches || [];
  if (matches.length === 0) {
    return ctx.reply(`🤔 No encontré "${cliNombre}". Crea el cliente primero:\n<b>Crear cliente ${cliNombre} RNC [#]</b>`, { parse_mode: 'HTML' });
  }
  const exacto = matches.find(c => c.nombre.toUpperCase() === cliNombre.toUpperCase());
  const cliente = exacto || matches[0];
  if (!exacto && matches.length > 1) {
    await ctx.reply(`⚠️ Tomé "${cliente.nombre}" (encontré ${matches.length} parecidos). Si no es, dicta otra vez con el nombre exacto.`);
  }

  // Validar precios
  const sinPrecio = items.filter(it => !it.precio || it.precio <= 0);
  if (sinPrecio.length > 0) {
    return ctx.reply('⚠️ Falta el precio en algún ítem. Vuelve a dictar incluyendo precio. Ej: <b>... a 250 cada uno</b>', { parse_mode: 'HTML' });
  }

  const itemsPayload = items.map(it => {
    const partes = [it.producto, it.color, it.talla].filter(Boolean).join(' ');
    const desc = partes ? `${partes}${it.descripcion ? ` · ${it.descripcion}` : ''}` : (it.descripcion || '—');
    return {
      descripcion:     desc,
      cantidad:        Number(it.cantidad ?? 1),
      precio_unitario: Number(it.precio),
      tecnica:         it.tecnica || undefined,
    };
  });

  await ctx.reply('📝 Creando cotización…');
  const c = await erpApi.post('/asistente/bot/cotizar', {
    cliente_id: cliente.id,
    items:      itemsPayload,
    creado_por: vinculacion.usuario_nombre,
  });
  const cot = c.data;
  const total = Number(cot.total ?? 0).toLocaleString('es-DO', { minimumFractionDigits: 2 });
  return ctx.reply(
    `✅ <b>Cotización ${cot.numero}</b>\n` +
    `Cliente: ${cliente.nombre}\n` +
    `${itemsPayload.length} línea(s)\n` +
    `<b>Total: RD$ ${total}</b>\n\n` +
    `${ERP_API_URL.replace('/api/v1', '')}/ventas/cotizaciones/${cot.id}`,
    { parse_mode: 'HTML' }
  );
}

async function flowConsultarOrden(ctx, intent) {
  const haystack = `${intent.consulta_query || ''} ${intent.orden_numero || ''} ${intent.mensaje_usuario || ''}`;
  const mFull = haystack.match(/OP[-\s]?\d{4}[-\s]?\d{1,4}/i);
  const mMid  = haystack.match(/\b\d{4}-\d{1,4}\b/);
  const mNum  = haystack.match(/\b\d{1,5}\b/);

  let query = null;
  if (mFull) query = mFull[0];
  else if (mMid) query = mMid[0];
  else if (intent.consulta_query && /^\d{1,5}$/.test(intent.consulta_query.trim())) query = intent.consulta_query.trim();
  else if (intent.cliente?.nombre) query = intent.cliente.nombre;
  else if (intent.consulta_query) query = intent.consulta_query;
  else if (mNum) query = mNum[0];

  if (!query) {
    return ctx.reply('¿De qué orden? Puede ser:\n• Número: <b>Cómo va la OP-2026-040</b> o <b>040</b>\n• Cliente: <b>Órdenes de Mario Pio</b>', { parse_mode: 'HTML' });
  }
  query = query.replace(/\s+/g, ' ').trim();

  const r = await erpApi.get(`/asistente/bot/orden/${encodeURIComponent(query)}`);
  if (!r.data.encontradas) {
    const tipo = r.data.busqueda_tipo === 'cliente' ? `cliente "${query}"` : `orden ${query}`;
    return ctx.reply(`No encontré órdenes para ${tipo}.`);
  }

  const semIcon = (s) => ({ critico: '🔴', alerta: '🟡', normal: '🟢' }[s] || '⚪');

  // CASO A: 1 orden → detalle completo
  if (r.data.encontradas === 1) {
    const o = r.data.principal;
    const sem = semIcon(o.semaforo);
    const entrega = o.fecha_hora_entrega
      ? new Date(o.fecha_hora_entrega).toLocaleDateString('es-DO')
      : (o.fecha_comprometida ? new Date(o.fecha_comprometida).toLocaleDateString('es-DO') : '—');
    let msg = `📊 <b>${o.numero}</b> — ${o.cliente_nombre || 'Sin cliente'}\n`;
    msg += `Estado: <b>${o.estado}</b> ${sem}\n`;
    msg += `Producción: ${o.estado_produccion}\n`;
    msg += `Entrega: ${entrega}\n`;

    const etapas = (r.data.etapas || []).filter(e => e.tipo === 'departamento');
    if (etapas.length) {
      msg += `\n<b>Etapas:</b>\n`;
      etapas.slice(0, 8).forEach(e => {
        const icon = e.estado === 'completado' ? '✅' :
                     e.estado === 'en_proceso' ? '🔄' :
                     e.estado === 'desbloqueado' ? '🔓' :
                     e.estado === 'cancelado' ? '❌' : '⏸';
        msg += `${icon} ${e.departamento}${e.responsable ? ` · ${e.responsable}` : ''}\n`;
      });
    }
    return ctx.reply(msg, { parse_mode: 'HTML' });
  }

  // CASO B: varias órdenes (búsqueda por cliente) → lista resumida
  let msg = `📊 Encontré <b>${r.data.encontradas} órdenes</b> para "${query}":\n\n`;
  r.data.ordenes.slice(0, 8).forEach(o => {
    const fecha = o.fecha_hora_entrega
      ? new Date(o.fecha_hora_entrega).toLocaleDateString('es-DO')
      : (o.fecha_comprometida ? new Date(o.fecha_comprometida).toLocaleDateString('es-DO') : '—');
    msg += `${semIcon(o.semaforo)} <b>${o.numero}</b> · ${o.estado} · entrega ${fecha}\n`;
  });
  if (r.data.encontradas > 8) msg += `\n<i>…y ${r.data.encontradas - 8} más</i>`;
  msg += `\n\nDime el número específico para ver el detalle. Ej: <b>Cómo va la ${r.data.ordenes[0]?.numero}</b>`;
  return ctx.reply(msg, { parse_mode: 'HTML' });
}

async function flowConsultarMetrica(ctx, intent) {
  const m = intent.metrica;
  if (!m) {
    return ctx.reply(
      '¿Qué quieres saber? Ejemplos:\n' +
      '• <b>¿Cuántas órdenes en atraso?</b>\n' +
      '• <b>¿Cuánto cobré hoy?</b>\n' +
      '• <b>¿Cuánto vendí este mes?</b>\n' +
      '• <b>ITBIS a depositar</b>',
      { parse_mode: 'HTML' }
    );
  }
  const fmtRD = (n) => 'RD$ ' + Number(n).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  try {
    const r = await erpApi.get('/asistente/bot/metricas', {
      params: { tipo: m, periodo: intent.periodo },
    });
    const d = r.data;
    let msg = `📊 <b>${d.metrica}</b>\n\n`;
    if (d.tipo === 'monto') {
      msg += `<b>${fmtRD(d.total)}</b>`;
      if (d.cantidad) msg += ` <i>(${d.cantidad} ${d.cantidad === 1 ? 'registro' : 'registros'})</i>`;
      if (d.cobrado != null && d.deducible != null) {
        msg += `\n\nDesglose:\n• Cobrado: ${fmtRD(d.cobrado)}\n• Deducible: ${fmtRD(d.deducible)}`;
      }
    } else if (d.tipo === 'numero') {
      msg += `<b>${d.total}</b> ${d.total === 1 ? 'orden' : 'órdenes'}`;
    } else if (d.tipo === 'lista') {
      msg += `<b>${d.total}</b> ${d.total === 1 ? 'orden' : 'órdenes'}`;
      if (d.detalle && d.detalle.length > 0) {
        msg += '\n\n';
        d.detalle.slice(0, 8).forEach(o => {
          msg += `• <b>${o.numero}</b>`;
          if (o.cliente) msg += ` — ${o.cliente}`;
          if (o.dias_vencida != null) msg += ` <i>(${o.dias_vencida}d vencida)</i>`;
          msg += '\n';
        });
        if (d.total > 8) msg += `\n<i>…y ${d.total - 8} más</i>`;
      }
    }
    return ctx.reply(msg, { parse_mode: 'HTML' });
  } catch (e) {
    return ctx.reply(`❌ ${e?.response?.data?.message || e.message}`);
  }
}

async function flowGastoTexto(ctx, intent, vinculacion) {
  const items = intent.items || [];
  const monto = items[0]?.precio || items[0]?.cantidad || 0;
  const descripcion = items[0]?.descripcion || items[0]?.producto || intent.consulta_query || intent.notas;
  if (!monto) return ctx.reply('Falta el monto. Ej: <b>Gasto: gasolina 1500 personal</b>', { parse_mode: 'HTML' });

  const txt = (intent.mensaje_usuario || '').toLowerCase() + ' ' + (intent.notas || '').toLowerCase();
  let tipo = 'informal';
  if (txt.includes('personal')) tipo = 'personal';
  else if (txt.includes('formal') || txt.includes('ncf')) tipo = 'formal';

  const r = await erpApi.post('/asistente/bot/gasto', {
    tipo,
    monto: Number(monto),
    descripcion,
    categoria: items[0]?.tecnica || undefined,
    usuario_id:     vinculacion.usuario_id,
    usuario_nombre: vinculacion.usuario_nombre,
  });
  const tipoIcon = tipo === 'formal' ? '📋' : tipo === 'personal' ? '👤' : '💼';
  return ctx.reply(
    `✅ Gasto registrado (#${r.data.id})\n` +
    `${tipoIcon} <b>${tipo}</b> · RD$ ${Number(monto).toLocaleString('es-DO', { minimumFractionDigits: 2 })}\n` +
    `${descripcion ? `Concepto: ${descripcion}` : ''}`,
    { parse_mode: 'HTML' }
  );
}

async function flowFacturar(ctx, intent, vinculacion) {
  const ordenNumero = intent.orden_numero ||
    (intent.consulta_query || '').match(/OP[-\s]?\d{4}[-\s]?\d{3,}/i)?.[0];
  const cliNombre = intent.cliente?.nombre;
  const items     = intent.items || [];
  const tipoNcf   = intent.tipo_ncf;

  let payload;
  if (ordenNumero) {
    payload = {
      orden_numero: ordenNumero.toUpperCase().replace(/\s+/g, ''),
      tipo_ncf:     tipoNcf,
      preview:      true,
      creado_por:   vinculacion.usuario_nombre,
    };
  } else if (cliNombre && items.length > 0) {
    const r = await erpApi.get('/asistente/bot/buscar-cliente', { params: { q: cliNombre } });
    const matches = r.data.matches || [];
    if (matches.length === 0) {
      return ctx.reply(`No encontré "${cliNombre}". Crea el cliente primero.`);
    }
    const cliente = matches.find(c => c.nombre.toUpperCase() === cliNombre.toUpperCase()) || matches[0];
    const itemsPayload = items.map(it => {
      const partes = [it.producto, it.color, it.talla].filter(Boolean).join(' ');
      const desc = partes ? `${partes}${it.descripcion ? ` · ${it.descripcion}` : ''}` : (it.descripcion || '—');
      return {
        descripcion:     desc,
        cantidad:        Number(it.cantidad ?? 1),
        precio_unitario: Number(it.precio || 0),
      };
    });
    payload = {
      cliente_id: cliente.id,
      items:      itemsPayload,
      tipo_ncf:   tipoNcf,
      preview:    true,
      creado_por: vinculacion.usuario_nombre,
    };
  } else {
    return ctx.reply('Para facturar dime una de estas dos:\n• <b>Factura la OP-XXX</b>\n• <b>Factura a [cliente] X [productos] a [precio]</b>', { parse_mode: 'HTML' });
  }

  // Pedir preview
  const r = await erpApi.post('/asistente/bot/facturar', payload);
  const prev = r.data;
  const total = Number(prev.total ?? 0).toLocaleString('es-DO', { minimumFractionDigits: 2 });
  const sub   = Number(prev.subtotal ?? 0).toLocaleString('es-DO', { minimumFractionDigits: 2 });
  const it    = Number(prev.itbis ?? 0).toLocaleString('es-DO', { minimumFractionDigits: 2 });
  let msg = `📄 <b>Preview de factura</b>\n\n`;
  if (prev.orden_numero) msg += `Orden: ${prev.orden_numero}\n`;
  msg += `Cliente: <b>${prev.cliente?.nombre || '—'}</b>\n`;
  if (prev.cliente?.documento) msg += `RNC: ${prev.cliente.documento}\n`;
  msg += `Tipo NCF: <b>${prev.tipo_ncf}</b>${prev.proximo_ncf ? ` (próximo: ${prev.proximo_ncf})` : ''}\n\n`;
  msg += `Subtotal: RD$ ${sub}\n`;
  msg += `ITBIS: RD$ ${it}\n`;
  msg += `<b>Total: RD$ ${total}</b>\n\n`;
  msg += `<i>⚠️ El NCF es irreversible.</i>`;

  // Guardar payload para confirmar
  const cbId = `f_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  // Clonar payload sin preview
  const emitirPayload = { ...payload, preview: false };
  facturasPendientes.set(cbId, { chat_id: String(ctx.chat.id), payload: emitirPayload });
  // Limpieza automática a los 5 min
  setTimeout(() => facturasPendientes.delete(cbId), 5 * 60 * 1000);

  return ctx.reply(msg, {
    parse_mode: 'HTML',
    ...Markup.inlineKeyboard([
      [
        Markup.button.callback('✅ Emitir factura', `factemit:${cbId}`),
        Markup.button.callback('❌ Cancelar',       `factcancel:${cbId}`),
      ],
    ]),
  });
}

// ─── Callbacks de factura ──────────────────────────────────────────────────
bot.action(/^factemit:(.+)$/, async (ctx) => {
  const cbId = ctx.match[1];
  const pend = facturasPendientes.get(cbId);
  if (!pend) {
    await ctx.answerCbQuery('Borrador expirado');
    return ctx.editMessageText('⚠️ La factura expiró. Pídela de nuevo.');
  }
  facturasPendientes.delete(cbId);
  await ctx.answerCbQuery('Emitiendo…');
  try {
    const r = await erpApi.post('/asistente/bot/facturar', pend.payload);
    const f = r.data.factura;
    return ctx.editMessageText(
      `✅ <b>Factura ${f.numero}</b> emitida\n` +
      `NCF: <b>${f.ncf || '—'}</b> (${f.tipo_ncf})\n` +
      `<b>Total: RD$ ${Number(f.total).toLocaleString('es-DO', { minimumFractionDigits: 2 })}</b>`,
      { parse_mode: 'HTML' }
    );
  } catch (e) {
    const msg = e?.response?.data?.message || e.message;
    return ctx.editMessageText(`❌ Error al emitir: ${msg}`);
  }
});

bot.action(/^factcancel:(.+)$/, async (ctx) => {
  const cbId = ctx.match[1];
  facturasPendientes.delete(cbId);
  await ctx.answerCbQuery('Cancelado');
  return ctx.editMessageText('❌ Factura cancelada (NCF intacto).');
});

// ─── Handler de notas de voz ───────────────────────────────────────────────
bot.on('voice', async (ctx) => {
  const chatId = String(ctx.chat.id);
  const v = await resolverChat(chatId);
  if (!v) {
    return ctx.reply('⚠️ Primero debes vincularte. Envía tu código de 6 dígitos.');
  }

  // Monkey-patch ctx.reply para que respuestas relevantes también vayan en voz
  const origReply = ctx.reply.bind(ctx);
  ctx.reply = async (text, extra) => {
    const sent = await origReply(text, extra);
    if (typeof text === 'string' && shouldVoice(text)) {
      // No bloquear el flow si el TTS falla
      generarVoz(text).then(audio => {
        if (audio) {
          ctx.telegram.sendVoice(ctx.chat.id, { source: audio, filename: 'respuesta.wav' })
            .catch(() => ctx.telegram.sendAudio(ctx.chat.id, { source: audio, filename: 'respuesta.wav' }).catch(() => {}));
        }
      }).catch(() => {});
    }
    return sent;
  };

  await ctx.reply('🎙️ Procesando audio…');
  try {
    const fileId = ctx.message.voice.file_id;
    const link = await ctx.telegram.getFileLink(fileId);
    const r = await axios.get(link.href, { responseType: 'arraybuffer' });
    const buffer = Buffer.from(r.data);
    const audio_base64 = buffer.toString('base64');
    return procesarComandoAsistente(ctx, { audio_base64, audio_mime: 'audio/ogg' });
  } catch (e) {
    console.error('voice error:', e);
    return ctx.reply(`❌ Error procesando audio: ${e.message}`);
  }
});

// ─── Mensajes de texto suelto (fallback + comandos del asistente) ──────────

// ═══════════════════════════════════════════════════════════════════════════
// COBROS A CLIENTES — "cobré 5000 de la orden 768"
// Flujo: contexto → método (botones) → cuenta (botones) → referencia → confirmar
// Endpoints: /facturacion/bot/* (x-bot-secret). Mismas reglas que la web:
// transferencia/cheque exigen cuenta + referencia; tarjeta exige autorización.
// ═══════════════════════════════════════════════════════════════════════════

function fmtCobroContexto(cx, monto) {
  const saldoTxt = cx.saldo != null ? fmtRD(cx.saldo) : '—';
  const totalTxt = cx.total != null ? fmtRD(cx.total) : '—';
  const esFinal  = cx.saldo != null && monto >= cx.saldo - 0.01;
  let msg = `📋 <b>${cx.orden.numero}</b> — ${cx.cliente || 'Sin cliente'}\n`;
  if (cx.destino === 'factura') msg += `🧾 Factura: <b>${cx.factura_numero}</b>\n`;
  msg += `Total: ${totalTxt} · Cobrado: ${fmtRD(cx.cobrado)} · Saldo: <b>${saldoTxt}</b>\n\n`;
  msg += `Registrar <b>${fmtRD(monto)}</b> → ${esFinal ? '<b>PAGO FINAL</b> ✅' : `ABONO${cx.saldo != null ? ` (quedarían ${fmtRD(cx.saldo - monto)})` : ''}`}`;
  return msg;
}

async function iniciarCobro(ctx, texto) {
  const v = await resolverChat(String(ctx.chat.id));
  if (!v) return ctx.reply('❌ Chat no vinculado. Usa /vincular CODIGO primero.');

  const mMonto = texto.match(/(\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{1,2})?|\d+(?:[.,]\d{1,2})?)/);
  if (!mMonto) return ctx.reply('Dime el monto. Ej: <i>cobré 5000 de la orden 768</i>', { parse_mode: 'HTML' });
  let sM = mMonto[1];
  if (sM.includes('.') && sM.includes(',')) {
    sM = sM.lastIndexOf(',') > sM.lastIndexOf('.') ? sM.replace(/\./g, '').replace(',', '.') : sM.replace(/,/g, '');
  } else if (sM.includes(',')) {
    const p = sM.split(',');
    sM = (p.length === 2 && p[1].length <= 2) ? sM.replace(',', '.') : sM.replace(/,/g, '');
  }
  const monto = Number(sM);
  if (!monto || monto <= 0) return ctx.reply('Monto inválido.');

  // Orden: OP-YYYY-NNN, número suelto, o nombre de cliente
  const resto = texto.replace(mMonto[0], ' ');
  const mOP = resto.match(/OP[-\s]?\d{4}[-\s]?\d{1,4}/i);
  let q = null;
  if (mOP) q = mOP[0];
  else {
    const mNum = resto.match(/\b\d{1,5}\b/);
    if (mNum) q = mNum[0];
    else {
      const mCli = resto
        .replace(/\b(cobre|cobré|cobro|cobrar|cobramos|de|la|el|los|las|orden|op|a|del|pesos|rd\$?|efectivo|transferencia|tarjeta|cheque)\b/gi, ' ')
        .replace(/[^a-záéíóúñü\s]/gi, ' ').replace(/\s+/g, ' ').trim();
      if (mCli.length >= 3) q = mCli;
    }
  }
  if (!q) return ctx.reply('¿De cuál orden es? Ej: <i>cobré 5000 de la orden 768</i> o <i>cobré 5000 de García</i>', { parse_mode: 'HTML' });

  await ctx.sendChatAction('typing');
  try {
    const r = await erpApi.get('/facturacion/bot/cobro-contexto', { params: { q, chat_id: String(ctx.chat.id) } });
    const d = r.data;
    if (d.tipo === 'no_encontrada') return ctx.reply(`No encontré órdenes para "${q}".`);
    if (d.tipo === 'lista') {
      cobrosPendientes.set(ctx.chat.id, { monto, esperando: null });
      return ctx.reply(
        `Encontré varias órdenes. ¿De cuál es el cobro de ${fmtRD(monto)}?`,
        Markup.inlineKeyboard(d.ordenes.map(o => [Markup.button.callback(`${o.numero} · ${o.estado}`, `cobro_orden:${o.numero}`)]))
      );
    }
    return prepararCobro(ctx, d, monto);
  } catch (e) {
    return ctx.reply(`❌ ${e?.response?.data?.message || e.message}`);
  }
}

async function prepararCobro(ctx, contexto, monto) {
  if (contexto.saldo != null && contexto.saldo <= 0.01) {
    cobrosPendientes.delete(ctx.chat.id);
    return ctx.reply(`✅ ${contexto.orden.numero} no tiene saldo pendiente (ya está pagada).`, { parse_mode: 'HTML' });
  }
  if (contexto.saldo != null && monto > contexto.saldo + 0.01) {
    cobrosPendientes.delete(ctx.chat.id);
    return ctx.reply(`⚠️ El monto ${fmtRD(monto)} supera el saldo ${fmtRD(contexto.saldo)} de ${contexto.orden.numero}. Verifica y dicta de nuevo.`, { parse_mode: 'HTML' });
  }
  cobrosPendientes.set(ctx.chat.id, { monto, contexto, esperando: null });
  return ctx.reply(
    fmtCobroContexto(contexto, monto) + '\n\n¿Cómo te pagaron?',
    { parse_mode: 'HTML', ...Markup.inlineKeyboard([
      [Markup.button.callback('💵 Efectivo', 'cobro_met:efectivo'), Markup.button.callback('🏦 Transferencia', 'cobro_met:transferencia')],
      [Markup.button.callback('💳 Tarjeta', 'cobro_met:tarjeta'), Markup.button.callback('📄 Cheque', 'cobro_met:cheque')],
      [Markup.button.callback('❌ Cancelar', 'cobro_cancel')],
    ]) }
  );
}

async function mostrarBorradorCobro(ctx, cob) {
  const cx = cob.contexto;
  const esFinal = cx.saldo != null && cob.monto >= cx.saldo - 0.01;
  let msg = '📝 <b>BORRADOR DE COBRO</b>\n\n';
  msg += `Orden: <b>${cx.orden.numero}</b> · ${cx.cliente || ''}\n`;
  if (cx.destino === 'factura') msg += `Factura: ${cx.factura_numero}\n`;
  msg += `Monto: <b>${fmtRD(cob.monto)}</b> (${esFinal ? 'pago final' : 'abono'})\n`;
  msg += `Método: ${cob.metodo}`;
  if (cob.cuenta) msg += ` → ${cob.cuenta.alias || cob.cuenta.banco} ····${cob.cuenta.digitos}`;
  msg += '\n';
  if (cob.referencia) msg += `Ref: <code>${cob.referencia}</code>\n`;
  msg += '\n¿Confirmas?';
  return ctx.reply(msg, { parse_mode: 'HTML', ...Markup.inlineKeyboard([
    [Markup.button.callback('✅ Confirmar cobro', 'cobro_ok')],
    [Markup.button.callback('❌ Cancelar', 'cobro_cancel')],
  ]) });
}

bot.action(/^cobro_orden:(OP-[\d-]+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const cob = cobrosPendientes.get(ctx.chat.id);
  if (!cob) return ctx.reply('Este cobro expiró. Dicta de nuevo.');
  try {
    const r = await erpApi.get('/facturacion/bot/cobro-contexto', { params: { q: ctx.match[1], chat_id: String(ctx.chat.id) } });
    if (r.data.tipo !== 'orden') return ctx.reply('No pude cargar esa orden.');
    return prepararCobro(ctx, r.data, cob.monto);
  } catch (e) {
    return ctx.reply(`❌ ${e?.response?.data?.message || e.message}`);
  }
});

bot.action(/^cobro_met:(efectivo|transferencia|tarjeta|cheque)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const cob = cobrosPendientes.get(ctx.chat.id);
  if (!cob || !cob.contexto) return ctx.reply('Este cobro expiró. Dicta de nuevo, ej: "cobré 5000 de la orden 768".');
  cob.metodo = ctx.match[1];
  if (cob.metodo === 'efectivo') return mostrarBorradorCobro(ctx, cob);
  if (cob.metodo === 'tarjeta') {
    cob.esperando = 'referencia';
    return ctx.reply('💳 Escribe el nº de autorización de la tarjeta:');
  }
  try {
    const r = await erpApi.get('/facturacion/bot/cuentas', { params: { chat_id: String(ctx.chat.id) } });
    const cuentas = r.data || [];
    if (!cuentas.length) { cobrosPendientes.delete(ctx.chat.id); return ctx.reply('No hay cuentas bancarias activas en el ERP.'); }
    cob.cuentasCache = cuentas;
    return ctx.reply(
      cob.metodo === 'cheque' ? '📄 ¿En cuál cuenta se depositó el cheque?' : '🏦 ¿A cuál cuenta llegó la transferencia?',
      Markup.inlineKeyboard(cuentas.map(c => [Markup.button.callback(`${c.alias || c.banco} ····${c.digitos}`, `cobro_cta:${c.id}`)]))
    );
  } catch (e) {
    return ctx.reply(`❌ ${e?.response?.data?.message || e.message}`);
  }
});

bot.action(/^cobro_cta:(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const cob = cobrosPendientes.get(ctx.chat.id);
  if (!cob) return ctx.reply('Este cobro expiró. Dicta de nuevo.');
  const cta = (cob.cuentasCache || []).find(c => String(c.id) === ctx.match[1]);
  if (!cta) return ctx.reply('Cuenta no válida.');
  cob.cuenta = cta;
  cob.esperando = 'referencia';
  return ctx.reply(cob.metodo === 'cheque' ? '📄 Escribe el nº del cheque:' : '🏦 Escribe el nº de confirmación de la transferencia:');
});

bot.action('cobro_ok', async (ctx) => {
  await ctx.answerCbQuery();
  const cob = cobrosPendientes.get(ctx.chat.id);
  if (!cob || !cob.contexto || !cob.metodo) return ctx.reply('Este cobro expiró. Dicta de nuevo.');
  await ctx.sendChatAction('typing');
  try {
    const r = await erpApi.post('/facturacion/bot/cobrar', {
      chat_id: String(ctx.chat.id),
      orden_id: cob.contexto.orden.id,
      monto: cob.monto,
      metodo: cob.metodo,
      cuenta_banco_id: cob.cuenta ? cob.cuenta.id : undefined,
      referencia: cob.referencia || undefined,
    });
    cobrosPendientes.delete(ctx.chat.id);
    const d = r.data;
    let msg = '✅ <b>Cobro registrado</b>\n\n';
    msg += `Recibo: <b>${d.recibo_numero || '—'}</b>\n`;
    if (d.destino === 'factura') {
      msg += `Factura ${d.factura_numero}: ${d.factura_estado === 'pagada' ? '<b>PAGADA</b> 🎉' : `saldo ${fmtRD(d.nuevo_saldo)}`}\n`;
    } else if (d.nuevo_saldo != null) {
      msg += `Saldo de ${d.orden_numero}: ${fmtRD(d.nuevo_saldo)}\n`;
    }
    if (cob.metodo === 'transferencia') msg += '\n⏳ Pendiente de certificar en el panel de transferencias.';
    if (d.recibo_id) msg += `\n🖨️ https://etex360erp.com/imprimir/recibo/${d.recibo_id}`;
    return ctx.reply(msg, { parse_mode: 'HTML' });
  } catch (e) {
    return ctx.reply(`❌ No se registró: ${e?.response?.data?.message || e.message}`);
  }
});

bot.action('cobro_cancel', async (ctx) => {
  await ctx.answerCbQuery();
  cobrosPendientes.delete(ctx.chat.id);
  return ctx.reply('Cobro cancelado, no se registró nada.');
});

bot.on('text', async (ctx) => {
  const texto = ctx.message.text.trim();
  if (texto.startsWith('/')) return; // ya manejado por commands

  // ─── Captura de edición manual de un campo del borrador (foto de factura) ───
  const borrEdit = borradores.get(ctx.chat.id);
  if (borrEdit && borrEdit.editando) {
    const campo = borrEdit.editando;
    const val = texto.trim();
    let aviso = 'Dato actualizado.';
    if (campo === 'monto') {
      const n = Number(val.replace(/[^0-9.]/g, ''));
      if (!n || n <= 0) return ctx.reply('⚠️ Monto inválido. Escribe solo el número, ej: 1850.00');
      borrEdit.gasto.monto = n;
      aviso = `Total actualizado a ${fmtRD(n)}.`;
    } else if (campo === 'ncf') {
      const u = val.toUpperCase().replace(/\s+/g, '');
      if (/^(NINGUNO|SIN|NO|NA|N\/A)$/.test(u)) {
        borrEdit.gasto.ncf = null; borrEdit.gasto.tipo_ncf = null;
        aviso = 'NCF eliminado (sin comprobante).';
      } else if (/^B\d{10}$/.test(u) || /^E\d{10,11}$/.test(u)) {
        borrEdit.gasto.ncf = u;
        const t = derivarTipoNcf(u);
        if (t) borrEdit.gasto.tipo_ncf = t;
        if (borrEdit.gasto.tipo !== 'formal') borrEdit.gasto.tipo = 'formal';
        aviso = `NCF actualizado${t ? ` (tipo ${t})` : ''}.`;
      } else {
        return ctx.reply('⚠️ NCF inválido. Debe ser B + 10 dígitos (B0100001234) o E + 10-11 dígitos (E310000000771). Escríbelo de nuevo, o "ninguno" para dejarlo sin NCF.');
      }
    } else if (campo === 'rnc') {
      borrEdit.gasto.rnc = val.replace(/[^0-9]/g, '') || null;
      aviso = 'RNC actualizado.';
    } else if (campo === 'fecha') {
      borrEdit.gasto.fecha = val;
      aviso = 'Fecha actualizada.';
    } else {
      borrEdit.gasto[campo] = val;
    }
    borrEdit.editando = null;
    await ctx.reply(
      `✅ ${aviso}\n\n` + renderResumen(borrEdit.gasto) + '\n\n<i>Revisa y confirma, o sigue editando:</i>',
      { parse_mode: 'HTML', ...botonesConfirmacion(borrEdit.gasto.tipo, true) },
    );
    return;
  }

  // ─── Captura de referencia para un cobro en curso ─────────────────────
  const cobRef = cobrosPendientes.get(ctx.chat.id);
  if (cobRef && cobRef.esperando === 'referencia') {
    cobRef.referencia = texto.trim();
    cobRef.esperando = null;
    return mostrarBorradorCobro(ctx, cobRef);
  }

  // Código de 6 dígitos = intento de vinculación (si NO está vinculado)
  const esCodigo6 = /^\d{6}$/.test(texto);
  if (esCodigo6) {
    const v = await resolverChat(String(ctx.chat.id));
    if (!v) {
      try {
        const r = await erpApi.post('/telegram/bot/vincular', {
          chat_id: String(ctx.chat.id),
          codigo: texto,
          telegram_username:   ctx.from.username || null,
          telegram_first_name: ctx.from.first_name || null,
        });
        return ctx.reply(
          `✅ ¡Vinculado correctamente!\n\n` +
          `Cuenta ERP: ${r.data.usuario_nombre}\n\n` +
          `Ya puedes enviarme:\n` +
          `• Fotos de facturas (registro gastos automático)\n` +
          `• Notas de voz o texto para cotizar/facturar/consultar`
        );
      } catch (e) {
        const msg = e?.response?.data?.message || e.message;
        return ctx.reply(`❌ No pude vincularte: ${msg}`);
      }
    }
  }

  // Detectar comando de FACTURA / GASTO — siempre pregunta crédito vs contado
  // Verbos: factura, deber, credito, pendiente (suelen ser crédito)
  //         gasto, gasté, gaste, compré, compre, consumí (suelen ser contado)
  // Independientemente del verbo, mostramos el flujo crédito/contado para que el usuario elija.
  const RE_FACTURA = /^\s*(factura|deber|credito|crédito|pendiente|por\s+pagar|cuenta\s+por\s+pagar|gasto|gaste|gasté|gastar|compre|compré|comprar|consumi|consumí)\b/i;
  if (RE_FACTURA.test(texto)) {
    return procesarFacturaCredito(ctx, texto, false);
  }

  // Detectar registro de COBRO a cliente ("cobré 5000 de la orden 768")
  const RE_COBRO = /^\s*(cobr(e|é|o|ar|amos))\b/i;
  if (RE_COBRO.test(texto)) {
    return iniciarCobro(ctx, texto);
  }

  // Detectar comando de pago de compromiso (palabras clave)
  // Patrones: "pago luz 4567", "pagué claro 1850", "efectivo alquiler 25000",
  //          "transferencia internet 3500", "cheque renta 25000"
  const RE_PAGO_COMPROMISO = /^\s*(pago|pague|pagué|pagar|paga|efectivo|transferencia|transfer|trf|cheque|tarjeta|cash)\b/i;
  if (RE_PAGO_COMPROMISO.test(texto)) {
    return procesarPagoCompromiso(ctx, texto);
  }

  // Si está vinculado y no es un código → pasar al asistente
  return procesarComandoAsistente(ctx, { texto });
});

// ─── Handler de factura (CxP) — flujo de 2 pasos ──────────────────────────
// Paso 1: usuario escribe "factura X 850 vence 30 jun" → bot pregunta crédito/contado
// Paso 2: usuario presiona botón → bot crea en CxP con el modo correcto
const facturasPorPagarPendientes = new Map(); // chatId → { texto, datos } para confirmación

async function procesarFacturaCredito(ctx, texto, forzarNuevo) {
  await ctx.sendChatAction('typing');
  try {
    // PASO 1: modo consultar — bot parsea pero no guarda, devuelve datos + colisión si hay
    const r = await erpApi.post('/cxp/bot/factura', {
      texto,
      chat_id: String(ctx.chat.id),
      modo: 'consultar',
    });
    const d = r.data;

    // Si hay colisión con recurrente, mostrar antes de preguntar crédito/contado
    if (d && d.colision) {
      facturasPorPagarPendientes.set(String(ctx.chat.id), { texto });
      const rec = d.colision;
      const msg = `⚠️ <b>Posible colisión</b>\n\n` +
        `Coincide con un compromiso <b>RECURRENTE</b>:\n\n` +
        `📋 <b>${rec.nombre}</b>\n` +
        `🔁 ${rec.frecuencia.toUpperCase()} · RD$ ${Number(rec.monto_estimado).toLocaleString('es-DO', {minimumFractionDigits:2})}\n\n` +
        `<b>¿Qué quieres hacer?</b>`;
      return ctx.reply(msg, {
        parse_mode: 'HTML',
        reply_markup: Markup.inlineKeyboard([
          [Markup.button.callback('📅 Es el pago del mes (registrar)', `pagar_rec:${rec.id}`)],
          [Markup.button.callback('🆕 Es factura distinta (continuar)', 'factura_continuar')],
          [Markup.button.callback('❌ Cancelar', 'factura_cancelar')],
        ]).reply_markup,
      });
    }

    // Mostrar datos parseados + preguntar crédito/contado
    return preguntarCreditoContado(ctx, texto, d);
  } catch (e) {
    const msg = e?.response?.data?.message || e.message;
    return ctx.reply(`❌ ${msg}`);
  }
}

function preguntarCreditoContado(ctx, texto, datosParseados) {
  facturasPorPagarPendientes.set(String(ctx.chat.id), { texto });
  const fmtRDLocal = (n) => 'RD$ ' + Number(n || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const d = datosParseados;
  let resumen = `📄 <b>Factura detectada</b>\n\n` +
    `🏢 Proveedor: <b>${d.proveedor_nombre}</b>\n` +
    `💰 Monto: <b>${fmtRDLocal(d.monto_total)}</b>\n` +
    `🏷️ Categoría: ${d.categoria}\n`;
  if (d.fecha_vencimiento) resumen += `📅 Vencimiento: ${d.fecha_vencimiento}\n`;
  resumen += `\n<b>¿Cómo es?</b>`;

  const botones = [
    [Markup.button.callback('💵 Al CONTADO (ya pagada)', 'factura_contado')],
  ];
  // Solo permitir crédito si hay fecha de vencimiento
  if (d.fecha_vencimiento) {
    botones.push([Markup.button.callback('📅 A CRÉDITO (pendiente)', 'factura_credito')]);
  } else {
    botones.push([Markup.button.callback('📅 A crédito (falta "vence FECHA")', 'factura_credito_sin_fecha')]);
  }
  botones.push([Markup.button.callback('❌ Cancelar', 'factura_cancelar')]);

  return ctx.reply(resumen, {
    parse_mode: 'HTML',
    reply_markup: Markup.inlineKeyboard(botones).reply_markup,
  });
}

// Callback: usuario eligió continuar tras colisión → pregunta crédito/contado
bot.action('factura_continuar', async (ctx) => {
  await ctx.answerCbQuery();
  const pendiente = facturasPorPagarPendientes.get(String(ctx.chat.id));
  if (!pendiente) return ctx.editMessageText('⚠️ Sesión expirada, vuelve a enviar el comando.');
  try {
    const r = await erpApi.post('/cxp/bot/factura', {
      texto: pendiente.texto, chat_id: String(ctx.chat.id), modo: 'consultar',
    });
    await ctx.editMessageText('✅ Continuando con factura nueva…');
    return preguntarCreditoContado(ctx, pendiente.texto, r.data);
  } catch (e) {
    return ctx.reply(`❌ ${e?.response?.data?.message || e.message}`);
  }
});

// Callback: AL CONTADO → crea CxP con al_contado=true (crea gasto y marca pagada)
bot.action('factura_contado', async (ctx) => {
  await ctx.answerCbQuery('Registrando al contado…');
  const pendiente = facturasPorPagarPendientes.get(String(ctx.chat.id));
  if (!pendiente) return ctx.editMessageText('⚠️ Sesión expirada.');
  facturasPorPagarPendientes.delete(String(ctx.chat.id));
  try {
    const r = await erpApi.post('/cxp/bot/factura', {
      texto: pendiente.texto, chat_id: String(ctx.chat.id), modo: 'contado', forzar_nuevo: true,
    });
    const d = r.data;
    const fmtRDLocal = (n) => 'RD$ ' + Number(n || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return ctx.editMessageText(
      `✅ <b>Pagada al contado</b>\n\n` +
      `📄 ${d.numero} — ${d.proveedor_nombre}\n` +
      `💰 ${fmtRDLocal(d.monto_total)}\n` +
      `🏷️ ${d.categoria}\n\n` +
      `💼 Gasto generado y marcada como pagada.`,
      { parse_mode: 'HTML' }
    );
  } catch (e) {
    return ctx.reply(`❌ ${e?.response?.data?.message || e.message}`);
  }
});

// Callback: A CRÉDITO → crea CxP pendiente
bot.action('factura_credito', async (ctx) => {
  await ctx.answerCbQuery('Registrando a crédito…');
  const pendiente = facturasPorPagarPendientes.get(String(ctx.chat.id));
  if (!pendiente) return ctx.editMessageText('⚠️ Sesión expirada.');
  facturasPorPagarPendientes.delete(String(ctx.chat.id));
  try {
    const r = await erpApi.post('/cxp/bot/factura', {
      texto: pendiente.texto, chat_id: String(ctx.chat.id), modo: 'credito', forzar_nuevo: true,
    });
    const d = r.data;
    const fmtRDLocal = (n) => 'RD$ ' + Number(n || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const fechaVenc = d.fecha_vencimiento ? String(d.fecha_vencimiento).slice(0, 10) : '?';
    return ctx.editMessageText(
      `✅ <b>Cuenta por pagar registrada</b>\n\n` +
      `📄 ${d.numero} — ${d.proveedor_nombre}\n` +
      `💰 ${fmtRDLocal(d.monto_total)}\n` +
      `📅 Vence: ${fechaVenc}\n` +
      `🏷️ ${d.categoria}\n\n` +
      `📌 Aparece en el calendario.\n` +
      `🔔 Para pagarla escribe: <i>abono ${d.numero} MONTO</i>`,
      { parse_mode: 'HTML' }
    );
  } catch (e) {
    return ctx.reply(`❌ ${e?.response?.data?.message || e.message}`);
  }
});

// Callback: crédito sin fecha → pide fecha
bot.action('factura_credito_sin_fecha', async (ctx) => {
  await ctx.answerCbQuery();
  return ctx.editMessageText(
    '⚠️ Para registrar a crédito necesito la fecha de vencimiento.\n\n' +
    'Vuelve a enviar el comando con la fecha. Ejemplos:\n' +
    '• <i>factura claro 1850 <b>vence 30 jun</b></i>\n' +
    '• <i>factura tinta 850 <b>vence 30/06</b></i>\n' +
    '• <i>factura flete 2400 <b>vence 30 días</b></i>',
    { parse_mode: 'HTML' }
  );
});

// Callback: usuario eligió "Es el pago del mes del recurrente"
bot.action(/^pagar_rec:(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const pendiente = facturasPorPagarPendientes.get(String(ctx.chat.id));
  if (!pendiente) return ctx.editMessageText('⚠️ Sesión expirada, vuelve a enviar el comando.');
  facturasPorPagarPendientes.delete(String(ctx.chat.id));
  let textoPago = pendiente.texto
    .replace(/^\s*(factura|deber|credito|crédito|pendiente|por\s+pagar|cuenta\s+por\s+pagar)\s+/i, 'pago ')
    .replace(/\s+vence\s+.+$/i, '');
  await ctx.editMessageText(`✅ Registrando como pago del recurrente…\n<i>${textoPago}</i>`, { parse_mode: 'HTML' });
  return procesarPagoCompromiso(ctx, textoPago);
});

// Callback: cancelar
bot.action('factura_cancelar', async (ctx) => {
  await ctx.answerCbQuery();
  facturasPorPagarPendientes.delete(String(ctx.chat.id));
  return ctx.editMessageText('❌ Cancelado.');
});

// ─── Handler de pago de compromiso ──────────────────────────────────────────
async function procesarPagoCompromiso(ctx, texto) {
  await ctx.sendChatAction('typing');
  try {
    const r = await erpApi.post('/compromisos/bot/pagar', {
      texto,
      chat_id: String(ctx.chat.id),
    });
    const d = r.data;
    const fmtRDLocal = (n) => 'RD$ ' + Number(n || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const fechaVenc = d.fecha_vencimiento ? String(d.fecha_vencimiento).slice(0, 10) : '?';
    let respuesta = `✅ <b>Pago registrado</b>\n\n`;
    respuesta += `📋 <b>${d.compromiso}</b>\n`;
    if (d.proveedor) respuesta += `🏢 ${d.proveedor}\n`;
    respuesta += `💰 ${fmtRDLocal(d.monto_pagado)} (${d.metodo_pago})\n`;
    respuesta += `📅 Vencía: ${fechaVenc}\n`;
    if (Math.abs(d.diferencia) > 0.01) {
      respuesta += d.diferencia > 0
        ? `📊 +${fmtRDLocal(d.diferencia)} sobre estimado\n`
        : `📊 ${fmtRDLocal(d.diferencia)} bajo estimado\n`;
    }
    if (d.egreso_id) respuesta += `\n💼 Egreso de caja #${d.egreso_id} creado`;
    if (d.gasto_id)  respuesta += `\n💼 Gasto #${d.gasto_id} creado`;
    return ctx.reply(respuesta, { parse_mode: 'HTML' });
  } catch (e) {
    const msg = e?.response?.data?.message || e.message;
    return ctx.reply(`❌ ${msg}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CRÉDITO A CLIENTES — botones Aprobar/Rechazar que envía la API al admin.
// La API valida que el chat sea de un usuario admin (x-bot-secret + vinculación).
// ═══════════════════════════════════════════════════════════════════════════
bot.action(/^cred_(ok|no):(\d+)$/, async (ctx) => {
  await ctx.answerCbQuery();
  const accion = ctx.match[1] === 'ok' ? 'aprobar' : 'rechazar';
  const sid = ctx.match[2];
  try {
    const r = await erpApi.post('/clientes/bot/credito/' + sid + '/' + accion, { chat_id: String(ctx.chat.id) });
    const d = r.data || {};
    const fmt = (n) => Number(n || 0).toLocaleString('es-DO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const veredicto = accion === 'aprobar'
      ? '✅ <b>CRÉDITO APROBADO</b> — ' + d.cliente + '\nLímite RD$ ' + fmt(d.limite) + ' · ' + d.plazo + ' días'
      : '❌ <b>CRÉDITO RECHAZADO</b> — ' + d.cliente;
    const original = (ctx.callbackQuery && ctx.callbackQuery.message && ctx.callbackQuery.message.text) || '';
    try {
      await ctx.editMessageText(original + '\n\n' + veredicto, { parse_mode: 'HTML' }); // quita los botones
    } catch (_) {
      await ctx.reply(veredicto, { parse_mode: 'HTML' });
    }
  } catch (e) {
    const msg = (e && e.response && e.response.data && e.response.data.message) || e.message;
    await ctx.reply('❌ No se pudo ' + accion + ': ' + msg);
  }
});

// ─── Manejo de errores global ───────────────────────────────────────────────
bot.catch((err, ctx) => {
  console.error(`Error en update ${ctx.update.update_id}:`, err);
});

// ─── Arranque ───────────────────────────────────────────────────────────────
bot.launch().then(() => {
  console.log(`🤖 Bot iniciado. Conectado a ${ERP_API_URL}`);
  console.log(`   Modelo Gemini: ${GEMINI_MODEL}`);
});

// Apagado limpio
process.once('SIGINT',  () => bot.stop('SIGINT'));
process.once('SIGTERM', () => bot.stop('SIGTERM'));
