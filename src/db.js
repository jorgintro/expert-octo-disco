import Database from 'better-sqlite3';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { raiz } from './version.js';

export function abrirDb(ruta) {
  if (ruta !== ':memory:') mkdirSync(path.dirname(ruta), { recursive: true });
  const db = new Database(ruta);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  return db;
}

// Aplica en orden las migraciones SQL pendientes de migrations/.
export function migrar(db, dir = path.join(raiz, 'migrations')) {
  db.exec(`CREATE TABLE IF NOT EXISTS migracion (
    nombre TEXT PRIMARY KEY,
    aplicada_en TEXT NOT NULL
  )`);
  const aplicadas = new Set(db.prepare('SELECT nombre FROM migracion').all().map((r) => r.nombre));
  const ficheros = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const fichero of ficheros) {
    if (aplicadas.has(fichero)) continue;
    const sql = readFileSync(path.join(dir, fichero), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO migracion (nombre, aplicada_en) VALUES (?, ?)').run(fichero, new Date().toISOString());
    })();
  }
}
