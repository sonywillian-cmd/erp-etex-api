import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { GoogleGenAI } from '@google/genai';
import axios from 'axios';
import { ClientesService } from '../clientes/clientes.service';
import { TelegramService } from '../telegram/telegram.service';
import { TipoCliente, EstadoCliente } from '../clientes/entities/cliente.entity';
import { CotizacionesService } from '../cotizaciones/cotizaciones.service';
import { GastosService } from '../gastos/gastos.service';
import { FacturacionService } from '../facturacion/facturacion.service';
import { TipoComprobante, MetodoPago } from '../facturacion/entities/factura.entity';

// ─── Schema para que Gemini extraiga el intent del mensaje del usuario ──────
const SCHEMA_INTENT = {
  type: 'object',
  properties: {
    accion: {
      type: 'string',
      enum: [
        'crear_cliente',
        'cotizar',
        'facturar',
        'buscar_cliente',
        'consultar_orden',
        'consultar_metrica',
        'gasto',
        'saludo',
        'otro',
      ],
    },
    // Para consultar_metrica: qué métrica está pidiendo el usuario
    metrica: {
      type: 'string',
      enum: [
        'ordenes_atraso',        // órdenes en atraso o críticas no terminadas
        'ordenes_criticas',      // semáforo crítico, no terminadas
        'ordenes_activas',       // en curso (no listo/entregado/cancelado)
        'ordenes_listas',        // listo / listo_parcial
        'ordenes_entregadas',
        'ordenes_canceladas',
        'cobros',                // total cobros del periodo
        'ventas',                // total facturas emitidas del periodo
        'gastos',                // total gastos del periodo
        'itbis_deducible',       // ITBIS deducible del periodo
        'itbis_a_depositar',     // cobrado − deducible
        'cuentas_por_cobrar',    // saldo pendiente de facturas
      ],
      nullable: true,
    },
    periodo: {
      type: 'string',
      enum: ['hoy', 'ayer', 'semana', 'mes', 'mes_pasado', 'año'],
      nullable: true,
    },
    // Datos del cliente (para crear_cliente, cotizar, facturar, buscar_cliente)
    cliente: {
      type: 'object',
      nullable: true,
      properties: {
        nombre:    { type: 'string', nullable: true },
        rnc:       { type: 'string', nullable: true },
        cedula:    { type: 'string', nullable: true },
        telefono:  { type: 'string', nullable: true },
        email:     { type: 'string', nullable: true },
        direccion: { type: 'string', nullable: true },
        tipo:      { type: 'string', enum: ['empresa', 'persona'], nullable: true },
      },
    },
    // Datos de cotización/factura (líneas, fecha, etc.)
    items: {
      type: 'array',
      nullable: true,
      items: {
        type: 'object',
        properties: {
          producto:    { type: 'string', nullable: true },
          descripcion: { type: 'string', nullable: true },
          cantidad:    { type: 'number', nullable: true },
          precio:      { type: 'number', nullable: true },
          tecnica:     { type: 'string', nullable: true },
          color:       { type: 'string', nullable: true },
          talla:       { type: 'string', nullable: true },
        },
      },
    },
    fecha_entrega: { type: 'string', nullable: true },
    notas:         { type: 'string', nullable: true },
    // Para consultas (búsqueda, número de orden, etc.)
    consulta_query: { type: 'string', nullable: true },
    // Para facturar: tipo NCF si el usuario lo especifica explícitamente
    tipo_ncf:       { type: 'string', enum: ['B01','B02','B11','B14','B15','PROFORMA'], nullable: true },
    // Para facturar: número de orden si quiere facturar desde una orden
    orden_numero:   { type: 'string', nullable: true },
    // Respuesta natural del asistente al usuario
    mensaje_usuario: { type: 'string' },
  },
  required: ['accion', 'mensaje_usuario'],
};

