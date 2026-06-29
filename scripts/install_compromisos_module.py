"""Crea el módulo `compromisos` desde cero en el dist."""
import os, sys

BASE = '/home/u372536694/apps/api/dist'
DIR = f'{BASE}/compromisos'
os.makedirs(DIR, exist_ok=True)

# Usamos triple comilla simple para encerrar los strings JS y evitar escapes
SERVICE = """'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.CompromisosService = void 0;
const common_1 = require("@nestjs/common");
const typeorm_2 = require("typeorm");
const __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
const __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};

let CompromisosService = class CompromisosService {
  constructor(ds) {
    this.ds = ds;
  }

  async listar() {
    return this.ds.query(`SELECT * FROM compromisos_recurrentes ORDER BY activo DESC, nombre ASC`);
  }

  async obtener(id) {
    const [c] = await this.ds.query(`SELECT * FROM compromisos_recurrentes WHERE id = ?`, [id]);
    if (!c) throw new common_1.NotFoundException(`Compromiso #${id} no encontrado`);
    return c;
  }

  async crear(dto) {
    if (!dto.nombre) throw new common_1.BadRequestException('Nombre es requerido');
    if (!dto.frecuencia) throw new common_1.BadRequestException('Frecuencia es requerida');
    const r = await this.ds.query(`
      INSERT INTO compromisos_recurrentes
        (nombre, categoria, clasificacion_contable, monto_estimado, frecuencia,
         dia_vencimiento, proveedor, descripcion, metodo_pago_default, cuenta_banco_id,
         recordar_dias_antes, activo, fecha_inicio, fecha_fin, creado_por)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `, [
      dto.nombre,
      dto.categoria || 'otros',
      dto.clasificacion_contable === 'costo' ? 'costo' : 'gasto',
      Number(dto.monto_estimado) || 0,
      dto.frecuencia,
      dto.dia_vencimiento != null ? Number(dto.dia_vencimiento) : null,
      dto.proveedor || null,
      dto.descripcion || null,
      dto.metodo_pago_default || null,
      dto.cuenta_banco_id || null,
      Number(dto.recordar_dias_antes) || 5,
      dto.activo === false ? 0 : 1,
      dto.fecha_inicio || null,
      dto.fecha_fin || null,
      dto.creado_por || null,
    ]);
    const id = r.insertId;
    await this.regenerarOcurrencias(id);
    return this.obtener(id);
  }

  async actualizar(id, dto) {
    await this.obtener(id);
    const campos = ['nombre','categoria','clasificacion_contable','monto_estimado',
      'frecuencia','dia_vencimiento','proveedor','descripcion','metodo_pago_default',
      'cuenta_banco_id','recordar_dias_antes','activo','fecha_inicio','fecha_fin'];
    const sets = [];
    const params = [];
    for (const k of campos) {
      if (dto[k] !== undefined) {
        sets.push(`\\`${k}\\` = ?`);
        let v = dto[k];
        if (k === 'activo') v = v === false || v === 0 ? 0 : 1;
        if (k === 'clasificacion_contable') v = v === 'costo' ? 'costo' : 'gasto';
        if (v === '') v = null;
        params.push(v);
      }
    }
    if (sets.length) {
      params.push(id);
      await this.ds.query(`UPDATE compromisos_recurrentes SET ${sets.join(', ')} WHERE id = ?`, params);
    }
    await this.regenerarOcurrencias(id);
    return this.obtener(id);
  }

  async eliminar(id) {
    await this.obtener(id);
    await this.ds.query(`UPDATE compromisos_recurrentes SET activo = 0 WHERE id = ?`, [id]);
    await this.ds.query(`
      UPDATE compromisos_ocurrencias
      SET estado = 'cancelado'
      WHERE compromiso_id = ? AND estado = 'pendiente' AND fecha_vencimiento >= CURDATE()
    `, [id]);
    return { ok: true };
  }

  async regenerarOcurrencias(compromisoId) {
    const c = await this.obtener(compromisoId);
    if (!c.activo) return;
    await this.ds.query(`
      DELETE FROM compromisos_ocurrencias
      WHERE compromiso_id = ? AND estado = 'pendiente' AND fecha_vencimiento >= CURDATE()
    `, [compromisoId]);
    const fechas = this.generarFechas(c);
    if (!fechas.length) return;
    const values = fechas.map(() => '(?,?,?)').join(',');
    const params = [];
    for (const f of fechas) {
      params.push(compromisoId, f, Number(c.monto_estimado) || 0);
    }
    await this.ds.query(`
      INSERT IGNORE INTO compromisos_ocurrencias (compromiso_id, fecha_vencimiento, monto_estimado)
      VALUES ${values}
    `, params);
  }

  generarFechas(c) {
    const fechas = [];
    const hoy = new Date();
    hoy.setHours(0,0,0,0);
    const inicio = c.fecha_inicio ? new Date(c.fecha_inicio + 'T00:00:00') : hoy;
    const limite = c.fecha_fin ? new Date(c.fecha_fin + 'T00:00:00') : new Date(hoy.getFullYear()+1, hoy.getMonth(), hoy.getDate());
    const desde = inicio < hoy ? hoy : inicio;
    const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    const dia = c.dia_vencimiento != null ? Number(c.dia_vencimiento) : null;

    if (c.frecuencia === 'mensual') {
      let cur = new Date(desde.getFullYear(), desde.getMonth(), 1);
      while (cur <= limite) {
        const ultDia = new Date(cur.getFullYear(), cur.getMonth()+1, 0).getDate();
        const d = Math.min(dia || 1, ultDia);
        const fecha = new Date(cur.getFullYear(), cur.getMonth(), d);
        if (fecha >= desde && fecha <= limite) fechas.push(fmt(fecha));
        cur.setMonth(cur.getMonth()+1);
      }
    } else if (c.frecuencia === 'quincenal') {
      let cur = new Date(desde.getFullYear(), desde.getMonth(), 1);
      const dias = dia ? [dia, dia+15 > 28 ? 15 : dia+15] : [1, 15];
      while (cur <= limite) {
        const ultDia = new Date(cur.getFullYear(), cur.getMonth()+1, 0).getDate();
        for (const dd of dias) {
          const d = Math.min(dd, ultDia);
          const fecha = new Date(cur.getFullYear(), cur.getMonth(), d);
          if (fecha >= desde && fecha <= limite) fechas.push(fmt(fecha));
        }
        cur.setMonth(cur.getMonth()+1);
      }
    } else if (c.frecuencia === 'semanal') {
      const dow = dia != null ? dia : 5;
      const cur = new Date(desde);
      while (cur.getDay() !== dow) cur.setDate(cur.getDate()+1);
      while (cur <= limite) {
        fechas.push(fmt(cur));
        cur.setDate(cur.getDate()+7);
      }
    } else if (c.frecuencia === 'bimensual') {
      let cur = new Date(desde.getFullYear(), desde.getMonth(), 1);
      while (cur <= limite) {
        const ultDia = new Date(cur.getFullYear(), cur.getMonth()+1, 0).getDate();
        const d = Math.min(dia || 1, ultDia);
        const fecha = new Date(cur.getFullYear(), cur.getMonth(), d);
        if (fecha >= desde && fecha <= limite) fechas.push(fmt(fecha));
        cur.setMonth(cur.getMonth()+2);
      }
    } else if (c.frecuencia === 'trimestral') {
      let cur = new Date(desde.getFullYear(), desde.getMonth(), 1);
      while (cur <= limite) {
        const ultDia = new Date(cur.getFullYear(), cur.getMonth()+1, 0).getDate();
        const d = Math.min(dia || 1, ultDia);
        const fecha = new Date(cur.getFullYear(), cur.getMonth(), d);
        if (fecha >= desde && fecha <= limite) fechas.push(fmt(fecha));
        cur.setMonth(cur.getMonth()+3);
      }
    } else if (c.frecuencia === 'anual') {
      const cur = new Date(inicio);
      while (cur <= limite) {
        if (cur >= desde) fechas.push(fmt(cur));
        cur.setFullYear(cur.getFullYear()+1);
      }
    } else if (c.frecuencia === 'unica') {
      if (inicio >= desde && inicio <= limite) fechas.push(fmt(inicio));
    }
    return fechas;
  }

  async calendario(desde, hasta) {
    if (!desde || !hasta) {
      const hoy = new Date();
      const ini = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
      const fin = new Date(hoy.getFullYear(), hoy.getMonth()+2, 0);
      desde = ini.toISOString().slice(0,10);
      hasta = fin.toISOString().slice(0,10);
    }
    return this.ds.query(`
      SELECT
        o.id, o.compromiso_id, o.fecha_vencimiento, o.monto_estimado, o.monto_pagado,
        o.estado, o.fecha_pago, o.metodo_pago, o.gasto_id, o.egreso_id, o.notas, o.pagado_por,
        c.nombre, c.categoria, c.clasificacion_contable, c.proveedor, c.recordar_dias_antes
      FROM compromisos_ocurrencias o
      JOIN compromisos_recurrentes c ON c.id = o.compromiso_id
      WHERE o.fecha_vencimiento BETWEEN ? AND ?
      ORDER BY o.fecha_vencimiento ASC, c.nombre ASC
    `, [desde, hasta]);
  }

  async alertas() {
    const vencidas = await this.ds.query(`
      SELECT o.*, c.nombre, c.categoria, c.proveedor, c.recordar_dias_antes
      FROM compromisos_ocurrencias o
      JOIN compromisos_recurrentes c ON c.id = o.compromiso_id
      WHERE o.estado = 'pendiente' AND o.fecha_vencimiento < CURDATE() AND c.activo = 1
      ORDER BY o.fecha_vencimiento ASC
    `);
    const proximas = await this.ds.query(`
      SELECT o.*, c.nombre, c.categoria, c.proveedor, c.recordar_dias_antes
      FROM compromisos_ocurrencias o
      JOIN compromisos_recurrentes c ON c.id = o.compromiso_id
      WHERE o.estado = 'pendiente'
        AND o.fecha_vencimiento >= CURDATE()
        AND o.fecha_vencimiento <= DATE_ADD(CURDATE(), INTERVAL c.recordar_dias_antes DAY)
        AND c.activo = 1
      ORDER BY o.fecha_vencimiento ASC
    `);
    return { vencidas, proximas };
  }

  async marcarPagada(ocurrenciaId, dto) {
    const [oc] = await this.ds.query(`
      SELECT o.*, c.nombre, c.categoria, c.clasificacion_contable, c.proveedor
      FROM compromisos_ocurrencias o
      JOIN compromisos_recurrentes c ON c.id = o.compromiso_id
      WHERE o.id = ?
    `, [ocurrenciaId]);
    if (!oc) throw new common_1.NotFoundException(`Ocurrencia #${ocurrenciaId} no encontrada`);
    if (oc.estado === 'pagado') throw new common_1.BadRequestException('Este compromiso ya fue pagado');

    const monto = Number(dto.monto_pagado);
    if (!monto || monto <= 0) throw new common_1.BadRequestException('Monto pagado debe ser mayor a 0');

    const fechaPago = dto.fecha_pago || new Date().toISOString().slice(0,10);
    const metodo = dto.metodo_pago || 'efectivo';
    const usuarioId = dto.usuario_id || null;
    const usuarioNombre = dto.usuario_nombre || 'Sistema';

    let gastoId = null;
    let egresoId = null;

    if (metodo === 'efectivo') {
      const r = await this.ds.query(`
        INSERT INTO egresos_caja
          (fecha, monto, destinatario, categoria, comentario, registrado_por,
           sesion_caja_id, clasificacion_contable)
        VALUES (?,?,?,?,?,?,
          (SELECT id FROM sesiones_caja WHERE estado='abierta' AND usuario_nombre = ? ORDER BY id DESC LIMIT 1),
          ?)
      `, [
        fechaPago,
        monto,
        oc.proveedor || oc.nombre,
        oc.categoria || 'otros',
        `Pago de compromiso: ${oc.nombre}`,
        usuarioNombre,
        usuarioNombre,
        oc.clasificacion_contable,
      ]);
      egresoId = r.insertId;
    } else {
      const r = await this.ds.query(`
        INSERT INTO gastos
          (tipo, clasificacion_contable, fecha, monto, descripcion, categoria, proveedor,
           metodo_pago, registrado_por_id, registrado_por_nombre, estado, notas)
        VALUES ('informal', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'registrado', ?)
      `, [
        oc.clasificacion_contable,
        fechaPago,
        monto,
        `Pago de compromiso: ${oc.nombre}`,
        oc.categoria || 'Otros',
        oc.proveedor || null,
        metodo,
        usuarioId || 1,
        usuarioNombre,
        dto.notas || null,
      ]);
      gastoId = r.insertId;
    }

    await this.ds.query(`
      UPDATE compromisos_ocurrencias
      SET estado='pagado', monto_pagado=?, fecha_pago=?, metodo_pago=?, referencia=?,
          gasto_id=?, egreso_id=?, notas=?, pagado_por=?
      WHERE id = ?
    `, [
      monto, fechaPago, metodo, dto.referencia || null,
      gastoId, egresoId, dto.notas || null, usuarioNombre,
      ocurrenciaId
    ]);

    return { ok: true, gasto_id: gastoId, egreso_id: egresoId, monto, estado: 'pagado' };
  }

  async deshacerPago(ocurrenciaId) {
    const [oc] = await this.ds.query(`SELECT * FROM compromisos_ocurrencias WHERE id = ?`, [ocurrenciaId]);
    if (!oc) throw new common_1.NotFoundException(`Ocurrencia #${ocurrenciaId} no encontrada`);
    if (oc.estado !== 'pagado') throw new common_1.BadRequestException('No está marcado como pagado');
    if (oc.gasto_id) await this.ds.query(`DELETE FROM gastos WHERE id = ?`, [oc.gasto_id]);
    if (oc.egreso_id) await this.ds.query(`DELETE FROM egresos_caja WHERE id = ?`, [oc.egreso_id]);
    await this.ds.query(`
      UPDATE compromisos_ocurrencias
      SET estado='pendiente', monto_pagado=NULL, fecha_pago=NULL, metodo_pago=NULL,
          gasto_id=NULL, egreso_id=NULL, pagado_por=NULL
      WHERE id = ?
    `, [ocurrenciaId]);
    return { ok: true };
  }

  async cancelarOcurrencia(ocurrenciaId, motivo) {
    await this.ds.query(`
      UPDATE compromisos_ocurrencias
      SET estado='cancelado', notas = CONCAT(IFNULL(notas,''), CHAR(10), 'Cancelada: ', ?)
      WHERE id = ? AND estado = 'pendiente'
    `, [motivo || 'sin motivo', ocurrenciaId]);
    return { ok: true };
  }
};

CompromisosService = __decorate([
  (0, common_1.Injectable)(),
  __metadata("design:paramtypes", [typeorm_2.DataSource])
], CompromisosService);

exports.CompromisosService = CompromisosService;
"""

