import path from 'node:path';
import { crearApp } from './app.js';
import { cargarConfig } from './config.js';
import { abrirDb, migrar } from './db.js';
import { sembrar } from './seed.js';

let config;
try {
  config = cargarConfig();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

const db = abrirDb(path.join(config.dataDir, 'app.db'));
migrar(db);
await sembrar(db, config);

const app = crearApp({ db, config, logger: true });
app.addHook('onClose', async () => db.close());

try {
  await app.listen({ port: config.puerto, host: '0.0.0.0' });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
