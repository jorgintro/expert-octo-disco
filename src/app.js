import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyCookie from '@fastify/cookie';
import fastifyFormbody from '@fastify/formbody';
import path from 'node:path';
import { raiz, version } from './version.js';
import { pagina } from './vistas.js';
import rutasAdmin from './rutas/admin.js';

export function crearApp({ db, config, logger = false }) {
  const app = Fastify({ logger, trustProxy: true });
  app.decorate('db', db);
  app.decorate('config', config);

  app.addHook('onSend', async (req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
    );
  });

  app.register(fastifyCookie);
  app.register(fastifyFormbody);
  app.register(fastifyStatic, { root: path.join(raiz, 'public'), wildcard: false });

  app.get('/healthz', async () => ({ estado: 'ok' }));
  app.get('/version', async () => ({ version }));

  app.get('/', async (req, reply) => {
    reply.type('text/html; charset=utf-8');
    return pagina(
      'Participación y recuento',
      `<h1>Participación y recuento</h1>
<p class="subtitulo">Colegio Dulcinea · Alcalá de Henares</p>
<section class="tarjeta">
  <p><strong>La aplicación está en marcha.</strong></p>
  <p>El acceso para agentes estará disponible en próximas versiones.</p>
  <p><a href="/admin/login">Acceso administrador</a></p>
</section>`
    );
  });

  app.register(rutasAdmin);

  return app;
}