const PROMPT_INTENT = `Eres un asistente del ERP de E-Tex 360, una empresa textil en República Dominicana. Interpreta el mensaje del usuario y extrae:

1. La ACCIÓN que quiere realizar (una de las opciones del schema)
2. Las ENTIDADES mencionadas (cliente, productos, montos, fechas)
3. Un MENSAJE_USUARIO breve y amable confirmando lo que entendiste (en español dominicano natural)

Acciones disponibles:
- crear_cliente: agregar un cliente nuevo al sistema
- cotizar: crear una cotización (presupuesto sin compromiso de venta)
- facturar: facturar directamente (venta inmediata)
- buscar_cliente: encontrar un cliente existente
- consultar_orden: ver estado de una orden de producción
- gasto: registrar un gasto/salida
- saludo: solo saludando o preguntando qué puede hacer
- otro: cualquier otra cosa fuera de scope

Reglas:
- Si dice "crear cliente", "agregar cliente", "nuevo cliente" → crear_cliente
- Si dice "cotizar", "presupuesto", "cotización" → cotizar
- Si dice "facturar", "factura para", "factura a" → facturar
- Si dice "buscar", "encontrar", "quién es" → buscar_cliente
- Si dice "estado de", "cómo va", "OP-" SIN "factura" → consultar_orden
- Si dice "órdenes de [cliente]", "cómo va lo de [cliente]" → consultar_orden con cliente.nombre lleno
- En consultar_orden: si hay un número de orden lo pones en orden_numero; si hay un cliente lo pones en cliente.nombre; consulta_query es opcional
- Si dice "factura la OP-XXX", "facturar OP-XXX" → facturar + orden_numero
- Si dice "gasto", "registrar gasto" → gasto
- Si dice "cuántas/cuánto", "cuánta plata", "cuántas órdenes", "total de", "resumen de", "cuántas hay" → consultar_metrica con la métrica adecuada:
   * "órdenes en atraso/atrasadas/críticas/vencidas" → metrica="ordenes_atraso"
   * "órdenes activas/en curso/en proceso" → metrica="ordenes_activas"
   * "órdenes listas/para entregar" → metrica="ordenes_listas"
   * "cobré/cobramos/total cobrado" → metrica="cobros"
   * "vendí/vendimos/total ventas/facturé" → metrica="ventas"
   * "gasté/gastamos/total gastos" → metrica="gastos"
   * "ITBIS deducible/del mes" → metrica="itbis_deducible"
   * "ITBIS a pagar/depositar" → metrica="itbis_a_depositar"
   * "cuentas por cobrar/me deben" → metrica="cuentas_por_cobrar"
- periodo: extraer si dice "hoy/ayer/esta semana/este mes/mes pasado/este año"; default "hoy" para cobros/ventas/gastos, "mes" para itbis.
- Si solo saluda → saludo
- En cliente.tipo: "empresa" si menciona SRL, EIRL, SA, Industrias, Comercial, etc. o si tiene RNC; "persona" si tiene cédula o nombre individual.
- rnc: 9 dígitos (puede tener guiones). cédula: 11 dígitos.
- tipo_ncf: extraer SOLO si el usuario lo dice explícitamente (B01, B02, B11, B14, B15). NO inventes.
- orden_numero: extraer formato OP-XXXX-XXX cuando facture desde orden.
- En mensaje_usuario: NUNCA inventes datos. Solo confirma lo que entendiste. Si falta algo crítico, pídelo.

Ejemplos:
- "Cotiza a Industrias García 50 polos blancos M a 250" → accion=cotizar, cliente={nombre:"Industrias García",tipo:"empresa"}, items=[{producto:"polos",cantidad:50,precio:250,color:"blanco",talla:"M"}], mensaje_usuario="Cotización para Industrias García con 50 polos blancos M a RD$250 c/u. ¿Confirmas?"
- "Crear cliente RNC 131036686" → accion=crear_cliente, cliente={rnc:"131036686",tipo:"empresa"}, mensaje_usuario="Voy a consultar el RNC en DGII para validarlo..."
- "Hola" → accion=saludo, mensaje_usuario="¡Hola! Soy el asistente de E-Tex. Puedo crear clientes, cotizaciones, facturas o consultar info. ¿Qué necesitas?"`;

@Injectable()
export class AsistenteService {
  private readonly logger = new Logger('AsistenteService');
  private genai: GoogleGenAI | null = null;
  private readonly GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-pro';

  constructor(
    @InjectDataSource() private ds: DataSource,
    private clientesSvc: ClientesService,
    private cotizacionesSvc: CotizacionesService,
    private gastosSvc: GastosService,
    private facturacionSvc: FacturacionService,
    private telegram: TelegramService,
  ) {
    if (process.env.GEMINI_API_KEY) {
      this.genai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    } else {
      this.logger.warn('GEMINI_API_KEY no configurado — el asistente no funcionará');
    }
  }

  // ── Interpretar comando libre del usuario con Gemini ───────────────────
  async interpretar(texto: string) {
    if (!this.genai) {
      throw new BadRequestException('Asistente no disponible (GEMINI_API_KEY no configurado)');
    }
    if (!texto || !texto.trim()) {
      throw new BadRequestException('Mensaje vacío');
    }

    try {
      const resp = await this.genai.models.generateContent({
        model: this.GEMINI_MODEL,
        contents: [{
          role: 'user',
          parts: [{ text: `${PROMPT_INTENT}\n\nMensaje del usuario: "${texto.trim()}"` }],
        }],
        config: {
          responseMimeType: 'application/json',
          responseSchema: SCHEMA_INTENT,
          temperature: 0.2,
        },
      });
      const out = (resp.text || '').trim();
      if (!out) throw new Error('Respuesta vacía de Gemini');
      return JSON.parse(out);
    } catch (e: any) {
      this.logger.error('Error interpretando: ' + e.message);
      throw new BadRequestException(`No pude entender el mensaje: ${e.message}`);
    }
  }

  // ── Interpretar audio (Gemini transcribe + extrae intent en una llamada) ─
  async interpretarAudio(audioBase64: string, mimeType = 'audio/ogg') {
    if (!this.genai) {
      throw new BadRequestException('Asistente no disponible (GEMINI_API_KEY no configurado)');
    }
    if (!audioBase64) throw new BadRequestException('Sin audio');

    try {
      const resp = await this.genai.models.generateContent({
        model: this.GEMINI_MODEL,
        contents: [{
          role: 'user',
          parts: [
            { inlineData: { mimeType, data: audioBase64 } },
            { text: PROMPT_INTENT + '\n\nEl mensaje del usuario llega como audio. Transcríbelo internamente y analiza el intent. En español dominicano.' },
          ],
        }],
        config: {
          responseMimeType: 'application/json',
          responseSchema: SCHEMA_INTENT,
          temperature: 0.2,
        },
      });
      const out = (resp.text || '').trim();
      if (!out) throw new Error('Respuesta vacía de Gemini');
      return JSON.parse(out);
    } catch (e: any) {
      this.logger.error('Error interpretando audio: ' + e.message);
      throw new BadRequestException(`No pude entender el audio: ${e.message}`);
    }
  }

