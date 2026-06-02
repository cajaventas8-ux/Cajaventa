/**
 * ALASMotionBridge — alas-transition.js  v1.1
 * Transición estándar del ecosistema ALAS.
 *
 * Uso:
 *   ALASTransition.init({ root: '.mi-contenedor' })
 *   ALASTransition.enterProject()
 *   ALASTransition.exitToLauncher(url)
 *
 * Compatible: HTML puro, Vanilla JS, Vite, React, CommonJS.
 * No toca: SSO, Supabase, sesiones, lógica de negocio.
 */
;(function (global) {
  'use strict'

  // ── Configuración ──────────────────────────────────────────────────────────
  var _rootSel = null

  // Entrada: slide desde izquierda + scale sutil + fade + blur
  var DUR_IN   = 520
  var EASE_IN  = 'cubic-bezier(0.22, 1, 0.36, 1)'   // expo.out suave — premium sin rebote

  // Salida: slide hacia derecha + scale sutil + fade
  var DUR_OUT  = 300
  var EASE_OUT = 'cubic-bezier(0.55, 0, 1, 0.45)'   // ease-in curvado — salida decisiva

  // ── Helpers ────────────────────────────────────────────────────────────────
  function reduced() {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch (_) { return false }
  }

  function getEl() {
    if (!_rootSel) return null
    if (typeof _rootSel === 'string') return document.querySelector(_rootSel)
    return _rootSel
  }

  function applyInitialState(el) {
    if (!el || reduced()) return
    el.style.opacity    = '0'
    el.style.transform  = 'translateX(-52px) scale(0.96)'
    el.style.filter     = 'blur(6px)'
    el.style.willChange = 'opacity, transform, filter'
  }

  // ── API pública ────────────────────────────────────────────────────────────
  var ALASTransition = {

    /**
     * Inicializa el bridge y oculta el contenedor raíz (anti-flash).
     * @param {{ root: string|Element }} opts
     */
    init: function (opts) {
      opts     = opts || {}
      _rootSel = opts.root || null

      function setup() { applyInitialState(getEl()) }

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setup, { once: true })
      } else {
        setup()
      }
      return this
    },

    /**
     * Anima la entrada del contenedor desde la izquierda.
     * Llamar cuando el contenido principal esté listo en el DOM.
     */
    enterProject: function () {
      var el = getEl()
      if (!el) return this

      if (reduced()) {
        el.style.opacity    = ''
        el.style.transform  = ''
        el.style.filter     = ''
        el.style.transition = ''
        el.style.willChange = ''
        return this
      }

      // Forzar reflow desde el estado inicial oculto
      void el.offsetHeight

      el.style.transition = [
        'opacity '   + DUR_IN + 'ms ' + EASE_IN,
        'transform ' + DUR_IN + 'ms ' + EASE_IN,
        'filter '    + (DUR_IN * 0.7 | 0) + 'ms ' + EASE_IN
      ].join(', ')

      el.style.opacity   = '1'
      el.style.transform = 'translateX(0) scale(1)'
      el.style.filter    = 'blur(0px)'

      setTimeout(function () {
        el.style.transition = ''
        el.style.willChange = ''
        // Limpiar valores inline para no interferir con el CSS del proyecto
        el.style.transform  = ''
        el.style.filter     = ''
      }, DUR_IN + 80)

      return this
    },

    /**
     * Anima la salida del contenedor hacia la derecha y navega al Launcher.
     * No cierra sesión ni toca el SSO.
     * @param {string} url  URL del Launcher ALAS.
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

      void el.offsetHeight

      el.style.transition = [
        'opacity '   + DUR_OUT + 'ms ' + EASE_OUT,
        'transform ' + DUR_OUT + 'ms ' + EASE_OUT,
        'filter '    + (DUR_OUT * 0.6 | 0) + 'ms ' + EASE_OUT
      ].join(', ')

      el.style.opacity   = '0'
      el.style.transform = 'translateX(52px) scale(0.97)'
      el.style.filter    = 'blur(4px)'

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
