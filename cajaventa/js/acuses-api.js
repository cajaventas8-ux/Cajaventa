(function () {
  'use strict';

  let acuses = [];
  let totalAcuses = 0;
  let acuseSummary = { pendiente: 0, en_transito: 0, entregado: 0 };
  let resizeTimer = null;
  let selectedAcuseId = null;
  const acuseDetailsCache = new Map();
  let currentEditId = null;
  let currentEditAcuse = null;
  let anulacionTargetId = null;
  let catalogos = { repartidores: [], clientes: [], articulos: [] };
  let detallesDraft = [];
  let filterTimer = null;
  let filterClienteSearchTimer = null;
  let clienteSearchTimer = null;
  let articuloSearchTimer = null;
  let cantidadFormatTimer = null;
  let loaderValue = 0;
  let loaderTarget = 0;
  let loaderFrame = null;
  const startupLoaderKey = 'acuse.startupLoaderShown';
  const legacyAcuseDraftKey = 'borrador_formulario_acuse';
  const acuseDraftKey = window.StorageUtils?.buildKey?.('draft', 'acuse.formulario') || 'alas.draft.acuse.formulario';
  const acuseDraftCleanupVersionKey = window.StorageUtils?.buildKey?.('migration', 'acuse.draft.cleanup.version') || 'alas.migration.acuse.draft.cleanup.version';
  const acuseDraftCleanupVersion = '20260425-2';
  const legacyPrintDataSessionKey = 'acuse_print_data';
  const printDataSessionKey = window.StorageUtils?.buildKey?.('session', 'acuse.print') || 'alas.session.acuse.print';
  const acuseSavedSessionKey = window.StorageUtils?.buildKey?.('session', 'acuse.just-saved') || 'alas.session.acuse.just-saved';
  const catalogCacheNames = {
    repartidores: 'acuse.repartidores',
    clientes: 'acuse.clientes',
    articulos: 'acuse.articulos'
  };
  const actionButtonLoadingMs = 500;
  const modalTransitionMs = 520;
  const modalCloseTimers = new Map();
  let acuseWizardStep = 1;
  const acuseWizardTotalSteps = 3;
  const embedParams = new URLSearchParams(window.location.search);
  const embedMode = embedParams.get('embed') === '1';
  let embedActionHandled = false;
  let embedSuppressClose = false;
  let pendingAcuseDraft = null;
  let draftRestoreNotified = false;
  let suppressDraftAutosave = false;
  let draftDiscardedSinceReset = false;
  let draftPersistenceLocked = false;
  const acuseWizardMeta = {
    1: {
      title: 'Datos del acuse',
      subtitle: 'Completa la fecha, el repartidor y los datos del cliente.'
    },
    2: {
      title: 'Mercaderias',
      subtitle: 'Agrega los items que componen el acuse operativo.'
    },
    3: {
      title: 'Confirmar acuse',
      subtitle: 'Revisa el resumen y confirma la carga antes de guardar.'
    }
  };
  const scheduleAcuseDraftSave = debounce(persistAcuseDraft, 260);

  document.addEventListener('DOMContentLoaded', init);

  async function init() {
    const showStartupLoader = shouldShowStartupLoader();
    try {
      if (embedMode) applyEmbedMode();
      if (showStartupLoader) {
        showLoader();
        setLoader(10, 'Preparando pantalla', 'Inicializando modulo de acuses...');
        await loaderPause(450);
      }
      setDefaultDate();
      lockAutofilledFields();
      initFormChips();
      syncAcuseWizardChrome();
      goToAcuseWizardStep(1);
      renderDetalleItems();
      initFiltersFromUrl();
      initEstadoPicker();
      initDatePickers();
      bindCatalogEvents();
      initWizardFieldChecks();
      bindAcuseDraftAutosave();
      bindModalInteractions();
      bindFilters();
      updateEstadoFilterTone();
      bindTableViewport();
      if (showStartupLoader) {
        setLoader(25, 'Cargando catalogos', 'Consultando repartidores, clientes SAP y mercaderias...');
        await loaderPause(450);
      }
      await loadCatalogos();
      primeAcuseDraft();
      renderActiveFilterChips();
      if (showStartupLoader) {
        setLoader(70, 'Cargando mercaderias', 'Organizando catalogo para el modal...');
        await loaderPause(700);
        setLoader(88, 'Cargando acuses', 'Preparando el listado operativo...');
      }
      await loadAcuses();
      if (showStartupLoader) {
        setLoader(100, 'Listo', 'Catalogos cargados correctamente.');
        sessionStorage.setItem(startupLoaderKey, '1');
        await loaderPause(450);
        hideLoader();
      }
      await maybeRestoreDraftOnInit();
      await handleEmbedAction();
    } catch (error) {
      hideLoader();
      if (embedMode) {
        notifyEmbedParent('error', { message: error.message });
      } else {
        notify(error.message, 'error');
      }
    }
  }

  function notifyDataChanged(action, detail = {}) {
    window.dispatchEvent(new CustomEvent('acuse:data-changed', {
      detail: { action, ...detail }
    }));
  }

  function notifyEmbedParent(type, payload = {}) {
    if (!embedMode || window.parent === window) return;
    const targetOrigin = window.location.origin && window.location.origin !== 'null'
      ? window.location.origin
      : '*';
    window.parent.postMessage({
      source: 'acuse-embed',
      type,
      ...payload
    }, targetOrigin);
  }

  function applyEmbedMode() {
    document.body.classList.add('embed-mode');
    const style = document.createElement('style');
    style.textContent = `
      html {
        background: transparent !important;
      }
      body.embed-mode {
        background: transparent !important;
        overflow: hidden !important;
      }
      body.embed-mode #layout-root,
      body.embed-mode .app-shell,
      body.embed-mode .main-content,
      body.embed-mode .main-content__stage,
      body.embed-mode #dynamic-main-content,
      body.embed-mode .main-content__container--app-layout {
        background: transparent !important;
        box-shadow: none !important;
        padding: 0 !important;
        margin: 0 !important;
        min-height: auto !important;
      }
      body.embed-mode .app-shell {
        display: block !important;
      }
      body.embed-mode .main-content {
        margin-left: 0 !important;
        padding-right: 0 !important;
      }
      body.embed-mode .sidebar,
      body.embed-mode .app-topbar,
      body.embed-mode .page-heading,
      body.embed-mode .mb-3,
      body.embed-mode .acuses-table-card,
      body.embed-mode #catalogLoader {
        display: none !important;
      }
      body.embed-mode .main-content,
      body.embed-mode .main-content__stage,
      body.embed-mode .main-content__container {
        padding: 0 !important;
        margin: 0 !important;
        max-width: none !important;
        min-height: auto !important;
        background: transparent !important;
        box-shadow: none !important;
      }
      body.embed-mode .main-content__container--table-page {
        display: block !important;
      }
      body.embed-mode .main-content__container--table-page > *:not(.modal-backdrop) {
        display: none !important;
      }
      body.embed-mode .modal-backdrop {
        position: fixed;
        inset: 0;
        padding: 0 !important;
        background: transparent !important;
        backdrop-filter: none !important;
        -webkit-backdrop-filter: none !important;
      }
      body.embed-mode #acuseModalDialog {
        width: min(1220px, calc(100vw - 42px)) !important;
        max-width: 1220px !important;
        max-height: min(94vh, 920px) !important;
        border-radius: 28px !important;
        box-shadow: 0 22px 48px rgba(15, 36, 64, 0.14) !important;
      }
      body.embed-mode #acuseModalDialog.modal--success-compact {
        width: min(248px, calc(100vw - 32px)) !important;
        max-width: 248px !important;
        height: 186px !important;
        max-height: 186px !important;
        border-radius: 18px !important;
        box-shadow: 0 18px 38px rgba(15, 36, 64, 0.16) !important;
      }
      body.embed-mode #fichaModalDialog {
        width: min(1100px, calc(100vw - 42px)) !important;
        max-width: 1100px !important;
        max-height: min(92vh, 900px) !important;
        border-radius: 24px !important;
        box-shadow: 0 22px 48px rgba(15, 36, 64, 0.14) !important;
      }
      body.embed-mode #printPreviewModal {
        width: min(1360px, calc(100vw - 36px)) !important;
        max-width: 1360px !important;
        height: min(94vh, 960px) !important;
        max-height: 94vh !important;
        border-radius: 24px !important;
        box-shadow: 0 22px 48px rgba(15, 36, 64, 0.14) !important;
      }
      body.embed-mode #printPreviewModal .modal__close {
        display: inline-flex !important;
      }
      body.embed-mode .print-preview-stage {
        background: linear-gradient(180deg, #eef2f7 0%, #f8fafc 100%) !important;
        padding: 14px !important;
        overflow: hidden !important;
      }
      body.embed-mode .print-preview-frame {
        height: 100% !important;
        min-height: 0 !important;
        border-radius: 14px !important;
        box-shadow: 0 12px 30px rgba(15, 23, 42, 0.08) !important;
      }
      body.embed-mode #acuseModalDialog,
      body.embed-mode #fichaModalDialog,
      body.embed-mode #printPreviewModal {
        will-change: transform, opacity !important;
      }
    `;
    document.head.appendChild(style);
  }

  async function handleEmbedAction() {
    if (!embedMode || embedActionHandled) return;
    embedActionHandled = true;

    const action = cleanEmbedAction(embedParams.get('action'));
    const id = Number(embedParams.get('id') || 0) || null;
    const proxyButton = document.createElement('button');

    if (action === 'new') {
      await window.openAcuseModal();
    } else if (action === 'edit' && id) {
      await window.editarAcuse(id, proxyButton);
    } else if (action === 'view' && id) {
      await window.verFichaAcuse(id, proxyButton);
    } else if (action === 'delete' && id) {
      window.confirmarAnulacionAcuse(id);
    } else if (action === 'print' && id) {
      await window.imprimirAcuse(id, proxyButton);
    }

    notifyEmbedParent('ready', { action, id });
  }

  function cleanEmbedAction(value) {
    const action = String(value || '').trim().toLowerCase();
    if (['new', 'edit', 'view', 'delete', 'print'].includes(action)) return action;
    return 'new';
  }

  function notify(message, type = 'success') {
    if (embedMode && window.parent !== window) {
      notifyEmbedParent('toast', {
        message: String(message || ''),
        toastType: type
      });
      return;
    }
    if (window.AlasToast) AlasToast.show(message, type);
    else showFallbackToast(message, type);
  }

  function showFallbackToast(message, type = 'info') {
    let container = document.querySelector('.toast-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'toast-container';
      document.body.appendChild(container);
    }

    const toast = document.createElement('div');
    toast.className = `toast toast--${type} toast--show`;
    toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
    toast.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
    toast.setAttribute('aria-atomic', 'true');

    const iconWrap = document.createElement('span');
    iconWrap.className = 'toast__icon-wrap';
    iconWrap.setAttribute('aria-hidden', 'true');
    iconWrap.appendChild(createFallbackToastIcon(type));

    const text = document.createElement('span');
    text.className = 'toast__text';
    text.textContent = String(message || '');

    toast.appendChild(iconWrap);
    toast.appendChild(text);
    container.appendChild(toast);

    window.setTimeout(() => {
      toast.classList.remove('toast--show');
      toast.classList.add('toast--hide');
      window.setTimeout(() => toast.remove(), 260);
    }, 2200);
  }

  function createFallbackToastIcon(type) {
    const svgNs = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNs, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.classList.add('toast__icon-svg');

    const iconPaths = {
      success: ['M5 12.5l4 4L19 7'],
      complete: ['M5 12.5l4 4L19 7'],
      annul: ['M9 4.75h6', 'M7.75 7.5h8.5', 'M9 10.25v6.5', 'M12 10.25v6.5', 'M15 10.25v6.5', 'M8.75 19.25h6.5a1.5 1.5 0 001.49-1.325l.95-8.925h-11.88l.95 8.925a1.5 1.5 0 001.49 1.325z'],
      error: ['M7 7l10 10', 'M17 7L7 17'],
      warning: ['M12 7v6', 'M12 17h.01'],
      info: ['M12 11v6', 'M12 7h.01']
    };

    (iconPaths[type] || iconPaths.info).forEach((d) => {
      const path = document.createElementNS(svgNs, 'path');
      path.setAttribute('d', d);
      svg.appendChild(path);
    });

    return svg;
  }

  function bindTableViewport() {
    window.addEventListener('resize', () => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        if (acuses.length) renderTable();
      }, 120);
    });
  }

  function setButtonLoading(button, isLoading) {
    if (!button) return;
    button.classList.toggle('btn-loading', Boolean(isLoading));
    button.disabled = Boolean(isLoading);
    button.setAttribute('aria-busy', isLoading ? 'true' : 'false');
  }

  function wait(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  function nextPaint() {
    return new Promise((resolve) => {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(resolve);
      });
    });
  }

  async function runButtonLoading(button, action, minimumMs = 220) {
    setButtonLoading(button, true);
    try {
      await nextPaint();
      if (minimumMs > 0) {
        await wait(minimumMs);
      }
      return await action();
    } finally {
      setButtonLoading(button, false);
    }
  }

  function shouldShowStartupLoader() {
    try {
      return sessionStorage.getItem(startupLoaderKey) !== '1';
    } catch (error) {
      return true;
    }
  }

  function showLoader() {
    const loader = document.getElementById('catalogLoader');
    if (!loader) return;
    loader.classList.add('catalog-loader--active');
  }

  function setLoader(percent, title, text) {
    const loader = document.getElementById('catalogLoader');
    if (!loader) return;

    loaderTarget = Math.max(0, Math.min(100, Number(percent) || 0));
    startLoaderTween(loader);
    setText('catalogLoaderTitle', title);
    setText('catalogLoaderText', text);
  }

  function startLoaderTween(loader) {
    if (loaderFrame) return;

    const tick = () => {
      loaderValue += (loaderTarget - loaderValue) * 0.075;
      if (Math.abs(loaderTarget - loaderValue) < 0.12) loaderValue = loaderTarget;

      const rounded = Math.round(loaderValue);
      loader.style.setProperty('--loader-progress', `${loaderValue}`);
      setText('catalogLoaderPercent', `${rounded}%`);

      if (loaderValue !== loaderTarget) {
        loaderFrame = requestAnimationFrame(tick);
      } else {
        loaderFrame = null;
      }
    };

    loaderFrame = requestAnimationFrame(tick);
  }

  function hideLoader() {
    const loader = document.getElementById('catalogLoader');
    if (!loader) return;
    setTimeout(() => loader.classList.remove('catalog-loader--active'), 700);
  }

  function loaderPause(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function setDefaultDate() {
    const fecha = document.getElementById('fechaEmision');
    if (fecha && !fecha.value) {
      fecha.value = currentDateValue();
      if (fecha._proDatePicker && typeof fecha._proDatePicker.sync === 'function') {
        fecha._proDatePicker.sync();
      }
    }
  }

  function initDatePickers() {
    if (!window.DatePickerPro) return;

    const filterDate = document.getElementById('filtroFecha');
    if (filterDate) {
      window.DatePickerPro.attach(filterDate, {
        variant: 'filter',
        placeholder: 'Seleccionar fecha'
      });
    }

    const fechaEmision = document.getElementById('fechaEmision');
    if (fechaEmision) {
      window.DatePickerPro.attach(fechaEmision, {
        variant: 'field',
        placeholder: 'Seleccionar fecha'
      });
    }
  }

  async function loadCatalogos() {
    const [repartidores, clientes, articulos] = await Promise.allSettled([
      loadCatalogoItems(catalogCacheNames.repartidores, '/api/repartidores'),
      loadCatalogoItems(catalogCacheNames.clientes, '/api/clientes?limit=50'),
      loadCatalogoItems(catalogCacheNames.articulos, '/api/articulos?limit=50')
    ]);

    catalogos = {
      repartidores: repartidores.status === 'fulfilled' ? (repartidores.value || []) : [],
      clientes: clientes.status === 'fulfilled' ? (clientes.value || []) : [],
      articulos: articulos.status === 'fulfilled' ? (articulos.value || []) : []
    };

    fillRepartidores();
    fillClientes();
    fillArticulos();
    fillFiltroRepartidores();
    syncFilterClienteInput();
    renderFilterClienteSuggestions(false);

    const sapFallos = [];
    if (clientes.status === 'rejected') sapFallos.push('clientes SAP');
    if (articulos.status === 'rejected') sapFallos.push('articulos SAP');
    if (sapFallos.length) notify(`Catalogo no disponible: ${sapFallos.join(', ')}. Revisa /api/health.`, 'error');
    if (repartidores.status === 'rejected') notify(repartidores.reason.message, 'error');
  }

  function debounce(fn, wait = 250) {
    if (window.AlasShared?.fn?.debounce) {
      return window.AlasShared.fn.debounce(fn, wait);
    }

    let timer = null;
    function debounced(...args) {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        fn.apply(this, args);
      }, wait);
    }
    debounced.cancel = function cancel() {
      window.clearTimeout(timer);
      timer = null;
    };
    return debounced;
  }

  function loadStoredJson(key) {
    if (window.StorageUtils && typeof window.StorageUtils.loadJson === 'function') {
      return window.StorageUtils.loadJson(key);
    }

    try {
      const raw = window.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      return null;
    }
  }

  function saveStoredJson(key, value) {
    if (window.StorageUtils && typeof window.StorageUtils.saveJson === 'function') {
      return window.StorageUtils.saveJson(key, value);
    }

    try {
      window.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      return false;
    }
  }

  function removeStoredValue(key) {
    if (window.StorageUtils && typeof window.StorageUtils.remove === 'function') {
      return window.StorageUtils.remove(key);
    }

    try {
      window.localStorage.removeItem(key);
      return true;
    } catch (error) {
      return false;
    }
  }

  function getSessionStorage() {
    try {
      return window.sessionStorage;
    } catch (error) {
      return null;
    }
  }

  function saveSessionJson(key, value) {
    const storage = getSessionStorage();
    if (!storage) return false;

    try {
      storage.setItem(key, JSON.stringify(value));
      return true;
    } catch (error) {
      return false;
    }
  }

  function loadSessionJson(key) {
    const storage = getSessionStorage();
    if (!storage) return null;

    try {
      const raw = storage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      return null;
    }
  }

  function removeSessionValue(key) {
    const storage = getSessionStorage();
    if (!storage) return false;

    try {
      storage.removeItem(key);
      return true;
    } catch (error) {
      return false;
    }
  }

  function removeAcuseDraftStorage() {
    removeStoredValue(acuseDraftKey);
    removeStoredValue(legacyAcuseDraftKey);
  }

  function runOneTimeDraftCleanup() {
    const currentVersion = loadStoredJson(acuseDraftCleanupVersionKey);
    if (currentVersion === acuseDraftCleanupVersion) return;

    pendingAcuseDraft = null;
    removeAcuseDraftStorage();
    saveStoredJson(acuseDraftCleanupVersionKey, acuseDraftCleanupVersion);
  }

  function consumeJustSavedMarker() {
    const marker = loadSessionJson(acuseSavedSessionKey);
    if (!marker || typeof marker !== 'object') return false;

    const savedAtMs = Date.parse(marker.savedAt || '');
    removeSessionValue(acuseSavedSessionKey);
    if (!Number.isFinite(savedAtMs)) return false;
    return (Date.now() - savedAtMs) <= 30 * 60 * 1000;
  }

  function clearDraftAfterSaveIfNeeded() {
    if (!consumeJustSavedMarker()) return false;
    pendingAcuseDraft = null;
    draftRestoreNotified = false;
    removeAcuseDraftStorage();
    updateDraftDiscardButton();
    return true;
  }

  function markDraftAsSaved() {
    clearAcuseDraft();
    draftPersistenceLocked = true;
    saveSessionJson(acuseSavedSessionKey, {
      savedAt: new Date().toISOString()
    });
  }

  function loadPersistedAcuseDraft() {
    const draft = loadStoredJson(acuseDraftKey);
    if (isValidAcuseDraft(draft)) {
      removeStoredValue(legacyAcuseDraftKey);
      return draft;
    }

    const legacyDraft = loadStoredJson(legacyAcuseDraftKey);
    if (isValidAcuseDraft(legacyDraft)) {
      saveStoredJson(acuseDraftKey, legacyDraft);
      removeStoredValue(legacyAcuseDraftKey);
      return legacyDraft;
    }

    removeStoredValue(acuseDraftKey);
    removeStoredValue(legacyAcuseDraftKey);
    return null;
  }

  async function loadCatalogoItems(nombreCatalogo, urlApi) {
    if (window.StorageUtils && typeof window.StorageUtils.cargarCatalogo === 'function') {
      return window.StorageUtils.cargarCatalogo(nombreCatalogo, urlApi);
    }

    const response = await AcuseAPI.get(urlApi);
    return response.items || [];
  }

  function persistCatalogoCache(nombreCatalogo, items) {
    if (window.StorageUtils && typeof window.StorageUtils.guardarCatalogo === 'function') {
      window.StorageUtils.guardarCatalogo(nombreCatalogo, items);
      return;
    }

    saveStoredJson(`alas.catalogo.${nombreCatalogo}`, Array.isArray(items) ? items : []);
  }

  function invalidateCatalogoCache(nombreCatalogo) {
    if (window.StorageUtils && typeof window.StorageUtils.invalidarCatalogo === 'function') {
      window.StorageUtils.invalidarCatalogo(nombreCatalogo);
      return;
    }

    removeStoredValue(`alas.catalogo.${nombreCatalogo}`);
  }

  function bindAcuseDraftAutosave() {
    const form = document.getElementById('acuseForm');
    if (!form) return;

    form.addEventListener('input', handleWizardFieldInputChange);
    form.addEventListener('change', handleWizardFieldInputChange);
    window.addEventListener('beforeunload', persistAcuseDraft);
  }

  function handleWizardFieldInputChange(event) {
    syncWizardFieldCheckState(event?.target);
    queueAcuseDraftSave();
  }

  function queueAcuseDraftSave() {
    if (suppressDraftAutosave || draftPersistenceLocked || currentEditId) return;
    if (draftDiscardedSinceReset && hasMeaningfulDraft(buildAcuseDraftSnapshot())) {
      draftDiscardedSinceReset = false;
    }
    updateDraftDiscardButton();
    scheduleAcuseDraftSave();
  }

  function primeAcuseDraft() {
    runOneTimeDraftCleanup();
    if (clearDraftAfterSaveIfNeeded()) return;
    pendingAcuseDraft = loadPersistedAcuseDraft();
  }

  async function maybeRestoreDraftOnInit() {
    if (embedMode || !pendingAcuseDraft || currentEditId) return;
    await window.openAcuseModal({ skipButtonLoading: true, source: 'draft' });
  }

  function resolveModalWrapper(target) {
    if (!target) return null;
    return typeof target === 'string' ? document.getElementById(target) : target;
  }

  function clearModalCloseTimer(wrapper) {
    const current = modalCloseTimers.get(wrapper);
    if (current) {
      window.clearTimeout(current);
      modalCloseTimers.delete(wrapper);
    }
  }

  function openModalBackdrop(target, options = {}) {
    const wrapper = resolveModalWrapper(target);
    if (!wrapper) return;
    clearModalCloseTimer(wrapper);
    wrapper.classList.remove('modal-backdrop--closing', 'is-closing');
    window.requestAnimationFrame(() => {
      wrapper.classList.add('modal-backdrop--open', 'is-open');
      window.setTimeout(() => {
        if (typeof options.onAfterOpen === 'function') options.onAfterOpen();
        activateFocusTrap(wrapper);
      }, 34);
    });
  }

  function closeModalBackdrop(target, options = {}) {
    const wrapper = resolveModalWrapper(target);
    if (!wrapper) {
      if (typeof options.onClosed === 'function') options.onClosed();
      return;
    }
    deactivateFocusTrap();
    clearModalCloseTimer(wrapper);
    wrapper.classList.add('modal-backdrop--closing', 'is-closing');
    wrapper.classList.remove('modal-backdrop--open', 'is-open');
    const timer = window.setTimeout(() => {
      wrapper.classList.remove('modal-backdrop--closing', 'is-closing');
      modalCloseTimers.delete(wrapper);
      if (typeof options.cleanup === 'function') options.cleanup();
      if (typeof options.onClosed === 'function') options.onClosed();
    }, modalTransitionMs);
    modalCloseTimers.set(wrapper, timer);
  }

  function topOpenModalId() {
    const ids = [
      'printPreviewModalWrapper',
      'anulacionConfirmModalWrapper',
      'repartidorModalWrapper',
      'fichaModalWrapper',
      'acuseModalWrapper'
    ];
    return ids.find((id) => {
      const wrapper = document.getElementById(id);
      return wrapper?.classList.contains('modal-backdrop--open');
    }) || null;
  }

  const FOCUSABLE_SEL = [
    'a[href]', 'button:not([disabled])',
    'input:not([disabled]):not([type="hidden"])',
    'select:not([disabled])', 'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])'
  ].join(', ');

  let focusTrapHandler = null;
  let focusTrapPreviousFocus = null;

  function activateFocusTrap(wrapper) {
    const dialog = wrapper.querySelector('dialog');
    if (!dialog) return;

    focusTrapPreviousFocus = document.activeElement;

    const getFocusables = () => Array.from(dialog.querySelectorAll(FOCUSABLE_SEL))
      .filter((el) => !el.closest('[style*="display:none"]') && !el.closest('[hidden]'));

    const first = getFocusables()[0];
    if (first) first.focus();

    if (focusTrapHandler) document.removeEventListener('keydown', focusTrapHandler, true);
    focusTrapHandler = function (event) {
      if (event.key !== 'Tab') return;
      const focusables = getFocusables();
      if (!focusables.length) { event.preventDefault(); return; }
      const firstEl = focusables[0];
      const lastEl = focusables[focusables.length - 1];
      if (event.shiftKey) {
        if (document.activeElement === firstEl) { event.preventDefault(); lastEl.focus(); }
      } else {
        if (document.activeElement === lastEl) { event.preventDefault(); firstEl.focus(); }
      }
    };
    document.addEventListener('keydown', focusTrapHandler, true);
  }

  function deactivateFocusTrap() {
    if (focusTrapHandler) {
      document.removeEventListener('keydown', focusTrapHandler, true);
      focusTrapHandler = null;
    }
    if (focusTrapPreviousFocus && typeof focusTrapPreviousFocus.focus === 'function') {
      try { focusTrapPreviousFocus.focus(); } catch (_) {}
      focusTrapPreviousFocus = null;
    }
  }

  function bindModalInteractions() {
    const wrappers = [
      ['acuseModalWrapper', () => window.closeAcuseModal()],
      ['fichaModalWrapper', () => window.closeFichaAcuse()],
      ['repartidorModalWrapper', () => window.closeRepartidorModal()],
      ['anulacionConfirmModalWrapper', () => window.cancelarAnulacion()],
      ['printPreviewModalWrapper', () => window.cerrarVistaPreviaImpresion()]
    ];

    wrappers.forEach(([id, closer]) => {
      const wrapper = document.getElementById(id);
      if (!wrapper) return;
      wrapper.addEventListener('click', (event) => {
        if (event.target === wrapper) closer();
      });
    });

    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      const openId = topOpenModalId();
      if (!openId) return;
      event.preventDefault();
      if (openId === 'printPreviewModalWrapper') window.cerrarVistaPreviaImpresion();
      else if (openId === 'anulacionConfirmModalWrapper') window.cancelarAnulacion();
      else if (openId === 'repartidorModalWrapper') window.closeRepartidorModal();
      else if (openId === 'fichaModalWrapper') window.closeFichaAcuse();
      else window.closeAcuseModal();
    });
  }

  function isValidAcuseDraft(draft) {
    return Boolean(
      draft
      && typeof draft === 'object'
      && draft.fields
      && typeof draft.fields === 'object'
    );
  }

  function hasMeaningfulDraft(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return false;
    const fields = snapshot.fields || {};
    const pendingDetail = snapshot.pendingDetail || {};
    const hasCustomDate = String(fields.fechaEmision || '').trim() && String(fields.fechaEmision || '').trim() !== currentDateValue();
    const values = [
      fields.repartidor,
      fields.cliente,
      fields.clienteSearch,
      fields.zona,
      fields.observacion,
      pendingDetail.Cod_Mercaderia,
      pendingDetail.Search,
      pendingDetail.Cantidad,
      pendingDetail.Nota
    ];

    return hasCustomDate || values.some((value) => String(value || '').trim()) || (Array.isArray(snapshot.detalles) && snapshot.detalles.length > 0);
  }

  function buildAcuseDraftSnapshot() {
    const cliente = getSelectedClienteData();
    const pendingDetail = buildPendingDetalleSnapshot();

    return {
      version: 1,
      savedAt: new Date().toISOString(),
      step: acuseWizardStep,
      fields: {
        fechaEmision: getValue('fechaEmision'),
        repartidor: getValue('repartidor'),
        cliente: getValue('cliente'),
        clienteSearch: getValue('clienteSearch'),
        zona: getValue('zona'),
        clienteRuc: getValue('clienteRuc'),
        clienteTelefono: getValue('clienteTelefono'),
        clienteDireccion: getValue('clienteDireccion'),
        observacion: getValue('observacion'),
        estado: getValue('estado')
      },
      clienteData: cliente ? {
        Cod_Cliente: getValue('cliente'),
        Nom_Cliente: cliente.Nom_Cliente || extractNameFromLabel(getValue('clienteSearch')),
        Ruc_Cliente: getValue('clienteRuc'),
        Direc_Cliente: getValue('clienteDireccion'),
        Telefono_Cliente: getValue('clienteTelefono'),
        Ciudad_Cliente: getValue('zona'),
        Zona_Cliente: getValue('zona')
      } : null,
      detalles: detallesDraft.map((item) => ({
        Cod_Mercaderia: item.Cod_Mercaderia,
        Descr_SAP: item.Descr_SAP || item.Cod_Mercaderia,
        Cantidad: Number(item.Cantidad || 0),
        UM: item.UM || '',
        Nota: item.Nota || null
      })),
      pendingDetail
    };
  }

  function buildPendingDetalleSnapshot() {
    const codMercaderia = getValue('mercaderia');
    const search = getValue('mercaderiaSearch');
    const cantidad = getValue('cantidad');
    const um = getValue('um');
    const nota = getValue('notaDetalle');
    const hasValue = codMercaderia || search || cantidad || um || nota;
    if (!hasValue) return null;

    const articulo = findArticuloByCode(codMercaderia);
    return {
      Cod_Mercaderia: codMercaderia || '',
      Descr_SAP: articulo?.Descr_SAP || extractNameFromLabel(search),
      Search: search,
      Cantidad: cantidad,
      UM: um,
      Nota: nota || null
    };
  }

  function persistAcuseDraft() {
    if (suppressDraftAutosave || draftPersistenceLocked || currentEditId) return;
    if (document.getElementById('successOverlay')?.classList.contains('success-overlay--active')) return;

    const wrapper = document.getElementById('acuseModalWrapper');
    const modalOpen = wrapper?.classList.contains('modal-backdrop--open');
    if (!modalOpen && !pendingAcuseDraft) return;

    const snapshot = buildAcuseDraftSnapshot();
    if (!hasMeaningfulDraft(snapshot)) {
      clearAcuseDraft();
      return;
    }

    draftDiscardedSinceReset = false;
    pendingAcuseDraft = snapshot;
    saveStoredJson(acuseDraftKey, snapshot);
    removeStoredValue(legacyAcuseDraftKey);
    updateDraftDiscardButton();
  }

  function clearAcuseDraft() {
    scheduleAcuseDraftSave.cancel?.();
    pendingAcuseDraft = null;
    draftRestoreNotified = false;
    removeAcuseDraftStorage();
    updateDraftDiscardButton();
  }

  function applyPendingAcuseDraft() {
    if (!pendingAcuseDraft || currentEditId) return false;

    const draft = pendingAcuseDraft;
    const fields = draft.fields || {};
    const clienteData = draft.clienteData || null;
    const detalles = Array.isArray(draft.detalles) ? draft.detalles : [];
    const pendingDetail = draft.pendingDetail || null;

    suppressDraftAutosave = true;
    try {
      if (clienteData?.Cod_Cliente) {
        mergeClientes([clienteData]);
        fillClientes(clienteData.Cod_Cliente);
      } else {
        setValue('cliente', fields.cliente || '');
        setValue('clienteSearch', fields.clienteSearch || '');
        setClienteDetails(fields.zona ? {
          Ruc_Cliente: fields.clienteRuc || '',
          Direc_Cliente: fields.clienteDireccion || '',
          Telefono_Cliente: fields.clienteTelefono || '',
          Ciudad_Cliente: fields.zona || '',
          Zona_Cliente: fields.zona || ''
        } : null);
      }

      if (fields.repartidor) fillRepartidores(fields.repartidor);
      setValue('fechaEmision', fields.fechaEmision || currentDateValue());
      setValue('repartidor', fields.repartidor || '');
      setValue('observacion', fields.observacion || '');
      setValue('estado', fields.estado || 'pendiente');
      if (!clienteData) {
        setValue('zona', fields.zona || '');
        setValue('clienteRuc', fields.clienteRuc || '');
        setValue('clienteTelefono', fields.clienteTelefono || '');
        setValue('clienteDireccion', fields.clienteDireccion || '');
      }

      detallesDraft = detalles.map((item) => ({
        Cod_Mercaderia: item.Cod_Mercaderia,
        Descr_SAP: item.Descr_SAP || item.Cod_Mercaderia,
        Cantidad: Number(item.Cantidad || 0),
        UM: item.UM || '',
        Nota: item.Nota || null
      }));

      if (detallesDraft.length) ensureArticuloOptions(detallesDraft);

      if (pendingDetail) {
        if (pendingDetail.Cod_Mercaderia) {
          ensureArticuloOptions([{
            Cod_Mercaderia: pendingDetail.Cod_Mercaderia,
            Descr_SAP: pendingDetail.Descr_SAP || pendingDetail.Cod_Mercaderia,
            UM: pendingDetail.UM || ''
          }]);
        }
        setValue('mercaderia', pendingDetail.Cod_Mercaderia || '');
        setValue('mercaderiaSearch', pendingDetail.Search || '');
        setValue('um', pendingDetail.UM || '');
        setValue('cantidad', pendingDetail.Cantidad || '');
        setValue('notaDetalle', pendingDetail.Nota || '');
      } else {
        clearDetalleInputs();
      }

      renderDetalleItems();
      syncAcuseWizardChrome();
      goToAcuseWizardStep(normalizeDraftStep(draft.step));
      syncAllWizardFieldChecks();
    } finally {
      suppressDraftAutosave = false;
    }

    if (!draftRestoreNotified) {
      notify('Se recupero tu borrador del acuse.', 'info');
      draftRestoreNotified = true;
    }

    updateDraftDiscardButton();
    return true;
  }

  function hasAcuseDraftAvailable() {
    if (currentEditId) return false;
    if (isValidAcuseDraft(pendingAcuseDraft)) return true;
    return hasMeaningfulDraft(buildAcuseDraftSnapshot());
  }

  function updateDraftDiscardButton() {
    const button = document.getElementById('btnDescartarBorrador');
    if (!button) return;

    const visible = !currentEditId && hasAcuseDraftAvailable();
    button.style.display = visible ? 'inline-flex' : 'none';
    button.disabled = !visible;
  }

  function resetAcuseWizardForm() {
    draftPersistenceLocked = false;
    currentEditId = null;
    currentEditAcuse = null;
    detallesDraft = [];
    document.getElementById('acuseForm').reset();
    setDefaultDate();
    lockAutofilledFields();
    setValue('estado', 'pendiente');
    setValue('repartidor', '');
    setValue('repartidorSearch', '');
    setValue('cliente', '');
    setValue('clienteSearch', '');
    setValue('zona', '');
    setValue('clienteRuc', '');
    setValue('clienteTelefono', '');
    setValue('clienteDireccion', '');
    setValue('observacion', '');
    setClienteDetails();
    clearDetalleInputs();
    closeCombo('repartidorSuggestions', 'repartidorSearch');
    closeCombo('clienteSuggestions', 'clienteSearch');
    closeCombo('articuloSuggestions', 'mercaderiaSearch');
    renderDetalleItems();
    syncAcuseWizardChrome();
    goToAcuseWizardStep(1);
    syncAllWizardFieldChecks();
  }

  function normalizeDraftStep(value) {
    const step = Number(value || 1);
    if (!Number.isFinite(step)) return 1;
    return Math.min(acuseWizardTotalSteps, Math.max(1, Math.trunc(step)));
  }

  function extractNameFromLabel(label) {
    const text = String(label || '').trim();
    if (!text) return '';
    const parts = text.split(' - ');
    return parts.length > 1 ? parts.slice(1).join(' - ').trim() : text;
  }

  function option(value, label, selected = false) {
    return `<option value="${escapeHtml(value)}" ${selected ? 'selected' : ''}>${escapeHtml(label)}</option>`;
  }

  function fillRepartidores(selected = '') {
    const select = document.getElementById('repartidor');
    if (!select) return;
    const current = selected || select.value || '';
    select.innerHTML = '<option value="">Seleccionar...</option>' + catalogos.repartidores
      .map((item) => option(item.ID, repartidorLabel(item), String(item.ID) === String(current)))
      .join('');
    const found = findRepartidorById(current);
    if (found) {
      applyRepartidorSelection(found, { persist: false });
    } else {
      setValue('repartidor', '');
      setValue('repartidorSearch', '');
      closeCombo('repartidorSuggestions', 'repartidorSearch');
    }
  }

  function fillFiltroRepartidores(selected = '') {
    const select = document.getElementById('filtroRepartidor');
    if (!select) return;
    const current = selected || select.value;
    select.innerHTML = '<option value="">Todos</option>' + catalogos.repartidores
      .map((item) => option(item.ID, item.Nombre_Repartidor || item.Codigo_Repartidor || item.ID, String(item.ID) === String(current)))
      .join('');
  }

  function fillClientes(selected = '') {
    if (selected) {
      const found = findClienteByCode(selected);
      if (found) applyClienteSelection(found);
    }
    renderClienteSuggestions(false);
  }

  function fillArticulos(selected = '') {
    if (selected) {
      const found = findArticuloByCode(selected);
      if (found) applyArticuloSelection(found);
    }
    renderArticuloSuggestions(false);
  }

  function bindCatalogEvents() {
    const cliente = document.getElementById('clienteSearch');
    const repartidor = document.getElementById('repartidorSearch');
    const articulo = document.getElementById('mercaderiaSearch');
    const cantidad = document.getElementById('cantidad');
    const addDetail = document.getElementById('btnAgregarDetalle');

    if (cliente) {
      cliente.addEventListener('input', handleClienteInput);
      cliente.addEventListener('change', handleClienteInput);
      cliente.addEventListener('focus', () => renderClienteSuggestions(true));
      cliente.addEventListener('blur', () => setTimeout(() => closeCombo('clienteSuggestions', 'clienteSearch'), 140));
      syncComboControlState(cliente);
    }

    if (repartidor) {
      repartidor.addEventListener('input', handleRepartidorInput);
      repartidor.addEventListener('change', handleRepartidorInput);
      repartidor.addEventListener('focus', () => renderRepartidorSuggestions(true));
      repartidor.addEventListener('blur', () => setTimeout(() => closeCombo('repartidorSuggestions', 'repartidorSearch'), 140));
      syncComboControlState(repartidor);
    }

    if (articulo) {
      articulo.addEventListener('input', handleArticuloInput);
      articulo.addEventListener('change', handleArticuloInput);
      articulo.addEventListener('focus', () => renderArticuloSuggestions(true));
      articulo.addEventListener('blur', () => setTimeout(() => closeCombo('articuloSuggestions', 'mercaderiaSearch'), 140));
      syncComboControlState(articulo);
    }

    if (cantidad) {
      cantidad.addEventListener('input', handleCantidadInput);
      cantidad.addEventListener('blur', formatCantidadField);
    }

    document.querySelectorAll('[data-clear-combo]').forEach((button) => {
      button.addEventListener('mousedown', (event) => event.preventDefault());
      button.addEventListener('click', (event) => {
        event.preventDefault();
        clearAcuseCombo(button.dataset.clearCombo);
      });
    });

    document.querySelectorAll('[data-combo-trigger]').forEach((trigger) => {
      const inputId = trigger.dataset.comboTrigger;
      const field = trigger.closest('.combo-field');
      const menu = field?.querySelector('.combo-menu');
      if (!inputId || !menu) return;

      const toggle = () => {
        const input = document.getElementById(inputId);
        if (!input) return;
        if (input.getAttribute('aria-expanded') === 'true') {
          closeCombo(menu.id, inputId);
          return;
        }
        renderComboForInput(inputId, true);
        window.requestAnimationFrame(() => input.focus());
      };

      trigger.addEventListener('click', (event) => {
        if (event.target.closest('[data-clear-combo]')) return;
        event.preventDefault();
        toggle();
      });

      trigger.addEventListener('keydown', (event) => {
        if (!['Enter', ' ', 'ArrowDown'].includes(event.key)) return;
        event.preventDefault();
        toggle();
      });
    });

    if (addDetail) addDetail.addEventListener('click', addDetalleFromForm);

    document.addEventListener('click', (event) => {
      if (!event.target.closest('.combo-field')) {
        closeCombo('repartidorSuggestions', 'repartidorSearch');
        closeCombo('clienteSuggestions', 'clienteSearch');
        closeCombo('articuloSuggestions', 'mercaderiaSearch');
        closeCombo('filtroClienteSuggestions', 'filtroCliente');
      }
    });
  }

  function clienteLabel(item) {
    return `${item.Cod_Cliente || ''} - ${item.Nom_Cliente || 'Sin nombre'}`;
  }

  function articuloLabel(item) {
    return `${item.Material_SAP || ''} - ${item.Descr_SAP || 'Sin descripcion'}`;
  }

  const normalizeText = window.normalizeText || function (value) {
    return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
  };

  function startsAtWordBoundary(text, needle) {
    return text
      .split(/[\s\-_/.,()]+/)
      .filter(Boolean)
      .some((part) => part.startsWith(needle));
  }

  function scoreMatch(text, needle) {
    if (!text || !needle) return 0;
    if (text === needle) return 1000 - text.length;
    if (text.startsWith(needle)) return 820 - (text.length - needle.length);
    if (startsAtWordBoundary(text, needle)) return 620 - text.indexOf(needle);

    const index = text.indexOf(needle);
    if (index >= 0) return 420 - index;
    return 0;
  }

  function rankMatches(rows, needle, fieldsGetter, limit = 3) {
    const normalizedNeedle = normalizeText(needle);
    if (!normalizedNeedle) return [];

    return rows
      .map((item, index) => {
        const fields = fieldsGetter(item)
          .map((field) => normalizeText(field))
          .filter(Boolean);
        const score = fields.reduce((best, field) => Math.max(best, scoreMatch(field, normalizedNeedle)), 0);
        return { item, index, score };
      })
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .slice(0, limit)
      .map((entry) => entry.item);
  }

  function findClienteByCode(code) {
    return catalogos.clientes.find((item) => String(item.Cod_Cliente) === String(code));
  }

  function findArticuloByCode(code) {
    return catalogos.articulos.find((item) => String(item.Material_SAP) === String(code));
  }

  function compactPersonName(value) {
    const words = String(value || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean);

    if (!words.length) return '';
    if (words.length <= 2) return words.join(' ');
    return `${words[0]} ${words[words.length - 1]}`;
  }

  function repartidorName(item) {
    const fullName = item?.Nombre_Repartidor || '';
    const compactName = compactPersonName(fullName);
    return compactName || item?.Codigo_Repartidor || (item?.ID ? `Repartidor ${item.ID}` : 'Sin repartidor');
  }

  function repartidorLabel(item) {
    return repartidorName(item);
  }

  function findRepartidorById(id) {
    return catalogos.repartidores.find((item) => String(item.ID) === String(id)) || null;
  }

  function getClienteTelefono(cliente) {
    return cliente?.Telefono_Cliente || cliente?.Telef_Cliente || cliente?.TelF_Cliente || cliente?.Telefono || '';
  }

  function getSelectedClienteData() {
    const selected = findClienteByCode(getValue('cliente'));
    if (selected) return selected;
    if (currentEditAcuse && String(currentEditAcuse.Cod_Cliente) === String(getValue('cliente'))) return currentEditAcuse;
    return null;
  }

  function setClienteDetails(cliente = null) {
    setValue('zona', cliente?.Ciudad_Cliente || cliente?.Zona_Cliente || '');
    setValue('clienteRuc', cliente?.Ruc_Cliente || '');
    setValue('clienteTelefono', getClienteTelefono(cliente));
    setValue('clienteDireccion', cliente?.Direc_Cliente || '');
    lockAutofilledFields();
  }

  function lockAutofilledFields() {
    const zona = document.getElementById('zona');
    if (!zona) return;
    zona.readOnly = true;
    zona.setAttribute('readonly', 'readonly');
    zona.setAttribute('tabindex', '-1');
  }

  async function reloadRepartidores(selected = '') {
    invalidateCatalogoCache(catalogCacheNames.repartidores);
    const response = await AcuseAPI.get('/api/repartidores');
    catalogos.repartidores = response.items || [];
    persistCatalogoCache(catalogCacheNames.repartidores, catalogos.repartidores);
    fillRepartidores(selected);
    fillFiltroRepartidores();
    queueAcuseDraftSave();
  }

  function findClienteByInput(value) {
    const needle = normalizeText(value);
    if (!needle) return null;
    return catalogos.clientes.find((item) => {
      return normalizeText(item.Cod_Cliente) === needle
        || normalizeText(item.Nom_Cliente) === needle
        || normalizeText(clienteLabel(item)) === needle;
    }) || null;
  }

  function findArticuloByInput(value) {
    const needle = normalizeText(value);
    if (!needle) return null;
    return catalogos.articulos.find((item) => {
      return normalizeText(item.Material_SAP) === needle
        || normalizeText(item.Descr_SAP) === needle
        || normalizeText(articuloLabel(item)) === needle;
    }) || null;
  }

  function findRepartidorByInput(value) {
    const needle = normalizeText(value);
    if (!needle) return null;
    return catalogos.repartidores.find((item) => {
      return normalizeText(item.ID) === needle
        || normalizeText(item.Codigo_Repartidor) === needle
        || normalizeText(item.Nombre_Repartidor) === needle
        || normalizeText(repartidorLabel(item)) === needle;
    }) || null;
  }

  function applyClienteSelection(cliente) {
    setValue('cliente', cliente.Cod_Cliente || '');
    setValue('clienteSearch', clienteLabel(cliente));
    setClienteDetails(cliente);
    closeCombo('clienteSuggestions', 'clienteSearch');
    queueAcuseDraftSave();
  }

  function applyArticuloSelection(articulo) {
    setValue('mercaderia', articulo.Material_SAP || '');
    setValue('mercaderiaSearch', articuloLabel(articulo));
    setValue('um', articulo.UM_SAP || '');
    closeCombo('articuloSuggestions', 'mercaderiaSearch');
    queueAcuseDraftSave();
  }

  function applyRepartidorSelection(repartidor, options = {}) {
    const settings = options && typeof options === 'object' ? options : {};
    setValue('repartidor', repartidor?.ID || '');
    setValue('repartidorSearch', repartidor ? repartidorLabel(repartidor) : '');
    closeCombo('repartidorSuggestions', 'repartidorSearch');
    if (settings.persist !== false) queueAcuseDraftSave();
  }

  function handleClienteInput() {
    const input = document.getElementById('clienteSearch');
    const value = input?.value || '';
    syncComboControlState(input);
    const found = findClienteByInput(value);
    if (found) {
      applyClienteSelection(found);
      return;
    }

    setValue('cliente', '');
    setClienteDetails();
    renderClienteSuggestions(true);
    window.clearTimeout(clienteSearchTimer);
    if (value.trim().length < 2) return;
    clienteSearchTimer = window.setTimeout(() => searchClientes(value), 260);
  }

  async function searchClientes(value) {
    try {
      const response = await AcuseAPI.get('/api/clientes', { q: value, limit: 50 });
      mergeClientes(response.items || []);
      persistCatalogoCache(catalogCacheNames.clientes, catalogos.clientes);
      fillClientes();
      renderClienteSuggestions(true);
      const found = findClienteByInput(document.getElementById('clienteSearch')?.value || '');
      if (found) applyClienteSelection(found);
    } catch (error) {
      notify('No se pudo buscar clientes. Verifica la conexion con el servidor.', 'warn');
    }
  }

  function handleArticuloInput() {
    const input = document.getElementById('mercaderiaSearch');
    const value = input?.value || '';
    syncComboControlState(input);
    const found = findArticuloByInput(value);
    if (found) {
      applyArticuloSelection(found);
      return;
    }

    setValue('mercaderia', '');
    setValue('um', '');
    renderArticuloSuggestions(true);
    window.clearTimeout(articuloSearchTimer);
    if (value.trim().length < 2) return;
    articuloSearchTimer = window.setTimeout(() => searchArticulos(value), 260);
  }

  function handleRepartidorInput() {
    const input = document.getElementById('repartidorSearch');
    const value = input?.value || '';
    syncComboControlState(input);
    const found = findRepartidorByInput(value);
    if (found) {
      applyRepartidorSelection(found);
      return;
    }

    setValue('repartidor', '');
    renderRepartidorSuggestions(true);
  }

  async function searchArticulos(value) {
    try {
      const response = await AcuseAPI.get('/api/articulos', { q: value, limit: 50 });
      mergeArticulos(response.items || []);
      persistCatalogoCache(catalogCacheNames.articulos, catalogos.articulos);
      fillArticulos();
      renderArticuloSuggestions(true);
      const found = findArticuloByInput(document.getElementById('mercaderiaSearch')?.value || '');
      if (found) applyArticuloSelection(found);
    } catch (error) {
      notify('No se pudo buscar mercaderias. Verifica la conexion con el servidor.', 'warn');
    }
  }

  function mergeClientes(rows) {
    let changed = false;
    rows.forEach((row) => {
      const existing = catalogos.clientes.find((item) => item.Cod_Cliente === row.Cod_Cliente);
      if (existing) {
        Object.assign(existing, row);
        changed = true;
      } else if (row.Cod_Cliente) {
        catalogos.clientes.push(row);
        changed = true;
      }
    });
    if (changed) persistCatalogoCache(catalogCacheNames.clientes, catalogos.clientes);
  }

  function mergeArticulos(rows) {
    let changed = false;
    rows.forEach((row) => {
      const existing = catalogos.articulos.find((item) => item.Material_SAP === row.Material_SAP);
      if (existing) {
        Object.assign(existing, row);
        changed = true;
      } else if (row.Material_SAP) {
        catalogos.articulos.push(row);
        changed = true;
      }
    });
    if (changed) persistCatalogoCache(catalogCacheNames.articulos, catalogos.articulos);
  }

  function clienteMatches(value) {
    return rankMatches(
      catalogos.clientes,
      value,
      (item) => [item.Cod_Cliente, item.Nom_Cliente, item.Ruc_Cliente, clienteLabel(item)],
      6
    );
  }

  function articuloMatches(value) {
    return rankMatches(
      catalogos.articulos,
      value,
      (item) => [item.Material_SAP, item.Descr_SAP, articuloLabel(item)],
      6
    );
  }

  function repartidorMatches(value) {
    return rankMatches(
      catalogos.repartidores,
      value,
      (item) => [item.ID, item.Codigo_Repartidor, item.Nombre_Repartidor, repartidorLabel(item)],
      6
    );
  }

  function getComboList(menuId) {
    return document.getElementById(`${menuId}List`) || document.getElementById(menuId);
  }

  function comboCheckIcon() {
    return '<svg class="combo-option__check" viewBox="0 0 20 20" fill="none"><path d="M4.5 10.5l3.2 3.2L15.5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }

  function buildComboOption(item) {
    return `<button type="button" class="combo-option${item.selected ? ' combo-option--selected' : ''}" style="animation-delay:${Math.min(item.index * 0.025, 0.18)}s" data-code="${escapeHtml(item.code)}" role="option">
      <span class="combo-option__dot"></span>
      <span class="combo-option__body">
        <span class="combo-option__main">${escapeHtml(item.title)}</span>
        ${item.meta ? `<span class="combo-option__meta">${escapeHtml(item.meta)}</span>` : ''}
      </span>
      ${item.badge ? `<span class="combo-option__code">${escapeHtml(item.badge)}</span>` : ''}
      ${comboCheckIcon()}
    </button>`;
  }

  function renderComboForInput(inputId, open = true) {
    if (inputId === 'clienteSearch') {
      renderClienteSuggestions(open);
      return;
    }
    if (inputId === 'repartidorSearch') {
      renderRepartidorSuggestions(open);
      return;
    }
    if (inputId === 'mercaderiaSearch') {
      renderArticuloSuggestions(open);
      return;
    }
    if (inputId === 'filtroCliente') {
      renderFilterClienteSuggestions(open);
    }
  }

  function renderClienteSuggestions(open = true) {
    const menu = document.getElementById('clienteSuggestions');
    const list = getComboList('clienteSuggestions');
    const input = document.getElementById('clienteSearch');
    if (!menu || !list || !input) return;
    const hasNeedle = input.value.trim().length > 0;
    const rows = hasNeedle ? clienteMatches(input.value) : catalogos.clientes.slice(0, 8);
    const selectedCode = getValue('cliente');
    list.innerHTML = rows.length
      ? rows.map((item, index) => buildComboOption({
          index,
          code: item.Cod_Cliente || '',
          title: item.Nom_Cliente || item.Cod_Cliente || 'Sin nombre',
          meta: item.Ciudad_Cliente || item.Zona_Cliente || 'Sin ciudad',
          badge: item.Cod_Cliente || '',
          selected: String(selectedCode || '') === String(item.Cod_Cliente || '')
        })).join('')
      : '<div class="combo-empty">No se encontraron clientes</div>';
    list.querySelectorAll('.combo-option').forEach((button) => {
      button.addEventListener('mousedown', (event) => {
        event.preventDefault();
        const found = findClienteByCode(button.dataset.code);
        if (found) applyClienteSelection(found);
      });
    });
    toggleCombo(menu, input, open);
  }

  function renderRepartidorSuggestions(open = true) {
    const menu = document.getElementById('repartidorSuggestions');
    const list = getComboList('repartidorSuggestions');
    const input = document.getElementById('repartidorSearch');
    if (!menu || !list || !input) return;
    const hasNeedle = input.value.trim().length > 0;
    const rows = hasNeedle ? repartidorMatches(input.value) : catalogos.repartidores.slice(0, 8);
    const selectedId = getValue('repartidor');
    list.innerHTML = rows.length
      ? rows.map((item, index) => buildComboOption({
          index,
          code: item.ID || '',
          title: repartidorName(item),
          meta: '',
          badge: '',
          selected: String(selectedId || '') === String(item.ID || '')
        })).join('')
      : '<div class="combo-empty">No se encontraron repartidores</div>';

    list.querySelectorAll('.combo-option').forEach((button) => {
      button.addEventListener('mousedown', (event) => {
        event.preventDefault();
        const found = findRepartidorById(button.dataset.code);
        if (found) applyRepartidorSelection(found);
      });
    });

    toggleCombo(menu, input, open);
  }

  function renderArticuloSuggestions(open = true) {
    const menu = document.getElementById('articuloSuggestions');
    const list = getComboList('articuloSuggestions');
    const input = document.getElementById('mercaderiaSearch');
    if (!menu || !list || !input) return;
    const hasNeedle = input.value.trim().length > 0;
    const rows = hasNeedle ? articuloMatches(input.value) : catalogos.articulos.slice(0, 8);
    const selectedCode = getValue('mercaderia');
    list.innerHTML = rows.length
      ? rows.map((item, index) => buildComboOption({
          index,
          code: item.Material_SAP || '',
          title: item.Descr_SAP || item.Material_SAP || 'Sin descripcion',
          meta: `UM: ${item.UM_SAP || '--'}`,
          badge: item.Material_SAP || '',
          selected: String(selectedCode || '') === String(item.Material_SAP || '')
        })).join('')
      : '<div class="combo-empty">No se encontraron mercaderias</div>';
    list.querySelectorAll('.combo-option').forEach((button) => {
      button.addEventListener('mousedown', (event) => {
        event.preventDefault();
        const found = findArticuloByCode(button.dataset.code);
        if (found) applyArticuloSelection(found);
      });
    });
    toggleCombo(menu, input, open);
  }

  function filterClienteMatches(value) {
    return rankMatches(
      catalogos.clientes,
      value,
      (item) => [item.Cod_Cliente, item.Nom_Cliente, item.Ruc_Cliente, clienteLabel(item)],
      6
    );
  }

  function applyFilterClienteSelection(cliente, shouldApply = true) {
    setValue('filtroCliente', clienteLabel(cliente));
    setValue('filtroClienteCodigo', cliente.Cod_Cliente || '');
    closeCombo('filtroClienteSuggestions', 'filtroCliente');
    if (shouldApply) applyFilters();
  }

  function syncFilterClienteInput() {
    const explicitCode = getValue('filtroClienteCodigo');
    const value = getValue('filtroCliente');
    const found = findClienteByCode(explicitCode || value);
    if (found) applyFilterClienteSelection(found, false);
  }

  function renderFilterClienteSuggestions(open = true) {
    const menu = document.getElementById('filtroClienteSuggestions');
    const list = getComboList('filtroClienteSuggestions');
    const input = document.getElementById('filtroCliente');
    if (!menu || !list || !input) return;
    const hasNeedle = input.value.trim().length > 0;

    const rows = hasNeedle ? filterClienteMatches(input.value) : catalogos.clientes.slice(0, 8);
    const selectedCode = getValue('filtroClienteCodigo');
    list.innerHTML = rows.length
      ? rows.map((item, index) => buildComboOption({
          index,
          code: item.Cod_Cliente || '',
          title: item.Nom_Cliente || item.Cod_Cliente || 'Sin nombre',
          meta: item.Ciudad_Cliente || item.Zona_Cliente || 'Sin ciudad',
          badge: item.Cod_Cliente || '',
          selected: String(selectedCode || '') === String(item.Cod_Cliente || '')
        })).join('')
      : '<div class="combo-empty">No se encontraron clientes</div>';

    list.querySelectorAll('.combo-option').forEach((button) => {
      button.addEventListener('mousedown', (event) => {
        event.preventDefault();
        const found = findClienteByCode(button.dataset.code);
        if (found) applyFilterClienteSelection(found);
      });
    });

    toggleCombo(menu, input, open);
  }

  function handleFilterClienteInput() {
    const input = document.getElementById('filtroCliente');
    const value = input?.value || '';
    syncComboControlState(input);
    setValue('filtroClienteCodigo', '');
    renderFilterClienteSuggestions(true);

    window.clearTimeout(filterClienteSearchTimer);
    if (value.trim().length >= 2) {
      filterClienteSearchTimer = window.setTimeout(() => searchFilterClientes(value), 220);
    }

    clearTimeout(filterTimer);
    filterTimer = setTimeout(applyFilters, 420);
  }

  async function searchFilterClientes(value) {
    try {
      const response = await AcuseAPI.get('/api/clientes', { q: value, limit: 50 });
      mergeClientes(response.items || []);
      renderFilterClienteSuggestions(true);
    } catch (error) {
      notify('No se pudo filtrar por cliente. Verifica la conexion.', 'warn');
    }
  }

  function toggleCombo(menu, input, open) {
    menu.classList.toggle('combo-menu--open', Boolean(open));
    input.setAttribute('aria-expanded', open ? 'true' : 'false');
    syncComboControlState(input);
  }

  function closeCombo(menuId, inputId) {
    const menu = document.getElementById(menuId);
    const input = document.getElementById(inputId);
    if (menu) menu.classList.remove('combo-menu--open');
    if (input) {
      input.setAttribute('aria-expanded', 'false');
      syncComboControlState(input);
    }
  }

  function syncComboControlState(inputOrId) {
    const input = typeof inputOrId === 'string'
      ? document.getElementById(inputOrId)
      : inputOrId;
    const field = input?.closest('.combo-field');
    const control = field?.querySelector('.acuse-combo__control');
    if (!control) return;
    const valueNode = control.querySelector('[data-combo-value]');
    const hasValue = Boolean(String(input.value || '').trim());
    const isOpen = input.getAttribute('aria-expanded') === 'true';
    control.classList.toggle('has-value', hasValue);
    control.classList.toggle('is-open', isOpen);
    if (valueNode) {
      const placeholder = input.dataset.displayPlaceholder || input.placeholder || 'Seleccionar...';
      valueNode.textContent = hasValue ? String(input.value || '').trim() : placeholder;
      valueNode.classList.toggle('acuse-combo__value--placeholder', !hasValue);
    }
    syncWizardFieldCheckState(input);
  }

  function initWizardFieldChecks() {
    syncAllWizardFieldChecks();
  }

  function syncAllWizardFieldChecks() {
    document.querySelectorAll('.wizard-field--checkable').forEach((field) => syncWizardFieldCheckState(field));
  }

  function syncWizardFieldCheckState(fieldOrElement) {
    const field = resolveWizardFieldForCheck(fieldOrElement);
    if (!field || !field.classList.contains('wizard-field--checkable')) return;
    field.classList.toggle('is-complete', isWizardFieldComplete(field));
  }

  function resolveWizardFieldForCheck(fieldOrElement) {
    if (!fieldOrElement) return null;
    if (typeof fieldOrElement === 'string') {
      return document.getElementById(fieldOrElement)?.closest('.wizard-field');
    }
    if (fieldOrElement.classList?.contains('wizard-field')) return fieldOrElement;
    return fieldOrElement.closest?.('.wizard-field') || null;
  }

  function isWizardFieldComplete(field) {
    const targetId = field?.dataset.completeTarget || field?.querySelector('.wizard-label')?.getAttribute('for') || '';
    if (!targetId) return false;

    if ((field.dataset.completeRule || '') === 'positive-number') {
      const quantity = parseQuantityValue(getValue(targetId));
      return Number.isFinite(quantity) && quantity > 0;
    }

    return Boolean(getValue(targetId));
  }

  function clearAcuseCombo(inputId) {
    let shouldFocus = true;
    if (inputId === 'clienteSearch') {
      setValue('clienteSearch', '');
      setValue('cliente', '');
      setClienteDetails();
      closeCombo('clienteSuggestions', 'clienteSearch');
      queueAcuseDraftSave();
    } else if (inputId === 'repartidorSearch') {
      setValue('repartidorSearch', '');
      setValue('repartidor', '');
      closeCombo('repartidorSuggestions', 'repartidorSearch');
      queueAcuseDraftSave();
    } else if (inputId === 'mercaderiaSearch') {
      setValue('mercaderiaSearch', '');
      setValue('mercaderia', '');
      setValue('um', '');
      closeCombo('articuloSuggestions', 'mercaderiaSearch');
      queueAcuseDraftSave();
    } else if (inputId === 'filtroCliente') {
      setValue('filtroCliente', '');
      setValue('filtroClienteCodigo', '');
      closeCombo('filtroClienteSuggestions', 'filtroCliente');
      shouldFocus = false;
      applyFilters();
    }

    if (shouldFocus) {
      document.getElementById(inputId)?.focus();
    }
  }

  function initFiltersFromUrl() {
    const query = new URLSearchParams(window.location.search);
    setValue('filtroEstado', normalizeEstadoFilter(query.get('estado')));
    setValue('filtroFecha', query.get('fecha') || '');
    setValue('filtroCliente', query.get('q') || query.get('cliente') || '');
    setValue('filtroClienteCodigo', query.get('codCliente') || '');
    setValue('filtroRepartidor', query.get('repartidor') || '');
    renderActiveFilterChips();
  }

  function bindFilters() {
    ['filtroFecha', 'filtroEstado', 'filtroRepartidor'].forEach((id) => {
      const element = document.getElementById(id);
      if (element) {
        element.addEventListener('change', () => {
          if (id === 'filtroEstado') updateEstadoFilterTone();
          applyFilters();
        });
      }
    });

    const cliente = document.getElementById('filtroCliente');
    if (cliente) {
      cliente.setAttribute('autocomplete', 'off');
      cliente.setAttribute('aria-autocomplete', 'list');
      cliente.setAttribute('aria-expanded', 'false');
      cliente.placeholder = 'Buscar por cliente o código';
      cliente.addEventListener('input', handleFilterClienteInput);
      cliente.addEventListener('change', handleFilterClienteInput);
      cliente.addEventListener('focus', () => renderFilterClienteSuggestions(true));
      cliente.addEventListener('blur', () => setTimeout(() => closeCombo('filtroClienteSuggestions', 'filtroCliente'), 140));
      syncComboControlState(cliente);
    }

    const clear = document.getElementById('btnLimpiarFiltros');
    if (clear) clear.addEventListener('click', clearFilters);

    const chips = document.getElementById('filtrosActivos');
    if (chips) {
      chips.addEventListener('click', function (event) {
        const button = event.target.closest('[data-remove-filter]');
        if (!button) return;
        removeFilter(button.dataset.removeFilter);
      });
    }
  }

  async function applyFilters() {
    syncFilterUrl();
    renderActiveFilterChips();
    try {
      await loadAcuses();
    } catch (error) {
      notify(error.message, 'error');
    }
  }

  function clearFilters() {
    setValue('filtroFecha', '');
    setValue('filtroCliente', '');
    setValue('filtroClienteCodigo', '');
    setValue('filtroEstado', 'all');
    setValue('filtroRepartidor', '');
    closeCombo('filtroClienteSuggestions', 'filtroCliente');
    updateEstadoFilterTone();
    applyFilters();
  }

  function removeFilter(filterName) {
    const defaults = {
      fecha: '',
      cliente: '',
      estado: 'all',
      repartidor: ''
    };
    const fieldId = {
      fecha: 'filtroFecha',
      cliente: 'filtroCliente',
      estado: 'filtroEstado',
      repartidor: 'filtroRepartidor'
    }[filterName];

    if (!fieldId) return;
    setValue(fieldId, defaults[filterName]);
    if (filterName === 'cliente') {
      setValue('filtroClienteCodigo', '');
      closeCombo('filtroClienteSuggestions', 'filtroCliente');
    }
    if (filterName === 'estado') updateEstadoFilterTone();
    applyFilters();
  }

  function renderActiveFilterChips() {
    const container = document.getElementById('filtrosActivos');
    if (!container) return;

    const chips = [];
    const fecha = getValue('filtroFecha');
    const cliente = getValue('filtroCliente');
    const estado = getValue('filtroEstado');
    const repartidor = getValue('filtroRepartidor');

    if (fecha) chips.push({ key: 'fecha', prefix: 'Fecha', value: formatFilterDate(fecha) });
    if (cliente) chips.push({ key: 'cliente', prefix: 'Cliente', value: cliente });
    if (estado && estado !== 'all') chips.push({ key: 'estado', prefix: 'Estado', value: formatEstado(estado) });
    if (repartidor) chips.push({ key: 'repartidor', prefix: 'Repartidor', value: getSelectedOptionText('filtroRepartidor') });

    if (!chips.length) {
      container.innerHTML = '';
      container.style.display = 'none';
      setText('filtrosHeaderSubtitle', 'Refina tu busqueda');
      return;
    }

    container.innerHTML = chips.map((chip) => `<span class="${filterChipClass(chip.key, chip.value)}"><span class="chip-filtro-label">${escapeHtml(chip.prefix)}:</span>${escapeHtml(chip.value)}<button class="chip-filtro-close" type="button" data-remove-filter="${escapeHtml(chip.key)}" aria-label="Quitar ${escapeHtml(`${chip.prefix}: ${chip.value}`)}">&times;</button></span>`).join('');
    container.style.display = 'flex';
    setText('filtrosHeaderSubtitle', `${chips.length} activo${chips.length === 1 ? '' : 's'}`);
  }

  function filterChipClass(key, value) {
    if (key === 'cliente') return 'chip-filtro chip-filtro-cliente';
    if (key === 'estado') {
      const normalized = normalizeEstadoValue(value);
      if (normalized === 'entregado') return 'chip-filtro chip-filtro-estado-entregado';
      if (normalized === 'en_transito') return 'chip-filtro chip-filtro-estado-transito';
      if (normalized === 'anulado') return 'chip-filtro chip-filtro-estado-anulado';
      return 'chip-filtro chip-filtro-estado-pendiente';
    }
    return 'chip-filtro chip-filtro-neutral';
  }

  function buildFilterParams(overrides = {}) {
    const params = { all: 1, ...overrides };
    const fecha = getValue('filtroFecha');
    const cliente = getValue('filtroCliente');
    const codCliente = getValue('filtroClienteCodigo');
    const estado = getValue('filtroEstado');
    const repartidor = getValue('filtroRepartidor');

    if (fecha) params.fecha = fecha;
    if (codCliente) params.codCliente = codCliente;
    else if (cliente) params.q = cliente;
    if (estado && estado !== 'all') params.estado = estado;
    if (repartidor) params.idRepartidor = repartidor;
    return params;
  }

  function normalizeAcuseSummary(summary = {}) {
    return {
      pendiente: Number(summary.pendiente || 0),
      en_transito: Number(summary.en_transito || 0),
      entregado: Number(summary.entregado || 0)
    };
  }

  function syncFilterUrl() {
    const url = new URL(window.location.href);
    const codCliente = getValue('filtroClienteCodigo');
    const filters = {
      fecha: getValue('filtroFecha'),
      q: !codCliente ? getValue('filtroCliente') : '',
      cliente: codCliente || '',
      codCliente: codCliente || '',
      estado: getValue('filtroEstado') === 'all' ? '' : getValue('filtroEstado'),
      repartidor: getValue('filtroRepartidor')
    };

    Object.entries(filters).forEach(([key, value]) => {
      if (value) url.searchParams.set(key, value);
      else url.searchParams.delete(key);
    });
    window.history.replaceState(null, '', `${url.pathname}${url.search}`);
  }

  function updateEstadoFilterTone() {
    const value = getValue('filtroEstado');
    const dot = document.getElementById('estadoPickerDot');
    const label = document.getElementById('estadoPickerLabel');
    if (dot && label) {
      const opt = document.querySelector(`.estado-picker__opt[data-value="${value}"]`);
      const color = opt ? opt.dataset.color : 'all';
      dot.className = `estado-dot estado-dot--${color}`;
      label.textContent = opt ? opt.dataset.label : 'Todos';
      document.querySelectorAll('.estado-picker__opt').forEach(function(o) {
        o.classList.toggle('selected', o.dataset.value === value);
      });
    }
  }

  function initEstadoPicker() {
    const btn = document.getElementById('estadoPickerBtn');
    const menu = document.getElementById('estadoPickerMenu');
    const hidden = document.getElementById('filtroEstado');
    if (!btn || !menu || !hidden) return;

    btn.addEventListener('click', function() {
      const isOpen = btn.classList.contains('open');
      if (isOpen) {
        btn.classList.remove('open');
        btn.setAttribute('aria-expanded', 'false');
        menu.style.display = 'none';
      } else {
        btn.classList.add('open');
        btn.setAttribute('aria-expanded', 'true');
        menu.style.display = '';
      }
    });

    menu.addEventListener('click', function(e) {
      const opt = e.target.closest('.estado-picker__opt');
      if (!opt) return;
      hidden.value = opt.dataset.value;
      btn.classList.remove('open');
      btn.setAttribute('aria-expanded', 'false');
      menu.style.display = 'none';
      updateEstadoFilterTone();
      hidden.dispatchEvent(new Event('change'));
    });

    document.addEventListener('click', function(e) {
      if (!document.getElementById('estadoPicker')?.contains(e.target)) {
        btn.classList.remove('open');
        btn.setAttribute('aria-expanded', 'false');
        menu.style.display = 'none';
      }
    });
  }

  function setTableLoading(loading) {
    const skeleton = document.getElementById('tableLoadingSkeleton');
    const body     = document.getElementById('acuseTableBody');
    const empty    = document.getElementById('emptyState');
    if (!skeleton) return;
    skeleton.style.display = loading ? 'block' : 'none';
    if (loading && body)  body.innerHTML  = '';
    if (loading && empty) empty.style.display = 'none';
  }

  async function fetchAcusesResponse(params = {}) {
    const baseParams = { ...params };
    const firstResponse = await AcuseAPI.get('/api/acuses', baseParams);
    const items = Array.isArray(firstResponse.items) ? [...firstResponse.items] : [];
    const total = Number(firstResponse.total || items.length || 0);

    if (!total || items.length >= total) {
      return {
        ...firstResponse,
        items,
        total
      };
    }

    const batchSize = Math.max(Number(firstResponse.limit || items.length || 100) || 100, 1);
    let offset = items.length;

    while (offset < total) {
      const nextResponse = await AcuseAPI.get('/api/acuses', {
        ...baseParams,
        all: 0,
        limit: batchSize,
        offset
      });
      const nextItems = Array.isArray(nextResponse.items) ? nextResponse.items : [];
      if (!nextItems.length) break;
      items.push(...nextItems);
      offset += nextItems.length;
    }

    return {
      ...firstResponse,
      items,
      total
    };
  }

  async function loadAcuses() {
    setTableLoading(true);
    try {
      const response = await fetchAcusesResponse(buildFilterParams());
      acuses = response.items || [];
      totalAcuses = Number(response.total || acuses.length || 0);
      acuseSummary = normalizeAcuseSummary(response.summary);

      if (totalAcuses === 0) {
        selectedAcuseId = null;
      }
    } finally {
      setTableLoading(false);
    }
    renderTable();
  }

  function focusSelectedAcuseRow() {
    if (!selectedAcuseId) return;
    window.requestAnimationFrame(() => {
      const row = document.querySelector(`#acuseTableBody [data-acuse-id="${selectedAcuseId}"]`);
      if (!row) return;
      row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }

  function destacarFilaGuardada(_acuseId) {
    // Sin efecto por ahora; pendiente de un rediseño.
  }

  function setSelectedAcuse(id) {
    selectedAcuseId = id ? Number(id) : null;
  }

  function isCompletedEstado(estado) {
    return normalizeEstadoValue(estado) === 'entregado';
  }

  function isCancelledEstado(estado) {
    return normalizeEstadoValue(estado) === 'anulado';
  }

  function findAcuseById(id) {
    return acuses.find((item) => Number(item.ID_Acuse) === Number(id)) || null;
  }

  window.openAcuseModal = async function openAcuseModal(options = {}) {
    const btn = document.getElementById('btnNuevoAcuse');
    const settings = options && typeof options === 'object' ? options : {};
    const openModal = async () => {
      clearDraftAfterSaveIfNeeded();
      resetAcuseWizardForm();
      if (settings.restoreDraft !== false) applyPendingAcuseDraft();
      updateDraftDiscardButton();
      openModalBackdrop('acuseModalWrapper');
    };

    if (settings.skipButtonLoading) {
      await openModal();
      return;
    }

    await runButtonLoading(btn, openModal, actionButtonLoadingMs);
  };

  window.openRepartidorModal = function openRepartidorModal() {
    setValue('nuevoRepartidorNombre', '');
    openModalBackdrop('repartidorModalWrapper', {
      onAfterOpen: () => document.getElementById('nuevoRepartidorNombre')?.focus()
    });
  };

  window.closeRepartidorModal = function closeRepartidorModal() {
    closeModalBackdrop('repartidorModalWrapper');
  };

  window.guardarNuevoRepartidor = async function guardarNuevoRepartidor() {
    const nombre = getValue('nuevoRepartidorNombre');
    const btn = document.getElementById('btnGuardarRepartidor');

    if (!nombre) {
      notify('Ingresa el nombre del repartidor.', 'error');
      document.getElementById('nuevoRepartidorNombre')?.focus();
      return;
    }

    setButtonLoading(btn, true);

    try {
      const repartidor = await AcuseAPI.post('/api/repartidores', {
        Nombre_Repartidor: nombre,
        Estado_Repartidor: 'Activo'
      });
      await reloadRepartidores(repartidor.ID);
      closeRepartidorModal();
      notify('Repartidor agregado correctamente.', 'success');
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setButtonLoading(btn, false);
    }
  };

  window.closeAcuseModal = function closeAcuseModal(options = {}) {
    const successActive = Boolean(options?.success)
      || document.getElementById('successOverlay')?.classList.contains('success-overlay--active');
    const shouldNotifyClose = embedMode
      && !embedSuppressClose
      && !successActive;
    const shouldSkipDraftPersist = draftDiscardedSinceReset && !hasMeaningfulDraft(buildAcuseDraftSnapshot());
    if (!currentEditId && !successActive) {
      if (shouldSkipDraftPersist) clearAcuseDraft();
      else persistAcuseDraft();
    }
    closeModalBackdrop('acuseModalWrapper', {
      cleanup: () => {
        const dialogElem = document.getElementById('acuseModalDialog');
        const wrapperElem = document.getElementById('acuseModalWrapper');
        dialogElem.classList.remove('modal--success-compact');
        dialogElem.style.overflow = '';
        wrapperElem?.classList.remove('modal-backdrop--success-compact');
        document.getElementById('successOverlay').classList.remove('success-overlay--active');
        document.getElementById('modalFormContent').style.opacity = '1';
        resetAcuseWizardForm();
        if (shouldSkipDraftPersist) draftDiscardedSinceReset = false;
        updateDraftDiscardButton();
      },
      onClosed: () => {
        if (shouldNotifyClose) notifyEmbedParent('close');
      }
    });
  };

  window.descartarBorradorAcuse = function descartarBorradorAcuse() {
    suppressDraftAutosave = true;
    try {
      draftDiscardedSinceReset = true;
      clearAcuseDraft();
      resetAcuseWizardForm();
    } finally {
      suppressDraftAutosave = false;
    }
    updateDraftDiscardButton();
    notify('Borrador descartado.', 'success');
  };

  function setEstadoChip(estado) {
    const safeEstado = normalizeEstadoValue(estado);
    setValue('estado', safeEstado);
    document.querySelectorAll('.status-chip-form').forEach((chip) => {
      chip.classList.remove('status-chip--active');
      const input = chip.querySelector('input');
      if (chip.dataset.value === safeEstado) {
        chip.classList.add('status-chip--active');
        input.checked = true;
      }
    });
  }

  function initFormChips() {
    document.querySelectorAll('.status-chip-form').forEach((chip) => {
      chip.addEventListener('click', function () {
        setEstadoChip(this.dataset.value);
      });
    });
  }

  function acuseWizardActionLabel() {
    return currentEditId ? 'Actualizar Acuse' : 'Guardar Acuse';
  }

  function syncAcuseWizardChrome() {
    const eyebrow = document.getElementById('wizardSidebarEyebrow');
    const sidebarTitle = document.getElementById('wizardSidebarTitle');
    const previewTitle = document.querySelector('.wizard-preview-head__title');
    const previewSubtitle = document.querySelector('.wizard-preview-head__subtitle');

    if (eyebrow) eyebrow.textContent = currentEditId ? 'Editar acuse' : 'Nuevo acuse';
    if (sidebarTitle) sidebarTitle.textContent = 'Acuse Operativo';
    if (previewTitle) previewTitle.textContent = currentEditId ? 'Todo listo para actualizar' : 'Todo listo para guardar';
    if (previewSubtitle) previewSubtitle.textContent = currentEditId
      ? 'Revisa el resumen del acuse antes de confirmar la actualizacion.'
      : 'Revisa el resumen del acuse antes de confirmar la carga.';
    updateDraftDiscardButton();
  }

  function syncAcuseWizardStepUi() {
    const headerTitle = document.getElementById('wizardHeaderTitle');
    const headerSubtitle = document.getElementById('wizardHeaderSubtitle');
    const progressBar = document.getElementById('wizardProgressBar');
    const stepCounter = document.getElementById('wizardStepCounter');
    const prevButton = document.getElementById('btnPasoAnterior');
    const actionButton = document.getElementById('btnGuardar');
    const stepMeta = acuseWizardMeta[acuseWizardStep] || acuseWizardMeta[1];

    if (headerTitle) headerTitle.textContent = stepMeta.title;
    if (headerSubtitle) headerSubtitle.textContent = stepMeta.subtitle;
    if (progressBar) progressBar.style.width = `${(acuseWizardStep / acuseWizardTotalSteps) * 100}%`;
    if (stepCounter) stepCounter.textContent = `Paso ${acuseWizardStep} de ${acuseWizardTotalSteps}`;
    if (prevButton) prevButton.style.display = acuseWizardStep === 1 ? 'none' : 'inline-flex';

    if (actionButton) {
      actionButton.className = acuseWizardStep === acuseWizardTotalSteps
        ? 'btn btn--success btn--compact'
        : 'btn btn--primary btn--compact';
      actionButton.innerHTML = acuseWizardStep === acuseWizardTotalSteps
        ? `<i class="fas fa-check"></i> ${acuseWizardActionLabel()}`
        : 'Siguiente <i class="fas fa-chevron-right"></i>';
      actionButton.disabled = false;
    }
  }

  function goToAcuseWizardStep(step) {
    const nextStep = Math.min(Math.max(Number(step) || 1, 1), acuseWizardTotalSteps);
    acuseWizardStep = nextStep;

    document.querySelectorAll('[data-step-panel]').forEach((panel) => {
      panel.classList.toggle('wizard-panel--active', Number(panel.dataset.stepPanel) === nextStep);
    });

    document.querySelectorAll('[data-wizard-step]').forEach((node) => {
      const nodeStep = Number(node.dataset.wizardStep);
      node.classList.remove('acuse-step--pending', 'acuse-step--active', 'acuse-step--completed');
      if (nodeStep < nextStep) node.classList.add('acuse-step--completed');
      else if (nodeStep === nextStep) node.classList.add('acuse-step--active');
      else node.classList.add('acuse-step--pending');
    });

    syncAcuseWizardChrome();
    syncAcuseWizardStepUi();

    if (nextStep === 3) buildAcusePreview();

    const body = document.querySelector('.acuse-wizard__body');
    if (body) body.scrollTop = 0;
  }

  function pulseDetalleEmptyState() {
    const empty = document.getElementById('detalleEmptyState');
    if (!empty) return;
    empty.classList.add('wizard-empty-state--alert');
    window.setTimeout(() => empty.classList.remove('wizard-empty-state--alert'), 1400);
  }

  function markWizardFieldError(id) {
    const element = document.getElementById(id);
    if (!element) return;
    const isTextArea = element.tagName === 'TEXTAREA';
    const isSelect = element.tagName === 'SELECT';
    element.classList.add(isTextArea ? 'wizard-textarea--error' : isSelect ? 'wizard-select--error' : 'wizard-input--error');
    const field = element.closest('.wizard-field');
    if (field && field.querySelector('.acuse-combo__control')) field.classList.add('wizard-field--error');
    window.setTimeout(() => {
      element.classList.remove('wizard-input--error', 'wizard-select--error', 'wizard-textarea--error');
      if (field) field.classList.remove('wizard-field--error');
    }, 1500);
  }

  function validateWizardStepOne() {
    const fecha = getValue('fechaEmision');
    const repartidor = getValue('repartidor');
    const cliente = getValue('cliente');

    if (fecha && repartidor && cliente) return true;

    if (!fecha) markWizardFieldError('fechaEmision');
    if (!repartidor) markWizardFieldError('repartidor');
    if (!cliente) markWizardFieldError('clienteSearch');
    notify('Completa fecha, repartidor y cliente antes de continuar.', 'error');
    return false;
  }

  function validateWizardStepTwo() {
    const hasPendingDetalle = getValue('mercaderiaSearch') || getValue('mercaderia') || getValue('cantidad') || getValue('um') || getValue('notaDetalle');

    if (hasPendingDetalle) {
      const detalle = readDetalleFromForm(true);
      if (!detalle) return false;
      detallesDraft.push(detalle);
      clearDetalleInputs();
      renderDetalleItems();
    }

    if (!detallesDraft.length) {
      pulseDetalleEmptyState();
      notify('Agrega al menos una mercaderia para continuar.', 'error');
      return false;
    }

    return true;
  }

  window.handleAcuseWizardAction = function handleAcuseWizardAction() {
    if (acuseWizardStep === 1) {
      if (!validateWizardStepOne()) return;
      goToAcuseWizardStep(2);
      return;
    }

    if (acuseWizardStep === 2) {
      if (!validateWizardStepTwo()) return;
      goToAcuseWizardStep(3);
      return;
    }

    guardarAcuse();
  };

  window.prevAcuseWizardStep = function prevAcuseWizardStep() {
    if (acuseWizardStep > 1) goToAcuseWizardStep(acuseWizardStep - 1);
  };

  function buildAcusePreview() {
    const cliente = getSelectedClienteData();
    setText('previewFecha', formatPreviewDate(getValue('fechaEmision')) || '--');
    setText('previewRepartidor', getValue('repartidorSearch') || getSelectedOptionText('repartidor') || '--');
    setText('previewCliente', getValue('clienteSearch') || (cliente ? clienteLabel(cliente) : '--'));
    setText('previewRuc', cliente?.Ruc_Cliente || '--');
    setText('previewDireccion', cliente?.Direc_Cliente || '--');
    setText('previewTelefono', getClienteTelefono(cliente) || '--');
    setText('previewCiudad', cliente?.Ciudad_Cliente || getValue('zona') || '--');
    setText('previewObservacion', getValue('observacion') || '--');
    setText('previewItemsCount', String(detallesDraft.length));

    const body = document.getElementById('previewItemsBody');
    if (!body) return;

    if (!detallesDraft.length) {
      body.innerHTML = '<tr><td colspan="4"><span class="wizard-item-note">Sin mercaderias agregadas.</span></td></tr>';
      return;
    }

    body.innerHTML = detallesDraft.map((item) => `<tr>
      <td><span class="wizard-item-name">${escapeHtml(item.Cod_Mercaderia)} - ${escapeHtml(item.Descr_SAP || 'Sin descripcion')}</span></td>
      <td>${escapeHtml(item.UM || '--')}</td>
      <td><strong>${escapeHtml(formatQuantity(item.Cantidad))}</strong></td>
      <td><span class="wizard-item-note">${escapeHtml(item.Nota || '--')}</span></td>
    </tr>`).join('');
  }

  function addDetalleFromForm() {
    const detalle = readDetalleFromForm(true);
    if (!detalle) return;

    detallesDraft.push(detalle);
    clearDetalleInputs();
    renderDetalleItems();
    queueAcuseDraftSave();
  }

  function readDetalleFromForm(showErrors = false) {
    const codMercaderia = getValue('mercaderia');
    const cantidad = parseQuantityValue(getValue('cantidad'));
    const um = getValue('um');
    const nota = getValue('notaDetalle') || null;
    const articulo = findArticuloByCode(codMercaderia);
    const hasAnyValue = getValue('mercaderiaSearch') || codMercaderia || getValue('cantidad') || um || nota;

    if (!hasAnyValue) return null;

    if (!codMercaderia || !articulo) {
      if (showErrors) notify('Selecciona una mercaderia valida desde el buscador.', 'error');
      return null;
    }

    if (!Number.isFinite(cantidad) || cantidad <= 0) {
      markWizardFieldError('cantidad');
      if (showErrors) notify('Ingresa una cantidad valida para la mercaderia.', 'error');
      return null;
    }

    return {
      Cod_Mercaderia: codMercaderia,
      Descr_SAP: articulo.Descr_SAP || codMercaderia,
      Cantidad: cantidad,
      UM: um || articulo.UM_SAP || '',
      Nota: nota
    };
  }

  function clearDetalleInputs() {
    setValue('mercaderia', '');
    setValue('mercaderiaSearch', '');
    setValue('um', '');
    setValue('cantidad', '');
    setValue('notaDetalle', '');
    closeCombo('articuloSuggestions', 'mercaderiaSearch');
    syncAllWizardFieldChecks();
  }

  function renderDetalleItems() {
    const wrapper = document.getElementById('detalleTableWrapper');
    const body = document.getElementById('detalleItemsBody');
    const empty = document.getElementById('detalleEmptyState');
    if (!wrapper || !body) return;

    if (!detallesDraft.length) {
      wrapper.style.display = 'none';
      body.innerHTML = '';
      if (empty) empty.style.display = 'flex';
      buildAcusePreview();
      return;
    }

    wrapper.style.display = 'block';
    if (empty) empty.style.display = 'none';
    body.innerHTML = detallesDraft.map((item, index) => `<tr>
      <td><span class="wizard-item-name">${escapeHtml(item.Cod_Mercaderia)} - ${escapeHtml(item.Descr_SAP || 'Sin descripcion')}</span></td>
      <td>${escapeHtml(item.UM || '--')}</td>
      <td><strong>${escapeHtml(formatQuantity(item.Cantidad))}</strong></td>
      <td><span class="wizard-item-note">${escapeHtml(item.Nota || '--')}</span></td>
      <td><button class="wizard-del-btn" type="button" onclick="quitarDetalle(${index})" title="Quitar" aria-label="Quitar mercadería"><i class="fas fa-trash" aria-hidden="true"></i></button></td>
    </tr>`).join('');
    buildAcusePreview();
  }

  window.quitarDetalle = function quitarDetalle(index) {
    detallesDraft.splice(index, 1);
    renderDetalleItems();
    queueAcuseDraftSave();
  };

  window.guardarAcuse = async function guardarAcuse() {
    const payload = buildPayload();
    if (!payload) return;

    const btn = document.getElementById('btnGuardar');
    setButtonLoading(btn, true);

    try {
      const isEditing = Boolean(currentEditId);
      const successToast = buildSuccessToastPayload(isEditing ? 'ACTUALIZADO' : 'REGISTRADO');
      const saved = isEditing
        ? await AcuseAPI.put(`/api/acuses/${currentEditId}`, payload)
        : await AcuseAPI.post('/api/acuses', payload);
      const savedId = Number(saved.ID_Acuse || currentEditId || 0) || null;
      if (savedId) {
        acuseDetailsCache.set(savedId, saved);
      }

      if (!isEditing) markDraftAsSaved();
      setSelectedAcuse(null);

      notifyDataChanged(isEditing ? 'edit' : 'create', { id: savedId || null });
      if (embedMode) {
        notifyEmbedParent('completed', {
          action: isEditing ? 'edit' : 'create',
          id: savedId || null,
          toastMessage: successToast.message,
          toastType: successToast.type
        });
        return;
      }

      closeAcuseModal({ success: true });
      await loadAcuses();
      notify(successToast.message, successToast.type);
      destacarFilaGuardada(savedId);
    } catch (error) {
      notify(error.message, 'error');
      syncAcuseWizardStepUi();
    } finally {
      setButtonLoading(btn, false);
    }
  };

  function buildPayload() {
    const fecha = getValue('fechaEmision');
    const idRepartidor = getValue('repartidor');
    const codCliente = getValue('cliente');
    const zona = getValue('zona');
    const estado = currentEditAcuse?.Estado || 'pendiente';
    const fechaEntrega = currentEditAcuse?.Fecha_Entrega || null;
    const detalleEnFormulario = readDetalleFromForm(false);
    const hasDetallePendiente = getValue('mercaderiaSearch') || getValue('mercaderia') || getValue('cantidad') || getValue('um') || getValue('notaDetalle');
    const detalles = detalleEnFormulario ? [...detallesDraft, detalleEnFormulario] : [...detallesDraft];

    if (!fecha || !idRepartidor || !codCliente) {
      notify('Completa fecha, repartidor y cliente.', 'error');
      return null;
    }

    if (hasDetallePendiente && !detalleEnFormulario) {
      readDetalleFromForm(true);
      return null;
    }

    if (!detalles.length) {
      notify('Agrega al menos una mercaderia al detalle del acuse.', 'error');
      return null;
    }

    const usuario = resolveCurrentOperator();
    if (!usuario) return null;

    return {
      Nro_Acuse: currentEditId ? undefined : null,
      Cod_Cliente: codCliente,
      Estado: estado,
      Fecha_Emision: fecha,
      Fecha_Entrega: fechaEntrega,
      ID_Repartidor: Number(idRepartidor),
      Zona: zona,
      Observacion: getValue('observacion') || null,
      Usuario: usuario,
      detalles: detalles.map((item) => ({
        Cod_Mercaderia: item.Cod_Mercaderia,
        Cantidad: Number(item.Cantidad),
        UM: item.UM,
        Nota: item.Nota || null
      }))
    };
  }

  function buildSuccessToastPayload(text) {
    const normalized = String(text || '').trim().toUpperCase();
    return {
      type: 'complete',
      message: normalized === 'ACTUALIZADO'
        ? 'ACUSE ACTUALIZADO CORRECTAMENTE.'
        : 'ACUSE REGISTRADO CORRECTAMENTE.'
    };
  }

  function renderTable() {
    const body = document.getElementById('acuseTableBody');
    const empty = document.getElementById('emptyState');
    const table = document.querySelector('#acuseTable')?.closest('.table-container');

    updateAcusesHeaderSummary();

    if (!acuses.length) {
      body.innerHTML = '';
      empty.style.display = 'block';
      table.style.display = 'none';
      return;
    }

    empty.style.display = 'none';
    table.style.display = 'block';

    body.innerHTML = acuses.map((item) => {
      const fecha = formatDate(item.Fecha_Emision || item.Fecha_Creacion);
      const cliente = item.Nom_Cliente || item.Cod_Cliente || 'Sin cliente';
      const ciudad = item.Ciudad_Cliente || item.Zona || item.Zona_Cliente || 'Sin ciudad';
      const isSelected = Number(item.ID_Acuse) === Number(selectedAcuseId);
      const isCompleted = isCompletedEstado(item.Estado);
      const isCancelled = isCancelledEstado(item.Estado);
      const totalItems = Number(item.Detalle_Items || 0);
      const itemsLabel = `${totalItems} item${totalItems === 1 ? '' : 's'}`;
      const actionsHtml = isCancelled
        ? '<div class="acciones-group" style="justify-content:center;"><span style="font-size:12px;color:#9CA3AF;font-weight:700;">Sin acciones</span></div>'
        : `<div class="acciones-group" style="${isCompleted ? 'justify-content:center;' : ''}">
            ${isCompleted ? '' : `<button class="action-btn action-btn--success" onclick="event.stopPropagation(); marcarAcuseEntregado(${item.ID_Acuse}, this)" title="Marcar como entregado" aria-label="Marcar como entregado"><i class="fas fa-check" aria-hidden="true"></i></button>`}
            ${isCompleted ? '' : `<button class="action-btn" onclick="event.stopPropagation(); editarAcuse(${item.ID_Acuse}, this)" title="Editar" aria-label="Editar acuse"><i class="fas fa-pen" aria-hidden="true"></i></button>`}
            <button class="action-btn" onclick="event.stopPropagation(); imprimirAcuse(${item.ID_Acuse}, this)" title="Imprimir" aria-label="Imprimir acuse"><i class="fas fa-print" aria-hidden="true"></i></button>
            ${isCompleted ? '' : `<button class="action-btn action-btn--danger" onclick="event.stopPropagation(); confirmarAnulacionAcuse(${item.ID_Acuse})" title="Anular" aria-label="Anular acuse"><i class="fas fa-ban" aria-hidden="true"></i></button>`}
          </div>`;
      return `<tr class="table__row acuses-table__row ${isSelected ? 'table__row--selected' : ''}" data-acuse-id="${item.ID_Acuse}">
        <td class="table__cell">${renderFechaCell(item.Fecha_Emision || item.Fecha_Creacion, item.Estado, fecha)}</td>
        <td class="table__cell">${renderClienteCell(cliente)}</td>
        <td class="table__cell">${renderCiudadCell(ciudad)}</td>
        <td class="table__cell table__cell--detail-action">
          <button class="table-detail-btn" onclick="event.stopPropagation(); verFichaAcuse(${item.ID_Acuse}, this)" type="button" title="Ver detalle del acuse">
            <span class="table-detail-btn__iconbox" aria-hidden="true"><i class="far fa-eye"></i></span>
            <span>Ver detalle</span>
          </button>
          <span class="table-detail-btn__meta">${escapeHtml(itemsLabel)}</span>
        </td>
        <td class="table__cell">${renderEstadoChip(item.Estado)}</td>
        <td class="table__cell table__cell--actions">${actionsHtml}</td>
      </tr>`;
    }).join('');
  }

  function updateAcusesHeaderSummary() {
    const total = totalAcuses;
    const counts = {
      pendiente: acuseSummary.pendiente,
      en_transito: acuseSummary.en_transito,
      entregado: acuseSummary.entregado
    };

    setText('acusesTableSubtitle', `${total} registro${total === 1 ? '' : 's'} · actualizado hace un momento`);
    setText('badgePendientesText', `${counts.pendiente} pendiente${counts.pendiente === 1 ? '' : 's'}`);
    setText('badgeTransitoText', `${counts.en_transito} en tránsito`);
    setText('badgeEntregadosText', `${counts.entregado} entregado${counts.entregado === 1 ? '' : 's'}`);
  }

  function renderFechaCell(value, estado, formattedDate) {
    return `<div class="cell-fecha">
      <span class="fecha-bar ${estadoToneClass(estado)}"></span>
      <div>
        <div class="fecha-valor">${escapeHtml(formattedDate || '--')}</div>
        <div class="fecha-relativa">${escapeHtml(formatRelativeDate(value))}</div>
      </div>
    </div>`;
  }

  function renderClienteCell(cliente) {
    return `<div class="cell-cliente">
      <i class="far fa-user cell-cliente__icon" aria-hidden="true"></i>
      <span class="cliente-nombre table__text-ellipsis" title="${escapeHtml(cliente)}">${escapeHtml(cliente)}</span>
    </div>`;
  }

  function renderCiudadCell(ciudad) {
    return `<div class="cell-ciudad">
      <i class="fas fa-map-marker-alt cell-ciudad__icon" aria-hidden="true"></i>
      <span class="table__text-ellipsis" title="${escapeHtml(ciudad)}">${escapeHtml(ciudad)}</span>
    </div>`;
  }

  function renderCheckIcon(className) {
    return `<svg class="${className}" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M4.5 10.5l3.2 3.2L15.5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  }

  function renderStatusSummaryContent(estado) {
    const normalized = normalizeEstadoValue(estado);
    const label = escapeHtml(formatEstado(estado));
    if (normalized === 'entregado') {
      return `${renderCheckIcon('status__check')}<span class="status__label">${label}</span>`;
    }
    return `<span class="status__dot" aria-hidden="true"></span><span class="status__label">${label}</span>`;
  }

  function renderEstadoChip(estado) {
    const normalized = normalizeEstadoValue(estado);
    const label = formatEstado(estado);
    if (normalized === 'entregado') {
      return `<span class="chip chip-entregado">${renderCheckIcon('chip-icon')}<span>${escapeHtml(label)}</span></span>`;
    }
    if (normalized === 'anulado') {
      return `<span class="chip chip-anulado"><span class="chip-dot" aria-hidden="true"></span><span>${escapeHtml(label)}</span></span>`;
    }
    return `<span class="chip ${normalized === 'en_transito' ? 'chip-en-transito' : 'chip-pendiente'}"><span class="chip-dot" aria-hidden="true"></span><span>${escapeHtml(label)}</span></span>`;
  }

  function estadoToneClass(estado) {
    const normalized = normalizeEstadoValue(estado);
    if (normalized === 'anulado') return 'anulado';
    if (normalized === 'entregado') return 'entregado';
    if (normalized === 'en_transito') return 'en-transito';
    return 'pendiente';
  }

  function formatRelativeDate(value) {
    if (!value) return '--';
    const target = new Date(`${String(value).slice(0, 10)}T00:00:00`);
    if (Number.isNaN(target.getTime())) return '--';
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const diffDays = Math.round((target.getTime() - today.getTime()) / 86400000);
    if (diffDays === 0) return 'Hoy';
    if (diffDays === -1) return 'Ayer';
    if (diffDays === 1) return 'Mañana';
    return target.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
  }

  window.editarAcuse = async function editarAcuse(id, button) {
    await runButtonLoading(button, async () => {
      const acuseListado = findAcuseById(id);
      if (acuseListado && isCompletedEstado(acuseListado.Estado)) {
        notify('El acuse entregado solo puede visualizarse o imprimirse.', 'warning');
        return;
      }
      setSelectedAcuse(id);
      const acuse = await AcuseAPI.get(`/api/acuses/${id}`);
      const detalle = acuse.detalles && acuse.detalles[0] ? acuse.detalles[0] : {};
      currentEditId = id;
      currentEditAcuse = acuse;

      setValue('fechaEmision', toDateInput(acuse.Fecha_Emision));
      fillRepartidores(acuse.ID_Repartidor);
      ensureClienteOption(acuse);
      ensureArticuloOptions(acuse.detalles || []);
      detallesDraft = (acuse.detalles || []).map((item) => ({
        Cod_Mercaderia: item.Cod_Mercaderia,
        Descr_SAP: item.Descr_SAP || item.Cod_Mercaderia,
        Cantidad: Number(item.Cantidad || 0),
        UM: item.UM || '',
        Nota: item.Nota || null
      }));
      setValue('zona', acuse.Zona || acuse.Ciudad_Cliente || acuse.Zona_Cliente || '');
      clearDetalleInputs();
      renderDetalleItems();
      setValue('observacion', acuse.Observacion || '');
      setValue('estado', normalizeEstadoValue(acuse.Estado));
      syncAcuseWizardChrome();
      goToAcuseWizardStep(1);
      syncAllWizardFieldChecks();
      renderTable();
      openModalBackdrop('acuseModalWrapper');
    }, actionButtonLoadingMs).catch((error) => {
      notify(error.message, 'error');
    });
  };

  function ensureClienteOption(acuse) {
    if (acuse.Cod_Cliente && !catalogos.clientes.some((item) => item.Cod_Cliente === acuse.Cod_Cliente)) {
      catalogos.clientes.push({
        Cod_Cliente: acuse.Cod_Cliente,
        Nom_Cliente: acuse.Nom_Cliente || acuse.Cod_Cliente,
        Ruc_Cliente: acuse.Ruc_Cliente || '',
        Direc_Cliente: acuse.Direc_Cliente || '',
        Telefono_Cliente: getClienteTelefono(acuse) || '',
        Ciudad_Cliente: acuse.Ciudad_Cliente || acuse.Zona,
        Zona_Cliente: acuse.Zona_Cliente || acuse.Zona
      });
    }
    fillClientes(acuse.Cod_Cliente);
  }

  function ensureArticuloOptions(detalles = []) {
    detalles.forEach((detalle) => {
      if (detalle.Cod_Mercaderia && !catalogos.articulos.some((item) => item.Material_SAP === detalle.Cod_Mercaderia)) {
        catalogos.articulos.push({
          Material_SAP: detalle.Cod_Mercaderia,
          Descr_SAP: detalle.Descr_SAP || detalle.Cod_Mercaderia,
          UM_SAP: detalle.UM
        });
      }
    });
    fillArticulos();
  }

  window.verFichaAcuse = async function verFichaAcuse(id, button) {
    await runButtonLoading(button, async () => {
      setSelectedAcuse(id);
      const normalizedId = Number(id);
      const acuse = acuseDetailsCache.get(normalizedId) || await AcuseAPI.get(`/api/acuses/${normalizedId}`);
      acuseDetailsCache.set(normalizedId, acuse);

      document.getElementById('f-id').textContent = acuse.Nro_Acuse || `#${acuse.ID_Acuse}`;
      document.getElementById('f-rep').textContent = acuse.Nombre_Repartidor || 'Sin repartidor';
      document.getElementById('f-cam').textContent = acuse.Cod_Cliente ? clienteLabel(acuse) : (acuse.Nom_Cliente || 'Sin cliente');
      document.getElementById('f-ruc').textContent = acuse.Ruc_Cliente || '--';
      document.getElementById('f-direccion').textContent = acuse.Direc_Cliente || '--';
      document.getElementById('f-telefono').textContent = getClienteTelefono(acuse) || '--';
      document.getElementById('f-fec').textContent = formatPreviewDate(acuse.Fecha_Emision) || '--';
      document.getElementById('f-zon').textContent = acuse.Ciudad_Cliente || acuse.Zona || acuse.Zona_Cliente || 'Sin ciudad';
      document.getElementById('f-obs').textContent = acuse.Observacion || '--';

      const badge = document.getElementById('f-estado');
      badge.innerHTML = renderStatusSummaryContent(acuse.Estado);
      badge.className = `badge ${statusClass(acuse.Estado)}`;

      const detalles = Array.isArray(acuse.detalles) ? acuse.detalles : [];
      document.getElementById('f-items-count').textContent = String(detalles.length);
      document.getElementById('f-items-body').innerHTML = detalles.length
        ? detalles.map((detalle) => `<tr>
          <td><span class="wizard-item-note">${escapeHtml(detalle.Cod_Mercaderia || '--')}</span></td>
          <td><span class="wizard-item-name">${escapeHtml(detalle.Descr_SAP || detalle.Cod_Mercaderia || '--')}</span></td>
          <td>${escapeHtml(detalle.UM || '--')}</td>
          <td><strong>${escapeHtml(formatQuantity(detalle.Cantidad))}</strong></td>
          <td><span class="wizard-item-note">${escapeHtml(detalle.Nota || '--')}</span></td>
        </tr>`).join('')
        : '<tr><td colspan="5"><span class="wizard-item-note">Sin mercaderias cargadas.</span></td></tr>';
      renderTable();
      openModalBackdrop('fichaModalWrapper');
    }, actionButtonLoadingMs).catch((error) => {
      notify(error.message, 'error');
    });
  };

  window.closeFichaAcuse = function closeFichaAcuse() {
    closeModalBackdrop('fichaModalWrapper', {
      onClosed: () => {
        if (embedMode && !embedSuppressClose) notifyEmbedParent('close');
      }
    });
  };

  function formatDetallesDescripcion(detalles = []) {
    if (!detalles.length) return 'Sin mercaderia';
    return detalles.map((item) => item.Descr_SAP || item.Cod_Mercaderia || 'Sin mercaderia').join(' | ');
  }

  function formatDetallesCantidad(detalles = []) {
    if (!detalles.length) return '--';
    return detalles.map((item) => `${formatQuantity(item.Cantidad)} ${item.UM || ''}`.trim()).join(' | ');
  }

  window.imprimirAcuse = async function imprimirAcuse(id, button) {
    await runButtonLoading(button, async () => {
      const normalizedId = Number(id);
      setSelectedAcuse(id);
      const acuse = await AcuseAPI.get(`/api/acuses/${normalizedId}`);
      acuseDetailsCache.set(normalizedId, acuse);

      removeSessionValue(printDataSessionKey);
      removeSessionValue(legacyPrintDataSessionKey);
      saveSessionJson(printDataSessionKey, acuse);
      mostrarVistaPreviaImpresion();
    }, actionButtonLoadingMs).catch((error) => {
      notify(error.message, 'error');
    });
  };

  window.mostrarVistaPreviaImpresion = function mostrarVistaPreviaImpresion() {
    const wrapper = document.getElementById('printPreviewModalWrapper');
    if (!wrapper) return;
    const frame = document.getElementById('printPreviewFrame');
    if (frame) frame.src = '/views/acuse-imprimir.html?preview=1';
    openModalBackdrop(wrapper);
  };

  window.cerrarVistaPreviaImpresion = function cerrarVistaPreviaImpresion() {
    const wrapper = document.getElementById('printPreviewModalWrapper');
    if (!wrapper) return;
    closeModalBackdrop(wrapper, {
      cleanup: () => {
        const frame = document.getElementById('printPreviewFrame');
        if (frame) frame.src = '';
      },
      onClosed: () => {
        if (embedMode && !embedSuppressClose) notifyEmbedParent('close');
      }
    });
  };

  window.abrirImpresionDesdeModal = async function abrirImpresionDesdeModal() {
    const usuario = resolveCurrentOperator();
    const selectedId = Number(selectedAcuseId || 0) || null;
    const frame = document.getElementById('printPreviewFrame');

    if (!frame || !frame.contentWindow) {
      notify('No se pudo preparar la impresión del acuse.', 'error');
      return;
    }

    if (selectedId && usuario) {
      try {
        await AcuseAPI.post(`/api/dashboard/interactivo/acuses/${selectedId}/print`, {
          Usuario: usuario,
          Observacion: 'Impresion desde vista previa de acuse'
        });
      } catch (error) {
        notify(error.message, 'error');
      }
    }

    frame.contentWindow.focus();
    frame.contentWindow.print();
    notify('Enviando acuse a impresion.', 'success');

    window.setTimeout(async () => {
      notifyDataChanged('print', { id: selectedId });
      if (embedMode) {
        notifyEmbedParent('completed', { action: 'print', id: selectedId });
      } else {
        try {
          await loadAcuses();
          focusSelectedAcuseRow();
        } catch (error) {
          notify(error.message, 'error');
        }
        cerrarVistaPreviaImpresion();
      }
    }, 300);
  };

  window.confirmarAnulacionAcuse = function confirmarAnulacionAcuse(id) {
    const acuseListado = findAcuseById(id);
    if (acuseListado && isCompletedEstado(acuseListado.Estado)) {
      notify('El acuse entregado ya no puede anularse desde esta pantalla.', 'warning');
      return;
    }
    if (acuseListado && isCancelledEstado(acuseListado.Estado)) {
      notify('El acuse ya se encuentra anulado.', 'warning');
      return;
    }
    setSelectedAcuse(id);
    renderTable();
    anulacionTargetId = id;
    const motivoInput = document.getElementById('anulacionMotivo');
    if (motivoInput) motivoInput.value = '';
    const wrapper = document.getElementById('anulacionConfirmModalWrapper');
    openModalBackdrop(wrapper);
    window.setTimeout(() => motivoInput?.focus(), 80);
  };

  window.marcarAcuseEntregado = async function marcarAcuseEntregado(id, button) {
    await runButtonLoading(button, async () => {
      const acuseListado = findAcuseById(id);
      if (acuseListado && isCompletedEstado(acuseListado.Estado)) {
        notify('El acuse ya esta entregado.', 'warning');
        return;
      }

      const usuario = resolveCurrentOperator();
      if (!usuario) return;

      setSelectedAcuse(id);
      const updated = await AcuseAPI.patch(`/api/acuses/${id}/estado`, {
        Estado: 'Entregado',
        Fecha_Entrega: currentDateTimeValue(),
        Usuario: usuario,
        Observacion: 'Cambio a entregado desde el listado de acuses'
      });
      acuseDetailsCache.set(Number(id), updated);

      notifyDataChanged('deliver', { id: Number(id) });
      if (embedMode) notifyEmbedParent('completed', { action: 'deliver', id: Number(id) });
      notify('Acuse marcado como entregado.', 'success');
      await loadAcuses();
      focusSelectedAcuseRow();
    }, actionButtonLoadingMs).catch((error) => {
      notify(error.message, 'error');
    });
  };

  window.cancelarAnulacion = function cancelarAnulacion() {
    anulacionTargetId = null;
    const motivoInput = document.getElementById('anulacionMotivo');
    if (motivoInput) motivoInput.value = '';
    closeModalBackdrop('anulacionConfirmModalWrapper', {
      onClosed: () => {
        if (embedMode && !embedSuppressClose) notifyEmbedParent('close');
      }
    });
  };

  window.ejecutarAnulacion = async function ejecutarAnulacion() {
    if (!anulacionTargetId) return;
    const btn = document.getElementById('btnConfirmarAnulacion');
    const motivoInput = document.getElementById('anulacionMotivo');
    const motivo = String(motivoInput?.value || '').trim();
    if (!motivo) {
      notify('Debes indicar el motivo de la anulacion.', 'warning');
      motivoInput?.focus();
      return;
    }
    setButtonLoading(btn, true);
    try {
      const usuario = resolveCurrentOperator();
      if (!usuario) return;
      await AcuseAPI.delete(`/api/acuses/${anulacionTargetId}`, { Usuario: usuario, Observacion: motivo });
      notify('Acuse anulado correctamente', 'annul');
      notifyDataChanged('annul', { id: Number(anulacionTargetId) });
      if (embedMode) notifyEmbedParent('completed', { action: 'annul', id: Number(anulacionTargetId) });
      embedSuppressClose = true;
      cancelarAnulacion();
      embedSuppressClose = false;
      await loadAcuses();
    } catch (error) {
      notify(error.message, 'error');
    } finally {
      setButtonLoading(btn, false);
    }
  };

  async function fetchAcusesForExport() {
    const response = await fetchAcusesResponse(buildFilterParams());
    return response.items || [];
  }

  window.exportarAcuses = async function exportarAcuses() {
    const btn = document.getElementById('btnExportarAcuses');
    await runButtonLoading(btn, async () => {
      const exportItems = await fetchAcusesForExport();
      if (!exportItems.length) {
        notify('No hay acuses para exportar con los filtros actuales.', 'warning');
        return;
      }

      const detailedItems = await fetchDetailedAcusesForExport(exportItems);
      const csv = buildDetailedAcusesCsv(detailedItems);
      downloadCsv(csv, acuseExportFilename(currentDateValue()));
      notify('Exportacion completa generada.', 'success');
    }, actionButtonLoadingMs);
  };

  async function fetchDetailedAcusesForExport(items) {
    const detailed = [];
    const batchSize = 6;

    for (let index = 0; index < items.length; index += batchSize) {
      const batch = items.slice(index, index + batchSize);
      const resolved = await Promise.all(batch.map(async (item) => {
        const id = item.ID_Acuse || item.id;
        if (!id) return item;
        try {
          return await AcuseAPI.get(`/api/acuses/${id}`);
        } catch (error) {
          return item;
        }
      }));
      detailed.push(...resolved);
    }

    return detailed;
  }

  function buildDetailedAcusesCsv(items) {
    const rows = [[
      'Nro Acuse',
      'ID Acuse',
      'Fecha Emision',
      'Fecha Entrega',
      'Fecha Creacion',
      'Estado',
      'Usuario Creacion',
      'Cod Cliente',
      'Cliente',
      'RUC',
      'Telefono',
      'Direccion',
      'Ciudad',
      'Zona',
      'ID Repartidor',
      'Codigo Repartidor',
      'Repartidor',
      'Observacion Acuse',
      'Items Acuse',
      'Total Unidades Acuse',
      'Linea',
      'Cod Mercaderia',
      'Descripcion Mercaderia',
      'Cantidad',
      'UM',
      'Nota Item',
      'Status SAP',
      'Jerarquia SAP',
      'Ultimo Estado',
      'Fecha Ultimo Estado',
      'Usuario Ultimo Estado',
      'Ultima Accion',
      'Fecha Ultima Accion',
      'Usuario Ultima Accion',
      'Observacion Ultima Accion'
    ]];

    items.forEach((acuse) => {
      const detalles = Array.isArray(acuse.detalles) && acuse.detalles.length ? acuse.detalles : [null];
      const ultimoEstado = Array.isArray(acuse.historial) && acuse.historial.length ? acuse.historial[0] : null;
      const ultimaAccion = Array.isArray(acuse.acciones) && acuse.acciones.length ? acuse.acciones[0] : null;
      const totalUnidades = acuse.Detalle_Cantidad_Total
        ? detalles.reduce((total, item) => total + Number(item?.Cantidad || 0), 0)
        : Number(acuse.Detalle_Cantidad_Total || 0);

      detalles.forEach((detalle, index) => {
        rows.push([
          acuse.Nro_Acuse || acuse.ID_Acuse || '',
          acuse.ID_Acuse || '',
          formatExportDate(acuse.Fecha_Emision),
          formatExportDateTime(acuse.Fecha_Entrega),
          formatExportDateTime(acuse.Fecha_Creacion),
          formatEstado(acuse.Estado),
          acuse.Usuario_Creacion || '',
          acuse.Cod_Cliente || '',
          acuse.Nom_Cliente || '',
          acuse.Ruc_Cliente || '',
          acuse.Telefono_Cliente || acuse.Telef_Cliente || acuse.TelF_Cliente || '',
          acuse.Direc_Cliente || '',
          acuse.Ciudad_Cliente || '',
          acuse.Zona || acuse.Zona_Cliente || '',
          acuse.ID_Repartidor || '',
          acuse.Codigo_Repartidor || '',
          acuse.Nombre_Repartidor || '',
          acuse.Observacion || '',
          acuse.Detalle_Items ? detalles.filter(Boolean).length : 0,
          formatQuantity(totalUnidades),
          detalle ? index + 1 : '',
          detalle?.Cod_Mercaderia || '',
          detalle?.Descr_SAP || '',
          detalle ? formatQuantity(detalle.Cantidad) : '',
          detalle?.UM || '',
          detalle?.Nota || '',
          detalle?.Status_SAP || '',
          detalle?.Jerarquia_SAP || '',
          ultimoEstado?.Estado || '',
          formatExportDateTime(ultimoEstado?.Fecha),
          ultimoEstado?.Usuario || '',
          ultimaAccion?.Accion || '',
          formatExportDateTime(ultimaAccion?.FechaHora),
          ultimaAccion?.Usuario || '',
          ultimaAccion?.Observacion || ''
        ]);
      });
    });

    return csvFromRows(rows);
  }

  function csvFromRows(rows) {
    return rows.map((row) => row.map(csvCell).join(';')).join('\n');
  }

  function csvCell(value) {
    return `"${String(value ?? '').replace(/"/g, '""')}"`;
  }

  function downloadCsv(csv, filename) {
    const blob = new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  }

  function acuseExportFilename(dateText) {
    return `DATOS ACUSE ${dateText}.csv`;
  }

  function formatExportDate(value) {
    if (!value) return '';
    const text = String(value).slice(0, 10);
    return text === '--' ? '' : formatDate(text);
  }

  function formatExportDateTime(value) {
    if (!value) return '';
    const text = String(value).replace('T', ' ').slice(0, 19);
    const [datePart, timePart = ''] = text.split(' ');
    const formattedDate = formatExportDate(datePart);
    return `${formattedDate}${timePart ? ` ${timePart.slice(0, 5)}` : ''}`.trim();
  }

  function statusClass(estado) {
    const normalized = normalizeEstadoValue(estado);
    if (normalized === 'entregado') return 'status status--ent';
    if (normalized === 'anulado') return 'status status--cancel';
    if (normalized === 'en_transito') return 'status status--transit';
    if (normalized === 'pendiente') return 'status status--pen';
    return 'badge--info';
  }

  function formatEstado(estado) {
    const normalized = normalizeEstadoValue(estado);
    const labels = {
      pendiente: 'Pendiente',
      en_transito: 'En tránsito',
      entregado: 'Entregado',
      anulado: 'Anulado'
    };
    return labels[normalized] || estado || 'Sin estado';
  }

  function normalizeEstadoValue(estado) {
    if (window.AlasShared?.estado?.normalizeKey) {
      return window.AlasShared.estado.normalizeKey(estado);
    }

    const normalized = String(estado || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/_/g, ' ')
      .toLowerCase();
    if (['anulado', 'anulada', 'cancelado', 'cancelada'].includes(normalized)) return 'anulado';
    if (['en transito', 'en reparto', 'transito', 'reparto'].includes(normalized)) return 'en_transito';
    if (['entregado', 'terminado', 'completado'].includes(normalized)) return 'entregado';
    return 'pendiente';
  }

  function normalizeEstadoFilter(estado) {
    if (!estado || estado === 'all') return 'all';
    return normalizeEstadoValue(estado);
  }

  function formatDate(value) {
    if (!value) return '--';
    const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleDateString('es-ES', {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit'
    });
  }

  function formatPreviewDate(value) {
    if (!value) return '';
    const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleDateString('es-ES', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  }

  function formatFilterDate(value) {
    if (!value) return '';
    const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleDateString('es-ES', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
  }

  function formatQuantity(value) {
    if (window.AlasShared?.format?.formatQuantity) {
      return window.AlasShared.format.formatQuantity(value);
    }

    const number = Number(value || 0);
    if (!Number.isFinite(number)) return '0';
    return number.toLocaleString('es-PY', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 4
    });
  }

  function sanitizeQuantityText(value) {
    return String(value || '').replace(/[^\d.,]/g, '');
  }

  function parseQuantityValue(value) {
    const sanitized = sanitizeQuantityText(value).trim();
    if (!sanitized) return NaN;

    let normalized = sanitized;
    const dotCount = (normalized.match(/\./g) || []).length;
    const commaCount = (normalized.match(/,/g) || []).length;

    if (dotCount > 0 && commaCount > 0) {
      if (normalized.lastIndexOf(',') > normalized.lastIndexOf('.')) {
        normalized = normalized.replace(/\./g, '').replace(',', '.');
      } else {
        normalized = normalized.replace(/,/g, '');
      }
    } else if (commaCount > 0) {
      if (/^\d{1,3}(,\d{3})+$/.test(normalized)) {
        normalized = normalized.replace(/,/g, '');
      } else {
        normalized = normalized.replace(',', '.');
      }
    } else if (dotCount > 0) {
      if (/^\d{1,3}(\.\d{3})+$/.test(normalized) || dotCount > 1) {
        normalized = normalized.replace(/\./g, '');
      }
    }

    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : NaN;
  }

  function formatQuantityInputValue(value) {
    if (value === null || value === undefined) return '';
    const raw = String(value).trim();
    if (!raw) return '';
    const parsed = parseQuantityValue(raw);
    return Number.isFinite(parsed) ? formatQuantity(parsed) : sanitizeQuantityText(raw);
  }

  function handleCantidadInput(event) {
    const input = event?.target;
    if (!input) return;
    const sanitized = sanitizeQuantityText(input.value);
    if (sanitized !== input.value) input.value = sanitized;
    window.clearTimeout(cantidadFormatTimer);
    cantidadFormatTimer = window.setTimeout(() => {
      if (document.activeElement !== input) formatCantidadField();
    }, 420);
  }

  function formatCantidadField() {
    const input = document.getElementById('cantidad');
    if (!input) return;
    input.value = formatQuantityInputValue(input.value);
    syncWizardFieldCheckState(input);
  }

  function longDate(value) {
    if (!value) return '--';
    return new Date(`${String(value).slice(0, 10)}T00:00:00`).toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  }

  function currentDateValue() {
    return formatDateInputValue(new Date());
  }

  function toDateInput(value) {
    return value ? String(value).slice(0, 10) : '';
  }

  function toMysqlDateTime(value) {
    if (!value) return '';
    const raw = String(value);
    if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(raw)) return raw.slice(0, 19);
    const date = new Date(raw.replace(' ', 'T'));
    return Number.isNaN(date.getTime()) ? '' : formatMysqlDateTime(date);
  }

  function currentDateTimeValue() {
    return formatMysqlDateTime(new Date());
  }

  function formatDateInputValue(date) {
    const pad = (value) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function formatMysqlDateTime(date) {
    const pad = (value) => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  }

  function resolveCurrentOperator() {
    if (window.AlasSession?.requireCurrentUser) {
      return String(window.AlasSession.requireCurrentUser() || '').trim();
    }
    return String(window.AlasSession?.getCurrentUser?.() || window.AlasSession?.defaultUser || '').trim();
  }

  function getValue(id) {
    return document.getElementById(id)?.value?.trim() || '';
  }

  function setValue(id, value) {
    const element = document.getElementById(id);
    if (element) {
      element.value = id === 'cantidad'
        ? formatQuantityInputValue(value)
        : value || '';
      if (element._proDatePicker && typeof element._proDatePicker.sync === 'function') {
        element._proDatePicker.sync();
      }
      if (element.closest('.combo-field')) {
        syncComboControlState(element);
      }
      syncWizardFieldCheckState(element);
    }
  }

  function setText(id, value) {
    if (window.AlasShared?.dom?.setText) {
      return window.AlasShared.dom.setText(id, value || '');
    }

    const element = document.getElementById(id);
    if (element) element.textContent = value || '';
  }

  function getSelectedOptionText(id) {
    const element = document.getElementById(id);
    if (!element) return '';
    const option = element.options[element.selectedIndex];
    return option ? option.textContent.trim() : '';
  }

  function escapeHtml(value) {
    if (window.AlasShared?.text?.escapeHtml) {
      return window.AlasShared.text.escapeHtml(value);
    }

    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
})();

