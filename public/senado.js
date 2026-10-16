/* Recuento del Senado en el móvil. Dos pantallas:
 *  - «sábana a sábana»: cada papeleta se marca y se confirma (hasta 3 marcas). Los contadores y la última papeleta
 *    viven en el dispositivo; al servidor solo llegan contadores, por lotes y con control de versión.
 *  - «totales» (respaldo): campos numéricos con comprobación en vivo y autoguardado.
 * Las reglas de la papeleta son las mismas del servidor (papeleta.js). */
import { CELDAS, MAX_MARCAS, aplicarPapeleta, clasificarPapeleta, totalesContadores } from './papeleta.js';

const RETRASO_MS = 4000;     // autoguardado tras el último cambio
const ESPERA_MAX_MS = 15000; // y como mucho esto sin enviar si hay cambios pendientes
const REINTENTO_MS = 8000;   // reintento si no hay conexión

const form = document.querySelector('form.form-senado');
if (form) (form.dataset.modo === 'sabana' ? iniciarSabana : iniciarTotales)(form);

// ---------- utilidades ----------
function almacen() {
  try {
    window.localStorage.setItem('__t__', '1');
    window.localStorage.removeItem('__t__');
    return window.localStorage;
  } catch (e) { return null; }
}
const memoria = almacen();
const entero = (t) => { const s = String(t || '').trim(); return /^\d+$/.test(s) ? Number(s) : null; };
const n0 = (t) => entero(t) || 0;

function enviar(f, urlAuto, auto) {
  const cuerpo = new URLSearchParams(new FormData(f));
  cuerpo.set('auto', auto ? '1' : '0');
  const control = typeof AbortController === 'function' ? new AbortController() : null;
  const limite = setTimeout(() => { if (control) control.abort(); }, 12000);
  return fetch(urlAuto, {
    method: 'POST',
    body: cuerpo.toString(),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'fetch' },
    credentials: 'same-origin',
    keepalive: cuerpo.toString().length < 60000,
    signal: control ? control.signal : undefined
  }).then((r) => {
    clearTimeout(limite);
    if (r.status >= 500) throw new Error('servidor ' + r.status);
    return r.json().catch(() => { throw new Error('respuesta no válida'); }).then((d) => ({ status: r.status, datos: d }));
  }).catch((e) => { clearTimeout(limite); throw e; });
}

function mostrar(el, texto, clase) {
  if (!el) return;
  el.textContent = texto;
  el.className = 'bs-guardado' + (clase ? ' ' + clase : '');
}

function lector(clave) {
  return {
    leer() { if (!memoria) return null; try { return JSON.parse(memoria.getItem(clave) || 'null'); } catch (e) { return null; } },
    escribir(v) { if (memoria) { try { memoria.setItem(clave, JSON.stringify(v)); } catch (e) { /* sin espacio */ } } },
    borrar() { if (memoria) { try { memoria.removeItem(clave); } catch (e) { /* nada */ } } }
  };
}

// ---------- contadores (sábana) ----------
const copiar = (c) => ({ votos: Object.assign({}, c.votos), matriz: Object.assign({}, c.matriz), blancas: c.blancas, nulas: c.nulas });
function iguales(a, b) {
  if (a.blancas !== b.blancas || a.nulas !== b.nulas) return false;
  if (CELDAS.some((k) => (a.matriz[k] || 0) !== (b.matriz[k] || 0))) return false;
  const ids = Object.keys(a.votos).concat(Object.keys(b.votos));
  return ids.every((id) => (a.votos[id] || 0) === (b.votos[id] || 0));
}
// a + signo * b (por contador); se queda en 0 si quedara negativo.
function combinar(a, b, signo) {
  const c = copiar(a);
  const suma = (x, y) => Math.max(0, (x || 0) + signo * (y || 0));
  Object.keys(b.votos).forEach((id) => { c.votos[id] = suma(c.votos[id], b.votos[id]); });
  CELDAS.forEach((k) => { c.matriz[k] = suma(c.matriz[k], b.matriz[k]); });
  c.blancas = suma(c.blancas, b.blancas);
  c.nulas = suma(c.nulas, b.nulas);
  return c;
}

