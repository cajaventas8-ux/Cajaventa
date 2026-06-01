(function () {
  'use strict';

  const jsonHeaders = { 'Content-Type': 'application/json' };

  async function request(path, options = {}) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    try {
      const response = await fetch(path, {
        ...options,
        signal: controller.signal,
        headers: {
          ...(options.body ? jsonHeaders : {}),
          ...(options.headers || {})
        }
      });

      clearTimeout(timeout);
      const contentType = response.headers.get('content-type') || '';
      const payload = contentType.includes('application/json') ? await response.json() : await response.text();

      if (!response.ok) {
        let message = payload && payload.error ? payload.error : `Error HTTP ${response.status}`;
        if (response.status >= 500 && message === 'Error interno del servidor') {
          message = 'No se pudo completar la operación en el servidor. Reinicia el servidor o revisa /api/health.';
        }
        const code = payload && payload.details && payload.details.code ? ` (${payload.details.code})` : '';
        const error = new Error(`${message}${code}`);
        error.status = response.status;
        error.details = payload && payload.details ? payload.details : null;
        throw error;
      }

      return payload;
    } catch (err) {
      clearTimeout(timeout);
      if (err.name === 'AbortError') {
        const timeoutError = new Error('La petición tardó demasiado. Comprueba tu conexión o el servidor.');
        timeoutError.status = 0;
        timeoutError.isTimeout = true;
        throw timeoutError;
      }
      throw err;
    }
  }

  function query(params) {
    const search = new URLSearchParams();
    Object.entries(params || {}).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== '') search.set(key, value);
    });
    const text = search.toString();
    return text ? `?${text}` : '';
  }

  window.AcuseAPI = {
    get: (path, params) => request(`${path}${query(params)}`),
    post: (path, data) => request(path, { method: 'POST', body: JSON.stringify(data) }),
    put: (path, data) => request(path, { method: 'PUT', body: JSON.stringify(data) }),
    patch: (path, data) => request(path, { method: 'PATCH', body: JSON.stringify(data) }),
    delete: (path, data = {}) => request(path, { method: 'DELETE', body: JSON.stringify(data) })
  };
})();
