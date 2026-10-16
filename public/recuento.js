/* Formulario de recuento «clicker»: «+» suma un voto y «–» lo resta (la mesa canta el voto uno a uno);
 * opcionalmente se pueden teclear los números. Suma en vivo, autoguardado del borrador con control de
 * versión, borrador local en el dispositivo y reintentos si falla la conexión.
 * Sin JavaScript el formulario funciona igual (se teclean los números y se envía). */
(function () {
  'use strict';

  var form = document.querySelector('form.form-recuento');
  if (!form) return;

  var RETRASO_MS = 5000;     // autoguardado tras el último toque
  var REINTENTO_MS = 8000;   // reintento si no hay conexión
  var MAX = 9999999;

  var urlAuto = form.getAttribute('data-autoguardado');
  var urlCerrar = form.getAttribute('data-cerrar');
  var censo = Number(form.getAttribute('data-censo'));
  var claveLocal = 'tiroriro:recuento:' + form.getAttribute('data-clave');
  var campoVersion = form.elements.version;
  var votantes = form.elements.votantes;
  var cuentas = [].slice.call(form.querySelectorAll('input.cuenta'));
  var todos = cuentas.concat([votantes]);
  var elSuma = form.querySelector('[data-suma]');
  var elVotantes = form.querySelector('[data-votantes]');
  var elCuadra = form.querySelector('[data-cuadra]');
  var elGuardado = form.querySelector('[data-guardado]');
  var elOtros = form.querySelector('[data-suma-otros]');
  var botonCerrar = form.querySelector('[data-cerrar-mesa]');
  var botonGuardar = form.querySelector('[data-guardar]');
  var botonCeros = form.querySelector('[data-poner-ceros]');
  var interruptor = form.querySelector('[data-teclear]');
  var checkTeclear = document.getElementById('teclear');

  var estado = { sucio: false, bloqueado: false, enCurso: false, cambios: 0, temporizador: null, reintento: null, promesa: null, versionServidor: null };

  // ---------- almacenamiento local ----------
  function almacen() {
    try {
      window.localStorage.setItem('__t__', '1');
      window.localStorage.removeItem('__t__');
      return window.localStorage;
    } catch (e) { return null; }
  }
  var memoria = almacen();
  function leerLocal() {
    if (!memoria) return null;
    try { return JSON.parse(memoria.getItem(claveLocal) || 'null'); } catch (e) { return null; }
  }
  function guardarLocal() {
    if (!memoria) return;
    try { memoria.setItem(claveLocal, JSON.stringify({ valores: leerTodo(), baseVersion: Number(campoVersion.value), t: Date.now() })); } catch (e) { /* sin espacio */ }
  }
  function borrarLocal() {
    if (memoria) { try { memoria.removeItem(claveLocal); } catch (e) { /* nada */ } }
  }

  // ---------- valores ----------
  function entero(texto) {
    var t = String(texto || '').trim();
    return /^\d+$/.test(t) ? Number(t) : null;
  }
  function leerTodo() {
    var o = {};
    todos.forEach(function (i) { o[i.name] = i.value; });
    return o;
  }
  function escribirTodo(o) {
    todos.forEach(function (i) { if (Object.prototype.hasOwnProperty.call(o, i.name)) i.value = o[i.name]; });
  }

  // ---------- comprobación de la suma ----------
  function actualizar() {
    var suma = 0;
    var vacias = 0;
    cuentas.forEach(function (i) {
      var v = entero(i.value);
      if (v === null) vacias++; else suma += v;
    });
    var v = entero(votantes.value);
    if (v === null) vacias++;
    if (elSuma) elSuma.textContent = String(suma);
    if (elVotantes) elVotantes.textContent = v === null ? '–' : String(v);
    if (elOtros) {
      var otros = 0;
      [].slice.call(form.querySelectorAll('details.otros input.cuenta')).forEach(function (i) { otros += entero(i.value) || 0; });
      elOtros.textContent = String(otros);
    }
    var texto, cuadra = false, valido = false;
    if (v === null) {
      texto = 'Pon el total de votantes para comprobar la suma.';
    } else if (suma !== v) {
      texto = suma < v ? '✗ Faltan ' + (v - suma) : '✗ Sobran ' + (suma - v);
    } else if (vacias > 0) {
      texto = '✓ Cuadra · faltan ' + vacias + ' campos por rellenar (pon 0 si no hay votos)';
      cuadra = true;
    } else {
      texto = '✓ Cuadra';
      cuadra = true;
      valido = v <= censo;
      if (!valido) texto = '✗ El total de votantes supera el censo (' + censo + ')';
    }
    if (elCuadra) {
      elCuadra.textContent = texto;
      elCuadra.className = 'bs-estado ' + (cuadra && valido ? 'cuadra' : 'no-cuadra');
    }
    if (botonCerrar) botonCerrar.disabled = !valido;
  }

  function mostrarGuardado(texto, clase) {
    if (!elGuardado) return;
    elGuardado.textContent = texto;
    elGuardado.className = 'bs-guardado' + (clase ? ' ' + clase : '');
  }

  function marcarCambio() {
    estado.sucio = true;
    estado.cambios++;
    guardarLocal();
    if (!estado.bloqueado) mostrarGuardado('Sin guardar…', 'pendiente');
    programar();
    actualizar();
  }

  // ---------- autoguardado ----------
  function programar() {
    clearTimeout(estado.temporizador);
    if (estado.bloqueado) return;
    estado.temporizador = setTimeout(function () { guardarAhora(true); }, RETRASO_MS);
  }

  function mostrarConflicto(version) {
    estado.bloqueado = true;
    estado.versionServidor = version;
    var m = form.querySelector('[data-conflicto]');
    var b = form.querySelector('[data-conflicto-botones]');
    if (m) m.hidden = false;
    if (b) b.hidden = false;
    mostrarGuardado('Sin guardar: conflicto con otro dispositivo', 'error');
    if (m && m.scrollIntoView) m.scrollIntoView({ block: 'center' });
  }

  function bloquearConMensaje(mensaje) {
    estado.bloqueado = true;
    clearTimeout(estado.temporizador);
    mostrarGuardado((mensaje || 'No se puede guardar.') + ' Lo escrito sigue aquí y en este dispositivo.', 'error');
  }

  // Devuelve una promesa con true si todo lo escrito está guardado en el servidor.
  function guardarAhora(auto) {
    clearTimeout(estado.temporizador);
    clearTimeout(estado.reintento);
    if (estado.bloqueado) return Promise.resolve(false);
    if (estado.enCurso) {
      return estado.promesa.then(function () { return estado.sucio ? guardarAhora(auto) : true; });
    }
    if (!estado.sucio && auto) return Promise.resolve(true);
    var cambiosAlEnviar = estado.cambios;
    var cuerpo = new URLSearchParams(new FormData(form));
    cuerpo.set('auto', auto ? '1' : '0');
    estado.enCurso = true;
    mostrarGuardado('Guardando…', 'pendiente');
    var control = typeof AbortController === 'function' ? new AbortController() : null;
    var limite = setTimeout(function () { if (control) control.abort(); }, 12000);
    estado.promesa = fetch(urlAuto, {
      method: 'POST',
      body: cuerpo.toString(),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'fetch' },
      credentials: 'same-origin',
      keepalive: cuerpo.toString().length < 60000,
      signal: control ? control.signal : undefined
    })
      .then(function (r) {
        clearTimeout(limite);
        if (r.status >= 500) throw new Error('servidor ' + r.status);
        return r.json().catch(function () { throw new Error('respuesta no válida'); }).then(function (d) { return { status: r.status, datos: d }; });
      })
      .then(function (res) {
        var d = res.datos;
        if (d.ok) {
          campoVersion.value = String(d.version);
          if (estado.cambios === cambiosAlEnviar) { estado.sucio = false; borrarLocal(); }
          else { guardarLocal(); programar(); }
          mostrarGuardado('Guardado ' + d.guardadoEn, 'ok');
          return true;
        }
        if (d.estado === 'conflicto') { mostrarConflicto(d.version); return false; }
        if (d.estado === 'error') { mostrarGuardado('Sin guardar: ' + (d.errores || []).join(' '), 'error'); return false; }
        bloquearConMensaje(d.mensaje);
        return false;
      })
      .catch(function () {
        clearTimeout(limite);
        mostrarGuardado('Sin guardar: sin conexión. Reintentando…', 'error');
        estado.reintento = setTimeout(function () { guardarAhora(true); }, REINTENTO_MS);
        return false;
      })
      .then(function (ok) { estado.enCurso = false; return ok; });
    return estado.promesa;
  }

  // ---------- clicker ----------
  form.addEventListener('click', function (e) {
    var boton = e.target.closest ? e.target.closest('button[data-delta]') : null;
    if (!boton || estado.bloqueado && false) return;
    var entrada = boton.parentNode.querySelector('input.cuenta');
    var actual = entero(entrada.value);
    var delta = Number(boton.getAttribute('data-delta'));
    var nuevo = actual;
    if (delta > 0) nuevo = actual === null ? 1 : Math.min(actual + 1, MAX);
    else if (actual !== null && actual > 0) nuevo = actual - 1;
    if (nuevo === actual) return;
    entrada.value = String(nuevo);
    if (navigator.vibrate) { try { navigator.vibrate(8); } catch (err) { /* sin vibración */ } }
    marcarCambio();
  });

  form.addEventListener('input', function (e) {
    var i = e.target;
    if (!i || todos.indexOf(i) < 0) return;
    var limpio = i.value.replace(/\D+/g, '').replace(/^0+(?=\d)/, '');
    if (limpio !== i.value) i.value = limpio;
    marcarCambio();
  });

  // Modo «teclear»: por defecto los contadores son de solo lectura (un toque accidental no abre el teclado).
  function aplicarTeclear() {
    var teclear = checkTeclear && checkTeclear.checked;
    cuentas.forEach(function (i) { i.readOnly = !teclear; });
    if (memoria) { try { memoria.setItem('tiroriro:teclear', teclear ? '1' : '0'); } catch (err) { /* nada */ } }
  }
  [].slice.call(form.querySelectorAll('button[data-delta]')).forEach(function (b) { b.hidden = false; });
  if (botonCeros) botonCeros.hidden = false;
  if (interruptor) interruptor.hidden = false;
  if (checkTeclear) {
    checkTeclear.checked = memoria && memoria.getItem('tiroriro:teclear') === '1';
    checkTeclear.addEventListener('change', aplicarTeclear);
  }
  aplicarTeclear();

  if (botonCeros) {
    botonCeros.addEventListener('click', function () {
      var cambiado = false;
      cuentas.forEach(function (i) { if (i.value === '') { i.value = '0'; cambiado = true; } });
      if (cambiado) marcarCambio();
    });
  }

  // ---------- botones de guardar y cerrar ----------
  if (botonGuardar) {
    botonGuardar.addEventListener('click', function (e) {
      if (!window.fetch) return; // sin fetch: envío normal
      e.preventDefault();
      guardarAhora(false);
    });
  }
  if (botonCerrar) {
    botonCerrar.addEventListener('click', function (e) {
      if (!window.fetch) return;
      e.preventDefault();
      guardarAhora(false).then(function (ok) {
        if (!ok) { mostrarGuardado('No se puede cerrar hasta guardar. Revisa el aviso de arriba.', 'error'); return; }
        form.action = urlCerrar;
        HTMLFormElement.prototype.submit.call(form);
      });
    });
  }

  // ---------- conflicto y borrador local de una versión anterior ----------
  var botonRecargar = form.querySelector('[data-recargar]');
  var botonSobrescribir = form.querySelector('[data-sobrescribir]');
  if (botonRecargar) botonRecargar.addEventListener('click', function () { borrarLocal(); window.location.reload(); });
  if (botonSobrescribir) {
    botonSobrescribir.addEventListener('click', function () {
      campoVersion.value = String(estado.versionServidor);
      estado.bloqueado = false;
      form.querySelector('[data-conflicto]').hidden = true;
      form.querySelector('[data-conflicto-botones]').hidden = true;
      estado.sucio = true;
      guardarAhora(false);
    });
  }

  var local = leerLocal();
  if (local && local.valores) {
    var actualValores = leerTodo();
    var difiere = Object.keys(local.valores).some(function (k) { return (actualValores[k] || '') !== local.valores[k]; });
    if (!difiere) {
      borrarLocal();
    } else if (local.baseVersion === Number(campoVersion.value)) {
      escribirTodo(local.valores);
      estado.sucio = true;
      estado.cambios++;
      mostrarGuardado('Recuperados cambios sin guardar de este dispositivo', 'pendiente');
      programar();
    } else {
      var aviso = form.querySelector('[data-borrador-viejo]');
      var botones = form.querySelector('[data-borrador-viejo-botones]');
      if (aviso) aviso.hidden = false;
      if (botones) botones.hidden = false;
      var d = form.querySelector('[data-descartar-local]');
      var a = form.querySelector('[data-aplicar-local]');
      if (d) d.addEventListener('click', function () { borrarLocal(); aviso.hidden = true; botones.hidden = true; });
      if (a) a.addEventListener('click', function () {
        escribirTodo(local.valores);
        aviso.hidden = true;
        botones.hidden = true;
        marcarCambio();
      });
    }
  }

  // Al salir o esconder la página, intenta guardar lo pendiente; y avisa si se va a perder algo.
  document.addEventListener('visibilitychange', function () { if (document.hidden && estado.sucio) guardarAhora(true); });
  window.addEventListener('pagehide', function () { if (estado.sucio) guardarAhora(true); });
  window.addEventListener('beforeunload', function (e) {
    if (estado.sucio && !estado.bloqueado) { e.preventDefault(); e.returnValue = ''; }
  });

  actualizar();
})();
