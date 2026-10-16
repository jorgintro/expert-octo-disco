// Checklist del kit: marcas y horas guardadas SOLO en este dispositivo (localStorage), ligadas a la
// clave del agente. Sin localStorage la página funciona igual, pero no recuerda tras cerrarla.
(function () {
  'use strict';
  var raiz = document.getElementById('kit');
  if (!raiz) return;
  var clave = raiz.getAttribute('data-clave');
  var colegio = raiz.getAttribute('data-colegio') || '';
  var modo = raiz.getAttribute('data-modo') || '';
  var estadoEl = document.getElementById('kit-estado');
  var areaEl = document.getElementById('kit-texto');
  var casillas = Array.prototype.slice.call(raiz.querySelectorAll('input[data-id]'));
  var marcas = {}; // id -> ISO UTC
  var hayAlmacen = true;

  function leer() {
    try {
      var bruto = window.localStorage.getItem(clave);
      var datos = bruto ? JSON.parse(bruto) : {};
      return datos && typeof datos === 'object' && !Array.isArray(datos) ? datos : {};
    } catch (e) { hayAlmacen = false; return {}; }
  }
  function guardar() {
    try { window.localStorage.setItem(clave, JSON.stringify(marcas)); } catch (e) { hayAlmacen = false; avisarAlmacen(); }
  }
  function avisarAlmacen() {
    var aviso = document.getElementById('kit-sin-almacen');
    if (aviso) aviso.hidden = hayAlmacen;
  }

  function horaMadrid(iso) {
    try {
      return new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));
    } catch (e) { return ''; }
  }
  function fechaHoraMadrid(fecha) {
    try {
      return new Intl.DateTimeFormat('es-ES', { timeZone: 'Europe/Madrid', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(fecha).replace(',', '');
    } catch (e) { return fecha.toISOString(); }
  }

  function pintar() {
    casillas.forEach(function (c) {
      var iso = marcas[c.getAttribute('data-id')];
      c.checked = !!iso;
      var hora = c.closest('.kit-punto').querySelector('[data-hora]');
      hora.textContent = iso ? 'Hecho a las ' + horaMadrid(iso) : '';
    });
    var total = 0;
    Array.prototype.forEach.call(raiz.querySelectorAll('[data-fase]'), function (fase) {
      var cs = fase.querySelectorAll('input[data-id]');
      var hechas = 0;
      Array.prototype.forEach.call(cs, function (c) { if (c.checked) hechas++; });
      total += hechas;
      fase.querySelector('[data-progreso]').textContent = hechas + '/' + cs.length;
    });
    raiz.querySelector('[data-total]').textContent = total;
    if (areaEl) areaEl.value = construirTexto();
  }

  function construirTexto() {
    var lineas = [];
    var total = 0;
    var todos = 0;
    var bloques = [];
    Array.prototype.forEach.call(raiz.querySelectorAll('[data-fase]'), function (fase) {
      var cs = fase.querySelectorAll('input[data-id]');
      var hechas = 0;
      var cuerpo = [];
      Array.prototype.forEach.call(cs, function (c) {
        var iso = marcas[c.getAttribute('data-id')];
        var texto = c.parentNode.querySelector('.kit-texto').childNodes[0].nodeValue.trim();
        if (iso) hechas++;
        cuerpo.push((iso ? '✅ ' : '⬜ ') + texto + (iso ? ' (' + horaMadrid(iso) + ')' : ''));
      });
      total += hechas;
      todos += cs.length;
      var titulo = fase.querySelector('h2').childNodes[0].nodeValue.trim();
      bloques.push('*' + titulo + '* (' + hechas + '/' + cs.length + ')\n' + cuerpo.join('\n'));
    });
    if (modo === 'DEMO') lineas.push('*** DEMO - DATOS DE PRUEBA, NO SON REALES ***');
    lineas.push('*Checklist de la jornada*' + (colegio ? ' · ' + colegio : ''));
    lineas.push(fechaHoraMadrid(new Date()) + ' · ' + total + '/' + todos + ' hechos');
    lineas.push('');
    lineas.push(bloques.join('\n\n'));
    if (modo === 'DEMO') { lineas.push(''); lineas.push('*** DEMO - DATOS DE PRUEBA, NO SON REALES ***'); }
    return lineas.join('\n');
  }

  function mensaje(texto) { if (estadoEl) estadoEl.textContent = texto; }

  function copiar() {
    if (!areaEl) return;
    areaEl.value = construirTexto();
    function bien() { mensaje('Copiado. Ya puedes pegarlo en WhatsApp.'); }
    function manual() {
      var d = areaEl.closest('details');
      if (d) d.open = true;
      areaEl.focus();
      areaEl.select();
      mensaje('No se ha podido copiar solo: el texto está seleccionado, cópialo manualmente.');
    }
    function conSeleccion() {
      try {
        var d = areaEl.closest('details');
        if (d) d.open = true;
        areaEl.focus();
        areaEl.select();
        if (document.execCommand('copy')) bien(); else manual();
      } catch (e) { manual(); }
    }
    if (navigator.clipboard && window.isSecureContext) navigator.clipboard.writeText(areaEl.value).then(bien, conSeleccion);
    else conSeleccion();
  }

  raiz.addEventListener('change', function (e) {
    var c = e.target;
    if (!c || !c.matches || !c.matches('input[data-id]')) return;
    var id = c.getAttribute('data-id');
    if (c.checked) marcas[id] = new Date().toISOString();
    else delete marcas[id];
    guardar();
    pintar();
    mensaje('');
  });

  raiz.addEventListener('click', function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    var confirmar = raiz.querySelector('[data-confirmar]');
    if (t.closest('[data-copiar-kit]')) { copiar(); return; }
    if (t.closest('[data-reiniciar]')) { confirmar.hidden = false; confirmar.querySelector('[data-reiniciar-no]').focus(); return; }
    if (t.closest('[data-reiniciar-no]')) { confirmar.hidden = true; return; }
    if (t.closest('[data-reiniciar-si]')) {
      marcas = {};
      guardar();
      pintar();
      confirmar.hidden = true;
      mensaje('Checklist reiniciado.');
    }
  });

  // Al imprimir, las secciones de la guía salen desplegadas.
  window.addEventListener('beforeprint', function () {
    Array.prototype.forEach.call(raiz.querySelectorAll('details'), function (d) { d.open = true; });
  });

  var guardadas = leer();
  casillas.forEach(function (c) {
    var id = c.getAttribute('data-id');
    if (typeof guardadas[id] === 'string' && !isNaN(Date.parse(guardadas[id]))) marcas[id] = guardadas[id];
  });
  avisarAlmacen();
  pintar();
}());
