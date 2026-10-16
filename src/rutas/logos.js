import { hojaCandidaturas, leerLogo } from '../candidaturas.js';
import { buscarSesion } from '../sesiones.js';

// Recursos de las candidaturas servidos por la app: la hoja con los colores (pública: son colores) y los
// logos (solo con sesión de administrador o de agente; nunca de forma abierta).
export default async function rutasLogos(app) {
  const { db, config } = app;

  app.get('/candidaturas.css', async (req, reply) => {
    const { css, hash } = hojaCandidaturas(db);
    reply.header('Cache-Control', 'no-cache').header('ETag', `"${hash}"`);
    if (req.headers['if-none-match'] === `"${hash}"`) return reply.code(304).send();
    return reply.type('text/css; charset=utf-8').send(css);
  });

  app.get('/logos/:id', async (req, reply) => {
    const activa = ['sid', 'sid_agente'].some((cookie) => {
      const s = buscarSesion(db, config.sessionSecret, req.cookies[cookie]);
      return s && (s.actor_tipo === 'admin' || s.actor_tipo === 'agente');
    });
    if (!activa) return reply.code(403).type('text/plain; charset=utf-8').send('Acceso denegado');
    const logo = leerLogo(db, /^\d+$/.test(req.params.id) ? Number(req.params.id) : NaN);
    if (!logo) return reply.code(404).type('text/plain; charset=utf-8').send('No encontrado');
    const etag = `"${logo.logo_hash}"`;
    reply.header('ETag', etag).header('Cache-Control', 'private, max-age=31536000, immutable');
    if (req.headers['if-none-match'] === etag) return reply.code(304).send();
    return reply.type(logo.logo_tipo).send(logo.logo);
  });
}
