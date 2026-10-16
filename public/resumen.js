/* Panel resumen y /pantallazo: sondeo periódico, "Copiar como texto" y "Modo captura".
 * Sin JavaScript las páginas siguen siendo válidas (se ven los datos del momento de la carga). */
(function () {
  'use strict';

  var ESPERA_MS = 8000;
  var marca = document.getElementById('sondeo');
  var intervalo = marca ? Number(marca.getAttribute('data-intervalo')) || 5000 : 0;
  var enCurso = false;
  var temporizador = null;

  function reemplazar(nuevo, selector) {
    var actual = document.querySelector(selector);
    var otro = nuevo.querySelector(selector);
    if (actual && otro) actual.replaceWith(document.importNode(otro, true));
  }

  // Desglose de «Otros» del pantallazo de recuento: el estado se guarda en el dispositivo y se
  // reaplica tras cada refresco del sondeo y al volver de otra variante.
  var CLAVE_OTROS = 'tiroriro:recuento:otros';
  function aplicarOtros() {
    var d = document.querySelector('details.rec-otros');
    if (!d) return;
    try { if (sessionStorage.getItem(CLAVE_OTROS) === '1') d.open = true; } catch (e) { /* sin almacenamiento */ }
  }
  document.addEventListener('toggle', function (e) {
    var d = e.target;
    if (!d || !d.classList || !d.classList.contains('rec-otros')) return;
    try { sessionStorage.setItem(CLAVE_OTROS, d.open ? '1' : '0'); } catch (err) { /* sin almacenamiento */ }
  }, true);
  aplicarOtros();

  function sesionCaducada() {
    if (temporizador) clearInterval(temporizador);
    document.body.classList.add('sin-conexion');
    var estado = document.getElementById('estado-sondeo');
    if (estado) estado.textContent = 'La sesión ha caducado: vuelve a entrar para seguir viendo datos nuevos.';
  }

  function sondear() {
    if (document.hidden || enCurso || !window.fetch || !window.AbortController) return;
    enCurso = true;
    var control = new AbortController();
    var limite = setTimeout(function () { control.abort(); }, ESPERA_MS);
    fetch(window.location.href, {
      headers: { 'X-Requested-With': 'fetch' },
      credentials: 'same-origin',
      cache: 'no-store',
      signal: control.signal
    })
      .then(function (respuesta) {
        clearTimeout(limite);
        if (new URL(respuesta.url).pathname !== window.location.pathname) {
          sesionCaducada(); // redirigido a la pantalla de acceso
          return null;
        }
        if (!respuesta.ok) throw new Error('http ' + respuesta.status);
        return respuesta.text();
      })
      .then(function (texto) {
        if (texto === null) return;
        var nuevo = new DOMParser().parseFromString(texto, 'text/html');
        var detalles = document.querySelector('main details:not(.rec-otros)');
        var abierto = detalles ? detalles.open : false;
        reemplazar(nuevo, '#banner-modo'); // también cambia si el modo cambia
        reemplazar(nuevo, 'main');
        reemplazar(nuevo, 'footer');
        var nuevosDetalles = document.querySelector('main details:not(.rec-otros)');
        if (nuevosDetalles) nuevosDetalles.open = abierto;
        aplicarOtros();
        document.title = nuevo.title;
        document.body.classList.remove('sin-conexion');
      })
      .catch(function () {
        clearTimeout(limite);
        // Sin conexión: se conserva lo que había y se avisa de forma visible (también en la captura).
        document.body.classList.add('sin-conexion');
      })
      .then(function () { enCurso = false; });
  }

  if (intervalo) {
    temporizador = setInterval(sondear, intervalo);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) sondear(); });
  }

  function copiar() {
    var area = document.getElementById('texto-whatsapp');
    var estado = document.getElementById('estado-copia');
    if (!area || !estado) return;
    function bien() { estado.textContent = 'Copiado. Ya puedes pegarlo en WhatsApp.'; }
    function manual() {
      var detalles = area.closest('details');
      if (detalles) detalles.open = true;
      area.focus();
      area.select();
      estado.textContent = 'No se ha podido copiar solo: el texto está seleccionado, cópialo manualmente.';
    }
    function conSeleccion() {
      try {
        var detalles = area.closest('details');
        if (detalles) detalles.open = true;
        area.focus();
        area.select();
        if (document.execCommand('copy')) bien(); else manual();
      } catch (e) { manual(); }
    }
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(area.value).then(bien, conSeleccion);
    } else {
      conSeleccion();
    }
  }

  document.addEventListener('click', function (e) {
    var destino = e.target;
    if (!destino || !destino.closest) return;
    if (destino.closest('[data-copiar]')) { copiar(); return; }
    if (destino.closest('[data-captura]')) {
      document.body.classList.add('captura');
      window.scrollTo(0, 0);
      return;
    }
    if (document.body.classList.contains('captura') && destino.closest('.lienzo-cabecera')) {
      document.body.classList.remove('captura');
    }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') document.body.classList.remove('captura');
  });
})();
