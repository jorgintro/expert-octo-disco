import { crearApp } from './app.js';

const puerto = Number(process.env.PORT) || 3000;
const app = crearApp({ logger: true });

try {
  await app.listen({ port: puerto, host: '0.0.0.0' });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