  // ── Validar RNC en DGII (consulta SOAP pública) ─────────────────────────
  async validarRncDgii(rncRaw: string): Promise<{
    ok: boolean;
    rnc?: string;
    razon_social?: string;
    nombre_comercial?: string;
    actividad_economica?: string;
    estado?: string;
    mensaje?: string;
  }> {
    const rnc = (rncRaw || '').replace(/[^0-9]/g, '');
    if (!/^\d{9}$|^\d{11}$/.test(rnc)) {
      return { ok: false, mensaje: 'Formato de RNC inválido (debe tener 9 u 11 dígitos)' };
    }

    const soapBody = `<?xml version="1.0" encoding="utf-8"?>
<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
  <soap:Body>
    <GetContribuyentes xmlns="http://dgii.gov.do/">
      <value>${rnc}</value>
      <patronBusqueda>0</patronBusqueda>
      <inicioFilas>1</inicioFilas>
      <filaFilas>1</filaFilas>
      <IMEI></IMEI>
    </GetContribuyentes>
  </soap:Body>
</soap:Envelope>`;

    try {
      const resp = await axios.post(
        'https://www.dgii.gov.do/wsMovilDGII/WSMovilDGII.asmx',
        soapBody,
        {
          headers: {
            'Content-Type': 'text/xml; charset=utf-8',
            'SOAPAction': 'http://dgii.gov.do/GetContribuyentes',
          },
          timeout: 12000,
        },
      );
      const xml = resp.data as string;

      // El servicio devuelve los datos como un string JSON embebido en
      // <GetContribuyentesResult>...</GetContribuyentesResult>
      const m = xml.match(/<GetContribuyentesResult>([\s\S]*?)<\/GetContribuyentesResult>/);
      if (!m || !m[1]) return { ok: false, mensaje: 'DGII no devolvió datos' };

      // El contenido viene HTML-encoded (ej: &quot; en vez de ")
      let inner = m[1]
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>');

      // Puede venir como "{...}" o como JSON limpio
      try {
        const data = JSON.parse(inner);
        if (!data || !data.rnc) {
          return { ok: false, mensaje: 'RNC no encontrado en DGII' };
        }
        return {
          ok: true,
          rnc:                 String(data.rnc).trim(),
          razon_social:        (data.nombre || '').trim(),
          nombre_comercial:    (data.nombre_comercial || '').trim(),
          actividad_economica: (data.actividad_economica || '').trim(),
          estado:              (data.estado || '').trim(),
        };
      } catch {
        return { ok: false, mensaje: 'Respuesta DGII no parseable' };
      }
    } catch (e: any) {
      this.logger.warn('DGII consulta falló: ' + (e.code || e.message));
      return { ok: false, mensaje: 'No se pudo consultar DGII (timeout o servicio caído)' };
    }
  }

  // ── Crear cliente con auto-completado de DGII si es empresa con RNC ────
  async crearCliente(data: {
    nombre?: string;
    rnc?: string;
    cedula?: string;
    tipo?: 'empresa' | 'persona';
    telefono?: string;
    email?: string;
    direccion?: string;
  }) {
    const tipo = data.tipo === 'persona' ? TipoCliente.PERSONA : TipoCliente.EMPRESA;
    const documento = (data.rnc || data.cedula || '').replace(/[^0-9]/g, '');
    let nombre = (data.nombre || '').trim();
    let validacion: any = null;

    // Si es empresa con RNC, validar en DGII y auto-completar nombre
    if (tipo === TipoCliente.EMPRESA && documento && /^\d{9}$/.test(documento)) {
      validacion = await this.validarRncDgii(documento);
      if (validacion.ok && validacion.razon_social && !nombre) {
        nombre = validacion.razon_social;
      }
    }

    if (!nombre) {
      throw new BadRequestException(
        'Falta el nombre del cliente. Indícalo en el mensaje o un RNC válido para auto-completar.'
      );
    }

    // Crear usando el servicio existente
    const cliente = await this.clientesSvc.create({
      nombre,
      tipo,
      documento: documento || undefined,
      telefono: data.telefono || '',
      email: data.email || undefined,
      direccion: data.direccion || undefined,
      estado: EstadoCliente.ACTIVO,
    } as any);

    return {
      cliente,
      validacion_dgii: validacion,
    };
  }

  // ─── Búsqueda fuzzy de clientes (devuelve mejor match o opciones) ───────
  async buscarClienteFuzzy(query: string) {
    if (!query || !query.trim()) return { matches: [] };
    const rows: any[] = await this.ds.query(
      `SELECT id, nombre, documento, telefono, email, tipo
       FROM clientes
       WHERE UPPER(nombre) LIKE UPPER(?) OR documento LIKE ?
       ORDER BY
         CASE WHEN UPPER(nombre) = UPPER(?) THEN 0
              WHEN UPPER(nombre) LIKE UPPER(?) THEN 1
              ELSE 2 END,
         nombre ASC
       LIMIT 8`,
      [`%${query}%`, `%${query}%`, query, `${query}%`],
    );
    return { matches: rows };
  }

