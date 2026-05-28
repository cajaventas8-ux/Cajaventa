(function () {
  'use strict';

  const APP_NS = 'alas';
  const DEFAULT_CATALOG_TTL_MS = 6 * 60 * 60 * 1000;

  function getStorage() {
    try {
      return window.localStorage;
    } catch (error) {
      return null;
    }
  }

  function buildKey(scope, name) {
    return `${APP_NS}.${scope}.${name}`;
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function isObjectLike(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  }

  function buildEnvelope(value, meta = {}) {
    return {
      value,
      savedAt: nowIso(),
      ...meta
    };
  }

  function unwrapEnvelope(payload) {
    if (!isObjectLike(payload)) return null;
    if (!Object.prototype.hasOwnProperty.call(payload, 'value')) return null;
    if (!payload.savedAt) return null;
    return payload;
  }

  function isExpired(savedAt, maxAgeMs) {
    if (!maxAgeMs || maxAgeMs <= 0) return false;
    const savedAtMs = Date.parse(savedAt || '');
    if (!Number.isFinite(savedAtMs)) return true;
    return Date.now() - savedAtMs > maxAgeMs;
  }

  function saveJson(key, value) {
    const storage = getStorage();
    if (!storage) return false;
    try {
      storage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      return false;
    }
  }

  function loadJson(key) {
    const storage = getStorage();
    if (!storage) return null;
    try {
      const raw = storage.getItem(key);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (error) {
      return null;
    }
  }

  function remove(key) {
    const storage = getStorage();
    if (!storage) return false;
    try {
      storage.removeItem(key);
      return true;
    } catch (error) {
      return false;
    }
  }

  function removeMany(keys) {
    return (Array.isArray(keys) ? keys : []).some((key) => remove(key));
  }

  function debounce(fn, wait = 250) {
    if (window.AlasShared?.fn?.debounce) {
      return window.AlasShared.fn.debounce(fn, wait);
    }

    let timer = null;
    return function debounced(...args) {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => fn.apply(this, args), wait);
    };
  }

  function normalizeCatalogItems(payload) {
    if (Array.isArray(payload)) return payload;
    if (payload && Array.isArray(payload.items)) return payload.items;
    return [];
  }

  async function fetchCatalog(urlApi) {
    if (window.AcuseAPI && typeof window.AcuseAPI.get === 'function') {
      const payload = await window.AcuseAPI.get(urlApi);
      return normalizeCatalogItems(payload);
    }

    const response = await window.fetch(urlApi, {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' }
    });

    if (!response.ok) {
      throw new Error(`No se pudo cargar el catalogo ${urlApi}.`);
    }

    return normalizeCatalogItems(await response.json());
  }

  async function cargarCatalogo(nombreCatalogo, urlApi) {
    const key = buildKey('catalogo', nombreCatalogo);
    const cached = loadJson(key);
    const envelope = unwrapEnvelope(cached);

    if (envelope && Array.isArray(envelope.value) && !isExpired(envelope.savedAt, DEFAULT_CATALOG_TTL_MS)) {
      return envelope.value;
    }

    if (Array.isArray(cached)) {
      saveJson(key, buildEnvelope(cached, { type: 'catalogo', nombreCatalogo }));
      return cached;
    }

    const items = await fetchCatalog(urlApi);
    saveJson(key, buildEnvelope(items, { type: 'catalogo', nombreCatalogo }));
    return items;
  }

  function guardarCatalogo(nombreCatalogo, items) {
    const rows = Array.isArray(items) ? items : [];
    saveJson(
      buildKey('catalogo', nombreCatalogo),
      buildEnvelope(rows, { type: 'catalogo', nombreCatalogo })
    );
    return rows;
  }

  function invalidarCatalogo(nombreCatalogo) {
    return remove(buildKey('catalogo', nombreCatalogo));
  }

  /**
   * Normaliza un texto para comparación/búsqueda:
   * elimina acentos, convierte a minúsculas y hace trim.
   *
   * Versión canónica compartida. Duplicados conocidos:
   *   - js/acuses-api.js: normalizeText() (línea ~1219)
   *   - js/dashboard-acuses.js: normalizeDashboardLookup() (similar + reemplaza espacios)
   */
  function normalizeText(value) {
    if (window.AlasShared?.text?.normalize) {
      return window.AlasShared.text.normalize(value);
    }

    return String(value || '')
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .trim()
      .toLowerCase();
  }

  window.StorageUtils = {
    buildKey,
    debounce,
    saveJson,
    loadJson,
    remove,
    removeMany,
    cargarCatalogo,
    guardarCatalogo,
    invalidarCatalogo,
    normalizeText
  };

  window.cargarCatalogo = cargarCatalogo;
  /* Atajo global para uso directo sin prefijo */
  window.normalizeText = normalizeText;
})();
