import Database from 'better-sqlite3';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { normalizarAgrupaciones } from './candidatosSenado.js';
import { raiz } from './version.js';

export function abrirDb(ruta) {
  if (ruta !== ':memory:') mkdirSync(path.dirname(ruta), { recursive: true });
  const db = new Database(ruta);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  return db;
}

export const DIR_MIGRACIONES = path.join(raiz, 'migrations');
export const DIR_CAPTURA = path.join(DIR_MIGRACIONES, 'captura');

// Aplica en orden las migraciones SQL pendientes de `dir`, anotándolas en `tabla`.
export function migrar(db, dir = DIR_MIGRACIONES, tabla = 'migracion') {
  if (!/^[a-z_]+$/.test(tabla)) throw new Error('Nombre de tabla de migraciones no válido');
  db.exec(`CREATE TABLE IF NOT EXISTS ${tabla} (
    nombre TEXT PRIMARY KEY,
    aplicada_en TEXT NOT NULL
  )`);
  const aplicadas = new Set(db.prepare(`SELECT nombre FROM ${tabla}`).all().map((r) => r.nombre));
  const ficheros = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const fichero of ficheros) {
    if (aplicadas.has(fichero)) continue;
    const sql = readFileSync(path.join(dir, fichero), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      db.prepare(`INSERT INTO ${tabla} (nombre, aplicada_en) VALUES (?, ?)`).run(fichero, new Date().toISOString());
    })();
  }
}

// app.db: configuración + captura real.
export function migrarApp(db) {
  migrar(db, DIR_MIGRACIONES, 'migracion');
  migrar(db, DIR_CAPTURA, 'migracion_captura');
  normalizarAgrupaciones(db); // 0.6.2: una sola grafía por agrupación (idempotente)
}

// demo.db: solo las tablas de captura.
export function migrarDemo(db) {
  migrar(db, DIR_CAPTURA, 'migracion_captura');
}