  // ─── Crear cotización completa (desde datos ya interpretados) ───────────
  async crearCotizacion(data: {
    cliente_id: number;
    items: Array<{
      descripcion: string;
      cantidad?: number;
      precio_unitario?: number;
      tecnica?: string;
    }>;
    creado_por?: string;
    notas?: string;
    especificaciones?: string;
    fecha_vencimiento?: string;
  }) {
    if (!data.cliente_id) throw new BadRequestException('Falta cliente_id');
    if (!data.items || data.items.length === 0) {
      throw new BadRequestException('La cotización necesita al menos una línea');
    }

    const lineas = data.items.map(it => ({
      descripcion:        it.descripcion || '—',
      cantidad:           Number(it.cantidad ?? 1),
      precio_unitario:    Number(it.precio_unitario ?? 0),
      tecnica:            it.tecnica ?? undefined,
      aplica_itbis:       true,
      porcentaje_itbis:   18,
      descuento_pct:      0,
    }));

    const cot = await this.cotizacionesSvc.create({
      cliente_id:        data.cliente_id,
      lineas,
      creado_por:        data.creado_por,
      notas:             data.notas,
      especificaciones:  data.especificaciones,
      fecha_vencimiento: data.fecha_vencimiento ? new Date(data.fecha_vencimiento) : undefined,
    } as any);

    return cot;
  }

  // ─── Consultar orden(es): por número O por nombre del cliente ──────────
  async consultarOrden(query: string) {
    const q = (query || '').trim();
    if (!q) throw new BadRequestException('Falta query (número de orden o nombre de cliente)');

    // Detectar si es un identificador numérico de orden
    const esNumero = /^(OP-?\d{4}-?\d{1,4}|\d{4}-\d{1,4}|\d{1,5})$/i.test(q);
    const upper = q.toUpperCase();

    let whereClause: string;
    let likePattern: string;
    let busquedaTipo: 'numero' | 'cliente';
    let limit = 5;

    if (esNumero) {
      busquedaTipo = 'numero';
      if (upper.startsWith('OP-')) {
        likePattern = `%${upper}%`;
      } else if (/^\d{4}-\d{1,4}$/.test(upper)) {
        likePattern = `%${upper}`;
      } else {
        // Solo dígitos → padding y buscar como sufijo
        likePattern = `%-${upper.padStart(3, '0')}`;
      }
      whereClause = 'UPPER(o.numero) LIKE UPPER(?)';
    } else {
      busquedaTipo = 'cliente';
      likePattern = `%${upper}%`;
      whereClause = 'UPPER(c.nombre) LIKE UPPER(?)';
      limit = 10; // un cliente puede tener varias órdenes
    }

    const rows: any[] = await this.ds.query(
      `SELECT o.id, o.numero, o.estado, o.semaforo, o.estado_produccion,
              o.fecha_comprometida, o.fecha_hora_entrega,
              o.tiempo_inicio, o.tiempo_fin,
              c.nombre AS cliente_nombre, c.documento AS cliente_documento
       FROM ordenes_produccion o
       LEFT JOIN clientes c ON c.id = o.cliente_id
       WHERE ${whereClause}
       ORDER BY o.id DESC
       LIMIT ${limit}`,
      [likePattern],
    );

    if (rows.length === 0) {
      return { encontradas: 0, ordenes: [], busqueda_tipo: busquedaTipo };
    }

    // Cargar etapas SOLO si encontramos 1 sola orden (detalle completo).
    // Para varias, devolvemos lista corta sin etapas.
    let etapas: any[] = [];
    if (rows.length === 1) {
      etapas = await this.ds.query(
        `SELECT id, numero, departamento, tarea_nombre, tipo, estado, responsable,
                cantidad, piezas_ok, tiempo_inicio, tiempo_fin, orden_ejecucion
         FROM lotes_produccion
         WHERE orden_id = ?
         ORDER BY orden_ejecucion ASC, id ASC`,
        [rows[0].id],
      );
    }

    return {
      encontradas:  rows.length,
      ordenes:      rows,
      principal:    rows[0],
      etapas,
      busqueda_tipo: busquedaTipo,
    };
  }

