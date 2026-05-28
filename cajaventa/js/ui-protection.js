/*
 * ui-protection.js
 *
 * Muestra un aviso disuasivo en la consola del navegador.
 * NO bloquea herramientas de desarrollo: hacerlo rompe lectores de pantalla,
 * extensiones de accesibilidad y flujos legítimos de depuración.
 */
(function () {
  'use strict';

  const WARNING_TITLE = 'Detente, zona restringida.';
  const WARNING_TEXT  = 'Esta consola es solo para personal autorizado de ALAS.';

  try {
    console.log(
      '%c' + WARNING_TITLE,
      'font-size:24px;font-weight:800;color:#dc2626;'
    );
    console.log(
      '%c' + WARNING_TEXT,
      'font-size:13px;font-weight:600;color:#0f172a;'
    );
  } catch (_) {
    /* consola no disponible */
  }
})();