function iniciarSabana(f) {
  const urlAuto = f.getAttribute('data-autoguardado');
  const urlCerrar = f.getAttribute('data-cerrar');
  const local = lector('tiroriro:senado:' + f.getAttribute('data-clave'));
  const botones = {
    confirmar: f.querySelector('[data-confirmar]'),
    blanca: f.querySelector('[data-blanca]'),
    nula: f.querySelector('[data-nula]'),
    deshacer: f.querySelector('[data-deshacer]'),
    guardar: f.querySelector('[data-guardar]'),
    cerrar: f.querySelector('[data-cerrar-mesa]')
  };
  const el = {
    marcas: f.querySelector('[data-resumen-marcas]'),
    mensaje: f.querySelector('[data-mensaje]'),
    guardado: f.querySelector('[data-guardado]'),
    contadas: f.querySelector('[data-contadas]'),
    validas: f.querySelector('[data-validas]'),
    blancas: f.querySelector('[data-blancas]'),
    nulas: f.querySelector('[data-nulas]')
  };
  const botonesCand = [].slice.call(f.querySelectorAll('[data-candidato]'));
  const ids = botonesCand.map((b) => b.getAttribute('data-candidato'));
  const nombreDe = {};
  botonesCand.forEach((b) => { nombreDe[b.getAttribute('data-candidato')] = b.querySelector('.cs-nombre').textContent; });
  const grupoDe = (id) => f.querySelector('[data-candidato="' + id + '"]').getAttribute('data-lista');
  const campo = (nombre) => f.elements[nombre];

  function leer() {
    const c = { votos: {}, matriz: {}, blancas: n0(campo('blancas').value), nulas: n0(campo('nulas').value) };
    ids.forEach((id) => { c.votos[id] = n0(campo('c_' + id).value); });
    CELDAS.forEach((k) => { c.matriz[k] = n0(campo('m_' + k.replace(':', '_')).value); });
    return c;
  }
  function escribir(c) {
    campo('blancas').value = String(c.blancas);
    campo('nulas').value = String(c.nulas);
    ids.forEach((id) => { campo('c_' + id).value = String(c.votos[id] || 0); });
    CELDAS.forEach((k) => { campo('m_' + k.replace(':', '_')).value = String(c.matriz[k] || 0); });
  }

  const servidor = leer();
  const st = { actual: copiar(servidor), base: copiar(servidor), ultima: null, sel: [], sucio: false, bloqueado: false, enCurso: false, cambios: 0, promesa: null, temporizador: null, reintento: null, primero: 0, conflicto: null };

  function pintar() {
    const t = totalesContadores(st.actual);
    el.contadas.textContent = String(t.contadas);
    el.validas.textContent = String(t.validas);
    el.blancas.textContent = String(t.blancas);
    el.nulas.textContent = String(t.nulas);
    botonesCand.forEach((b) => {
      const id = b.getAttribute('data-candidato');
      b.querySelector('[data-votos]').textContent = String(st.actual.votos[id] || 0);
      b.setAttribute('aria-pressed', st.sel.indexOf(id) >= 0 ? 'true' : 'false');
    });
    const n = st.sel.length;
    botones.confirmar.disabled = n < 1 || n > MAX_MARCAS;
    botones.confirmar.textContent = n > 0 ? 'Confirmar papeleta (' + n + ')' : 'Confirmar papeleta';
    botones.blanca.disabled = n !== 0;
    botones.deshacer.disabled = !st.ultima;
    if (n > 0) el.marcas.textContent = 'Marcados ' + n + '/' + MAX_MARCAS + ': ' + st.sel.map((id) => nombreDe[id]).join(' · ');
    else el.marcas.textContent = st.ultima ? 'Papeleta vacía · última: ' + describir(st.ultima) : 'Papeleta vacía';
  }
  function describir(p) {
    if (p.tipo === 'blanca') return 'en blanco';
    if (p.tipo === 'nula') return 'nula';
    return 'válida de ' + p.marcas + (p.marcas === 1 ? ' marca' : ' marcas');
  }
  function aviso(texto) {
    el.mensaje.textContent = texto || '';
    el.mensaje.hidden = !texto;
    if (texto) { clearTimeout(aviso.t); aviso.t = setTimeout(() => aviso(''), 4000); }
  }
  function vibrar(ms) { if (navigator.vibrate) { try { navigator.vibrate(ms); } catch (e) { /* sin vibración */ } } }

  function guardarLocal() {
    if (iguales(st.actual, st.base) && !st.ultima) { local.borrar(); return; }
    local.escribir({ actual: st.actual, base: st.base, version: Number(campo('version').value), ultima: st.ultima, t: Date.now() });
  }

  function cambio() {
    escribir(st.actual);
    st.sucio = !iguales(st.actual, st.base);
    st.cambios++;
    guardarLocal();
    pintar();
    if (!st.sucio) { mostrar(el.guardado, 'Guardado', 'ok'); return; }
    if (!st.bloqueado) mostrar(el.guardado, 'Sin enviar…', 'pendiente');
    programar();
  }

  function programar() {
    clearTimeout(st.temporizador);
    if (st.bloqueado) return;
    if (!st.primero) st.primero = Date.now();
    const espera = Math.max(0, Math.min(RETRASO_MS, st.primero + ESPERA_MAX_MS - Date.now()));
    st.temporizador = setTimeout(() => { guardarAhora(true); }, espera);
  }

  // ---- papeletas ----
  function contar(papeleta) {
    const c = aplicarPapeleta(st.actual, papeleta, 1);
    if (!c) return;
    st.actual = c;
    st.ultima = papeleta;
    st.sel = [];
    vibrar(10);
    cambio();
  }
  function confirmar() {
    const n = st.sel.length;
    if (n < 1) return;
    contar(n > MAX_MARCAS ? { tipo: 'nula' } : clasificarPapeleta(st.sel.map(Number), grupoDe));
  }
  function marcar(id) {
    const i = st.sel.indexOf(id);
    if (i >= 0) st.sel.splice(i, 1);
    else if (st.sel.length >= MAX_MARCAS) { aviso('Máximo ' + MAX_MARCAS + ' marcas. Si la papeleta tiene más, pulsa «Nula».'); vibrar(30); return; }
    else st.sel.push(id);
    pintar();
  }
  function listaCompleta(clave) {
    const delGrupo = botonesCand.filter((b) => b.getAttribute('data-lista') === clave).map((b) => b.getAttribute('data-candidato'));
    if (delGrupo.length < 1 || delGrupo.length > MAX_MARCAS) return;
    st.sel = delGrupo;
    confirmar();
  }
  function deshacer() {
    if (!st.ultima) return;
    const c = aplicarPapeleta(st.actual, st.ultima, -1);
    if (!c) { aviso('No se puede deshacer: esa papeleta ya no está en los contadores.'); st.ultima = null; pintar(); return; }
    st.actual = c;
    st.ultima = null;
    aviso('Última papeleta deshecha.');
    cambio();
  }

  // ---- envío ----
  function adoptar(version, enviado, cambiosAlEnviar) {
    f.elements.version.value = String(version);
    st.base = copiar(enviado);
    st.sucio = !iguales(st.actual, st.base);
    if (st.sucio) programar(); else st.primero = 0;
    guardarLocal();
  }

  function mostrarConflicto(d) {
    st.bloqueado = true;
    st.conflicto = d;
    f.querySelector('[data-conflicto]').hidden = false;
    f.querySelector('[data-conflicto-botones]').hidden = false;
    mostrar(el.guardado, 'Sin enviar: conflicto con otro dispositivo', 'error');
    f.querySelector('[data-conflicto]').scrollIntoView({ block: 'center' });
  }

  function guardarAhora(auto) {
    clearTimeout(st.temporizador);
    clearTimeout(st.reintento);
    if (st.bloqueado) return Promise.resolve(false);
    if (st.enCurso) return st.promesa.then(() => (st.sucio ? guardarAhora(auto) : true));
    if (!st.sucio && auto) return Promise.resolve(true);
    const enviado = copiar(st.actual);
    const cambiosAlEnviar = st.cambios;
    escribir(enviado);
    st.enCurso = true;
    mostrar(el.guardado, 'Enviando…', 'pendiente');
    st.promesa = enviar(f, urlAuto, auto)
      .then((res) => {
        const d = res.datos;
        if (d.ok) {
          adoptar(d.version, enviado, cambiosAlEnviar);
          mostrar(el.guardado, st.sucio ? 'Enviado ' + d.guardadoEn + ' · quedan cambios' : 'Guardado ' + d.guardadoEn, 'ok');
          return true;
        }
        if (d.estado === 'conflicto') {
          // Si el servidor ya tiene exactamente lo que enviamos (el envío anterior llegó pero se perdió la respuesta), no hay conflicto.
          if (d.contadores && iguales(d.contadores, enviado)) { adoptar(d.version, enviado, cambiosAlEnviar); mostrar(el.guardado, 'Guardado', 'ok'); return true; }
          mostrarConflicto(d);
          return false;
        }
        if (d.estado === 'error') { mostrar(el.guardado, 'Sin enviar: ' + (d.errores || []).join(' '), 'error'); return false; }
        st.bloqueado = true;
        mostrar(el.guardado, (d.mensaje || 'No se puede guardar.') + ' Lo contado sigue aquí y en este dispositivo.', 'error');
        return false;
      })
      .catch(() => {
        mostrar(el.guardado, 'Sin enviar: sin conexión. Los contadores están en este móvil. Reintentando…', 'error');
        st.reintento = setTimeout(() => { guardarAhora(true); }, REINTENTO_MS);
        return false;
      })
      .then((ok) => { st.enCurso = false; return ok; });
    return st.promesa;
  }

  // ---- eventos ----
  [].slice.call(f.querySelectorAll('[hidden]')).forEach((e) => {
    if (e.hasAttribute('data-confirmar') || e.hasAttribute('data-blanca') || e.hasAttribute('data-nula') || e.hasAttribute('data-deshacer') || e.hasAttribute('data-candidato') || e.hasAttribute('data-lista-completa')) e.hidden = false;
  });
  f.addEventListener('click', (e) => {
    const b = e.target.closest ? e.target.closest('button') : null;
    if (!b) return;
    if (b.hasAttribute('data-candidato')) marcar(b.getAttribute('data-candidato'));
    else if (b.hasAttribute('data-lista-completa')) listaCompleta(b.getAttribute('data-lista-completa'));
    else if (b === botones.confirmar) confirmar();
    else if (b === botones.blanca) { if (st.sel.length === 0) contar({ tipo: 'blanca' }); }
    else if (b === botones.nula) contar({ tipo: 'nula' });
    else if (b === botones.deshacer) deshacer();
  });
  if (botones.guardar) botones.guardar.addEventListener('click', (e) => { if (!window.fetch) return; e.preventDefault(); guardarAhora(false); });
  if (botones.cerrar) {
    botones.cerrar.addEventListener('click', (e) => {
      if (!window.fetch) return;
      e.preventDefault();
      if (st.sel.length > 0) { aviso('Hay marcas sin confirmar: confirma la papeleta o desmárcala antes de cerrar.'); return; }
      guardarAhora(false).then((ok) => {
        if (!ok) { mostrar(el.guardado, 'No se puede cerrar hasta enviar lo contado. Revisa el aviso.', 'error'); return; }
        f.action = urlCerrar;
        HTMLFormElement.prototype.submit.call(f);
      });
    });
  }

  // ---- conflicto ----
  f.querySelector('[data-recargar]').addEventListener('click', () => { local.borrar(); window.location.reload(); });
  f.querySelector('[data-sumar-mio]').addEventListener('click', () => {
    const d = st.conflicto;
    if (!d) return;
    const pendiente = combinar(st.actual, st.base, -1);
    st.actual = combinar(d.contadores, pendiente, 1);
    st.base = copiar(d.contadores);
    f.elements.version.value = String(d.version);
    st.bloqueado = false;
    st.conflicto = null;
    f.querySelector('[data-conflicto]').hidden = true;
    f.querySelector('[data-conflicto-botones]').hidden = true;
    cambio();
    guardarAhora(false);
  });

  // ---- recuperación tras un cierre o una recarga ----
  const guardado = local.leer();
  if (guardado && guardado.actual) {
    const mismaVersion = guardado.version === Number(f.elements.version.value);
    if (iguales(guardado.actual, st.actual) && !guardado.ultima) {
      local.borrar();
    } else if (mismaVersion) {
      st.actual = guardado.actual;
      st.base = guardado.base || st.base;
      if (guardado.ultima && aplicarPapeleta(st.actual, guardado.ultima, -1)) st.ultima = guardado.ultima;
      escribir(st.actual);
      st.sucio = !iguales(st.actual, st.base);
      if (st.sucio) { mostrar(el.guardado, 'Recuperadas papeletas sin enviar de este móvil', 'pendiente'); programar(); }
    } else {
      const aviso1 = f.querySelector('[data-borrador-viejo]');
      const bots = f.querySelector('[data-borrador-viejo-botones]');
      aviso1.hidden = false;
      bots.hidden = false;
      f.querySelector('[data-descartar-local]').addEventListener('click', () => { local.borrar(); aviso1.hidden = true; bots.hidden = true; });
      f.querySelector('[data-aplicar-local]').addEventListener('click', () => {
        const pendiente = combinar(guardado.actual, guardado.base || guardado.actual, -1);
        st.actual = combinar(st.actual, pendiente, 1);
        aviso1.hidden = true;
        bots.hidden = true;
        cambio();
      });
    }
  }

  document.addEventListener('visibilitychange', () => { if (document.hidden && st.sucio) guardarAhora(true); });
  window.addEventListener('pagehide', () => { if (st.sucio) guardarAhora(true); });
  window.addEventListener('beforeunload', (e) => { if (st.sucio && !st.bloqueado) { e.preventDefault(); e.returnValue = ''; } });
  escribir(st.actual);
  pintar();
}

