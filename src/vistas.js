import { version } from './version.js';

// Texto ya escapado o HTML de confianza: no se vuelve a escapar.
export class Crudo {
  constructor(texto) {
    this.texto = texto;
  }
  toString() {
    return this.texto;
  }
}
export const crudo = (texto) => new Crudo(texto);

export function esc(valor) {
  return String(valor ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]
  );
}

function pintar(valor) {
  if (valor instanceof Crudo) return valor.texto;
  if (Array.isArray(valor)) return valor.map(pintar).join('');
  if (valor === null || valor === undefined || valor === false) return '';
  return esc(valor);
}

// Plantilla que escapa automáticamente todo lo interpolado (salvo `Crudo`).
export function html(trozos, ...valores) {
  let salida = trozos[0];
  valores.forEach((v, i) => {
    salida += pintar(v) + trozos[i + 1];
  });
  return new Crudo(salida);
}

// URL de un recurso estático con la versión de la app: al desplegar una versión nueva el navegador
// no puede quedarse con un CSS/JS antiguo (los estáticos se sirven con no-cache + ETag).
export const recurso = (ruta) => `${ruta}?v=${version}`;

export function pagina(titulo, cuerpo, { claseBody = '', hojas = [] } = {}) {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(titulo)}</title>
<link rel="stylesheet" href="${recurso('/estilos.css')}">${hojas.map((h) => `\n<link rel="stylesheet" href="${esc(h)}">`).join('')}
</head>
<body${claseBody ? ` class="${esc(claseBody)}"` : ''}>
<!--MODO_BANNER-->
<main class="contenedor">
${cuerpo}
</main>
<footer class="pie">Versión ${esc(version)}<!--MODO_PIE--></footer>
</body>
</html>`;
}

// Marcadores que app.js sustituye en cada respuesta HTML según el modo de trabajo, de modo que
// TODAS las pantallas (administración, agente, pantallazo...) muestran el modo sin tocar cada ruta.
export function bannerModo(modo) {
  return modo === 'DEMO'
    ? '<div id="banner-modo" class="banner-demo" role="status">MODO DEMO - datos de prueba</div>'
    : '<div id="banner-modo" class="barra-real" aria-hidden="true"></div>';
}
export const pieModo = (modo) => (modo === 'DEMO' ? ' · <strong>MODO DEMO</strong>' : ' · Modo REAL');

const AVISOS = {
  recuento_abierto: 'Recuento abierto.',
  recuento_cerrado: 'Recuento cerrado.',
  recuento_guardado: 'Recuento guardado.',
  recuento_mesa_cerrada: 'Mesa cerrada.',
  recuento_reabierta: 'Mesa reabierta: vuelve a estar en borrador.',
  senado_abierto: 'Recuento del Senado abierto.',
  senado_cerrado: 'Recuento del Senado cerrado.',
  senado_guardado: 'Recuento del Senado guardado.',
  senado_mesa_cerrada: 'Mesa del Senado cerrada.',
  senado_reabierta: 'Mesa del Senado reabierta: vuelve a estar en borrador.',
  senado_pasada_totales: 'Mesa del Senado pasada a modo totales conservando las cifras.',
  senado_reiniciada: 'Recuento del Senado de la mesa reiniciado.',
  candidato_creado: 'Candidato creado.',
  candidato_guardado: 'Candidato guardado.',
  candidato_movido: 'Orden actualizado.',
  candidato_borrado: 'Candidato borrado.',
  candidatura_creada: 'Candidatura creada.',
  candidatura_guardada: 'Candidatura guardada.',
  candidatura_movida: 'Orden actualizado.',
  candidatura_borrada: 'Candidatura borrada.',
  logo_quitado: 'Logo quitado.',
  cortes_guardados: 'Horas de los cortes guardadas.',
  cortes_sin_cambios: 'No has cambiado ninguna hora.',
  dato_guardado: 'Dato guardado.',
  dato_sin_cambios: 'El dato ya estaba guardado así.',
  dato_vaciado: 'Dato vaciado.',
  modo_cambiado: 'Modo de trabajo cambiado.',
  demo_reiniciada: 'Demo reiniciada: se han borrado los datos de prueba.',
  desbloqueada: 'IP desbloqueada.',
  creada: 'Mesa creada.',
  guardada: 'Cambios guardados.',
  baja: 'Mesa dada de baja.',
  alta: 'Mesa dada de alta.',
  agente_creado: 'Agente creado. Ya puedes generarle un PIN.',
  agente_guardado: 'Cambios guardados.',
  agente_baja: 'Agente dado de baja. Su PIN y sus sesiones han dejado de ser válidos.',
  agente_alta: 'Agente dado de alta. Genera un PIN nuevo para que pueda entrar.',
  pin_revocado: 'PIN revocado. Sus sesiones han dejado de ser válidas.',
  password: 'Contraseña cambiada.',
};
export const aviso = (codigo) => AVISOS[codigo] ?? null;

export function paginaAdmin(titulo, { csrf, aviso: textoAviso, error, hojas = [] } = {}, cuerpo = '') {
  return pagina(
    titulo,
    html`<nav class="nav" aria-label="Administración">
  <a href="/admin/resumen">Resumen</a>
  <a href="/admin/participacion">Participación</a>
  <a href="/admin/recuento">Recuento</a>
  <a href="/pantallazo">Pantallazo</a>
  <form method="post" action="/admin/logout">
    <input type="hidden" name="_csrf" value="${csrf}">
    <button type="submit" class="boton boton-sec">Salir</button>
  </form>
  <details class="nav-mas">
    <summary>Más</summary>
    <div class="nav-mas-enlaces">
      <a href="/admin">Inicio</a>
      <a href="/admin/mesas">Mesas</a>
      <a href="/admin/agentes">Agentes</a>
      <a href="/admin/candidaturas">Candidaturas</a>
      <a href="/admin/senado/candidatos">Candidatos Senado</a>
      <a href="/admin/cortes">Cortes</a>
      <a href="/admin/historico">Histórico</a>
      <a href="/admin/kit">Kit del agente</a>
      <a href="/admin/modo">Modo</a>
      <a href="/admin/bloqueos">Bloqueos</a>
      <a href="/admin/password">Contraseña</a>
    </div>
  </details>
</nav>
<h1>${titulo}</h1>
${textoAviso ? html`<p class="aviso" role="status">${textoAviso}</p>` : ''}
${error ? html`<p class="error" role="alert">${error}</p>` : ''}
${crudo(cuerpo)}`.texto,
    { hojas }
  );
}

export function responder(reply, contenido, codigo = 200) {
  return reply.code(codigo).type('text/html; charset=utf-8').send(contenido);
}

// Pantallas de agente: cabecera con su nombre y botón de salir (el banner de modo lo pone `pagina`).
export function paginaAgente(titulo, { csrf, aviso: textoAviso, error, agente, hojas = [] } = {}, cuerpo = '') {
  return pagina(
    titulo,
    html`<header class="cabecera-agente">
  <span class="agente-nombre">${agente.nombre}</span>
  <a class="kit-enlace" href="/agente/kit">Kit</a>
  <form method="post" action="/agente/salir">
    <input type="hidden" name="_csrf" value="${csrf}">
    <button type="submit" class="boton boton-sec">Salir</button>
  </form>
</header>
<h1>${titulo}</h1>
${textoAviso ? html`<p class="aviso" role="status">${textoAviso}</p>` : ''}
${error ? html`<p class="error" role="alert">${error}</p>` : ''}
${crudo(cuerpo)}`.texto,
    { hojas }
  );
}
