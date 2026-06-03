/**
 * ui-protection.js — ALAS Ecosystem  v1.1
 *
 * Muestra un aviso disuasivo en la consola del navegador.
 * NO bloquea DevTools: hacerlo rompe lectores de pantalla,
 * extensiones de accesibilidad y flujos legítimos de depuración.
 *
 * Carga: <script src="/js/ui-protection.js" defer></script>
 */
;(function () {
  'use strict';

  var VERSION = '1.1';

  // ── Colores del ecosistema ALAS ──────────────────────────────────────────
  var C_BRAND = '#0B5F8D';  // azul primario
  var C_RED   = '#dc2626';  // rojo terminal
  var C_MUTED = '#64748b';  // gris secundario (visible en tema claro y oscuro)
  var MONO    = 'font-family:ui-monospace,"Cascadia Code","Fira Code",monospace;';

  // ── Leer sesión activa (sin romper si no existe) ─────────────────────────
  function getSession() {
    try {
      // 1. Módulos vanilla con SSO client cargado (cajaventa, Calendario, itemsborrados)
      if (window.AlasAuthClient && window.AlasAuthClient.isAuthenticated) {
        return {
          name: window.AlasAuthClient.getCurrentUser(),
          role: window.AlasAuthClient.getRole()
        };
      }
      // 2. Sesión SSO en caché (módulos vanilla)
      var raw = localStorage.getItem('alas.sso.session');
      if (raw) {
        var s = JSON.parse(raw);
        if (s && Date.now() < s.exp) {
          return { name: s.name || s.email, role: s.role };
        }
      }
      // 3. Usuario activo del launcher (React — escrito por AuthContext al cargar perfil)
      var cu = localStorage.getItem('alas.current_user');
      if (cu) {
        var u = JSON.parse(cu);
        if (u && u.name) return { name: u.name, role: u.role };
      }
    } catch (_) {}
    return null;
  }

  // ── Banner ────────────────────────────────────────────────────────────────
  function showBanner() {
    var session = getSession();

    // Marca ALAS
    console.log('%c⬡  ALAS · Sistema Logístico',
      MONO + 'color:' + C_BRAND + ';font-size:11px;font-weight:700;letter-spacing:0.08em;');

    console.log('');

    // Detección
    console.log('%c🔍  Detectando curioso...',
      MONO + 'color:' + C_RED + ';font-size:13px;font-weight:600;');

    console.log('');

    // Barra de progreso estilo terminal
    console.log('%c██████████████████  100%',
      MONO + 'color:' + C_RED + ';font-size:12px;letter-spacing:0.02em;');

    console.log('');

    // Resultado
    console.log('%cResultado:',
      MONO + 'color:' + C_MUTED + ';font-size:10px;letter-spacing:0.06em;text-transform:uppercase;');

    console.log('%cUsuario extremadamente curioso detectado.',
      MONO + 'color:' + C_MUTED + ';font-size:12px;');

    console.log('');

    // Nivel de amenaza
    console.log('%cNivel de amenaza:',
      MONO + 'color:' + C_MUTED + ';font-size:10px;letter-spacing:0.06em;text-transform:uppercase;');

    console.log('%cInofensivo 😄',
      MONO + 'color:' + C_MUTED + ';font-size:12px;');

    console.log('');

    // Usuario y rol (solo si hay sesión)
    if (session && session.name) {
      var roleLabel = (session.role || '—').toUpperCase();
      console.log('%c👤  ' + session.name + '  ·  ' + roleLabel,
        MONO + 'color:' + C_BRAND + ';font-size:11px;font-weight:700;letter-spacing:0.04em;');
      console.log('');
    }
  }

  // ── Ejecución en idle — sin impacto en render ni transiciones ────────────
  try {
    if (typeof requestIdleCallback === 'function') {
      requestIdleCallback(showBanner, { timeout: 3000 });
    } else {
      setTimeout(showBanner, 0);
    }
  } catch (_) {}

}());
