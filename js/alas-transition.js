/**
 * ALASMotionBridge — alas-transition.js  v1.2
 * Transición estándar del ecosistema ALAS.
 * Estilo "Empuje desde la derecha" — como PowerPoint / iOS navigation.
 *
 * Entrada:  contenido llega DESDE LA DERECHA → se asienta al centro
 * Salida:   contenido vuelve HACIA LA DERECHA → (regresa de donde vino)
 *
 * Uso:
 *   ALASTransition.init({ root: '.mi-contenedor' })
 *   ALASTransition.enterProject()
 *   ALASTransition.exitToLauncher(url)
 *
 * Compatible: HTML puro, Vanilla JS, Vite, React.
 * No toca: SSO, Supabase, sesiones, lógica de negocio.
 */
;(function (global) {
  'use strict'

  var _rootSel = null

  // ── Valores del movimiento ─────────────────────────────────────────────────
  // El contenido "vive" a la derecha cuando no está en pantalla
  var X_OUT   = '72px'    // desplazamiento horizontal fuera de pantalla
  var SC_OUT  = '0.96'    // escala ligeramente reducida cuando está fuera
  var BL_OUT  = '5px'     // blur suave cuando está fuera

  // Entrada: desde derecha → centro, suave y fluida
  var DUR_IN  = 480                             // ms
  var ESE_IN  = 'cubic-bezier(0.22, 1, 0.36, 1)'  // expo.out premium

  // Salida: desde centro → derecha, rápida y decisiva
  var DUR_OUT = 300                              // ms
  var ESE_OUT = 'cubic-bezier(0.55, 0, 0.8, 0.35)' // ease-in curvado

  // ── Helpers ────────────────────────────────────────────────────────────────
  function reduced() {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch (_) { return false }
  }

  function getEl() {
    if (!_rootSel) return null
    if (typeof _rootSel === 'string') return document.querySelector(_rootSel)
    return _rootSel
  }

  // Estado inicial: oculto a la derecha (listo para entrar)
  function setOffscreenRight(el) {
    el.style.opacity    = '0'
    el.style.transform  = 'translateX(' + X_OUT + ') scale(' + SC_OUT + ')'
    el.style.filter     = 'blur(' + BL_OUT + ')'
    el.style.willChange = 'opacity, transform, filter'
  }

  // ── API pública ────────────────────────────────────────────────────────────
  var ALASTransition = {

    /**
     * Inicializa el bridge.
     * Mueve el contenedor fuera de pantalla hacia la derecha (anti-flash).
     */
    init: function (opts) {
      opts     = opts || {}
      _rootSel = opts.root || null

      function setup() {
        var el = getEl()
        if (el && !reduced()) setOffscreenRight(el)
      }

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setup, { once: true })
      } else {
        setup()
      }
      return this
    },

    /**
     * Anima la entrada desde la derecha hacia el centro.
     * Llamar cuando el contenido principal esté listo en el DOM.
     */
    enterProject: function () {
      var el = getEl()
      if (!el) return this

      if (reduced()) {
        // Sin animación: mostrar inmediatamente
        el.style.opacity = el.style.transform = el.style.filter =
          el.style.transition = el.style.willChange = ''
        return this
      }

      // Forzar reflow desde el estado desplazado a la derecha
      void el.offsetHeight

      // Animar hacia el centro
      el.style.transition = [
        'opacity '   + DUR_IN + 'ms ' + ESE_IN,
        'transform ' + DUR_IN + 'ms ' + ESE_IN,
        'filter '    + Math.round(DUR_IN * 0.65) + 'ms ' + ESE_IN
      ].join(', ')

      el.style.opacity   = '1'
      el.style.transform = 'translateX(0) scale(1)'
      el.style.filter    = 'blur(0px)'

      // Limpiar estilos inline al terminar
      setTimeout(function () {
        el.style.transition = ''
        el.style.willChange = ''
        el.style.transform  = ''
        el.style.filter     = ''
      }, DUR_IN + 80)

      return this
    },

    /**
     * Anima la salida de vuelta hacia la derecha y navega al Launcher.
     * El contenido "vuelve de donde vino" — misma dirección que la entrada.
     * No cierra sesión ni toca el SSO.
     */
    exitToLauncher: function (url) {
      if (!url) {
        if (typeof console !== 'undefined') console.warn('[ALASTransition] exitToLauncher: se requiere una URL')
        return this
      }

      var el = getEl()

      if (!el || reduced()) {
        window.location.href = url
        return this
      }

      // Partir desde el estado visible actual
      el.style.opacity   = '1'
      el.style.transform = 'translateX(0) scale(1)'
      el.style.filter    = 'blur(0px)'
      el.style.willChange = 'opacity, transform, filter'

      void el.offsetHeight

      // Animar de vuelta a la derecha (misma dirección que la entrada)
      el.style.transition = [
        'opacity '   + DUR_OUT + 'ms ' + ESE_OUT,
        'transform ' + DUR_OUT + 'ms ' + ESE_OUT,
        'filter '    + Math.round(DUR_OUT * 0.6) + 'ms ' + ESE_OUT
      ].join(', ')

      el.style.opacity   = '0'
      el.style.transform = 'translateX(' + X_OUT + ') scale(' + SC_OUT + ')'
      el.style.filter    = 'blur(' + BL_OUT + ')'

      setTimeout(function () {
        window.location.href = url
      }, DUR_OUT + 30)

      return this
    }

  }

  // ── Export UMD-lite ────────────────────────────────────────────────────────
  global.ALASTransition = ALASTransition
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ALASTransition
  }

}(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this))
