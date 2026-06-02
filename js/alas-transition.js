/**
 * ALASMotionBridge — alas-transition.js  v1.3
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
  var X_OUT  = '110px'   // distancia horizontal fuera de pantalla (push dramático)
  var SC_OUT = '0.94'    // escala reducida cuando está fuera
  var BL_OUT = '8px'     // blur al estar fuera

  // Entrada: desde derecha → centro, lenta y cinematográfica
  var DUR_IN  = 800
  var ESE_IN  = 'cubic-bezier(0.22, 1, 0.36, 1)'

  // Salida: desde centro → derecha, fluida pero decisiva
  var DUR_OUT = 550
  var ESE_OUT = 'cubic-bezier(0.55, 0, 0.8, 0.35)'

  // ── Helpers ────────────────────────────────────────────────────────────────
  function reduced() {
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches } catch (_) { return false }
  }

  function getEl() {
    if (!_rootSel) return null
    if (typeof _rootSel === 'string') return document.querySelector(_rootSel)
    return _rootSel
  }

  function setOffscreenRight(el) {
    el.style.opacity    = '0'
    el.style.transform  = 'translateX(' + X_OUT + ') scale(' + SC_OUT + ')'
    el.style.filter     = 'blur(' + BL_OUT + ')'
    el.style.willChange = 'opacity, transform, filter'
  }

  // ── API pública ────────────────────────────────────────────────────────────
  var ALASTransition = {

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

    enterProject: function () {
      var el = getEl()
      if (!el) return this

      if (reduced()) {
        el.style.opacity = el.style.transform = el.style.filter =
          el.style.transition = el.style.willChange = ''
        return this
      }

      void el.offsetHeight

      el.style.transition = [
        'opacity '   + DUR_IN + 'ms ' + ESE_IN,
        'transform ' + DUR_IN + 'ms ' + ESE_IN,
        'filter '    + Math.round(DUR_IN * 0.6) + 'ms ' + ESE_IN
      ].join(', ')

      el.style.opacity   = '1'
      el.style.transform = 'translateX(0) scale(1)'
      el.style.filter    = 'blur(0px)'

      setTimeout(function () {
        el.style.transition = ''
        el.style.willChange = ''
        el.style.transform  = ''
        el.style.filter     = ''
      }, DUR_IN + 100)

      return this
    },

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

      el.style.opacity    = '1'
      el.style.transform  = 'translateX(0) scale(1)'
      el.style.filter     = 'blur(0px)'
      el.style.willChange = 'opacity, transform, filter'

      void el.offsetHeight

      el.style.transition = [
        'opacity '   + DUR_OUT + 'ms ' + ESE_OUT,
        'transform ' + DUR_OUT + 'ms ' + ESE_OUT,
        'filter '    + Math.round(DUR_OUT * 0.55) + 'ms ' + ESE_OUT
      ].join(', ')

      el.style.opacity   = '0'
      el.style.transform = 'translateX(' + X_OUT + ') scale(' + SC_OUT + ')'
      el.style.filter    = 'blur(' + BL_OUT + ')'

      setTimeout(function () {
        window.location.href = url
      }, DUR_OUT + 40)

      return this
    }

  }

  global.ALASTransition = ALASTransition
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ALASTransition
  }

}(typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : this))
