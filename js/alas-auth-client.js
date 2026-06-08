/**
 * alas-auth-client.js — Cliente SSO para CajaVenta
 *
 * Verifica el token firmado emitido por el Launcher ALAS.
 * Popula localStorage["acuse.currentUser"] con el usuario real,
 * que es la misma clave que supabase.js ya usa para auditoría.
 *
 * IMPORTANTE: SSO_SECRET debe ser idéntico al VITE_SSO_SECRET
 * configurado en el .env del Launcher.
 */
(function () {
  'use strict';

  /* ── Configuración ─────────────────────────────────────────────────────── */
  var _cfg         = window.ALAS_SSO_CONFIG || {};
  var LAUNCHER_URL = _cfg.launcherUrl || 'https://launcher-tawny.vercel.app';
  var SESSION_KEY  = 'alas.sso.session';
  var USER_KEY     = 'acuse.currentUser';

  // Verificación server-side: el secreto vive solo en Supabase, nunca en el cliente.
  var VERIFY_URL      = 'https://xkgumqztscqcwamtimuh.supabase.co/functions/v1/verify-sso-token';
  var SUPABASE_ANON   = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InhrZ3VtcXp0c2NxY3dhbXRpbXVoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODAzMDc0MjEsImV4cCI6MjA5NTg4MzQyMX0.ncD9XUgR6VDhKiShPAwdNgp3tRoKWIlt4JFEq8audX8';

  /* ── Verificación remota via Edge Function ─────────────────────────────── */
  async function verifyToken(token) {
    if (!token || typeof token !== 'string') return null;
    try {
      var res  = await fetch(VERIFY_URL, {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'apikey':        SUPABASE_ANON,
          'Authorization': 'Bearer ' + SUPABASE_ANON,
        },
        body: JSON.stringify({ token: token }),
      });
      var data = await res.json();
      if (!data.valid) {
        console.warn('[ALAS SSO] Token rechazado por el servidor.');
        return null;
      }
      return data.payload;
    } catch (e) {
      console.warn('[ALAS SSO] Error al verificar token:', e.message);
      return null;
    }
  }

  /* ── Persistencia de sesión ────────────────────────────────────────────── */
  function saveSession(payload) {
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify(payload));
      // Poblar la clave que supabase.js ya usa para auditoría (sin romper nada)
      localStorage.setItem(USER_KEY, payload.name || payload.email || 'Operador');
    } catch (e) { /* ignore */ }
  }

  function loadSession() {
    try {
      var raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      var s = JSON.parse(raw);
      if (!s || Date.now() > s.exp) {
        localStorage.removeItem(SESSION_KEY);
        return null;
      }
      return s;
    } catch (e) { return null; }
  }

  function clearSession() {
    try {
      localStorage.removeItem(SESSION_KEY);
      localStorage.removeItem(USER_KEY);
    } catch (e) { /* ignore */ }
  }

  /* ── BroadcastChannel — sincroniza logout entre pestañas del mismo origen ── */
  var _bc = null;
  try {
    _bc = new BroadcastChannel('alas-session');
    _bc.onmessage = function (e) {
      if (e.data === 'logout') {
        clearSession();
        redirectToLauncher('Logout en otra pestaña');
      }
    };
  } catch (_) {}

  /* ── Redirección al Launcher ───────────────────────────────────────────── */
  function redirectToLauncher(reason) {
    console.warn('[ALAS SSO] ' + (reason || 'Sin sesión') + '. Redirigiendo al Launcher...');
    var returnPath = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.replace(LAUNCHER_URL + '?next=' + returnPath);
  }

  /* ── API pública: window.AlasAuthClient ───────────────────────────────── */
  function buildAuthClient(session) {
    window.AlasAuthClient = {
      isAuthenticated: true,
      user: session,

      getCurrentUser: function () {
        return session.name || session.email || 'Operador';
      },
      getUserId: function () {
        return session.userId;
      },
      getRole: function () {
        return session.role;
      },
      hasPermission: function (key) {
        return Array.isArray(session.permissions) &&
               session.permissions.indexOf(key) !== -1;
      },
      logout: function () {
        try { if (_bc) _bc.postMessage('logout'); } catch (_) {}
        clearSession();
        redirectToLauncher('Logout desde CajaVenta');
      },

      // auditAction: registra en supabase.js si ya está cargado,
      // o encola para ejecutar después de que supabase.js cargue.
      auditAction: function (action, details) {
        var userName = session.name || session.email || 'sistema';
        if (window.Supabase && window.Supabase.registrarAuditoria) {
          window.Supabase.registrarAuditoria(action, userName, null, null, details || '');
        }
        console.info('[ALAS AUDIT] ' + action + ' | ' + userName + ' | ' + (details || ''));
      }
    };
  }

  /* ── Init ──────────────────────────────────────────────────────────────── */
  async function init() {
    var params   = new URLSearchParams(window.location.search);
    var rawToken = params.get('alas_token');

    // 1. Hay token en el URL → validar y guardar
    if (rawToken) {
      // Limpiar de la URL ANTES de cualquier otra cosa
      params.delete('alas_token');
      var cleanSearch = params.toString() ? '?' + params.toString() : '';
      window.history.replaceState({}, '', window.location.pathname + cleanSearch);

      var payload = await verifyToken(decodeURIComponent(rawToken));
      if (payload) {
        saveSession(payload);
        buildAuthClient(payload);
        console.info('[ALAS SSO] Sesión establecida. Usuario:', payload.name, '| Rol:', payload.role);
        return; // ✅ Autenticado
      }
      // Token inválido → intentar sesión guardada antes de redirigir
      console.warn('[ALAS SSO] Token del URL rechazado. Verificando sesión guardada...');
    }

    // 2. Sin token en URL → intentar restaurar sesión guardada
    var stored = loadSession();
    if (stored) {
      // Refrescar la clave de auditoría por si se limpió manualmente
      try { localStorage.setItem(USER_KEY, stored.name || stored.email || 'Operador'); } catch (e) {}
      buildAuthClient(stored);
      console.info('[ALAS SSO] Sesión restaurada. Usuario:', stored.name);
      return; // ✅ Autenticado desde caché
    }

    // 3. Sin sesión válida → redirigir al Launcher
    window.AlasAuthClient = { isAuthenticated: false };
    redirectToLauncher('Sin sesión válida');
  }

  init().catch(function (e) {
    console.error('[ALAS SSO] Error crítico:', e.message);
    redirectToLauncher('Error en autenticación');
  });

})();