// ---------- Totales ----------
function iniciarTotales(f) {
  const urlAuto = f.getAttribute('data-autoguardado');
  const urlCerrar = f.getAttribute('data-cerrar');
  const censo = Number(f.getAttribute('data-censo'));
  const local = lector('tiroriro:senado:' + f.getAttribute('data-clave'));
  const campos = [].slice.call(f.querySelectorAll('input.cuenta-total'));
  const campoVersion = f.elements.version;
  const elSuma = f.querySelector('[data-suma]');
  const elValidas = f.querySelector('[data-validas-v]');
  const elCuadra = f.querySelector('[data-cuadra]');
  const elGuardado = f.querySelector('[data-guardado]');
  const botonGuardar = f.querySelector('[data-guardar]');
  const botonCerrar = f.querySelector('[data-cerrar-mesa]');
  const st = { sucio: false, bloqueado: false, enCurso: false, cambios: 0, temporizador: null, reintento: null, promesa: null, versionServidor: null };

  const todo = () => { const o = {}; campos.forEach((i) => { o[i.name] = i.value; }); return o; };
  const poner = (o) => campos.forEach((i) => { if (Object.prototype.hasOwnProperty.call(o, i.name)) i.value = o[i.name]; });

  function actualizar() {
    let suma = 0;
    campos.forEach((i) => { if (/^c_/.test(i.name)) suma += n0(i.value); });
    const validas = entero(f.elements.validas.value);
    const contadas = n0(f.elements.validas.value) + n0(f.elements.blancas.value) + n0(f.elements.nulas.value);
    elSuma.textContent = String(suma);
    elValidas.textContent = validas === null ? '–' : String(validas);
    let texto = '';
    let bien = false;
    if (validas === null) texto = 'Pon las papeletas válidas para comprobar la suma.';
    else if (suma < validas) texto = '✗ La suma (' + suma + ') es menor que las papeletas válidas (' + validas + ')';
    else if (suma > MAX_MARCAS * validas) texto = '✗ La suma (' + suma + ') supera ' + MAX_MARCAS + ' veces las válidas (' + (MAX_MARCAS * validas) + ')';
    else { texto = '✓ Suma coherente'; bien = true; }
    if (contadas > censo) { texto = '✗ Papeletas contadas (' + contadas + ') > censo (' + censo + ')'; bien = false; }
    elCuadra.textContent = texto;
    elCuadra.className = 'bs-estado ' + (bien ? 'cuadra' : 'no-cuadra');
  }

  function cambio() {
    st.sucio = true;
    st.cambios++;
    local.escribir({ valores: todo(), baseVersion: Number(campoVersion.value), t: Date.now() });
    if (!st.bloqueado) mostrar(elGuardado, 'Sin guardar…', 'pendiente');
    clearTimeout(st.temporizador);
    if (!st.bloqueado) st.temporizador = setTimeout(() => { guardarAhora(true); }, 5000);
    actualizar();
  }

  function guardarAhora(auto) {
    clearTimeout(st.temporizador);
    clearTimeout(st.reintento);
    if (st.bloqueado) return Promise.resolve(false);
    if (st.enCurso) return st.promesa.then(() => (st.sucio ? guardarAhora(auto) : true));
    if (!st.sucio && auto) return Promise.resolve(true);
    const cambiosAlEnviar = st.cambios;
    st.enCurso = true;
    mostrar(elGuardado, 'Guardando…', 'pendiente');
    st.promesa = enviar(f, urlAuto, auto)
      .then((res) => {
        const d = res.datos;
        if (d.ok) {
          campoVersion.value = String(d.version);
          if (st.cambios === cambiosAlEnviar) { st.sucio = false; local.borrar(); } else { cambio(); }
          mostrar(elGuardado, d.estado === 'sin_datos' ? 'Nada que guardar todavía' : 'Guardado ' + d.guardadoEn, 'ok');
          return true;
        }
        if (d.estado === 'conflicto') {
          st.bloqueado = true;
          st.versionServidor = d.version;
          f.querySelector('[data-conflicto]').hidden = false;
          f.querySelector('[data-conflicto-botones]').hidden = false;
          mostrar(elGuardado, 'Sin guardar: conflicto con otro dispositivo', 'error');
          return false;
        }
        if (d.estado === 'error') { mostrar(elGuardado, 'Sin guardar: ' + (d.errores || []).join(' '), 'error'); return false; }
        st.bloqueado = true;
        mostrar(elGuardado, (d.mensaje || 'No se puede guardar.') + ' Lo escrito sigue aquí y en este dispositivo.', 'error');
        return false;
      })
      .catch(() => {
        mostrar(elGuardado, 'Sin guardar: sin conexión. Reintentando…', 'error');
        st.reintento = setTimeout(() => { guardarAhora(true); }, REINTENTO_MS);
        return false;
      })
      .then((ok) => { st.enCurso = false; return ok; });
    return st.promesa;
  }

  f.addEventListener('input', (e) => {
    const i = e.target;
    if (!i || campos.indexOf(i) < 0) return;
    const limpio = i.value.replace(/\D+/g, '').replace(/^0+(?=\d)/, '');
    if (limpio !== i.value) i.value = limpio;
    cambio();
  });
  if (botonGuardar) botonGuardar.addEventListener('click', (e) => { if (!window.fetch) return; e.preventDefault(); guardarAhora(false); });
  if (botonCerrar) {
    botonCerrar.addEventListener('click', (e) => {
      if (!window.fetch) return;
      e.preventDefault();
      guardarAhora(false).then((ok) => {
        if (!ok) { mostrar(elGuardado, 'No se puede cerrar hasta guardar. Revisa el aviso.', 'error'); return; }
        f.action = urlCerrar;
        HTMLFormElement.prototype.submit.call(f);
      });
    });
  }
  f.querySelector('[data-recargar]').addEventListener('click', () => { local.borrar(); window.location.reload(); });
  f.querySelector('[data-sobrescribir]').addEventListener('click', () => {
    campoVersion.value = String(st.versionServidor);
    st.bloqueado = false;
    f.querySelector('[data-conflicto]').hidden = true;
    f.querySelector('[data-conflicto-botones]').hidden = true;
    st.sucio = true;
    guardarAhora(false);
  });

  const guardado = local.leer();
  if (guardado && guardado.valores) {
    const actual = todo();
    const difiere = Object.keys(guardado.valores).some((k) => (actual[k] || '') !== guardado.valores[k]);
    if (!difiere) local.borrar();
    else if (guardado.baseVersion === Number(campoVersion.value)) {
      poner(guardado.valores);
      st.sucio = true;
      st.cambios++;
      mostrar(elGuardado, 'Recuperados cambios sin guardar de este dispositivo', 'pendiente');
      st.temporizador = setTimeout(() => { guardarAhora(true); }, 5000);
    } else {
      const aviso = f.querySelector('[data-borrador-viejo]');
      const bots = f.querySelector('[data-borrador-viejo-botones]');
      aviso.hidden = false;
      bots.hidden = false;
      f.querySelector('[data-descartar-local]').addEventListener('click', () => { local.borrar(); aviso.hidden = true; bots.hidden = true; });
      f.querySelector('[data-aplicar-local]').addEventListener('click', () => { poner(guardado.valores); aviso.hidden = true; bots.hidden = true; cambio(); });
    }
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden && st.sucio) guardarAhora(true); });
  window.addEventListener('pagehide', () => { if (st.sucio) guardarAhora(true); });
  window.addEventListener('beforeunload', (e) => { if (st.sucio && !st.bloqueado) { e.preventDefault(); e.returnValue = ''; } });
  actualizar();
}
