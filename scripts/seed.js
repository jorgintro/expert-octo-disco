import path from 'node:path';
import { cargarConfig } from '../src/config.js';
import { abrirDb, migrar } from '../src/db.js';
import { sembrar } from '../src/seed.js';

const config = cargarConfig();
const db = abrirDb(path.join(config.dataDir, 'app.db'));
migrar(db);
await sembrar(db, config);
console.log('Seed aplicado (idempotente).');
db.close();