CONTROLLER = """'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.CompromisosController = void 0;
const common_1 = require("@nestjs/common");
const compromisos_service_1 = require("./compromisos.service");
const guards_1 = require("../common/guards");
const decorators_1 = require("../common/decorators");
const usuario_entity_1 = require("../auth/entities/usuario.entity");

const __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
const __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
const __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); };
};

let CompromisosController = class CompromisosController {
  constructor(svc) { this.svc = svc; }
  listar() { return this.svc.listar(); }
  obtener(id) { return this.svc.obtener(id); }
  crear(body, user) {
    return this.svc.crear({ ...body, creado_por: user && user.nombre });
  }
  actualizar(id, body) { return this.svc.actualizar(id, body); }
  eliminar(id) { return this.svc.eliminar(id); }
  calendario(desde, hasta) { return this.svc.calendario(desde, hasta); }
  alertas() { return this.svc.alertas(); }
  marcarPagada(id, body, user) {
    return this.svc.marcarPagada(id, {
      ...body,
      usuario_id: user && user.id,
      usuario_nombre: user && user.nombre,
    });
  }
  deshacerPago(id) { return this.svc.deshacerPago(id); }
  cancelarOcurrencia(id, body) { return this.svc.cancelarOcurrencia(id, body && body.motivo); }
};

__decorate([(0, common_1.Get)(), __metadata("design:type", Function), __metadata("design:paramtypes", []), __metadata("design:returntype", void 0)], CompromisosController.prototype, "listar", null);
__decorate([(0, common_1.Get)('alertas'), __metadata("design:type", Function), __metadata("design:paramtypes", []), __metadata("design:returntype", void 0)], CompromisosController.prototype, "alertas", null);
__decorate([(0, common_1.Get)('calendario'),
  __param(0, (0, common_1.Query)('desde')),
  __param(1, (0, common_1.Query)('hasta')),
  __metadata("design:type", Function),
  __metadata("design:paramtypes", [String, String]),
  __metadata("design:returntype", void 0)
], CompromisosController.prototype, "calendario", null);
__decorate([(0, common_1.Get)(':id'),
  __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
  __metadata("design:type", Function),
  __metadata("design:paramtypes", [Number]),
  __metadata("design:returntype", void 0)
], CompromisosController.prototype, "obtener", null);
__decorate([(0, common_1.Post)(),
  (0, common_1.UseGuards)(guards_1.RolesGuard),
  (0, decorators_1.Roles)(usuario_entity_1.RolUsuario.ADMIN, usuario_entity_1.RolUsuario.SUPERVISOR),
  __param(0, (0, common_1.Body)()),
  __param(1, (0, decorators_1.CurrentUser)()),
  __metadata("design:type", Function),
  __metadata("design:paramtypes", [Object, Object]),
  __metadata("design:returntype", void 0)
], CompromisosController.prototype, "crear", null);
__decorate([(0, common_1.Put)(':id'),
  (0, common_1.UseGuards)(guards_1.RolesGuard),
  (0, decorators_1.Roles)(usuario_entity_1.RolUsuario.ADMIN, usuario_entity_1.RolUsuario.SUPERVISOR),
  __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
  __param(1, (0, common_1.Body)()),
  __metadata("design:type", Function),
  __metadata("design:paramtypes", [Number, Object]),
  __metadata("design:returntype", void 0)
], CompromisosController.prototype, "actualizar", null);
__decorate([(0, common_1.Delete)(':id'),
  (0, common_1.UseGuards)(guards_1.RolesGuard),
  (0, decorators_1.Roles)(usuario_entity_1.RolUsuario.ADMIN, usuario_entity_1.RolUsuario.SUPERVISOR),
  __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
  __metadata("design:type", Function),
  __metadata("design:paramtypes", [Number]),
  __metadata("design:returntype", void 0)
], CompromisosController.prototype, "eliminar", null);
__decorate([(0, common_1.Post)('ocurrencias/:id/pagar'),
  (0, common_1.UseGuards)(guards_1.RolesGuard),
  (0, decorators_1.Roles)(usuario_entity_1.RolUsuario.ADMIN, usuario_entity_1.RolUsuario.SUPERVISOR),
  __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
  __param(1, (0, common_1.Body)()),
  __param(2, (0, decorators_1.CurrentUser)()),
  __metadata("design:type", Function),
  __metadata("design:paramtypes", [Number, Object, Object]),
  __metadata("design:returntype", void 0)
], CompromisosController.prototype, "marcarPagada", null);
__decorate([(0, common_1.Post)('ocurrencias/:id/deshacer'),
  (0, common_1.UseGuards)(guards_1.RolesGuard),
  (0, decorators_1.Roles)(usuario_entity_1.RolUsuario.ADMIN),
  __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
  __metadata("design:type", Function),
  __metadata("design:paramtypes", [Number]),
  __metadata("design:returntype", void 0)
], CompromisosController.prototype, "deshacerPago", null);
__decorate([(0, common_1.Post)('ocurrencias/:id/cancelar'),
  (0, common_1.UseGuards)(guards_1.RolesGuard),
  (0, decorators_1.Roles)(usuario_entity_1.RolUsuario.ADMIN, usuario_entity_1.RolUsuario.SUPERVISOR),
  __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
  __param(1, (0, common_1.Body)()),
  __metadata("design:type", Function),
  __metadata("design:paramtypes", [Number, Object]),
  __metadata("design:returntype", void 0)
], CompromisosController.prototype, "cancelarOcurrencia", null);

exports.CompromisosController = CompromisosController = __decorate([
  (0, common_1.Controller)('compromisos'),
  (0, common_1.UseGuards)(guards_1.JwtAuthGuard),
  __metadata("design:paramtypes", [compromisos_service_1.CompromisosService])
], CompromisosController);
"""

