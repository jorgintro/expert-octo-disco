/* Mejora progresiva del formulario de participación: tolera mala conexión móvil.
 * Sin JavaScript el formulario funciona igual (envío normal). Con JavaScript:
 *  - envía con fetch, con tiempo máximo y hasta 3 intentos (guardar dos veces el mismo dato es inocuo);
 *  - si falla, muestra un mensaje claro y NO borra lo escrito;
 *  - guarda un borrador en este dispositivo y lo recupera si se recarga o se cierra la página.
 */
(function () {
  'use strict';

  var INTENTOS = 3;
  var ESPERA_MS = 12000;
  var CADUCIDAD_BORRADOR_MS = 12 * 60 * 60 * 1000;

  function almacen() {
    try {
      var prueba = '__tiroriro__';
      window.localStorage.setItem(prueba, '1');
      window.localStorage.removeItem(prueba);
      return window.localStorage;
    } catch (e) {
      return null;
    }
  }
  var memoria = almacen();

  function claveBorrador(formulario) {
    var corte = formulario.querySelector('[name="corte"]');
    return 'tiroriro:borrador:' + formulario.getAttribute('action') + ':' + (corte ? corte.value : '');
  }
  function guardarBorrador(formulario, valor) {
    if (!memoria) return;
    try {
      memoria.setItem(claveBorrador(formulario), JSON.stringify({ valor: valor, t: Date.now() }));
    } catch (e) { /* sin espacio o bloqueado: se sigue sin borrador */ }
  }
  function leerBorrador(formulario) {
    if (!memoria) return null;
    try {
      var d = JSON.parse(memoria.getItem(claveBorrador(formulario)) || 'null');
      return d && Date.now() - d.t < CADUCIDAD_BORRADOR_MS ? d.valor : null;
    } catch (e) {
      return null;
    }
  }
  function borrarBorrador(formulario) {
    if (!memoria) return;
    try { memoria.removeItem(claveBorrador(formulario)); } catch (e) { /* nada */ }
  }

  function estado(formulario, texto, esError) {
    var zona = formulario.querySelector('.estado-envio');
    if (!zona) return;
    zona.textContent = texto || '';
    zona.className = 'estado-envio' + (esError ? ' error' : '');
  }

  function recuperarBorrador() {
    var campo = document.getElementById('votantes');
    if (!campo || campo.form === null || !campo.form.classList.contains('form-dato')) return;
    var borrador = leerBorrador(campo.form);
    if (borrador !== null && borrador !== campo.value) {
      campo.value = borrador;
      estado(campo.form, 'Se ha recuperado lo que habías escrito y no se llegó a guardar. Pulsa Guardar.', false);
    }
  }

  document.addEventListener('input', function (e) {
    if (e.target && e.target.name === 'votantes' && e.target.form && e.target.form.classList.contains('form-dato')) {
      guardarBorrador(e.target.form, e.target.value);
    }
  });

  function espera(ms) {
    return new Promise(function (resolver) { setTimeout(resolver, ms); });
  }

  function intentar(formulario, cuerpo, numero) {
    var control = new AbortController();
    var temporizador = setTimeout(function () { control.abort(); }, ESPERA_MS);
    return fetch(formulario.action, {
      method: 'POST',
      body: cuerpo,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Requested-With': 'fetch' },
      credentials: 'same-origin',
      signal: control.signal
    })
      .then(function (respuesta) {
        clearTimeout(temporizador);
        if (respuesta.status >= 500) throw new Error('servidor ' + respuesta.status);
        return respuesta;
      })
      .catch(function (error) {
        clearTimeout(temporizador);
        if (numero >= INTENTOS) throw error;
        estado(formulario, 'Sin conexión estable. Reintentando (' + (numero + 1) + ' de ' + INTENTOS + ')…', false);
        return espera(1000 * numero).then(function () { return intentar(formulario, cuerpo, numero + 1); });
      });
  }

  document.addEventListener('submit', function (e) {
    var formulario = e.target;
    if (!formulario.classList || !formulario.classList.contains('form-dato') || !window.fetch || !window.AbortController) return;
    e.preventDefault();
    var boton = formulario.querySelector('button[type="submit"]');
    var cuerpo = new URLSearchParams(new FormData(formulario)).toString();
    if (boton) boton.disabled = true;
    estado(formulario, 'Guardando…', false);

    intentar(formulario, cuerpo, 1)
      .then(function (respuesta) {
        var url = new URL(respuesta.url);
        var seccion = formulario.getAttribute('action').split('/')[1];
        if (url.pathname.split('/')[1] !== seccion) {
          // Redirigido a la entrada: la sesión ha caducado. El borrador queda en este dispositivo.
          estado(formulario, 'Tu sesión ha caducado. Lo escrito se conserva en este dispositivo: vuelve a entrar y pulsa Guardar.', true);
          if (boton) boton.disabled = false;
          return null;
        }
        return respuesta.text().then(function (texto) {
          var nuevo = new DOMParser().parseFromString(texto, 'text/html');
          var principal = document.querySelector('main');
          var nueva = nuevo.querySelector('main');
          if (!principal || !nueva) { window.location.href = respuesta.url; return; }
          principal.innerHTML = nueva.innerHTML;
          document.title = nuevo.title;
          if (respuesta.url !== window.location.href) window.history.replaceState(null, '', respuesta.url);
          if (/[?&]ok=dato_/.test(url.search)) borrarBorrador(formulario); // guardado: ya no hace falta
          recuperarBorrador();
          window.scrollTo(0, 0);
        });
      })
      .catch(function () {
        estado(formulario, 'No se ha podido guardar: no hay conexión con el servidor. Tu dato sigue aquí y se conserva en este dispositivo. Pulsa Guardar para reintentar.', true);
        if (boton) boton.disabled = false;
      });
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', recuperarBorrador);
  else recuperarBorrador();
})();
