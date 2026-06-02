/**
 * ALASMotionBridge — alas-transition.js  v1.0
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
  var _rootSel = null   // selector CSS o elemento DOM
  var DUR_IN   = 420   // ms — entrada desde izquierda
  var DUR_OUT  = 260   // ms — salida hacia derecha
  var EASE_IN  = 'cubic-bezier(0.16, 1, 0.3, 1)'  // expo.out — premium sin rebote
  var EASE_OUT = 'cubic-bezier(0.4, 0, 1, 1)'     // ease-in  — salida rápida

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
    el.style.transform  = 'translateX(-24px)'
    el.style.filter     = 'blur(3px)'
    el.style.willChange = 'opacity, transform, filter'
  }

  // ── API pública ────────────────────────────────────────────────────────────
  var ALASTransition = {

    /**
     * Inicializa el bridge. Oculta el elemento raíz para evitar
     * flash de contenido antes de la animación de entrada.
     * @param {Object} opts
     * @param {string|Element} opts.root  Selector CSS o elemento DOM del contenedor principal.
     */
    init: function (opts) {
      opts     = opts || {}
      _rootSel = opts.root || null

      function setup() {
        applyInitialState(getEl())
      }

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', setup, { once: true })
      } else {
        setup()
      }
      return this
    },

    /**
     * Anima el contenedor entrando desde la izquierda.
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

      // Forzar reflow para que la transición CSS parta del estado inicial
      void el.offsetHeight

      el.style.transition = [
        'opacity '   + DUR_IN + 'ms ' + EASE_IN,
        'transform ' + DUR_IN + 'ms ' + EASE_IN,
        'filter '    + DUR_IN + 'ms ' + EASE_IN
      ].join(', ')

      el.style.opacity   = '1'
      el.style.transform = 'none'
      el.style.filter    = 'none'

      setTimeout(function () {
        el.style.transition = ''
        el.style.willChange = ''
      }, DUR_IN + 60)

      return this
    },

    /**
     * Anima el contenedor saliendo hacia la derecha y navega al Launcher.
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

      el.style.transition = [
        'opacity '   + DUR_OUT + 'ms ' + EASE_OUT,
        'transform ' + DUR_OUT + 'ms ' + EASE_OUT,
        'filter '    + DUR_OUT + 'ms ' + EASE_OUT
      ].join(', ')

      void el.offsetHeight

      el.style.opacity   = '0'
      el.style.transform = 'translateX(24px)'
      el.style.filter    = 'blur(3px)'

      setTimeout(function () {
        window.location.href = url
      }, DUR_OUT + 20)

      return this
    }

  }

  // ── Export UMD-lite ────────────────────────────────────────────────────────
  // Funciona como <script> global Y como require() / import en bundlers
  global.ALASTransition = ALASTransition
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ALASTransition
  }

}(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this))
