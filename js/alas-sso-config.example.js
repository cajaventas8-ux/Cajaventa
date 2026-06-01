/**
 * alas-sso-config.example.js — Plantilla de configuración SSO para CajaVenta
 *
 * INSTRUCCIONES:
 * 1. Copiar este archivo como: js/alas-sso-config.js
 * 2. Reemplazar los valores con los reales de producción.
 * 3. NUNCA commitear js/alas-sso-config.js (está en .gitignore).
 *
 * El secreto SSO_SECRET debe ser IDÉNTICO al VITE_SSO_SECRET
 * configurado en el .env del Launcher y en el sso-config.js del Calendario.
 *
 * Generar un secreto nuevo:
 *   node -e "require('crypto').randomBytes(32).toString('hex')"
 */
window.ALAS_SSO_CONFIG = {
  // Secreto HMAC-SHA-256 — mismo en todos los sistemas
  secret: 'REEMPLAZAR-CON-EL-SECRETO-REAL',

  // URL del Launcher — a dónde redirigir si no hay sesión
  // Desarrollo: 'http://localhost:5173'
  // Producción: 'https://tu-launcher.vercel.app'
  launcherUrl: 'http://localhost:5173',
};
