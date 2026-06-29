"""Reescribe el controller con el endpoint /bot/pagar siguiendo el patron
de asistente.controller (Headers x-bot-secret + helper validarBotSecret).
"""

CTRL = '/home/u372536694/apps/api/dist/compromisos/compromisos.controller.js'

contenido = """'use strict';
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

function validarBotSecret(secret) {
  const expected = process.env.TELEGRAM_BOT_SHARED_SECRET;
  if (!expected || secret !== expected) {
    throw new common_1.UnauthorizedException('Bot secret invalido');
  }
}

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
  async botPagar(secret, body) {
    validarBotSecret(secret);
    return this.svc.pagarPorBot(body && body.texto, body && body.chat_id);
  }
};

// GET /compromisos
__decorate([
  (0, common_1.UseGuards)(guards_1.JwtAuthGuard),
  (0, common_1.Get)(),
  __metadata("design:type", Function),
  __metadata("design:paramtypes", []),
  __metadata("design:returntype", void 0)
], CompromisosController.prototype, "listar", null);

// GET /compromisos/calendario (debe ir ANTES de :id)
__decorate([
  (0, common_1.UseGuards)(guards_1.JwtAuthGuard),
  (0, common_1.Get)('calendario'),
  __param(0, (0, common_1.Query)('desde')),
  __param(1, (0, common_1.Query)('hasta')),
  __metadata("design:type", Function),
  __metadata("design:paramtypes", [String, String]),
  __metadata("design:returntype", void 0)
], CompromisosController.prototype, "calendario", null);

// GET /compromisos/alertas
__decorate([
  (0, common_1.UseGuards)(guards_1.JwtAuthGuard),
  (0, common_1.Get)('alertas'),
  __metadata("design:type", Function),
  __metadata("design:paramtypes", []),
  __metadata("design:returntype", void 0)
], CompromisosController.prototype, "alertas", null);

// GET /compromisos/:id (solo numerico)
__decorate([
  (0, common_1.UseGuards)(guards_1.JwtAuthGuard),
  (0, common_1.Get)(':id(\\\\d+)'),
  __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
  __metadata("design:type", Function),
  __metadata("design:paramtypes", [Number]),
  __metadata("design:returntype", void 0)
], CompromisosController.prototype, "obtener", null);

// POST /compromisos
__decorate([
  (0, common_1.UseGuards)(guards_1.JwtAuthGuard, guards_1.RolesGuard),
  (0, decorators_1.Roles)(usuario_entity_1.RolUsuario.ADMIN, usuario_entity_1.RolUsuario.SUPERVISOR),
  (0, common_1.Post)(),
  __param(0, (0, common_1.Body)()),
  __param(1, (0, decorators_1.CurrentUser)()),
  __metadata("design:type", Function),
  __metadata("design:paramtypes", [Object, Object]),
  __metadata("design:returntype", void 0)
], CompromisosController.prototype, "crear", null);

// PUT /compromisos/:id (solo numerico)
__decorate([
  (0, common_1.UseGuards)(guards_1.JwtAuthGuard, guards_1.RolesGuard),
  (0, decorators_1.Roles)(usuario_entity_1.RolUsuario.ADMIN, usuario_entity_1.RolUsuario.SUPERVISOR),
  (0, common_1.Put)(':id(\\\\d+)'),
  __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
  __param(1, (0, common_1.Body)()),
  __metadata("design:type", Function),
  __metadata("design:paramtypes", [Number, Object]),
  __metadata("design:returntype", void 0)
], CompromisosController.prototype, "actualizar", null);

// DELETE /compromisos/:id (solo numerico)
__decorate([
  (0, common_1.UseGuards)(guards_1.JwtAuthGuard, guards_1.RolesGuard),
  (0, decorators_1.Roles)(usuario_entity_1.RolUsuario.ADMIN, usuario_entity_1.RolUsuario.SUPERVISOR),
  (0, common_1.Delete)(':id(\\\\d+)'),
  __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
  __metadata("design:type", Function),
  __metadata("design:paramtypes", [Number]),
  __metadata("design:returntype", void 0)
], CompromisosController.prototype, "eliminar", null);

// POST /compromisos/ocurrencias/:id/pagar
__decorate([
  (0, common_1.UseGuards)(guards_1.JwtAuthGuard, guards_1.RolesGuard),
  (0, decorators_1.Roles)(usuario_entity_1.RolUsuario.ADMIN, usuario_entity_1.RolUsuario.SUPERVISOR),
  (0, common_1.Post)('ocurrencias/:id/pagar'),
  __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
  __param(1, (0, common_1.Body)()),
  __param(2, (0, decorators_1.CurrentUser)()),
  __metadata("design:type", Function),
  __metadata("design:paramtypes", [Number, Object, Object]),
  __metadata("design:returntype", void 0)
], CompromisosController.prototype, "marcarPagada", null);

// POST /compromisos/ocurrencias/:id/deshacer
__decorate([
  (0, common_1.UseGuards)(guards_1.JwtAuthGuard, guards_1.RolesGuard),
  (0, decorators_1.Roles)(usuario_entity_1.RolUsuario.ADMIN),
  (0, common_1.Post)('ocurrencias/:id/deshacer'),
  __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
  __metadata("design:type", Function),
  __metadata("design:paramtypes", [Number]),
  __metadata("design:returntype", void 0)
], CompromisosController.prototype, "deshacerPago", null);

// POST /compromisos/ocurrencias/:id/cancelar
__decorate([
  (0, common_1.UseGuards)(guards_1.JwtAuthGuard, guards_1.RolesGuard),
  (0, decorators_1.Roles)(usuario_entity_1.RolUsuario.ADMIN, usuario_entity_1.RolUsuario.SUPERVISOR),
  (0, common_1.Post)('ocurrencias/:id/cancelar'),
  __param(0, (0, common_1.Param)('id', common_1.ParseIntPipe)),
  __param(1, (0, common_1.Body)()),
  __metadata("design:type", Function),
  __metadata("design:paramtypes", [Number, Object]),
  __metadata("design:returntype", void 0)
], CompromisosController.prototype, "cancelarOcurrencia", null);

// POST /compromisos/bot/pagar (SOLO x-bot-secret, sin JWT)
__decorate([
  (0, common_1.Post)('bot/pagar'),
  __param(0, (0, common_1.Headers)('x-bot-secret')),
  __param(1, (0, common_1.Body)()),
  __metadata("design:type", Function),
  __metadata("design:paramtypes", [String, Object]),
  __metadata("design:returntype", void 0)
], CompromisosController.prototype, "botPagar", null);

exports.CompromisosController = CompromisosController = __decorate([
  (0, common_1.Controller)('compromisos'),
  __metadata("design:paramtypes", [compromisos_service_1.CompromisosService])
], CompromisosController);
"""

open(CTRL, 'w').write(contenido)
print('OK: compromisos.controller.js reescrito.')
