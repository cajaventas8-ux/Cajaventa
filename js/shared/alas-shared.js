(function attachAlasShared(root, factory) {
  'use strict';

  const shared = factory(root);

  if (typeof module === 'object' && module.exports) {
    module.exports = shared;
  }

  root.AlasShared = Object.assign({}, root.AlasShared || {}, shared);
})(
  typeof globalThis !== 'undefined' ? globalThis : this,
  function buildAlasShared(root) {
    'use strict';

    function debounce(fn, wait) {
      const delay = Number.isFinite(Number(wait)) ? Number(wait) : 250;
      let timer = null;

      function debounced() {
        const args = Array.from(arguments);
        const context = this;
        root.clearTimeout(timer);
        timer = root.setTimeout(function runDebounced() {
          timer = null;
          fn.apply(context, args);
        }, delay);
      }

      debounced.cancel = function cancel() {
        root.clearTimeout(timer);
        timer = null;
      };

      return debounced;
    }

    function escapeHtml(value) {
      return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    function setText(id, value) {
      const element = root.document && typeof root.document.getElementById === 'function'
        ? root.document.getElementById(id)
        : null;
      if (element) element.textContent = value ?? '';
      return element;
    }

    function setHtml(id, value) {
      const element = root.document && typeof root.document.getElementById === 'function'
        ? root.document.getElementById(id)
        : null;
      if (element) element.innerHTML = value ?? '';
      return element;
    }

    function normalizeText(value) {
      return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLowerCase();
    }

    function normalizeLookup(value, separator) {
      const token = separator === undefined ? '_' : String(separator);
      return normalizeText(value).replace(/[\s-]+/g, token);
    }

    function normalizeEstadoKey(value) {
      const normalized = normalizeText(value).replace(/_/g, ' ');
      if (['anulado', 'anulada', 'cancelado', 'cancelada'].includes(normalized)) return 'anulado';
      if (['en transito', 'en reparto', 'transito', 'reparto'].includes(normalized)) return 'en_transito';
      if (['entregado', 'terminado', 'completado'].includes(normalized)) return 'entregado';
      return 'pendiente';
    }

    function formatQuantity(value) {
      const number = Number(value || 0);
      if (!Number.isFinite(number)) return '0';
      return number.toLocaleString('es-PY', {
        minimumFractionDigits: 0,
        maximumFractionDigits: 4
      });
    }

    function parseDateValue(value) {
      const raw = String(value || '').trim();
      if (!raw) return null;

      if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
        const parts = raw.split('-').map(Number);
        return {
          date: new Date(parts[0], parts[1] - 1, parts[2]),
          hasTime: false
        };
      }

      const normalized = raw.replace(' ', 'T');
      const date = new Date(normalized);
      if (Number.isNaN(date.getTime())) return null;

      return {
        date: date,
        hasTime: /T\d{2}:\d{2}/.test(normalized)
      };
    }

    function formatDateTime(value, options) {
      const settings = Object.assign({
        locale: 'es-PY',
        empty: '--',
        dateOptions: {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric'
        },
        includeTime: false,
        timeOptions: {
          hour12: false,
          hour: '2-digit',
          minute: '2-digit'
        },
        timeJoiner: ' - ',
        timeSuffix: ''
      }, options || {});
      const parsed = parseDateValue(value);

      if (!parsed) {
        return value || settings.empty;
      }

      const base = parsed.date.toLocaleDateString(settings.locale, settings.dateOptions);
      if (!settings.includeTime || !parsed.hasTime) return base;

      const time = parsed.date.toLocaleTimeString(settings.locale, settings.timeOptions);
      return `${base}${settings.timeJoiner}${time}${settings.timeSuffix}`;
    }
 
    return {
      fn: {
        debounce
      },
      text: {
        normalize: normalizeText,
        normalizeLookup,
        escapeHtml
      },
      dom: {
        setText,
        setHtml
      },
      estado: {
        normalizeKey: normalizeEstadoKey
      },
      format: {
        formatQuantity,
        parseDateValue,
        formatDateTime
      }
    };
  }
);