  // ─── Calcula rango de fechas según el periodo ──────────────────────────
  private rangoPeriodo(periodo: string): { desde: string; hasta: string; label: string } {
    const hoy = new Date();
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

    switch ((periodo || 'hoy').toLowerCase()) {
      case 'hoy': {
        const d = startOfDay(hoy);
        return { desde: fmt(d), hasta: fmt(d), label: 'hoy' };
      }
      case 'ayer': {
        const d = startOfDay(hoy);
        d.setDate(d.getDate() - 1);
        return { desde: fmt(d), hasta: fmt(d), label: 'ayer' };
      }
      case 'semana': {
        const d = startOfDay(hoy);
        const lun = new Date(d);
        const dia = d.getDay(); // 0=domingo
        lun.setDate(d.getDate() - (dia === 0 ? 6 : dia - 1));
        return { desde: fmt(lun), hasta: fmt(d), label: 'esta semana' };
      }
      case 'mes': {
        const ini = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
        const fin = new Date(hoy.getFullYear(), hoy.getMonth() + 1, 0);
        return { desde: fmt(ini), hasta: fmt(fin), label: 'este mes' };
      }
      case 'mes_pasado': {
        const ini = new Date(hoy.getFullYear(), hoy.getMonth() - 1, 1);
        const fin = new Date(hoy.getFullYear(), hoy.getMonth(), 0);
        return { desde: fmt(ini), hasta: fmt(fin), label: 'el mes pasado' };
      }
      case 'año': case 'anio': case 'ano': {
        const ini = new Date(hoy.getFullYear(), 0, 1);
        const fin = new Date(hoy.getFullYear(), 11, 31);
        return { desde: fmt(ini), hasta: fmt(fin), label: 'este año' };
      }
      default: {
        const d = startOfDay(hoy);
        return { desde: fmt(d), hasta: fmt(d), label: 'hoy' };
      }
    }
  }

  // ─── Consultar métrica (agregados de la operación) ──────────────────────
  async consultarMetricas(metrica: string, periodo?: string) {
    const m = (metrica || '').trim();
    const r = this.rangoPeriodo(periodo || 'hoy');

    switch (m) {
      case 'ordenes_atraso': {
        // Órdenes vencidas (fecha_hora_entrega pasada) que NO están terminadas
        const ahora = new Date();
        const ahoraStr = ahora.toISOString().slice(0, 19).replace('T', ' ');
        const rows: any[] = await this.ds.query(
          `SELECT o.id, o.numero, o.estado, o.semaforo, o.fecha_hora_entrega,
                  o.fecha_comprometida, c.nombre AS cliente_nombre,
                  DATEDIFF(?, COALESCE(o.fecha_hora_entrega, o.fecha_comprometida)) AS dias_vencida
           FROM ordenes_produccion o
           LEFT JOIN clientes c ON c.id = o.cliente_id
           WHERE o.estado NOT IN ('listo','listo_parcial','entregado','cancelado')
             AND COALESCE(o.fecha_hora_entrega, o.fecha_comprometida) < ?
           ORDER BY COALESCE(o.fecha_hora_entrega, o.fecha_comprometida) ASC
           LIMIT 20`,
          [ahoraStr, ahoraStr],
        );
        return {
          metrica: 'Órdenes en atraso',
          tipo: 'lista',
          total: rows.length,
          detalle: rows.slice(0, 10).map((o: any) => ({
            numero: o.numero,
            cliente: o.cliente_nombre,
            dias_vencida: Math.max(0, Number(o.dias_vencida ?? 0)),
            estado: o.estado,
          })),
        };
      }

      case 'ordenes_criticas': {
        const rows: any[] = await this.ds.query(
          `SELECT o.id, o.numero, o.estado, o.fecha_hora_entrega,
                  c.nombre AS cliente_nombre
           FROM ordenes_produccion o
           LEFT JOIN clientes c ON c.id = o.cliente_id
           WHERE o.semaforo = 'critico'
             AND o.estado NOT IN ('listo','listo_parcial','entregado','cancelado')
           ORDER BY o.fecha_hora_entrega ASC
           LIMIT 20`,
        );
        return {
          metrica: 'Órdenes críticas',
          tipo: 'lista',
          total: rows.length,
          detalle: rows.slice(0, 10).map((o: any) => ({
            numero: o.numero,
            cliente: o.cliente_nombre,
            entrega: o.fecha_hora_entrega,
            estado: o.estado,
          })),
        };
      }

      case 'ordenes_activas': {
        const rows: any[] = await this.ds.query(
          `SELECT COUNT(*) AS total FROM ordenes_produccion
           WHERE estado NOT IN ('listo','listo_parcial','entregado','cancelado')`,
        );
        return { metrica: 'Órdenes activas (en curso)', tipo: 'numero', total: Number(rows[0]?.total ?? 0) };
      }

      case 'ordenes_listas': {
        const rows: any[] = await this.ds.query(
          `SELECT COUNT(*) AS total FROM ordenes_produccion
           WHERE estado IN ('listo','listo_parcial')`,
        );
        return { metrica: 'Órdenes listas para entregar', tipo: 'numero', total: Number(rows[0]?.total ?? 0) };
      }

      case 'ordenes_entregadas': {
        const rows: any[] = await this.ds.query(
          `SELECT COUNT(*) AS total FROM ordenes_produccion
           WHERE estado = 'entregado'
             AND DATE(fecha_entrega_real) BETWEEN ? AND ?`,
          [r.desde, r.hasta],
        );
        return { metrica: `Órdenes entregadas ${r.label}`, tipo: 'numero', total: Number(rows[0]?.total ?? 0), periodo: r };
      }

      case 'ordenes_canceladas': {
        const rows: any[] = await this.ds.query(
          `SELECT COUNT(*) AS total FROM ordenes_produccion WHERE estado = 'cancelado'`,
        );
        return { metrica: 'Órdenes canceladas (total histórico)', tipo: 'numero', total: Number(rows[0]?.total ?? 0) };
      }

      case 'cobros': {
        // Cobros del periodo (vinculados a sesión, no PROFORMA orphans)
        const rows: any[] = await this.ds.query(
          `SELECT COUNT(*) AS cantidad, COALESCE(SUM(monto),0) AS total
           FROM recibos_ingreso
           WHERE fecha BETWEEN ? AND ?`,
          [r.desde, r.hasta],
        );
        return {
          metrica: `Cobros recibidos ${r.label}`,
          tipo: 'monto',
          total: Number(rows[0]?.total ?? 0),
          cantidad: Number(rows[0]?.cantidad ?? 0),
          periodo: r,
        };
      }

      case 'ventas': {
        // Facturas emitidas (no proforma, no anuladas)
        const rows: any[] = await this.ds.query(
          `SELECT COUNT(*) AS cantidad, COALESCE(SUM(total),0) AS total
           FROM facturas
           WHERE DATE(fecha_emision) BETWEEN ? AND ?
             AND tipo_ncf != 'PROFORMA'
             AND estado != 'anulada'`,
          [r.desde, r.hasta],
        );
        return {
          metrica: `Ventas ${r.label}`,
          tipo: 'monto',
          total: Number(rows[0]?.total ?? 0),
          cantidad: Number(rows[0]?.cantidad ?? 0),
          periodo: r,
        };
      }

      case 'gastos': {
        const rows: any[] = await this.ds.query(
          `SELECT COUNT(*) AS cantidad, COALESCE(SUM(monto),0) AS total
           FROM gastos
           WHERE fecha BETWEEN ? AND ?`,
          [r.desde, r.hasta],
        );
        return {
          metrica: `Gastos ${r.label}`,
          tipo: 'monto',
          total: Number(rows[0]?.total ?? 0),
          cantidad: Number(rows[0]?.cantidad ?? 0),
          periodo: r,
        };
      }

      case 'itbis_deducible': {
        const rows: any[] = await this.ds.query(
          `SELECT COALESCE(SUM(itbis),0) AS total
           FROM gastos
           WHERE fecha BETWEEN ? AND ?
             AND tipo = 'formal'
             AND tipo_ncf IN ('B01','B11','B15')`,
          [r.desde, r.hasta],
        );
        return {
          metrica: `ITBIS deducible ${r.label}`,
          tipo: 'monto',
          total: Number(rows[0]?.total ?? 0),
          periodo: r,
        };
      }

      case 'itbis_a_depositar': {
        const ventas: any[] = await this.ds.query(
          `SELECT COALESCE(SUM(itbis),0) AS t FROM facturas
           WHERE DATE(fecha_emision) BETWEEN ? AND ? AND tipo_ncf != 'PROFORMA' AND estado != 'anulada'`,
          [r.desde, r.hasta],
        );
        const ded: any[] = await this.ds.query(
          `SELECT COALESCE(SUM(itbis),0) AS t FROM gastos
           WHERE fecha BETWEEN ? AND ? AND tipo = 'formal' AND tipo_ncf IN ('B01','B11','B15')`,
          [r.desde, r.hasta],
        );
        const cobrado = Number(ventas[0]?.t ?? 0);
        const deducible = Number(ded[0]?.t ?? 0);
        return {
          metrica: `ITBIS a depositar ${r.label}`,
          tipo: 'monto',
          total: Math.max(0, cobrado - deducible),
          cobrado,
          deducible,
          periodo: r,
        };
      }

      case 'cuentas_por_cobrar': {
        const rows: any[] = await this.ds.query(
          `SELECT COUNT(*) AS cantidad, COALESCE(SUM(saldo_pendiente),0) AS total
           FROM facturas
           WHERE saldo_pendiente > 0
             AND estado NOT IN ('anulada','pagada')
             AND tipo_ncf != 'PROFORMA'`,
        );
        return {
          metrica: 'Cuentas por cobrar (saldo total)',
          tipo: 'monto',
          total: Number(rows[0]?.total ?? 0),
          cantidad: Number(rows[0]?.cantidad ?? 0),
        };
      }

      default:
        throw new BadRequestException(`Métrica desconocida: ${m}`);
    }
  }