MODULE = """'use strict';
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CompromisosModule = void 0;
const common_1 = require("@nestjs/common");
const compromisos_service_1 = require("./compromisos.service");
const compromisos_controller_1 = require("./compromisos.controller");

let CompromisosModule = class CompromisosModule {};
exports.CompromisosModule = CompromisosModule;
exports.CompromisosModule = CompromisosModule = __decorate([
    (0, common_1.Module)({
        providers: [compromisos_service_1.CompromisosService],
        controllers: [compromisos_controller_1.CompromisosController],
        exports: [compromisos_service_1.CompromisosService],
    })
], CompromisosModule);
"""

open(f'{DIR}/compromisos.service.js', 'w').write(SERVICE)
open(f'{DIR}/compromisos.controller.js', 'w').write(CONTROLLER)
open(f'{DIR}/compromisos.module.js', 'w').write(MODULE)
print(f'OK: 3 archivos creados en {DIR}')

# Registrar en app.module.js
APP = f'{BASE}/app.module.js'
a = open(APP).read()
if 'compromisos_module' in a:
    print('app.module.js ya tiene compromisos.')
else:
    old_req = 'const gastos_module_1 = require("./gastos/gastos.module");'
    new_req = old_req + '\nconst compromisos_module_1 = require("./compromisos/compromisos.module");'
    if old_req not in a:
        print('ERROR: require de gastos no encontrado'); sys.exit(1)
    a = a.replace(old_req, new_req, 1)

    old_imp = 'gastos_module_1.GastosModule,'
    new_imp = old_imp + '\n            compromisos_module_1.CompromisosModule,'
    if old_imp not in a:
        print('ERROR: GastosModule no encontrado en lista'); sys.exit(1)
    a = a.replace(old_imp, new_imp, 1)
    open(APP, 'w').write(a)
    print('app.module.js actualizado.')

print('OK: módulo compromisos registrado.')
