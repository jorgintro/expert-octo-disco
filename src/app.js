import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const raiz = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const { version } = JSON.parse(readFileSync(path.join(raiz, 'package.json'), 'utf8'));

const escapar = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function pagina(titulo, cuerpo) {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapar(titulo)}</title>
<link rel="stylesheet" href="/estilos.css">
</head>
<body>
<main class="contenedor">
${cuerpo}
</main>
<footer class="pie">Versión ${escapar(version)}</footer>
</body>
</html>`;
}

export function crearApp(opciones = {}) {
  const app = Fastify({ logger: opciones.logger ?? false, trustProxy: true });

  app.addHook('onSend', async (req, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header(
      'Content-Security-Policy',
      "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
    );
  });

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
  <p>El acceso para agentes y administración estará disponible en próximas versiones.</p>
</section>`
    );
  });

  return app;
}