  // ─── Crear gasto por texto (sin foto/OCR) ───────────────────────────────
  async crearGastoTexto(data: {
    tipo?: 'formal' | 'informal' | 'personal';
    monto?: number;
    fecha?: string;
    categoria?: string;
    descripcion?: string;
    proveedor?: string;
    rnc?: string;
    ncf?: string;
    registrado_por_id: number;
    registrado_por_nombre: string;
  }) {
    if (!data.monto || data.monto <= 0) {
      throw new BadRequestException('Falta el monto');
    }
    return this.gastosSvc.crear({
      tipo:                  data.tipo ?? 'informal',
      fecha:                 data.fecha || new Date().toISOString().slice(0, 10),
      monto:                 Number(data.monto),
      descripcion:           data.descripcion,
      categoria:             data.categoria,
      proveedor:             data.proveedor,
      rnc:                   data.rnc,
      ncf:                   data.ncf,
      registrado_por_id:     data.registrado_por_id,
      registrado_por_nombre: data.registrado_por_nombre,
    });
  }

  // ─── Determinar NCF default según tipo de cliente ───────────────────────
  private ncfDefault(cliente: any): TipoComprobante {
    const rnc = (cliente?.documento || '').replace(/[^0-9]/g, '');
    // Empresa con RNC válido (9 dígitos) → B01 (crédito fiscal)
    if (cliente?.tipo === 'empresa' && rnc.length === 9) return TipoComprobante.B01;
    // Default → B02 (consumidor final)
    return TipoComprobante.B02;
  }

