import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyCookie from '@fastify/cookie';
import fastifyFormbody from '@fastify/formbody';
import path from 'node:path';
import { GestorDatos } from './datos.js';
import { raiz, version } from './version.js';
import { bannerModo, pieModo } from './vistas.js';
import { confiarEnProxy } from './proxy.js';
import rutasAdmin from './rutas/admin.js';
import rutasAgente from './rutas/agente.js';
import rutasLogos from './rutas/logos.js';

export function crearApp({ db, config, logger = false, reloj = Date.now }) {
  const app = Fastify({ logger, trustProxy: confiarEnProxy(config.trustProxy) });
  app.decorate('db', db);
  app.decorate('config', config);
  const datos = new GestorDatos({ db, dataDir: config.dataDir, fechaElecciones: config.fechaElecciones, reloj });
  app.decorate('datos', datos);
  app.decorateRequest('modo', null);
  app.decorateRequest('captura', null);
  app.addHook('onClose', async () => datos.cerrar());

  // Al inicio de cada petición: evalúa el modo con el reloj (sin cron), aplica la transición si
  // toca y entrega a la ruta SOLO la captura del destino correcto. Si falla, la petición falla
  // (nunca se sigue adelante sin saber a qué base escribir).
  app.addHook('onRequest', async (req) => {
    req.modo = datos.sincronizar();
    req.captura = datos.captura();
  });

  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
    );
    if (req.modo && typeof payload === 'string' && String(reply.getHeader('content-type') ?? '').startsWith('text/html')) {
      return payload
        .replace('<!--MODO_BANNER-->', bannerModo(req.modo.modo))
        .replace('<!--MODO_PIE-->', pieModo(req.modo.modo));
    }
    return payload;
  });

  app.register(fastifyCookie);
  app.register(fastifyFormbody);
  // Estáticos: siempre se revalidan (no-cache) con ETag, así un despliegue nunca deja CSS/JS viejos;
  // además van con ?v=<versión> en la URL.
  app.register(fastifyStatic, {
    root: path.join(raiz, 'public'),
    wildcard: false,
    etag: true,
    cacheControl: false,
    setHeaders: (reply) => reply.header('Cache-Control', 'no-cache'),
  });

  app.get('/healthz', async (req) => ({ estado: 'ok', modo: req.modo.modo }));
  app.get('/version', async (req) => ({ version, modo: req.modo.modo }));

  app.register(rutasLogos);
  app.register(rutasAgente);
  app.register(rutasAdmin);

  return app;
}
