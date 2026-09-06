// Devuelve el hash bcrypt (coste 12, igual que auth.service) de la contraseña recibida.
// Uso: node crear-admin.js 'ContraseñaTemporal' [ruta a node_modules de la API]
const path = require('path');
const pass = process.argv[2];
if (!pass || pass.length < 8) { console.error('Contraseña de al menos 8 caracteres'); process.exit(1); }
const nm = process.argv[3] || path.join(__dirname, '..', 'node_modules');
const bcrypt = require(path.join(nm, 'bcrypt'));
process.stdout.write(bcrypt.hashSync(pass, 12));
