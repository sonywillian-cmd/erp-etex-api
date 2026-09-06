import { Controller, Get, Post, Query, Req, Body, Header } from '@nestjs/common';
import { AsistenciaService } from './asistencia.service';

/**
 * Receptores para los relojes biométricos. SIN JWT (los equipos no saben de tokens):
 * se validan por serial/tipo registrado en dispositivos_ponche.
 *
 * ZKTeco MB1600 (protocolo ADMS/iclock, push HTTP saliente):
 *   el equipo hace GET/POST a /iclock/cdata y GET /iclock/getrequest.
 *   NOTA: al configurar el equipo puede requerir una regla de proxy para
 *   /iclock → API (el equipo no permite prefijo /api/v1). Se resuelve al montar.
 *
 * Hikvision DS-K1T804BMF (ISAPI HTTP listening):
 *   el equipo hace POST con el evento JSON a /asistencia-reloj/hikvision.
 */
@Controller()
export class RelojesController {
  constructor(private readonly svc: AsistenciaService) {}

  // ═══ ZKTeco iclock ═══
  @Get('iclock/cdata')
  @Header('Content-Type', 'text/plain')
  handshake(@Query('SN') sn?: string) {
    // Respuesta mínima de registro para que el equipo empiece a enviar
    return `GET OPTION FROM: ${sn ?? ''}\nStamp=9999\nOpStamp=9999\nErrorDelay=30\nDelay=10\nTransTimes=00:00;23:59\nTransInterval=1\nTransFlag=1111000000\nTimeZone=-4\nRealtime=1\nEncrypt=0`;
  }

  @Post('iclock/cdata')
  @Header('Content-Type', 'text/plain')
  async recibir(@Query('SN') sn: string, @Query('table') table: string, @Req() req: any, @Body() body: any) {
    let texto = '';
    if (typeof body === 'string') texto = body;
    else if (Buffer.isBuffer(body)) texto = body.toString('utf8');
    else if (body && typeof body === 'object') texto = Object.keys(body).join('\n');
    if ((table ?? '').toUpperCase() === 'ATTLOG' || /\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(texto)) {
      const lineas = texto.split('\n').map(l => l.trim()).filter(Boolean);
      let n = 0;
      for (const l of lineas) {
        const partes = l.split('\t');
        const pin = (partes[0] ?? '').trim();
        const fh = (partes[1] ?? '').trim().slice(0, 19);
        if (pin && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(fh)) {
          const r = await this.svc.ingestarPoncheReloj('zkteco', sn ?? null, pin, fh.length === 16 ? fh + ':00' : fh);
          if (r.ok) n++;
        }
      }
      return `OK: ${n}`;
    }
    return 'OK';
  }

  @Get('iclock/getrequest')
  @Header('Content-Type', 'text/plain')
  getrequest() { return 'OK'; }

  @Post('iclock/devicecmd')
  @Header('Content-Type', 'text/plain')
  devicecmd() { return 'OK'; }

  // ═══ Diagnóstico: qué IP y encabezados ve el servidor detrás del proxy ═══
  @Get('asistencia-reloj/mi-ip')
  miIp(@Req() req: any) {
    const h = req.headers ?? {};
    return {
      req_ip: req.ip ?? null,
      remote: req.connection?.remoteAddress ?? req.socket?.remoteAddress ?? null,
      'x-forwarded-for': h['x-forwarded-for'] ?? null,
      'x-real-ip': h['x-real-ip'] ?? null,
      forwarded: h['forwarded'] ?? null,
      'x-client-ip': h['x-client-ip'] ?? null,
      'true-client-ip': h['true-client-ip'] ?? null,
      'cf-connecting-ip': h['cf-connecting-ip'] ?? null,
    };
  }

  // ═══ Hikvision ISAPI event notification ═══
  @Post('asistencia-reloj/hikvision')
  async hikvision(@Body() body: any) {
    // El evento puede venir directo o anidado (multipart lo maneja el proxy/equipo)
    const ev = body?.AccessControllerEvent ?? body?.EventNotificationAlert?.AccessControllerEvent ?? body ?? {};
    const pin = String(ev.employeeNoString ?? ev.employeeNo ?? '').trim();
    const dt = String(body?.dateTime ?? ev.dateTime ?? '').trim();
    if (!pin || !dt) return { ok: false, motivo: 'evento sin employeeNo o dateTime' };
    // dateTime ISO: 2026-07-06T08:01:23-04:00 → local 'YYYY-MM-DD HH:mm:ss'
    const fh = dt.slice(0, 19).replace('T', ' ');
    const serial = String(body?.deviceSerial ?? ev.serialNo ?? '') || null;
    return this.svc.ingestarPoncheReloj('hikvision', serial, pin, fh);
  }
}
