import { kitParaRol } from '../kit.js';
import { paginaAdmin, paginaAgente, responder } from '../vistas.js';
import { cuerpoKit } from '../vistasKit.js';

// Kit del agente electoral: solo lectura, sin tocar los datos de captura. Dos registros (uno por ámbito de
// sesión): el filtro de contenido pendiente de verificar depende del rol y se aplica aquí, en el servidor.
export const rutasKitAgente = async (priv) => {
  priv.get('/agente/kit', async (req, reply) => {
    const { db, kit } = priv;
    const colegio = db.prepare('SELECT nombre FROM colegio ORDER BY id LIMIT 1').get()?.nombre ?? 'Colegio';
    const cuerpo = cuerpoKit({ kit: kitParaRol(kit, false), clave: `tiroriro:kit:agente-${req.agente.id}`, colegio, modo: req.modo.modo, esAdmin: false });
    return responder(reply, paginaAgente('Kit del agente electoral', req.ctx(), cuerpo.texto));
  });
};

export const rutasKitAdmin = async (priv) => {
  priv.get('/admin/kit', async (req, reply) => {
    const { db, kit } = priv;
    const colegio = db.prepare('SELECT nombre FROM colegio ORDER BY id LIMIT 1').get()?.nombre ?? 'Colegio';
    const cuerpo = cuerpoKit({ kit: kitParaRol(kit, true), clave: 'tiroriro:kit:admin', colegio, modo: req.modo.modo, esAdmin: true });
    return responder(reply, paginaAdmin('Kit del agente electoral', req.ctx(), cuerpo.texto));
  });
};
