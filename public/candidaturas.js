/* Subida del logo de una candidatura: envía la imagen en bruto (PUT) y recarga la pantalla. */
(function () {
  'use strict';
  var TIPOS = ['image/png', 'image/jpeg', 'image/webp'];
  document.addEventListener('change', function (e) {
    var campo = e.target;
    if (!campo || !campo.classList || !campo.classList.contains('archivo-logo')) return;
    var estado = document.getElementById('estado-logo');
    var aviso = function (texto, error) {
      if (estado) { estado.textContent = texto; estado.className = 'nota' + (error ? ' error' : ''); }
    };
    var archivo = campo.files && campo.files[0];
    if (!archivo) return;
    if (TIPOS.indexOf(archivo.type) < 0) return aviso('El logo debe ser PNG, JPEG o WebP (no SVG).', true);
    if (archivo.size > Number(campo.getAttribute('data-max'))) return aviso('El logo es demasiado grande.', true);
    aviso('Subiendo…', false);
    fetch(campo.getAttribute('data-url'), {
      method: 'PUT',
      body: archivo,
      credentials: 'same-origin',
      headers: { 'Content-Type': archivo.type, 'X-CSRF-Token': campo.getAttribute('data-csrf'), 'X-Requested-With': 'fetch' }
    })
      .then(function (r) { return r.json().catch(function () { return { ok: false, error: 'Respuesta no válida.' }; }); })
      .then(function (datos) {
        if (datos.ok) window.location.reload();
        else aviso(datos.error || 'No se ha podido subir el logo.', true);
      })
      .catch(function () { aviso('No se ha podido subir el logo: sin conexión. Inténtalo de nuevo.', true); });
  });
})();
