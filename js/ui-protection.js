/**
 * ui-protection.js — ALAS Ecosystem  v1.0
 *
 * Muestra un aviso disuasivo en la consola del navegador.
 * NO bloquea DevTools: hacerlo rompe lectores de pantalla,
 * extensiones de accesibilidad y flujos legítimos de depuración.
 *
 * Características:
 *   - Banner visual con marca ALAS
 *   - Advertencia "Detente — zona restringida"
 *   - Mensaje anti-phishing (Self-XSS)
 *   - Usuario y rol si están disponibles en sesión
 *   - Sin loops, sin intervals, sin bloqueos
 *   - Compatible: logistic-launcher (React), módulos vanilla JS
 *
 * Carga: <script src="/js/ui-protection.js" defer></script>
 */
;(function () {
  'use strict';

  var VERSION = '1.0';

  // ── Colores del ecosistema ALAS ──────────────────────────────────────────
  var C_BRAND  = '#0B5F8D';  // azul primario
  var C_DANGER = '#dc2626';  // rojo advertencia
  var C_DARK   = '#0f172a';  // texto oscuro
  var C_MUTED  = '#64748b';  // texto secundario

  // ── Leer sesión activa (sin romper si no existe) ─────────────────────────
  function getSession() {
    try {
      // Módulos vanilla con SSO client cargado
      if (window.AlasAuthClient && window.AlasAuthClient.isAuthenticated) {
        return {
          name: window.AlasAuthClient.getCurrentUser(),
          role: window.AlasAuthClient.getRole()
        };
      }
      // Sesión en caché (localStorage) — funciona en todos los módulos
      var raw = localStorage.getItem('alas.sso.session');
      if (raw) {
        var s = JSON.parse(raw);
        if (s && Date.now() < s.exp) {
          return { name: s.name || s.email, role: s.role };
        }
      }
    } catch (_) { /* sin acceso a localStorage o JSON inválido */ }
    return null;
  }

  // ── Banner principal ──────────────────────────────────────────────────────
  function showBanner() {
    var session = getSession();

    // Línea 1 — marca
    console.log(
      '%c⬡  ALAS · Sistema Logístico',
      'font-size:11px;font-weight:700;color:' + C_BRAND + ';letter-spacing:0.06em;'
    );

    // Línea 2 — advertencia principal
    console.log(
      '%cDetente — zona restringida.',
      'font-size:22px;font-weight:800;color:' + C_DANGER + ';line-height:1.3;'
    );

    // Línea 3 — mensaje de seguridad (anti-Self-XSS)
    console.log(
      '%cEsta consola es solo para personal técnico autorizado de ALAS.\n' +
      'Si alguien te pidió pegar código aquí, es un ataque de robo de datos.',
      'font-size:13px;font-weight:500;color:' + C_DARK + ';line-height:1.55;'
    );

    // Línea 4 — sesión activa (opcional — solo si hay datos disponibles)
    if (session && session.name) {
      console.log(
        '%cSesión activa: ' + session.name + '  ·  Rol: ' + (session.role || '—'),
        'font-size:11px;color:' + C_MUTED + ';'
      );
    }

    // Línea 5 — versión y ecosistema
    console.log(
      '%cui-protection.js  v' + VERSION + '  ·  ecosistema ALAS',
      'font-size:10px;color:' + C_MUTED + ';opacity:0.65;'
    );
  }

  // ── Ejecución en idle — no bloquea render ni transiciones ────────────────
  try {
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(showBanner, { timeout: 3000 });
    } else {
      setTimeout(showBanner, 0);
    }
  } catch (_) { /* entorno sin timer API */ }

}());
