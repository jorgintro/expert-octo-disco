import { construirResumen, elegirVariante, textoWhatsApp } from '../resumen.js';
import { listarCortes } from '../servicioParticipacion.js';
import { formatearMadrid } from '../tiempo.js';
import { pagina, paginaAdmin, responder } from '../vistas.js';
import { lienzoPantallazo, panelResumen } from '../vistasResumen.js';

// Panel resumen y vista /pantallazo. Ambos leen solo la captura del modo vigente (req.captura): en DEMO,
// los datos de prueba; en REAL, los reales.
export default async function rutasResumen(app) {
  const { db } = app;

  function cargar(req) {
    const colegio = db.prepare('SELECT nombre FROM colegio ORDER BY id LIMIT 1').get()?.nombre ?? 'Colegio';
    const mesas = db
      .prepare('SELECT id, codigo, censo FROM mesa WHERE activa = 1 ORDER BY CAST(distrito AS INTEGER), CAST(seccion AS INTEGER), letra')
      .all();
    const resumen = construirResumen({ mesas, cortes: listarCortes(db), filas: req.captura.listarParticipacion() });
    const [fecha, hora] = formatearMadrid(req.modo.ahora).split(' ');
    return { colegio, resumen, fecha, hora, actualizado: `${fecha} ${hora}` };
  }

  app.get('/admin/resumen', async (req, reply) => {
    const { resumen, fecha, hora } = cargar(req);
    return responder(reply, paginaAdmin('Resumen de participación', req.ctx(), panelResumen({ resumen, fecha, hora }).texto));
  });

  app.get('/pantallazo', async (req, reply) => {
    const variante = elegirVariante(req.query?.variante);
    const { colegio, resumen, fecha, hora, actualizado } = cargar(req);
    const modo = req.modo.modo;
    const texto = textoWhatsApp({ resumen, variante: variante.id, colegio, modo, actualizado });
    const cuerpo = lienzoPantallazo({ colegio, resumen, variante, modo, hora, fecha, texto });
    const titulo = `${modo === 'DEMO' ? 'DEMO · ' : ''}Pantallazo · ${variante.etiqueta}`;
    return responder(reply, pagina(titulo, cuerpo.texto, { claseBody: 'pantallazo' }));
  });
}
