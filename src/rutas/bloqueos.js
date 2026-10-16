import { isIP } from 'node:net';
import { auditar } from '../auditoria.js';
import { AMBITOS, desbloquear, listarBloqueos } from '../limiteIntentos.js';
import { formatearMadrid } from '../tiempo.js';
import { html, paginaAdmin, responder } from '../vistas.js';

const ETIQUETA = { admin: 'Administrador', pin: 'Agentes (PIN)' };

export default async function rutasBloqueos(app) {
  const { db } = app;

  const pantalla = (req, ctx) => {
    const filas = listarBloqueos(db);
    const cuerpo = html`<section class="tarjeta">
  <p>Tu IP actual: <strong>${req.ip}</strong></p>
  <p class="nota">Los intentos fallidos se cuentan por IP y por separado: la contraseña de administrador y el PIN de los agentes no se afectan entre sí.</p>
</section>
${filas.length === 0
  ? html`<p>No hay IP bloqueadas ni con fallos recientes.</p>`
  : html`<div class="tabla-scroll"><table>
  <thead><tr><th>Ámbito</th><th>IP</th><th>Estado</th><th></th></tr></thead>
  <tbody>
    ${filas.map(
      (f) => html`<tr>
      <td>${ETIQUETA[f.ambito]}</td>
      <td>${f.ip}</td>
      <td>${f.bloqueada ? `Bloqueada hasta ${formatearMadrid(f.bloqueado_hasta)}` : `${f.fallos} fallos recientes`}</td>
      <td>
        <form method="post" action="/admin/bloqueos/desbloquear">
          <input type="hidden" name="_csrf" value="${ctx.csrf}">
          <input type="hidden" name="ambito" value="${f.ambito}">
          <input type="hidden" name="ip" value="${f.ip}">
          <button type="submit" class="boton boton-sec">Desbloquear</button>
        </form>
      </td>
    </tr>`
    )}
  </tbody>
</table></div>`}
<form method="post" action="/admin/bloqueos/desbloquear" class="tarjeta formulario">
  <h2>Desbloquear IP</h2>
  <input type="hidden" name="_csrf" value="${ctx.csrf}">
  <label for="ip">Dirección IP</label>
  <input id="ip" name="ip" type="text" inputmode="decimal" autocomplete="off" autocapitalize="none" required value="${req.ip}">
  <label for="ambito">Ámbito</label>
  <select id="ambito" name="ambito">
    <option value="todos">Todos (administrador y agentes)</option>
    ${AMBITOS.map((a) => html`<option value="${a}">${ETIQUETA[a]}</option>`)}
  </select>
  <button type="submit" class="boton">Desbloquear IP</button>
</form>
<form method="post" action="/admin/bloqueos/desbloquear" class="formulario">
  <input type="hidden" name="_csrf" value="${ctx.csrf}">
  <input type="hidden" name="todas" value="1">
  <button type="submit" class="boton boton-sec">Desbloquear todas las IP</button>
</form>`;
    return paginaAdmin('Bloqueos de IP', ctx, cuerpo.texto);
  };

  app.get('/admin/bloqueos', async (req, reply) => responder(reply, pantalla(req, req.ctx())));

  app.post('/admin/bloqueos/desbloquear', async (req, reply) => {
    const todas = req.body.todas === '1';
    const ip = String(req.body.ip ?? '').trim();
    const ambitoCampo = String(req.body.ambito ?? 'todos');
    if (!todas) {
      if (!isIP(ip)) return responder(reply, pantalla(req, req.ctx({ error: 'La dirección IP no es válida.' })), 422);
      if (ambitoCampo !== 'todos' && !AMBITOS.includes(ambitoCampo)) {
        return responder(reply, pantalla(req, req.ctx({ error: 'Ámbito no válido.' })), 422);
      }
    }
    const ambito = todas || ambitoCampo === 'todos' ? null : ambitoCampo;
    db.transaction(() => {
      const filas = desbloquear(db, { ambito, ip: todas ? null : ip });
      auditar(db, req.admin, 'desbloquear_ip', 'ip', null, null, { ambito: ambito ?? 'todos', ip: todas ? 'todas' : ip, filas });
    })();
    return reply.redirect('/admin/bloqueos?ok=desbloqueada');
  });
}
