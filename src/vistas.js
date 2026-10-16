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

export function pagina(titulo, cuerpo) {
  return `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(titulo)}</title>
<link rel="stylesheet" href="/estilos.css">
</head>
<body>
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
    ? '<div class="banner-demo" role="status">MODO DEMO - datos de prueba</div>'
    : '<div class="barra-real" aria-hidden="true"></div>';
}
export const pieModo = (modo) => (modo === 'DEMO' ? ' · <strong>MODO DEMO</strong>' : ' · Modo REAL');

const AVISOS = {
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

export function paginaAdmin(titulo, { csrf, aviso: textoAviso, error } = {}, cuerpo = '') {
  return pagina(
    titulo,
    html`<nav class="nav" aria-label="Administración">
  <a href="/admin">Inicio</a>
  <a href="/admin/mesas">Mesas</a>
  <a href="/admin/agentes">Agentes</a>
  <a href="/admin/modo">Modo</a>
  <a href="/admin/bloqueos">Bloqueos</a>
  <a href="/admin/password">Contraseña</a>
  <form method="post" action="/admin/logout">
    <input type="hidden" name="_csrf" value="${csrf}">
    <button type="submit" class="boton boton-sec">Salir</button>
  </form>
</nav>
<h1>${titulo}</h1>
${textoAviso ? html`<p class="aviso" role="status">${textoAviso}</p>` : ''}
${error ? html`<p class="error" role="alert">${error}</p>` : ''}
${crudo(cuerpo)}`.texto
  );
}

export function responder(reply, contenido, codigo = 200) {
  return reply.code(codigo).type('text/html; charset=utf-8').send(contenido);
}
