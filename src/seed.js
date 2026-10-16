import argon2 from 'argon2';
import { auditar } from './auditoria.js';

const SISTEMA = { tipo: 'sistema', id: null };
const MESAS = [
  ['4', '2', 'A', 615],
  ['4', '2', 'B', 623],
  ['4', '3', 'A', 754],
  ['4', '3', 'B', 821],
  ['5', '18', 'U', 692],
  ['5', '31', 'U', 676],
];
const CORTES = ['10:00', '12:00', '14:00', '16:00', '18:00', '20:00'];

// Seed idempotente: solo crea lo que falta, por bloques. Nunca pisa datos editados
// (censo, mesas dadas de baja, contraseña del administrador).
export async function sembrar(db, config) {
  const vacia = (tabla) => db.prepare(`SELECT COUNT(*) AS n FROM ${tabla}`).get().n === 0;
  const hashAdmin = vacia('admin') ? await argon2.hash(config.adminPasswordInitial) : null;

  db.transaction(() => {
    if (vacia('colegio')) {
      const { lastInsertRowid } = db
        .prepare('INSERT INTO colegio (nombre, municipio) VALUES (?, ?)')
        .run('Colegio Dulcinea', 'Alcalá de Henares');
      auditar(db, SISTEMA, 'seed', 'colegio', Number(lastInsertRowid), null, { nombre: 'Colegio Dulcinea' });
    }
    const colegio = db.prepare('SELECT id FROM colegio ORDER BY id LIMIT 1').get();

    if (vacia('mesa')) {
      const insertar = db.prepare(
        'INSERT INTO mesa (colegio_id, distrito, seccion, letra, codigo, censo) VALUES (?, ?, ?, ?, ?, ?)'
      );
      for (const [distrito, seccion, letra, censo] of MESAS) {
        const codigo = `${distrito}-${seccion}-${letra}`;
        const { lastInsertRowid } = insertar.run(colegio.id, distrito, seccion, letra, codigo, censo);
        auditar(db, SISTEMA, 'seed', 'mesa', Number(lastInsertRowid), null, { codigo, censo });
      }
    }

    if (vacia('corte')) {
      const insertar = db.prepare('INSERT INTO corte (hora, orden) VALUES (?, ?)');
      CORTES.forEach((hora, i) => insertar.run(hora, i + 1));
      auditar(db, SISTEMA, 'seed', 'corte', null, null, { horas: CORTES });
    }

    db.prepare("INSERT OR IGNORE INTO ajuste (clave, valor) VALUES ('zona_horaria', 'Europe/Madrid')").run();

    if (hashAdmin) {
      const { lastInsertRowid } = db
        .prepare('INSERT INTO admin (usuario, password_hash) VALUES (?, ?)')
        .run(config.adminUser, hashAdmin);
      auditar(db, SISTEMA, 'seed', 'admin', Number(lastInsertRowid), null, { usuario: config.adminUser });
    }
  })();
}