  // ─── Facturar (preview o ejecución real) ────────────────────────────────
  async facturar(data: {
    orden_id?:    number;
    orden_numero?: string;
    cliente_id?:  number;
    items?: Array<{
      descripcion: string;
      cantidad?: number;
      precio_unitario?: number;
      tecnica?: string;
    }>;
    tipo_ncf?:     string;
    metodo_pago?:  string;
    notas?:        string;
    preview?:      boolean;
    creado_por?:   string;
  }) {
    // 1. Resolver orden + cliente
    let orden: any = null;
    let cliente: any = null;
    let lineas: any[] = [];

    if (data.orden_numero || data.orden_id) {
      // Facturar desde orden existente
      const where = data.orden_id ? `id = ${Number(data.orden_id)}` : `numero = '${data.orden_numero?.replace(/'/g, '')}'`;
      const rows: any[] = await this.ds.query(
        `SELECT o.*, c.id AS c_id, c.nombre AS c_nombre, c.documento AS c_documento,
                c.tipo AS c_tipo, c.telefono AS c_telefono, c.email AS c_email,
                c.direccion AS c_direccion
         FROM ordenes_produccion o
         LEFT JOIN clientes c ON c.id = o.cliente_id
         WHERE ${where} LIMIT 1`,
      );
      if (rows.length === 0) {
        throw new BadRequestException(`No encontré la orden ${data.orden_numero || data.orden_id}`);
      }
      orden = rows[0];
      cliente = {
        id: orden.c_id,
        nombre: orden.c_nombre,
        documento: orden.c_documento,
        tipo: orden.c_tipo,
        telefono: orden.c_telefono,
        email: orden.c_email,
        direccion: orden.c_direccion,
      };

      // Verificar si ya tiene factura no anulada
      const facturasExistentes: any[] = await this.ds.query(
        `SELECT numero, estado, ncf FROM facturas
         WHERE orden_produccion_id = ? AND estado != 'anulada' LIMIT 1`,
        [orden.id],
      );
      if (facturasExistentes.length > 0) {
        const f = facturasExistentes[0];
        throw new BadRequestException(
          `Esa orden ya tiene factura: ${f.numero} (NCF ${f.ncf || 'sin asignar'}, estado: ${f.estado}). ` +
          `Anúlala primero si quieres re-facturarla.`,
        );
      }

      // Obtener líneas de producción de la orden
      const lp = typeof orden.lineas_produccion === 'string'
        ? JSON.parse(orden.lineas_produccion)
        : orden.lineas_produccion;
      if (!lp || !Array.isArray(lp) || lp.length === 0) {
        throw new BadRequestException('Esa orden no tiene líneas de producción para facturar');
      }
      lineas = lp.map((l: any) => ({
        descripcion:     [l.producto, l.descripcion].filter(Boolean).join(' · '),
        cantidad:        Number(l.cantidad ?? 1),
        precio_unitario: Number(l.precio ?? 0),
        itbis_pct:       18,
      }));

    } else if (data.cliente_id && data.items && data.items.length > 0) {
      // Facturar directo a cliente + items
      cliente = await this.clientesSvc.findOne(data.cliente_id);
      lineas = data.items.map(it => ({
        descripcion:     it.descripcion || '—',
        cantidad:        Number(it.cantidad ?? 1),
        precio_unitario: Number(it.precio_unitario ?? 0),
        itbis_pct:       18,
      }));
    } else {
      throw new BadRequestException('Debe indicar orden_numero/id o cliente_id + items');
    }

    // 2. Determinar tipo NCF
    let tipoNcf = (data.tipo_ncf || '').toUpperCase() as TipoComprobante;
    if (!Object.values(TipoComprobante).includes(tipoNcf)) {
      tipoNcf = this.ncfDefault(cliente);
    }

    // 3. Calcular totales (para preview)
    const subtotal = lineas.reduce((s, l) => s + l.cantidad * l.precio_unitario, 0);
    const itbis    = subtotal * 0.18;
    const total    = subtotal + itbis;

    // 4. Si es preview, NO crear factura — solo devolver lo que pasaría
    if (data.preview) {
      // Buscar el siguiente NCF que se asignaría (sin consumir secuencia)
      let proximo_ncf: string | null = null;
      try {
        const r = await this.ds.query(
          `SELECT siguiente FROM ncf_secuencias WHERE tipo = ? AND activa = 1 LIMIT 1`,
          [tipoNcf],
        );
        if (r.length > 0) {
          proximo_ncf = `${tipoNcf.replace('B', 'B0')}${String(r[0].siguiente).padStart(8, '0')}`;
        }
      } catch {}

      return {
        preview:    true,
        cliente,
        orden_numero: orden?.numero,
        tipo_ncf:   tipoNcf,
        proximo_ncf,
        lineas,
        subtotal,
        itbis,
        total,
      };
    }

    // 5. CREACIÓN REAL — usar FacturacionService
    const factura = await this.facturacionSvc.crear({
      tipo_ncf:            tipoNcf,
      orden_produccion_id: orden?.id,
      cliente_id:          cliente?.id,
      cliente_nombre:      cliente?.nombre,
      cliente_rnc:         cliente?.documento,
      cliente_direccion:   cliente?.direccion,
      cliente_telefono:    cliente?.telefono,
      metodo_pago:         (data.metodo_pago as MetodoPago) || undefined,
      creado_por:          data.creado_por,
      notas:               data.notas,
      lineas,
    });

    return {
      preview: false,
      factura,
      cliente,
    };
  }

