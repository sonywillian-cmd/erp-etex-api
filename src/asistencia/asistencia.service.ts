import {
  Injectable, BadRequestException, ForbiddenException, NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

// Secuencias de ponche del día
const SEQ_COMPLETA = ['ENTRADA', 'SALIDA_ALMUERZO', 'REGRESO_ALMUERZO', 'SALIDA'];
const SEQ_CORTA    = ['ENTRADA', 'SALIDA'];

// La DB corre en UTC; República Dominicana es UTC-4 fijo (sin horario de verano)
const NOW_RD = `CONVERT_TZ(NOW(), '+00:00', '-04:00')`;
const HOY_RD = `DATE(${NOW_RD})`;

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function diffMin(a: string, b: string): number {
  // a, b: 'YYYY-MM-DD HH:mm:ss'
  const da = new Date(a.replace(' ', 'T'));
  const db = new Date(b.replace(' ', 'T'));
  return Math.round((db.getTime() - da.getTime()) / 60000);
}

@Injectable()
export class AsistenciaService {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  private async hoy(): Promise<string> {
    const r = await this.ds.query(`SELECT DATE_FORMAT(${HOY_RD}, '%Y-%m-%d') AS f`);
    return r[0].f;
  }

  private async dow(fecha: string): Promise<number> {
    // 1=Lunes ... 7=Domingo
    const r = await this.ds.query(`SELECT WEEKDAY(?) + 1 AS d`, [fecha]);
    return Number(r[0].d);
  }

  // ═══════════════ SUCURSALES ═══════════════
  listarSucursales() {
    return this.ds.query(`SELECT * FROM sucursales ORDER BY id`);
  }

  async actualizarSucursal(id: number, dto: any) {
    const campos = ['nombre', 'direccion', 'lat', 'lng', 'radio_m', 'ip_publica', 'activo'];
    const sets: string[] = [];
    const vals: any[] = [];
    for (const c of campos) {
      if (dto[c] !== undefined) { sets.push(`${c} = ?`); vals.push(dto[c] === '' ? null : dto[c]); }
    }
    if (!sets.length) throw new BadRequestException('Nada que actualizar');
    vals.push(id);
    await this.ds.query(`UPDATE sucursales SET ${sets.join(', ')} WHERE id = ?`, vals);
    const r = await this.ds.query(`SELECT * FROM sucursales WHERE id = ?`, [id]);
    return r[0];
  }

  // ═══════════════ DISPOSITIVOS (relojes) ═══════════════
  listarDispositivos() {
    return this.ds.query(
      `SELECT d.*, s.nombre AS sucursal
         FROM dispositivos_ponche d
         LEFT JOIN sucursales s ON s.id = d.sucursal_id
        ORDER BY d.id`);
  }

  async actualizarDispositivo(id: number, dto: any) {
    const campos = ['nombre', 'serial', 'sucursal_id', 'activo'];
    const sets: string[] = [];
    const vals: any[] = [];
    for (const c of campos) {
      if (dto[c] !== undefined) { sets.push(`${c} = ?`); vals.push(dto[c] === '' ? null : dto[c]); }
    }
    if (!sets.length) throw new BadRequestException('Nada que actualizar');
    vals.push(id);
    await this.ds.query(`UPDATE dispositivos_ponche SET ${sets.join(', ')} WHERE id = ?`, vals);
    return { ok: true };
  }

  // ═══════════════ PLANTILLAS DE HORARIO ═══════════════
  async listarPlantillas() {
    const ps = await this.ds.query(`SELECT * FROM horario_plantillas WHERE activo = 1 ORDER BY id`);
    for (const p of ps) {
      p.dias = await this.ds.query(
        `SELECT dia_semana, labora,
                TIME_FORMAT(entrada, '%H:%i')          AS entrada,
                TIME_FORMAT(salida_almuerzo, '%H:%i')  AS salida_almuerzo,
                TIME_FORMAT(regreso_almuerzo, '%H:%i') AS regreso_almuerzo,
                TIME_FORMAT(salida, '%H:%i')           AS salida
           FROM horario_plantilla_dias WHERE plantilla_id = ? ORDER BY dia_semana`, [p.id]);
      const uso = await this.ds.query(
        `SELECT COUNT(*) AS n FROM usuario_horarios
          WHERE plantilla_id = ? AND (vigente_hasta IS NULL OR vigente_hasta >= ${HOY_RD})`, [p.id]);
      p.asignados = Number(uso[0].n);
    }
    return ps;
  }

  private async guardarDias(plantillaId: number, dias: any[]) {
    await this.ds.query(`DELETE FROM horario_plantilla_dias WHERE plantilla_id = ?`, [plantillaId]);
    for (const d of dias ?? []) {
      await this.ds.query(
        `INSERT INTO horario_plantilla_dias
           (plantilla_id, dia_semana, labora, entrada, salida_almuerzo, regreso_almuerzo, salida)
         VALUES (?,?,?,?,?,?,?)`,
        [plantillaId, d.dia_semana, d.labora ? 1 : 0,
         d.entrada || null, d.salida_almuerzo || null, d.regreso_almuerzo || null, d.salida || null]);
    }
  }

  async crearPlantilla(dto: any) {
    if (!dto?.nombre) throw new BadRequestException('Nombre requerido');
    const r = await this.ds.query(
      `INSERT INTO horario_plantillas (nombre, tolerancia_min) VALUES (?, ?)`,
      [String(dto.nombre).toUpperCase(), Number(dto.tolerancia_min ?? 10)]);
    await this.guardarDias(r.insertId, dto.dias);
    return { id: r.insertId };
  }

  async actualizarPlantilla(id: number, dto: any) {
    await this.ds.query(
      `UPDATE horario_plantillas SET nombre = COALESCE(?, nombre), tolerancia_min = COALESCE(?, tolerancia_min) WHERE id = ?`,
      [dto.nombre ? String(dto.nombre).toUpperCase() : null, dto.tolerancia_min ?? null, id]);
    if (Array.isArray(dto.dias)) await this.guardarDias(id, dto.dias);
    return { ok: true };
  }

  async eliminarPlantilla(id: number) {
    const uso = await this.ds.query(
      `SELECT COUNT(*) AS n FROM usuario_horarios
        WHERE plantilla_id = ? AND (vigente_hasta IS NULL OR vigente_hasta >= ${HOY_RD})`, [id]);
    if (Number(uso[0].n) > 0) {
      throw new BadRequestException(`No se puede eliminar: ${uso[0].n} colaborador(es) la tienen asignada`);
    }
    await this.ds.query(`UPDATE horario_plantillas SET activo = 0 WHERE id = ?`, [id]);
    return { ok: true };
  }

  // ═══════════════ HORARIO POR USUARIO ═══════════════
  private async horarioVigente(usuarioId: number, fecha?: string) {
    const f = fecha ?? (await this.hoy());
    const rows = await this.ds.query(
      `SELECT uh.*, COALESCE(uh.tolerancia_min, p.tolerancia_min, 10) AS tolerancia,
              p.nombre AS plantilla_nombre, s.nombre AS sucursal_nombre
         FROM usuario_horarios uh
         LEFT JOIN horario_plantillas p ON p.id = uh.plantilla_id
         LEFT JOIN sucursales s ON s.id = uh.sucursal_id
        WHERE uh.usuario_id = ? AND uh.vigente_desde <= ?
          AND (uh.vigente_hasta IS NULL OR uh.vigente_hasta >= ?)
        ORDER BY uh.vigente_desde DESC, uh.id DESC LIMIT 1`, [usuarioId, f, f]);
    if (!rows.length) return null;
    const row = rows[0];
    let dias: any[] = [];
    if (row.plantilla_id) {
      dias = await this.ds.query(
        `SELECT dia_semana, labora,
                TIME_FORMAT(entrada, '%H:%i')          AS entrada,
                TIME_FORMAT(salida_almuerzo, '%H:%i')  AS salida_almuerzo,
                TIME_FORMAT(regreso_almuerzo, '%H:%i') AS regreso_almuerzo,
                TIME_FORMAT(salida, '%H:%i')           AS salida
           FROM horario_plantilla_dias WHERE plantilla_id = ? ORDER BY dia_semana`, [row.plantilla_id]);
    } else if (row.dias_personalizados) {
      try {
        dias = typeof row.dias_personalizados === 'string'
          ? JSON.parse(row.dias_personalizados) : row.dias_personalizados;
      } catch { dias = []; }
    }
    let permitidas: number[] = [];
    if (row.sucursales_permitidas) {
      try {
        const arr = typeof row.sucursales_permitidas === 'string'
          ? JSON.parse(row.sucursales_permitidas) : row.sucursales_permitidas;
        if (Array.isArray(arr)) permitidas = arr.map(Number).filter(n => n > 0);
      } catch { permitidas = []; }
    }
    return { row, dias, tolerancia: Number(row.tolerancia), permitidas };
  }

  async horarioDe(usuarioId: number) {
    const vigente = await this.horarioVigente(usuarioId);
    const historial = await this.ds.query(
      `SELECT uh.id, uh.plantilla_id, p.nombre AS plantilla_nombre,
              DATE_FORMAT(uh.vigente_desde, '%Y-%m-%d') AS vigente_desde,
              DATE_FORMAT(uh.vigente_hasta, '%Y-%m-%d') AS vigente_hasta,
              uh.puede_movil, uh.sucursal_id, uh.sucursales_permitidas, uh.creado_por, uh.dias_personalizados
         FROM usuario_horarios uh
         LEFT JOIN horario_plantillas p ON p.id = uh.plantilla_id
        WHERE uh.usuario_id = ? ORDER BY uh.vigente_desde DESC LIMIT 20`, [usuarioId]);
    return { vigente, historial };
  }

  async asignarHorario(dto: any, por: string) {
    const { usuario_id, plantilla_id, dias_personalizados, tolerancia_min,
            sucursal_id, sucursales_permitidas, puede_movil, vigente_desde } = dto ?? {};
    if (!usuario_id) throw new BadRequestException('usuario_id requerido');
    if (!plantilla_id && !Array.isArray(dias_personalizados)) {
      throw new BadRequestException('Debe indicar plantilla o días personalizados');
    }
    const desde = vigente_desde || (await this.hoy());
    // Cerrar vigencia anterior el día antes del nuevo inicio
    await this.ds.query(
      `UPDATE usuario_horarios
          SET vigente_hasta = DATE_SUB(?, INTERVAL 1 DAY)
        WHERE usuario_id = ? AND (vigente_hasta IS NULL OR vigente_hasta >= ?)
          AND vigente_desde < ?`, [desde, usuario_id, desde, desde]);
    // Eliminar asignaciones que empiezan en/tras la nueva fecha (las reemplaza)
    await this.ds.query(
      `DELETE FROM usuario_horarios WHERE usuario_id = ? AND vigente_desde >= ?`,
      [usuario_id, desde]);
    await this.ds.query(
      `INSERT INTO usuario_horarios
         (usuario_id, plantilla_id, dias_personalizados, tolerancia_min, sucursal_id, sucursales_permitidas, puede_movil, vigente_desde, creado_por)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [usuario_id, plantilla_id ?? null,
       Array.isArray(dias_personalizados) ? JSON.stringify(dias_personalizados) : null,
       tolerancia_min ?? null, sucursal_id ?? null,
       Array.isArray(sucursales_permitidas) && sucursales_permitidas.length
         ? JSON.stringify(sucursales_permitidas.map(Number)) : null,
       puede_movil === false || puede_movil === 0 ? 0 : 1, desde, por]);
    return this.horarioDe(usuario_id);
  }

  // ═══════════════ VISTA GENERAL COLABORADORES ═══════════════
  async listarUsuariosAsistencia() {
    const usuarios = await this.ds.query(
      `SELECT u.id, u.nombre, u.email, u.rol
         FROM usuarios u WHERE u.activo = 1 ORDER BY u.nombre`);
    const hoy = await this.hoy();
    for (const u of usuarios) {
      const hv = await this.horarioVigente(u.id, hoy);
      u.horario = hv ? {
        plantilla_id: hv.row.plantilla_id,
        plantilla_nombre: hv.row.plantilla_nombre ?? 'PERSONALIZADO',
        sucursal: hv.row.sucursal_nombre,
        puede_movil: Number(hv.row.puede_movil) === 1,
        tolerancia: hv.tolerancia,
        sucursales_permitidas: hv.permitidas,
      } : null;
      const bio = await this.ds.query(
        `SELECT b.dispositivo_id, b.device_user_id, b.enrolado, d.nombre AS dispositivo
           FROM usuario_biometria b JOIN dispositivos_ponche d ON d.id = b.dispositivo_id
          WHERE b.usuario_id = ?`, [u.id]);
      u.biometria = bio;
      const mov = await this.ds.query(
        `SELECT COUNT(*) AS n, SUM(aprobado = 0) AS pendientes FROM usuario_moviles WHERE usuario_id = ?`, [u.id]);
      u.moviles = { total: Number(mov[0].n), pendientes: Number(mov[0].pendientes ?? 0) };
    }
    return usuarios;
  }

  // ═══════════════ PONCHE (PWA celular) ═══════════════
  private siguienteTipo(marcajesHoy: any[], diaCfg: any): string {
    const seq = diaCfg?.salida_almuerzo ? SEQ_COMPLETA : SEQ_CORTA;
    const usados = marcajesHoy.filter((m: any) => m.tipo !== 'EXTRA').length;
    return seq[usados] ?? 'EXTRA';
  }

  async ponchar(user: any, dto: any, ip: string) {
    const usuarioId = Number(user?.id ?? user?.sub);
    if (!usuarioId) throw new ForbiddenException('Usuario no identificado');

    // Anti doble-toque
    const reciente = await this.ds.query(
      `SELECT COUNT(*) AS n FROM marcajes
        WHERE usuario_id = ? AND estado != 'anulado'
          AND fecha_hora > DATE_SUB(${NOW_RD}, INTERVAL 60 SECOND)`, [usuarioId]);
    if (Number(reciente[0].n) > 0) {
      throw new BadRequestException('Ya ponchaste hace menos de un minuto');
    }

    const hoy = await this.hoy();
    const hv = await this.horarioVigente(usuarioId, hoy);
    if (hv && Number(hv.row.puede_movil) === 0) {
      throw new ForbiddenException('No estás autorizado a ponchar por celular. Usa el reloj de tu sucursal.');
    }

    const sucs = await this.ds.query(`SELECT * FROM sucursales WHERE activo = 1`);
    let sucursalId: number | null = null;
    let distancia: number | null = null;
    let masCercana: string | null = null;
    const sospechas: string[] = [];
    const notas: string[] = [];

    const lat = dto?.lat != null ? Number(dto.lat) : null;
    const lng = dto?.lng != null ? Number(dto.lng) : null;
    const sucsConGeo = sucs.filter((s: any) => s.lat != null && s.lng != null);

    if (lat != null && lng != null && sucsConGeo.length) {
      let best: any = null;
      for (const s of sucsConGeo) {
        const d = Math.round(haversineM(lat, lng, Number(s.lat), Number(s.lng)));
        if (!best || d < best.d) best = { s, d };
      }
      distancia = best.d;
      masCercana = best.s.nombre;
      if (best.d <= Number(best.s.radio_m)) sucursalId = best.s.id;
    }

    // Respaldo por IP de la sucursal (WiFi del local) — admite varias IPs
    // separadas por coma, y comodines de prefijo para IPv6 (ej: 2001:1308:268f:d000:*)
    if (!sucursalId && ip) {
      const coincideIp = (registrada: string) => registrada.endsWith('*')
        ? ip.toLowerCase().startsWith(registrada.slice(0, -1).toLowerCase())
        : registrada.toLowerCase() === ip.toLowerCase();
      const porIp = sucs.find((s: any) =>
        s.ip_publica && String(s.ip_publica).split(/[\s,;]+/).filter(Boolean).some(coincideIp));
      if (porIp) { sucursalId = porIp.id; notas.push('validado por WiFi/IP de sucursal'); }
    }

    // Respaldo por PC APROBADA de la oficina. Las PC de escritorio no tienen GPS
    // y el internet del local (Claro y Altice) cambia de IP cada 1-2 días, así
    // que ni la geocerca ni la IP pueden validarlas. Si el administrador aprobó
    // este equipo en la ficha del empleado (usuario_moviles.aprobado = 1) y es
    // una PC (no un celular), se acepta como ponche desde su sucursal asignada.
    // Los celulares NO entran por aquí: siguen validando por GPS.
    if (!sucursalId && dto?.hash) {
      const [pcAprobada] = await this.ds.query(
        `SELECT id, user_agent FROM usuario_moviles
          WHERE usuario_id = ? AND hash = ? AND aprobado = 1 LIMIT 1`,
        [usuarioId, String(dto.hash).slice(0, 64)]);
      const esPc = pcAprobada && !/Mobile|iPhone|iPad|Android/i.test(String(pcAprobada.user_agent ?? ''));
      if (esPc) {
        sucursalId = hv?.row?.sucursal_id ?? sucs[0]?.id ?? null;
        notas.push('validado por PC aprobada de la oficina');
      }
    }

    // BLOQUEO DURO: con geocercas configuradas, solo se poncha DENTRO de una sucursal
    if (!sucursalId && sucsConGeo.length) {
      if (lat == null || lng == null) {
        throw new ForbiddenException(
          `Este equipo no tiene GPS y no está aprobado para ponchar. ` +
          `Pídele al administrador que apruebe esta PC en tu ficha de empleado (Dispositivos), o poncha desde tu celular con el GPS activo.`);
      }
      const dTxt = distancia != null
        ? (distancia >= 1000 ? `${(distancia / 1000).toFixed(1)} km` : `${distancia} m`)
        : '';
      throw new ForbiddenException(
        `Estás fuera de las sucursales (a ${dTxt} de ${masCercana}). Debes estar en el local para ponchar.`);
    }
    if (!sucursalId) {
      sucursalId = hv?.row?.sucursal_id ?? null;
      notas.push('geocerca no configurada');
    }

    // Sucursales autorizadas para este colaborador
    const permitidas = hv?.permitidas ?? [];
    if (permitidas.length && sucursalId && !permitidas.includes(Number(sucursalId))) {
      const nom = sucs.find((s: any) => s.id === sucursalId)?.nombre ?? `#${sucursalId}`;
      sospechas.push(`sucursal no autorizada (${nom})`);
    }

    // Celular vinculado
    let estado = 'ok';
    if (dto?.hash) {
      const devs = await this.ds.query(
        `SELECT * FROM usuario_moviles WHERE usuario_id = ?`, [usuarioId]);
      const mio = devs.find((d: any) => d.hash === dto.hash);
      if (!mio) {
        const aprobado = devs.length === 0 ? 1 : 0;
        await this.ds.query(
          `INSERT IGNORE INTO usuario_moviles (usuario_id, hash, user_agent, aprobado) VALUES (?,?,?,?)`,
          [usuarioId, String(dto.hash).slice(0, 64), String(dto.user_agent ?? '').slice(0, 255), aprobado]);
        if (!aprobado) sospechas.push('celular nuevo sin aprobar');
      } else if (Number(mio.aprobado) === 0) {
        sospechas.push('celular pendiente de aprobación');
      }
    }

    if (sospechas.length) estado = 'sospechoso';

    // Tipo por secuencia del día
    const marcHoy = await this.ds.query(
      `SELECT tipo FROM marcajes WHERE usuario_id = ? AND fecha = ? AND estado != 'anulado' ORDER BY fecha_hora`,
      [usuarioId, hoy]);
    const dowHoy = await this.dow(hoy);
    const diaCfg = hv?.dias?.find((d: any) => Number(d.dia_semana) === dowHoy) ?? null;
    if (!hv) notas.push('sin horario asignado');
    else if (diaCfg && Number(diaCfg.labora) === 0) notas.push('día no laborable según su horario');
    const tipo = this.siguienteTipo(marcHoy, diaCfg);
    if (tipo === 'EXTRA') notas.push('ponche adicional fuera de secuencia');

    await this.ds.query(
      `INSERT INTO marcajes
         (usuario_id, fecha_hora, fecha, tipo, origen, sucursal_id, lat, lng, distancia_m, ip, dispositivo_hash, estado, motivo_sospecha, nota)
       VALUES (?, ${NOW_RD}, ${HOY_RD}, ?, 'celular', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [usuarioId, tipo, sucursalId, lat, lng, distancia, ip?.slice(0, 45) ?? null,
       dto?.hash ? String(dto.hash).slice(0, 64) : null, estado,
       sospechas.join('; ').slice(0, 200) || null, notas.join('; ').slice(0, 200) || null]);

    await this.recalcularJornada(usuarioId, hoy);
    const resumen = await this.estadoHoy(usuarioId, ip);
    return { ...resumen, ultimo: { tipo, estado, avisos: [...sospechas, ...notas] } };
  }

  // ¿El internet desde donde entra el usuario pertenece a una sucursal registrada?
  private async sucursalPorIp(ip?: string | null): Promise<string | null> {
    if (!ip) return null;
    const sucs = await this.ds.query(
      `SELECT nombre, ip_publica FROM sucursales WHERE activo = 1 AND ip_publica IS NOT NULL AND ip_publica != ''`);
    const coincideIp = (registrada: string) => registrada.endsWith('*')
      ? ip.toLowerCase().startsWith(registrada.slice(0, -1).toLowerCase())
      : registrada.toLowerCase() === ip.toLowerCase();
    const hit = sucs.find((s: any) =>
      String(s.ip_publica).split(/[\s,;]+/).filter(Boolean).some(coincideIp));
    return hit?.nombre ?? null;
  }

  async estadoHoy(usuarioId: number, ip?: string) {
    const hoy = await this.hoy();
    const marcajes = await this.ds.query(
      `SELECT m.id, m.tipo, m.estado, m.origen, m.nota,
              DATE_FORMAT(m.fecha_hora, '%H:%i') AS hora, s.nombre AS sucursal
         FROM marcajes m LEFT JOIN sucursales s ON s.id = m.sucursal_id
        WHERE m.usuario_id = ? AND m.fecha = ? AND m.estado != 'anulado'
        ORDER BY m.fecha_hora`, [usuarioId, hoy]);
    const hv = await this.horarioVigente(usuarioId, hoy);
    const dowHoy = await this.dow(hoy);
    const diaCfg = hv?.dias?.find((d: any) => Number(d.dia_semana) === dowHoy) ?? null;
    const siguiente = this.siguienteTipo(marcajes, diaCfg);
    const jor = await this.ds.query(
      `SELECT minutos_trabajados, tardanza_min, estado FROM jornadas WHERE usuario_id = ? AND fecha = ?`,
      [usuarioId, hoy]);
    const yo = await this.ds.query(`SELECT foto_url FROM usuarios WHERE id = ?`, [usuarioId]);
    const sucursales = await this.ds.query(
      `SELECT id, nombre, lat, lng, radio_m FROM sucursales WHERE activo = 1 AND lat IS NOT NULL AND lng IS NOT NULL`);
    return {
      fecha: hoy,
      marcajes,
      siguiente,
      horario: diaCfg,
      tiene_horario: !!hv,
      puede_movil: hv ? Number(hv.row.puede_movil) === 1 : true,
      jornada: jor[0] ?? null,
      foto: yo[0]?.foto_url ?? null,
      sucursales,
      ip_sucursal: await this.sucursalPorIp(ip),
    };
  }

  // ═══════════════ MARCAJES (gestión) ═══════════════
  listarMarcajes(q: any) {
    const cond: string[] = [`1=1`];
    const vals: any[] = [];
    if (q?.fecha) { cond.push(`m.fecha = ?`); vals.push(q.fecha); }
    if (q?.desde) { cond.push(`m.fecha >= ?`); vals.push(q.desde); }
    if (q?.hasta) { cond.push(`m.fecha <= ?`); vals.push(q.hasta); }
    if (q?.usuario_id) { cond.push(`m.usuario_id = ?`); vals.push(q.usuario_id); }
    if (q?.estado) { cond.push(`m.estado = ?`); vals.push(q.estado); }
    return this.ds.query(
      `SELECT m.id, m.usuario_id, u.nombre AS usuario, m.tipo, m.origen, m.estado,
              DATE_FORMAT(m.fecha, '%Y-%m-%d') AS fecha,
              DATE_FORMAT(m.fecha_hora, '%H:%i:%s') AS hora,
              m.distancia_m, m.ip, m.motivo_sospecha, m.nota, m.corregido_por,
              s.nombre AS sucursal
         FROM marcajes m
         JOIN usuarios u ON u.id = m.usuario_id
         LEFT JOIN sucursales s ON s.id = m.sucursal_id
        WHERE ${cond.join(' AND ')}
        ORDER BY m.fecha_hora DESC LIMIT 500`, vals);
  }

  async crearMarcajeManual(dto: any, por: string) {
    const { usuario_id, fecha, hora, tipo, sucursal_id, nota } = dto ?? {};
    if (!usuario_id || !fecha || !hora || !tipo) {
      throw new BadRequestException('usuario_id, fecha, hora y tipo son requeridos');
    }
    await this.ds.query(
      `INSERT INTO marcajes (usuario_id, fecha_hora, fecha, tipo, origen, sucursal_id, estado, nota, corregido_por, corregido_en)
       VALUES (?, ?, ?, ?, 'manual', ?, 'corregido', ?, ?, NOW())`,
      [usuario_id, `${fecha} ${hora}`, fecha, tipo, sucursal_id ?? null,
       (nota ?? 'registro manual').slice(0, 200), por]);
    await this.recalcularJornada(Number(usuario_id), fecha);
    return { ok: true };
  }

  async corregirMarcaje(id: number, dto: any, por: string) {
    const rows = await this.ds.query(`SELECT * FROM marcajes WHERE id = ?`, [id]);
    if (!rows.length) throw new NotFoundException('Marcaje no existe');
    const m = rows[0];
    const sets: string[] = [`corregido_por = ?`, `corregido_en = NOW()`];
    const vals: any[] = [por];
    if (dto.tipo) { sets.push(`tipo = ?`); vals.push(dto.tipo); }
    if (dto.hora) { sets.push(`fecha_hora = CONCAT(DATE_FORMAT(fecha, '%Y-%m-%d'), ' ', ?)`); vals.push(dto.hora); }
    if (dto.estado === 'anulado') { sets.push(`estado = 'anulado'`); }
    else if (dto.tipo || dto.hora) { sets.push(`estado = 'corregido'`); }
    if (dto.nota !== undefined) { sets.push(`nota = ?`); vals.push(String(dto.nota).slice(0, 200)); }
    vals.push(id);
    await this.ds.query(`UPDATE marcajes SET ${sets.join(', ')} WHERE id = ?`, vals);
    const fecha = (await this.ds.query(
      `SELECT DATE_FORMAT(fecha, '%Y-%m-%d') AS f FROM marcajes WHERE id = ?`, [id]))[0].f;
    await this.recalcularJornada(Number(m.usuario_id), fecha);
    return { ok: true };
  }

  // ═══════════════ JORNADAS ═══════════════
  async recalcularJornada(usuarioId: number, fecha?: string) {
    const f = fecha ?? (await this.hoy());
    const marc = await this.ds.query(
      `SELECT tipo, DATE_FORMAT(fecha_hora, '%Y-%m-%d %H:%i:%s') AS fh, sucursal_id
         FROM marcajes
        WHERE usuario_id = ? AND fecha = ? AND estado != 'anulado'
        ORDER BY fecha_hora`, [usuarioId, f]);
    if (!marc.length) {
      await this.ds.query(`DELETE FROM jornadas WHERE usuario_id = ? AND fecha = ?`, [usuarioId, f]);
      return;
    }
    const first = (t: string) => marc.find((m: any) => m.tipo === t)?.fh ?? null;
    const lastOf = (t: string) => [...marc].reverse().find((m: any) => m.tipo === t)?.fh ?? null;
    const entrada = first('ENTRADA');
    const salAlm  = first('SALIDA_ALMUERZO');
    const regAlm  = first('REGRESO_ALMUERZO');
    const salida  = lastOf('SALIDA');

    const minAlm = salAlm && regAlm ? Math.max(0, diffMin(salAlm, regAlm)) : 0;
    const minTrab = entrada && salida ? Math.max(0, diffMin(entrada, salida) - minAlm) : 0;

    const hv = await this.horarioVigente(usuarioId, f);
    const dowF = await this.dow(f);
    const diaCfg = hv?.dias?.find((d: any) => Number(d.dia_semana) === dowF) ?? null;

    let tardanza = 0;
    if (entrada && diaCfg?.entrada) {
      const t = diffMin(`${f} ${diaCfg.entrada}:00`, entrada) - (hv?.tolerancia ?? 10);
      tardanza = Math.max(0, t);
    }
    // Extra diaria según ley: lo trabajado por encima de 8 horas (480 min).
    // El excedente semanal sobre 44h se calcula aparte en resumenSemanal().
    const extra = Math.max(0, minTrab - 480);

    const hoy = await this.hoy();
    let estado = 'completa';
    if (!hv) estado = 'sin_horario';
    else if (!entrada || !salida) estado = f === hoy ? 'abierta' : 'incompleta';
    else if ((salAlm && !regAlm) || (!salAlm && regAlm)) estado = 'incompleta';
    const corrigio = marc.some((m: any) => m.origen === 'manual');
    if (estado === 'completa' && corrigio) estado = 'corregida';

    const sucursalId = marc[0]?.sucursal_id ?? null;
    await this.ds.query(
      `INSERT INTO jornadas
         (usuario_id, fecha, sucursal_id, entrada, salida_almuerzo, regreso_almuerzo, salida,
          minutos_trabajados, minutos_almuerzo, tardanza_min, extra_min, estado)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE
         sucursal_id = VALUES(sucursal_id), entrada = VALUES(entrada),
         salida_almuerzo = VALUES(salida_almuerzo), regreso_almuerzo = VALUES(regreso_almuerzo),
         salida = VALUES(salida), minutos_trabajados = VALUES(minutos_trabajados),
         minutos_almuerzo = VALUES(minutos_almuerzo), tardanza_min = VALUES(tardanza_min),
         extra_min = VALUES(extra_min), estado = VALUES(estado)`,
      [usuarioId, f, sucursalId, entrada, salAlm, regAlm, salida,
       minTrab, minAlm, tardanza, extra, estado]);
  }

  async recalcularRango(dto: any) {
    const { desde, hasta } = dto ?? {};
    if (!desde || !hasta) throw new BadRequestException('desde y hasta requeridos');
    const pares = await this.ds.query(
      `SELECT DISTINCT usuario_id, DATE_FORMAT(fecha, '%Y-%m-%d') AS f
         FROM marcajes WHERE fecha BETWEEN ? AND ?`, [desde, hasta]);
    for (const p of pares) await this.recalcularJornada(Number(p.usuario_id), p.f);
    return { recalculadas: pares.length };
  }

  listarJornadas(q: any) {
    const cond: string[] = [`1=1`];
    const vals: any[] = [];
    if (q?.desde) { cond.push(`j.fecha >= ?`); vals.push(q.desde); }
    if (q?.hasta) { cond.push(`j.fecha <= ?`); vals.push(q.hasta); }
    if (q?.usuario_id) { cond.push(`j.usuario_id = ?`); vals.push(q.usuario_id); }
    return this.ds.query(
      `SELECT j.*, DATE_FORMAT(j.fecha, '%Y-%m-%d') AS fecha,
              DATE_FORMAT(j.entrada, '%H:%i')          AS h_entrada,
              DATE_FORMAT(j.salida_almuerzo, '%H:%i')  AS h_salida_almuerzo,
              DATE_FORMAT(j.regreso_almuerzo, '%H:%i') AS h_regreso_almuerzo,
              DATE_FORMAT(j.salida, '%H:%i')           AS h_salida,
              u.nombre AS usuario, s.nombre AS sucursal
         FROM jornadas j
         JOIN usuarios u ON u.id = j.usuario_id
         LEFT JOIN sucursales s ON s.id = j.sucursal_id
        WHERE ${cond.join(' AND ')}
        ORDER BY j.fecha DESC, u.nombre LIMIT 1000`, vals);
  }

  /**
   * Resumen semanal por colaborador con regla dominicana de extras:
   * extra diaria = max(0, día − 8h); excedente semanal = max(0, semana − 44h).
   * El "extra semanal adicional" evita duplicar lo ya contado por día.
   */
  async resumenSemanal(fecha?: string) {
    const ref = fecha ?? (await this.hoy());
    const rango = await this.ds.query(
      `SELECT DATE_FORMAT(DATE_SUB(?, INTERVAL WEEKDAY(?) DAY), '%Y-%m-%d') AS lunes,
              DATE_FORMAT(DATE_ADD(DATE_SUB(?, INTERVAL WEEKDAY(?) DAY), INTERVAL 6 DAY), '%Y-%m-%d') AS domingo`,
      [ref, ref, ref, ref]);
    const { lunes, domingo } = rango[0];
    const rows = await this.ds.query(
      `SELECT j.usuario_id, u.nombre,
              COUNT(*)                        AS dias,
              SUM(j.minutos_trabajados)       AS min_total,
              SUM(GREATEST(j.minutos_trabajados - 480, 0)) AS min_extra_diaria,
              SUM(j.tardanza_min)             AS min_tardanza,
              SUM(j.tardanza_min > 0)         AS veces_tardanza
         FROM jornadas j
         JOIN usuarios u ON u.id = j.usuario_id
        WHERE j.fecha BETWEEN ? AND ?
        GROUP BY j.usuario_id, u.nombre
        ORDER BY u.nombre`, [lunes, domingo]);
    const LIMITE_SEMANAL = 44 * 60;
    const resumen = rows.map((r: any) => {
      const total = Number(r.min_total ?? 0);
      const extraDiaria = Number(r.min_extra_diaria ?? 0);
      const excesoSemanal = Math.max(0, total - LIMITE_SEMANAL);
      const extraSemanalAdicional = Math.max(0, excesoSemanal - extraDiaria);
      return {
        usuario_id: r.usuario_id,
        nombre: r.nombre,
        dias: Number(r.dias),
        min_total: total,
        min_extra_diaria: extraDiaria,
        min_extra_semanal: extraSemanalAdicional,
        min_extras_total: extraDiaria + extraSemanalAdicional,
        min_tardanza: Number(r.min_tardanza ?? 0),
        veces_tardanza: Number(r.veces_tardanza ?? 0),
        // Política E-Tex: cada 3 tardanzas en la semana = 1 ausencia (se
        // descontará de nómina cuando el módulo de nómina esté configurado)
        ausencias_por_tardanza: Math.floor(Number(r.veces_tardanza ?? 0) / 3),
      };
    });
    return { semana: { lunes, domingo }, limite_semanal_min: LIMITE_SEMANAL, colaboradores: resumen };
  }

  presentes() {
    return this.ds.query(
      `SELECT u.id, u.nombre, m.tipo,
              DATE_FORMAT(m.fecha_hora, '%H:%i') AS hora,
              s.nombre AS sucursal,
              CASE WHEN m.tipo IN ('ENTRADA','REGRESO_ALMUERZO') THEN 'presente'
                   WHEN m.tipo = 'SALIDA_ALMUERZO' THEN 'almuerzo'
                   WHEN m.tipo = 'SALIDA' THEN 'salio'
                   ELSE 'presente' END AS estado
         FROM marcajes m
         JOIN usuarios u ON u.id = m.usuario_id
         LEFT JOIN sucursales s ON s.id = m.sucursal_id
        WHERE m.fecha = ${HOY_RD} AND m.estado != 'anulado'
          AND m.id = (SELECT MAX(m2.id) FROM marcajes m2
                       WHERE m2.usuario_id = m.usuario_id AND m2.fecha = ${HOY_RD} AND m2.estado != 'anulado')
        ORDER BY u.nombre`);
  }

  // ═══════════════ BIOMETRÍA Y CELULARES ═══════════════
  async guardarFoto(usuarioId: number, filename: string) {
    const base = (process.env.FOTO_EMPLEADOS_BASE_URL || 'https://etex360erp.com/uploads/empleados').replace(/\/$/, '');
    const url = `${base}/${filename}`;
    await this.ds.query(`UPDATE usuarios SET foto_url = ? WHERE id = ?`, [url, usuarioId]);
    await this.ds.query(`UPDATE empleados_ficha SET foto_url = ? WHERE usuario_id = ?`, [url, usuarioId]);
    return { foto_url: url };
  }

  async biometriaDe(usuarioId: number) {
    const dispositivos = await this.ds.query(
      `SELECT d.id, d.nombre, d.tipo, d.modelo, s.nombre AS sucursal,
              b.device_user_id, b.enrolado,
              DATE_FORMAT(b.enrolado_en, '%Y-%m-%d') AS enrolado_en
         FROM dispositivos_ponche d
         LEFT JOIN sucursales s ON s.id = d.sucursal_id
         LEFT JOIN usuario_biometria b ON b.dispositivo_id = d.id AND b.usuario_id = ?
        WHERE d.activo = 1 ORDER BY d.id`, [usuarioId]);
    const moviles = await this.ds.query(
      `SELECT id, hash, user_agent, aprobado, DATE_FORMAT(creado_en, '%Y-%m-%d %H:%i') AS creado_en
         FROM usuario_moviles WHERE usuario_id = ? ORDER BY id`, [usuarioId]);
    const u = await this.ds.query(`SELECT foto_url, nombre FROM usuarios WHERE id = ?`, [usuarioId]);
    return { dispositivos, moviles, foto_url: u[0]?.foto_url ?? null, nombre: u[0]?.nombre ?? null };
  }

  async guardarBiometria(usuarioId: number, dto: any) {
    const { dispositivo_id, device_user_id, enrolado } = dto ?? {};
    if (!dispositivo_id) throw new BadRequestException('dispositivo_id requerido');
    const devUid = String(device_user_id ?? usuarioId);
    await this.ds.query(
      `INSERT INTO usuario_biometria (usuario_id, dispositivo_id, device_user_id, enrolado, enrolado_en)
       VALUES (?,?,?,?, IF(? = 1, NOW(), NULL))
       ON DUPLICATE KEY UPDATE device_user_id = VALUES(device_user_id),
         enrolado = VALUES(enrolado),
         enrolado_en = IF(VALUES(enrolado) = 1, COALESCE(enrolado_en, NOW()), NULL)`,
      [usuarioId, dispositivo_id, devUid, enrolado ? 1 : 0, enrolado ? 1 : 0]);
    return this.biometriaDe(usuarioId);
  }

  async gestionarMovil(id: number, dto: any) {
    if (dto?.accion === 'aprobar') {
      await this.ds.query(`UPDATE usuario_moviles SET aprobado = 1 WHERE id = ?`, [id]);
    } else if (dto?.accion === 'eliminar') {
      await this.ds.query(`DELETE FROM usuario_moviles WHERE id = ?`, [id]);
    } else {
      throw new BadRequestException('accion debe ser aprobar o eliminar');
    }
    return { ok: true };
  }

  // ═══════════════ INGESTA RELOJES (ZKTeco / Hikvision) ═══════════════
  async ingestarPoncheReloj(tipoDispositivo: 'zkteco' | 'hikvision', serial: string | null, pin: string, fechaHora: string) {
    const devs = await this.ds.query(
      `SELECT * FROM dispositivos_ponche WHERE tipo = ? AND activo = 1 ORDER BY id LIMIT 1`,
      [tipoDispositivo]);
    if (!devs.length) return { ok: false, motivo: 'dispositivo no registrado' };
    const dev = devs[0];
    if (serial && !dev.serial) {
      await this.ds.query(`UPDATE dispositivos_ponche SET serial = ? WHERE id = ?`, [serial, dev.id]);
    }
    await this.ds.query(`UPDATE dispositivos_ponche SET ultima_conexion = NOW() WHERE id = ?`, [dev.id]);

    // Resolver usuario: primero por biometría registrada, luego PIN = usuario_id
    let usuarioId: number | null = null;
    const bio = await this.ds.query(
      `SELECT usuario_id FROM usuario_biometria WHERE dispositivo_id = ? AND device_user_id = ?`,
      [dev.id, String(pin)]);
    if (bio.length) usuarioId = Number(bio[0].usuario_id);
    else {
      const u = await this.ds.query(`SELECT id FROM usuarios WHERE id = ? AND activo = 1`, [Number(pin) || 0]);
      if (u.length) usuarioId = Number(u[0].id);
    }
    if (!usuarioId) return { ok: false, motivo: `PIN ${pin} sin usuario` };

    const fecha = fechaHora.slice(0, 10);
    // Duplicado exacto (reenvíos del reloj)
    const dup = await this.ds.query(
      `SELECT id FROM marcajes WHERE usuario_id = ? AND fecha_hora = ? AND origen = ?`,
      [usuarioId, fechaHora, tipoDispositivo]);
    if (dup.length) return { ok: true, duplicado: true };

    const hv = await this.horarioVigente(usuarioId, fecha);
    const dowF = await this.dow(fecha);
    const diaCfg = hv?.dias?.find((d: any) => Number(d.dia_semana) === dowF) ?? null;
    const marcHoy = await this.ds.query(
      `SELECT tipo FROM marcajes WHERE usuario_id = ? AND fecha = ? AND estado != 'anulado' ORDER BY fecha_hora`,
      [usuarioId, fecha]);
    const tipo = this.siguienteTipo(marcHoy, diaCfg);

    // ¿Está autorizado a ponchar en la sucursal de este reloj?
    let estadoReloj = 'ok';
    let motivoReloj: string | null = null;
    const permitidasReloj = hv?.permitidas ?? [];
    if (permitidasReloj.length && dev.sucursal_id && !permitidasReloj.includes(Number(dev.sucursal_id))) {
      estadoReloj = 'sospechoso';
      motivoReloj = 'sucursal no autorizada para este colaborador';
    }

    await this.ds.query(
      `INSERT INTO marcajes (usuario_id, fecha_hora, fecha, tipo, origen, sucursal_id, dispositivo_id, estado, motivo_sospecha)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [usuarioId, fechaHora, fecha, tipo, tipoDispositivo, dev.sucursal_id, dev.id, estadoReloj, motivoReloj]);
    await this.recalcularJornada(usuarioId, fecha);
    // Marcar enrolado si ponchó y no estaba registrado
    await this.ds.query(
      `INSERT INTO usuario_biometria (usuario_id, dispositivo_id, device_user_id, enrolado, enrolado_en)
       VALUES (?,?,?,1,NOW())
       ON DUPLICATE KEY UPDATE enrolado = 1, enrolado_en = COALESCE(enrolado_en, NOW())`,
      [usuarioId, dev.id, String(pin)]);
    return { ok: true, usuario_id: usuarioId, tipo };
  }
}
