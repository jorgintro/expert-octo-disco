// Libera los bloqueos de IP (contraseña de administrador y PIN de agentes) sin usar el panel.
// Se ejecuta DENTRO del contenedor (lo hace scripts/desbloquear.sh); lee DATA_DIR como la app.
//
// Uso: node scripts/desbloquear.js [IP] [--ambito admin|pin|todos]
//   sin IP      libera todas las IP del ámbito indicado (por defecto, de todos los ámbitos)
//   con IP      libera solo esa IP
import { existsSync } from 'node:fs';
import { isIP } from 'node:net';
import path from 'node:path';
import { auditar } from '../src/auditoria.js';
import { abrirDb } from '../src/db.js';
import { AMBITOS, desbloquear, listarBloqueos } from '../src/limiteIntentos.js';
import { formatearMadrid } from '../src/tiempo.js';

const uso = 'Uso: desbloquear.sh [IP] [--ambito admin|pin|todos]';
const fallar = (mensaje, codigo = 1) => {
  console.error(`ERROR: ${mensaje}`);
  process.exit(codigo);
};

let ip = null;
let ambito = null;
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--ambito') {
    const valor = args[++i];
    if (valor !== 'todos' && !AMBITOS.includes(valor)) fallar(`Ámbito no válido: ${valor ?? '(vacío)'}. ${uso}`, 2);
    ambito = valor === 'todos' ? null : valor;
  } else if (args[i] === '-h' || args[i] === '--help') {
    console.log(uso);
    process.exit(0);
  } else if (ip === null && isIP(args[i])) {
    ip = args[i];
  } else {
    fallar(`Argumento no válido: ${args[i]}. ${uso}`, 2);
  }
}

const ruta = path.join(process.env.DATA_DIR || './data', 'app.db');
if (!existsSync(ruta)) fallar(`No existe la base de datos ${ruta}. ¿Se ha arrancado ya la app?`);

const db = abrirDb(ruta);
const tabla = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'bloqueo_ip'").get();
if (!tabla) fallar('La base de datos no tiene la tabla bloqueo_ip: arranca primero la versión 0.3.1 o posterior.');

const etiqueta = { admin: 'administrador', pin: 'PIN de agentes' };
const antes = listarBloqueos(db);
if (antes.length === 0) console.log('No había bloqueos ni fallos recientes.');
for (const f of antes) {
  console.log(`  ${etiqueta[f.ambito]}  ${f.ip}  ${f.bloqueada ? `bloqueada hasta ${formatearMadrid(f.bloqueado_hasta)}` : `${f.fallos} fallos recientes`}`);
}

db.transaction(() => {
  const filas = desbloquear(db, { ambito, ip });
  auditar(db, { tipo: 'sistema', id: null }, 'desbloquear_ip', 'ip', null, null, {
    ambito: ambito ?? 'todos',
    ip: ip ?? 'todas',
    filas,
    origen: 'script',
  });
  console.log(`OK: ${filas} registro(s) de bloqueo eliminados (${ambito ? etiqueta[ambito] : 'administrador y PIN'}, ${ip ?? 'todas las IP'}).`);
})();
db.close();