  // ── Reporte mensual para el bot (portado del dist del VPS el 6 sep 2026) ──
  async botReporteMensual(mes?: string) {
    const ahora = new Date();
    let yyyymm = mes;
    if (!yyyymm || !/^\d{4}-\d{2}$/.test(yyyymm)) {
      yyyymm = ahora.getFullYear() + '-' + String(ahora.getMonth() + 1).padStart(2, '0');
    }
    const [y, m] = yyyymm.split('-').map(Number);
    const desde = `${y}-${String(m).padStart(2, '0')}-01`;
    const ultimo = new Date(y, m, 0).getDate();
    const hasta = `${y}-${String(m).padStart(2, '0')}-${String(ultimo).padStart(2, '0')}`;
    const hastaInclusive = hasta + ' 23:59:59';

    const [vol] = await this.ds.query(`
        SELECT
          (SELECT COUNT(*) FROM cotizaciones WHERE creado_en BETWEEN ? AND ?) AS cotizaciones,
          (SELECT COUNT(*) FROM ordenes_produccion WHERE creado_en BETWEEN ? AND ?) AS ordenes,
          (SELECT COUNT(*) FROM facturas WHERE fecha_emision BETWEEN ? AND ? AND estado != 'anulada') AS facturas_emitidas,
          (SELECT COUNT(*) FROM facturas WHERE fecha_emision BETWEEN ? AND ? AND estado = 'anulada') AS facturas_anuladas,
          (SELECT COUNT(*) FROM recibos_ingreso WHERE fecha BETWEEN ? AND ?) AS recibos,
          (SELECT COUNT(*) FROM clientes WHERE creado_en BETWEEN ? AND ?) AS clientes_nuevos
    `, [desde, hastaInclusive, desde, hastaInclusive, desde, hastaInclusive, desde, hastaInclusive, desde, hasta, desde, hastaInclusive]);

    const [ing] = await this.ds.query(`
        SELECT ROUND(COALESCE(SUM(monto),0),2) AS total, COUNT(*) AS recibos,
          ROUND(COALESCE(SUM(IF(metodo='efectivo',monto,0)),0),2) AS efectivo,
          ROUND(COALESCE(SUM(IF(metodo='transferencia',monto,0)),0),2) AS transferencia,
          ROUND(COALESCE(SUM(IF(metodo='tarjeta',monto,0)),0),2) AS tarjeta,
          ROUND(COALESCE(SUM(IF(metodo='cheque',monto,0)),0),2) AS cheque
        FROM recibos_ingreso WHERE fecha BETWEEN ? AND ?
    `, [desde, hasta]);

    const [saldo] = await this.ds.query(`
        SELECT ROUND(COALESCE(SUM(total - total_pagado),0),2) AS monto, COUNT(*) AS facturas
        FROM facturas WHERE estado IN ('emitida','parcial','credito') AND fecha_emision <= ?
    `, [hastaInclusive]);

    const estados = await this.ds.query(`
        SELECT estado, COUNT(*) AS cant FROM ordenes_produccion
        WHERE creado_en BETWEEN ? AND ? GROUP BY estado ORDER BY cant DESC
    `, [desde, hastaInclusive]);

    const [atras] = await this.ds.query(`
        SELECT COUNT(*) AS cant FROM ordenes_produccion
        WHERE estado IN ('pendiente','en_diseno','en_produccion','en_terminacion','atraso')
          AND fecha_comprometida < CURDATE() AND creado_en BETWEEN ? AND ?
    `, [desde, hastaInclusive]);

    const topClientes = await this.ds.query(`
        SELECT cl.nombre, COUNT(o.id) AS ordenes, ROUND(COALESCE(SUM(cot.total),0),2) AS cotizado
        FROM ordenes_produccion o
        LEFT JOIN cotizaciones cot ON cot.id = o.cotizacion_id
        LEFT JOIN clientes cl ON cl.id = o.cliente_id
        WHERE o.creado_en BETWEEN ? AND ?
        GROUP BY cl.id, cl.nombre HAVING cotizado > 0
        ORDER BY cotizado DESC LIMIT 5
    `, [desde, hastaInclusive]);

    const gastos = await this.ds.query(`
        SELECT tipo, COUNT(*) AS cant, ROUND(COALESCE(SUM(monto),0),2) AS total
        FROM gastos WHERE fecha BETWEEN ? AND ? GROUP BY tipo
    `, [desde, hasta]);

    return {
      mes: yyyymm, rango: { desde, hasta },
      volumen: vol, ingresos: ing, saldo_pendiente: saldo,
      ordenes_por_estado: estados, atrasadas: atras.cant,
      top_clientes: topClientes, gastos: { por_tipo: gastos },
    };
  }

  async botAdminsChatIds() {
    // Destinatarios de avisos: los marcados en Ajustes → Bot de Telegram; si no hay, los admin vinculados
    return this.telegram.chatsParaAvisos();
  }
}
