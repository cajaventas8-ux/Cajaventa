(function () {
  'use strict';

  function debounce(fn, delay) {
    if (window.AlasShared?.fn?.debounce) {
      return window.AlasShared.fn.debounce(fn, delay);
    }

    let timer;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  }

  const BUTTON_LOADING_MS = 500;
  const EMBED_OVERLAY_MS = 180;
  const HISTORY_BATCH_SIZE = 200;
  const HISTORY_MAX_ROWS = 2000;
  const STORAGE_USER_KEY = 'acuse.currentUser';
  const MESES_ES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
  const DIAS_ES = ['Dom', 'Lun', 'Mar', 'Mie', 'Jue', 'Vie', 'Sab'];
  const PANEL_CONFIG = {
    pendientes: { dot: 'var(--warning)', title: 'Acuses Pendientes', bg: 'var(--warning-soft)', color: '#B45309' },
    entregados: { dot: 'var(--success)', title: 'Acuses Entregados', bg: 'var(--success-soft)', color: '#047857' },
    acuses: { dot: 'var(--purple)', title: 'Total de Acuses', bg: 'var(--purple-soft)', color: '#6D28D9' },
    en_transito: { dot: 'var(--accent)', title: 'Acuses En Tránsito', bg: 'var(--accent-soft)', color: '#1D4ED8' },
    anulados: { dot: '#ef4444', title: 'Acuses Anulados', bg: 'rgba(239,68,68,0.12)', color: '#dc2626' },
    repartidores: { dot: 'var(--primary-light)', title: 'Repartidores Activos', bg: '#E0E7F1', color: 'var(--primary-light)' }
  };
  const COLORS_AVATAR = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4', '#F97316', '#6366F1', '#14B8A6', '#E11D48', '#7C3AED'];
  let embedOverlayCloseTimer = null;
  let pendingExportButton = null;
  let dashboardSelectionEffectTimer = null;
  let dashboardSelectionFocusTimer = null;
  const TODAY_ISO = currentDateValue();

  const state = {
    activeKPI: 'acuses',
    currentView: 'dashboard',
    currentPage: {
      pendientes: 1,
      entregados: 1,
      acuses: 1,
      en_transito: 1,
      anulados: 1,
      repartidores: 1
    },
    summary: null,
    summaryComparison: null,
    kpiSummary: null,
    summaryPeriod: {
      year: new Date().getFullYear(),
      month: new Date().getMonth() + 1,
      scope: 'month',
      anchorDate: TODAY_ISO
    },
    panelFilters: {
      fecha: '',
      clienteCode: '',
      clienteLabel: '',
      repartidorId: '',
      repartidorLabel: ''
    },
    panelFilterQuery: {
      cliente: '',
      repartidor: ''
    },
    panelFilterResults: {
      cliente: [],
      repartidor: []
    },
    panelOpenFilter: null,
    panelResponse: null,
    panelRequestSeq: 0,
    selectedAcuseId: null,
    highlightedAcuseId: null,
    history: {
      filters: {
        fecha: '',
        usuario: '',
        cliente: ''
      },
      openFilter: null,
      page: 1,
      response: null,
      suggestions: {
        usuario: [],
        cliente: []
      }
    },
    calendar: {
      year: new Date().getFullYear(),
      month: new Date().getMonth() + 1,
      scope: 'month',
      anchorDate: TODAY_ISO,
      selectedDate: null,
      monthResponse: null,
      dayResponse: null,
      detailRequestId: 0
    },
    repartidoresCatalog: [],
    charts: {}
  };
  const PANEL_KPIS = new Set(['pendientes', 'entregados', 'acuses', 'en_transito', 'anulados']);
  const DASHBOARD_KPIS = new Set([...PANEL_KPIS, 'repartidores']);

  function normalizeDashboardLookup(value) {
    if (window.AlasShared?.text?.normalizeLookup) {
      return window.AlasShared.text.normalizeLookup(value);
    }

    return String(value || '')
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[\s-]+/g, '_');
  }

  function normalizeDashboardKpi(value, options = {}) {
    const allowRepartidores = options.allowRepartidores === true;
    const fallback = options.fallback || 'acuses';
    const normalized = normalizeDashboardLookup(value);

    if (!normalized) return fallback;
    if (['acuse', 'acuses', 'total', 'totales', 'todo', 'todos', 'all'].includes(normalized)) return 'acuses';
    if (['pendiente', 'pendientes'].includes(normalized)) return 'pendientes';
    if (['entregado', 'entregados', 'completado', 'completados'].includes(normalized)) return 'entregados';
    if (['en_transito', 'transito', 'en_reparto', 'reparto'].includes(normalized)) return 'en_transito';
    if (['anulado', 'anulados', 'cancelado', 'cancelados', 'annul', 'delete', 'deleted'].includes(normalized)) return 'anulados';
    if (allowRepartidores && ['repartidor', 'repartidores'].includes(normalized)) return 'repartidores';
    if (allowRepartidores && DASHBOARD_KPIS.has(normalized)) return normalized;
    if (PANEL_KPIS.has(normalized)) return normalized;
    return fallback;
  }

  const topLabelsPlugin = {
    id: 'dashboardAcusesTopLabels',
    afterDatasetsDraw(chart) {
      const options = chart.options.plugins && chart.options.plugins.dashboardAcusesTopLabels;
      if (!options || !options.enabled) return;
      if (chart.options.indexAxis === 'y') return;

      const ctx = chart.ctx;
      const datasetIndex = Number.isInteger(options.datasetIndex)
        ? options.datasetIndex
        : Math.max(chart.data.datasets.length - 1, 0);
      const dataset = chart.data.datasets[datasetIndex];
      if (!dataset) return;

      const datasetType = dataset.type || chart.config.type;
      if (datasetType !== 'bar' && datasetType !== 'line') return;

      const meta = chart.getDatasetMeta(datasetIndex);
      if (!meta || meta.hidden) return;

      meta.data.forEach((element, index) => {
        const value = dataset.data[index];
        if (value === null || value === undefined) return;

        const point = typeof element.getProps === 'function'
          ? element.getProps(['x', 'y'], true)
          : element;

        ctx.save();
        ctx.font = '700 11px DM Sans';
        ctx.fillStyle = '#0f2f57';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        ctx.fillText(String(value), point.x, point.y - (datasetType === 'line' ? 10 : 6));
        ctx.restore();
      });
    }
  };

  const endLabelsPlugin = {
    id: 'dashboardAcusesEndLabels',
    afterDatasetsDraw(chart) {
      const options = chart.options.plugins && chart.options.plugins.dashboardAcusesEndLabels;
      if (!options || !options.enabled || chart.options.indexAxis !== 'y') return;

      const ctx = chart.ctx;
      chart.data.datasets.forEach((dataset, datasetIndex) => {
        const datasetType = dataset.type || chart.config.type;
        if (datasetType !== 'bar') return;

        const meta = chart.getDatasetMeta(datasetIndex);
        if (!meta || meta.hidden) return;

        meta.data.forEach((element, index) => {
          const value = dataset.data[index];
          if (value === null || value === undefined) return;

          ctx.save();
          ctx.font = '700 11px DM Sans';
          ctx.fillStyle = '#0f2f57';
          ctx.textAlign = 'left';
          ctx.textBaseline = 'middle';
          ctx.fillText(String(value), element.x + 8, element.y);
          ctx.restore();
        });
      });
    }
  };

  window.showView = showView;
  window.showDashboardPanel = showDashboardPanel;
  window.selectKPI = selectKPI;
  window.pickDateFilter = pickDateFilter;
  window.clearDateFilter = clearDateFilter;
  window.clearCurrentPanelFilters = clearCurrentPanelFilters;
  window.toggleFilter = toggleFilter;
  window.renderFilterItems = debounce((kpi, query) => { renderFilterItems(kpi, query).catch(handleError); }, 300);
  window.pickFilter = pickFilter;
  window.clearFilter = clearFilter;
  window.openNewAcuse = openNewAcuse;
  window.openEditAcuse = openEditAcuse;
  window.openViewAcuse = openViewAcuse;
  window.openDeleteAcuse = openDeleteAcuse;
  window.openPrintAcuse = openPrintAcuse;
  window.selectDashboardAcuse = selectDashboardAcuse;
  window.markAcuseDelivered = markAcuseDelivered;
  window.exportCurrentPanel = exportCurrentPanel;
  window.confirmExportPanel = confirmExportPanel;
  window.cancelExportPanel = cancelExportPanel;
  window.changeSummaryMonth = changeSummaryMonth;
  window.goSummaryToday = goSummaryToday;
  window.toggleSummaryScope = toggleSummaryScope;
  window.toggleSummaryAll = toggleSummaryAll;
  window.changeMonth = changeMonth;
  window.goToday = goToday;
  window.toggleCalendarScope = toggleCalendarScope;
  window.selectCalDay = selectCalDay;
  window.selectCalDate = selectCalDate;
  window.toggleHistFilter = toggleHistFilter;
  window.renderHistFilterItems = renderHistFilterItems;
  window.pickHistFilter = pickHistFilter;
  window.clearHistFilter = clearHistFilter;
  window.clearHistoryFiltersAll = clearHistoryFiltersAll;
  window.pickHistDateFilter = pickHistDateFilter;
  window.closeAcuseEmbed = closeAcuseEmbed;
  window.showDashboardToast = notify;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initDashboardAcuses);
  } else {
    initDashboardAcuses();
  }

  const DASHBOARD_STATE_KEY = 'alas.dashboard.state';

  function saveDashboardState() {
    try {
      const snapshot = {
        activeKPI: state.activeKPI,
        currentView: state.currentView,
        panelFilters: { ...state.panelFilters },
        currentPage: { ...state.currentPage }
      };
      sessionStorage.setItem(DASHBOARD_STATE_KEY, JSON.stringify(snapshot));
    } catch (_) { /* sessionStorage may be unavailable */ }
  }

  function restoreDashboardState() {
    try {
      const raw = sessionStorage.getItem(DASHBOARD_STATE_KEY);
      if (!raw) return;
      const snapshot = JSON.parse(raw);
      if (snapshot.activeKPI) {
        state.activeKPI = normalizeDashboardKpi(snapshot.activeKPI, { allowRepartidores: true });
      }
      if (snapshot.panelFilters && typeof snapshot.panelFilters === 'object') {
        Object.assign(state.panelFilters, snapshot.panelFilters);
      }
      if (snapshot.currentPage && typeof snapshot.currentPage === 'object') {
        Object.assign(state.currentPage, snapshot.currentPage);
      }
    } catch (_) { /* ignore corrupt data */ }
  }

  async function initDashboardAcuses() {
    ensureRuntimeChrome();
    restoreDashboardState();
    wireGlobalEvents();
    wireSidebarHome();
    setHeaderDates();
    initDashboardDatePickers();
    document.title = 'Dashboard Acuses - ALAS';

    try {
      await Promise.all([
        loadRepartidoresCatalog(),
        loadSummary(),
        loadKpiSummary()
      ]);
      await loadPanel(state.activeKPI);
      await loadCalendarMonth();
      await showView('dashboard');
    } catch (error) {
      handleError(error);
    }
  }

  function ensureRuntimeChrome() {
    if (!document.getElementById('dashboardAcusesRuntimeStyle')) {
      const style = document.createElement('style');
      style.id = 'dashboardAcusesRuntimeStyle';
      style.textContent = `
        .dash-toast-wrap {
          position: fixed;
          left: 50%;
          right: auto;
          top: 24px;
          bottom: auto;
          transform: translateX(-50%);
          width: auto;
          max-width: calc(100vw - 32px);
          display: flex;
          flex-direction: column;
          gap: 10px;
          align-items: center;
          z-index: 9999;
          pointer-events: none;
        }
        .dash-toast {
          width: fit-content;
          min-width: 0;
          max-width: min(460px, calc(100vw - 32px));
          padding: 14px 18px;
          border-radius: 16px;
          background: #fff;
          border-left: 4px solid var(--dash-toast-accent, #3B82F6);
          box-shadow: 0 20px 40px rgba(15,23,42,.14);
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 12px;
          color: #1f2937;
          font: 600 14.5px/1.35 'DM Sans', sans-serif;
          transform: translateY(calc(-100% - 28px)) scale(.98);
          opacity: 0;
          pointer-events: none;
          will-change: transform, opacity;
        }
        .dash-toast.show {
          animation: dashToastDropIn .3s cubic-bezier(.22,1,.36,1) forwards;
          pointer-events: auto;
        }
        .dash-toast.hide {
          animation: dashToastLiftOut .24s ease forwards;
        }
        .dash-toast.success { --dash-toast-accent: #10B981; --dash-toast-icon-bg: #ECFDF5; --dash-toast-icon-border: #A7F3D0; }
        .dash-toast.error { --dash-toast-accent: #EF4444; --dash-toast-icon-bg: #FEF2F2; --dash-toast-icon-border: #FECACA; }
        .dash-toast.warning { --dash-toast-accent: #F59E0B; --dash-toast-icon-bg: #FFFBEB; --dash-toast-icon-border: #FDE68A; }
        .dash-toast.info { --dash-toast-accent: #3B82F6; --dash-toast-icon-bg: #EFF6FF; --dash-toast-icon-border: #BFDBFE; }
        .dash-toast.complete { --dash-toast-accent: #3B82F6; --dash-toast-icon-bg: #EFF6FF; --dash-toast-icon-border: #BFDBFE; }
        .dash-toast.annul { --dash-toast-accent: #EF4444; --dash-toast-icon-bg: #FEF2F2; --dash-toast-icon-border: #FECACA; }
        .dash-toast__icon {
          width: 26px;
          height: 26px;
          flex-shrink: 0;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border-radius: 50%;
          background: var(--dash-toast-icon-bg, #EFF6FF);
          border: 1px solid var(--dash-toast-icon-border, #BFDBFE);
          color: var(--dash-toast-accent, #3B82F6);
          line-height: 1;
        }
        .dash-toast__icon-svg {
          width: 14px;
          height: 14px;
          display: block;
          fill: none;
          stroke: currentColor;
          stroke-width: 2.4;
          stroke-linecap: round;
          stroke-linejoin: round;
        }
        .dash-toast__text {
          color: #1f2937;
          font-size: 14.5px;
          line-height: 1.35;
          font-weight: 600;
          text-align: center;
        }
        @media (max-width: 700px) {
          .dash-toast-wrap {
            left: 50%;
            right: auto;
            top: 16px;
            bottom: auto;
            width: auto;
            max-width: calc(100vw - 32px);
            transform: translateX(-50%);
            align-items: center;
          }
          .dash-toast {
            max-width: calc(100vw - 32px);
          }
        }
        @keyframes dashToastDropIn {
          from { opacity: 0; transform: translateY(calc(-100% - 28px)) scale(.98); }
          to { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes dashToastLiftOut {
          from { opacity: 1; transform: translateY(0) scale(1); }
          to { opacity: 0; transform: translateY(calc(-100% - 18px)) scale(.98); }
        }
        .view-enter {
          animation: dashboardViewIn 0.42s cubic-bezier(0.22, 1, 0.36, 1);
          transform-origin: top center;
        }
        @keyframes dashboardViewIn {
          from {
            opacity: 0;
            transform: translateY(10px) scale(0.992);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
        .embed-overlay {
          position: fixed;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 1100;
          opacity: 0;
          visibility: hidden;
          pointer-events: none;
          transition:
            opacity 180ms cubic-bezier(0.22, 1, 0.36, 1),
            visibility 0s linear 180ms;
          will-change: opacity;
        }
        .embed-overlay.open,
        .embed-overlay.closing {
          visibility: visible;
          transition-delay: 0s;
        }
        .embed-overlay.open {
          opacity: 1;
          pointer-events: auto;
        }
        .embed-overlay__backdrop {
          position: absolute;
          inset: 0;
          background: rgba(15, 36, 64, 0.34);
          backdrop-filter: blur(1.5px);
          opacity: 0;
          transition: opacity 170ms cubic-bezier(0.22, 1, 0.36, 1);
          will-change: opacity;
        }
        .embed-overlay.open .embed-overlay__backdrop {
          opacity: 1;
        }
        .embed-overlay__panel {
          position: relative;
          width: min(1280px, calc(100vw - 26px));
          height: min(94vh, 920px);
          background: transparent;
          border-radius: 22px;
          overflow: visible;
          box-shadow: none;
          opacity: 0;
          transform: translate3d(0, 10px, 0) scale(0.992);
          transition:
            transform 190ms cubic-bezier(0.22, 1, 0.36, 1),
            opacity 170ms cubic-bezier(0.22, 1, 0.36, 1);
          will-change: transform, opacity;
          backface-visibility: hidden;
        }
        .embed-overlay.open .embed-overlay__panel {
          opacity: 1;
          transform: translate3d(0, 0, 0) scale(1);
        }
        .embed-overlay.closing .embed-overlay__panel {
          opacity: 0;
          transform: translate3d(0, 8px, 0) scale(0.994);
        }
        .embed-overlay__frame {
          width: 100%;
          height: 100%;
          border: 0;
          background: transparent;
          border-radius: 24px;
          opacity: 0;
          transition: opacity 140ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        .embed-overlay.ready .embed-overlay__frame {
          opacity: 1;
        }
        .embed-overlay__loader {
          position: absolute;
          inset: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          opacity: 0;
          pointer-events: none;
          transition: opacity 0.18s ease;
          z-index: 3;
        }
        .embed-overlay.loading .embed-overlay__loader {
          opacity: 1;
        }
        .embed-loader__shell {
          position: relative;
          width: 182px;
          height: 182px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .embed-loader__shell::before {
          content: '';
          position: absolute;
          inset: 18px;
          border-radius: 50%;
          border: 1px solid rgba(47,111,255,0.07);
          animation: embedHaloPulse 2s ease-in-out infinite;
        }
        .embed-loader__base,
        .embed-loader__spinner {
          position: absolute;
          width: 136px;
          height: 136px;
          border-radius: 50%;
        }
        .embed-loader__base {
          border: 11px solid rgba(79,140,255,0.10);
        }
        .embed-loader__spinner {
          animation: embedSpin 1.2s linear infinite;
          filter: drop-shadow(0 10px 18px rgba(47,111,255,0.18));
        }
        .embed-loader__spinner::before {
          content: '';
          position: absolute;
          inset: 0;
          border-radius: 50%;
          background:
            conic-gradient(
              from 0deg,
              transparent 0deg,
              transparent 120deg,
              rgba(125,178,255,0.12) 185deg,
              #7DB2FF 225deg,
              #4F8CFF 280deg,
              #1F6FE5 330deg,
              transparent 360deg
            );
          -webkit-mask: radial-gradient(
            farthest-side,
            transparent calc(100% - 11px),
            #000 calc(100% - 11px)
          );
          mask: radial-gradient(
            farthest-side,
            transparent calc(100% - 11px),
            #000 calc(100% - 11px)
          );
        }
        .embed-loader__core {
          position: relative;
          width: 98px;
          height: 98px;
          border-radius: 50%;
          background: transparent;
          box-shadow: none;
        }
        .export-confirm {
          position: fixed;
          inset: 0;
          z-index: 1250;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 20px;
          opacity: 0;
          visibility: hidden;
          pointer-events: none;
          transition: opacity 180ms ease, visibility 0s linear 180ms;
        }
        .export-confirm.open {
          opacity: 1;
          visibility: visible;
          pointer-events: auto;
          transition-delay: 0s;
        }
        .export-confirm__backdrop {
          position: absolute;
          inset: 0;
          background: rgba(15, 23, 42, 0.32);
          backdrop-filter: blur(2px);
        }
        .export-confirm__card {
          position: relative;
          width: min(380px, calc(100vw - 34px));
          background: #fff;
          border-radius: 16px;
          border: 1px solid rgba(226, 232, 240, 0.96);
          box-shadow: 0 24px 70px rgba(15, 23, 42, 0.2);
          padding: 26px 24px 22px;
          text-align: center;
          transform: translateY(10px) scale(0.98);
          transition: transform 200ms cubic-bezier(0.22, 1, 0.36, 1);
        }
        .export-confirm.open .export-confirm__card {
          transform: translateY(0) scale(1);
        }
        .export-confirm__close {
          position: absolute;
          top: 10px;
          right: 10px;
          width: 30px;
          height: 30px;
          border: 0;
          border-radius: 8px;
          background: #f8fafc;
          color: #64748b;
          font-size: 20px;
          line-height: 1;
          cursor: pointer;
        }
        .export-confirm__icon {
          width: 54px;
          height: 54px;
          border-radius: 14px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: #ecfdf5;
          color: #15803d;
          margin-bottom: 14px;
          box-shadow: inset 0 0 0 1px rgba(21, 128, 61, 0.1);
        }
        .export-confirm__icon svg {
          width: 30px;
          height: 30px;
        }
        .export-confirm__title {
          color: #10233f;
          font: 800 20px/1.25 'Outfit', sans-serif;
          margin: 0 0 8px;
        }
        .export-confirm__text {
          color: #64748b;
          font: 600 13px/1.45 'DM Sans', sans-serif;
          margin-bottom: 20px;
        }
        .export-confirm__actions {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 10px;
        }
        .export-confirm__btn {
          min-width: 112px;
          height: 40px;
          border-radius: 9px;
          border: 1px solid #dbe4f0;
          background: #fff;
          color: #475569;
          font: 800 13px/1 'DM Sans', sans-serif;
          cursor: pointer;
          transition: transform 0.18s ease, box-shadow 0.18s ease, background 0.18s ease;
        }
        .export-confirm__btn:hover {
          transform: translateY(-1px);
          box-shadow: 0 10px 22px rgba(15, 23, 42, 0.08);
        }
        .export-confirm__btn--primary {
          border-color: #16a34a;
          background: linear-gradient(135deg, #22c55e, #15803d);
          color: #fff;
          box-shadow: 0 10px 22px rgba(34, 197, 94, 0.24);
        }
        @keyframes embedSpin {
          to { transform: rotate(360deg); }
        }
        @keyframes embedHaloPulse {
          0% {
            transform: scale(0.97);
            opacity: 0.3;
          }
          50% {
            transform: scale(1.03);
            opacity: 0.1;
          }
          100% {
            transform: scale(0.97);
            opacity: 0.3;
          }
        }
      `;
      document.head.appendChild(style);
    }

    if (!document.getElementById('dashToastWrap')) {
      const wrap = document.createElement('div');
      wrap.className = 'dash-toast-wrap';
      wrap.id = 'dashToastWrap';
      document.body.appendChild(wrap);
    }

    if (!document.getElementById('acuseEmbedOverlay')) {
      const overlay = document.createElement('div');
      overlay.className = 'embed-overlay';
      overlay.id = 'acuseEmbedOverlay';
      overlay.innerHTML = `
        <div class="embed-overlay__backdrop" onclick="closeAcuseEmbed()"></div>
        <div class="embed-overlay__panel">
          <div class="embed-overlay__loader" aria-hidden="true">
            <div class="embed-loader__shell">
              <div class="embed-loader__base"></div>
              <div class="embed-loader__spinner"></div>
              <div class="embed-loader__core"></div>
            </div>
          </div>
          <iframe class="embed-overlay__frame" id="acuseEmbedFrame" title="Operativa de acuses"></iframe>
        </div>
      `;
      document.body.appendChild(overlay);
    }

    if (!document.getElementById('exportConfirmOverlay')) {
      const overlay = document.createElement('div');
      overlay.className = 'export-confirm';
      overlay.id = 'exportConfirmOverlay';
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-labelledby', 'exportConfirmTitle');
      overlay.innerHTML = `
        <div class="export-confirm__backdrop" onclick="cancelExportPanel()"></div>
        <div class="export-confirm__card">
          <button class="export-confirm__close" type="button" onclick="cancelExportPanel()" aria-label="Cerrar">&times;</button>
          <div class="export-confirm__icon" aria-hidden="true">${excelIcon()}</div>
          <h2 class="export-confirm__title" id="exportConfirmTitle">Desea exportar el Excel</h2>
          <div class="export-confirm__text">Se descargaran los datos completos de los acuses con los filtros actuales.</div>
          <div class="export-confirm__actions">
            <button class="export-confirm__btn" type="button" onclick="cancelExportPanel()">Cancelar</button>
            <button class="export-confirm__btn export-confirm__btn--primary" type="button" onclick="confirmExportPanel()">Exportar</button>
          </div>
        </div>
      `;
      document.body.appendChild(overlay);
    }
  }

  function wireGlobalEvents() {
    window.addEventListener('message', handleEmbedMessage);
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        cancelExportPanel();
        closeAcuseEmbed();
        closePanelFilter();
        closeHistoryFilters();
      }
    });

    document.addEventListener('mousedown', (event) => {
      const activeFilterId = `filter-${state.activeKPI}`;
      if (state.panelOpenFilter && !event.target.closest(`#${activeFilterId}`)) {
        closePanelFilter();
      }

      if (state.history.openFilter && !event.target.closest(`#filter-hist-${state.history.openFilter === 'usuario' ? 'user' : 'client'}`)) {
        closeHistoryFilters();
      }
    });
  }

  function wireSidebarHome() {
    const home = document.getElementById('btnSidebarHome');
    if (home) {
      home.onclick = function () {
        window.location.href = '/';
      };
    }
  }

  async function showDashboardPanel(kpi = 'acuses') {
    const targetKpi = normalizeDashboardKpi(kpi, { allowRepartidores: true, fallback: 'acuses' });
    const wasDashboard = state.currentView === 'dashboard';
    const shouldReloadPanel = state.activeKPI !== targetKpi || state.currentView !== 'dashboard';
    state.activeKPI = targetKpi;
    syncActiveKpiCards();
    syncDashboardChrome();
    await showView('dashboard');
    if (shouldReloadPanel) {
      await loadPanel(targetKpi, { soft: wasDashboard });
    }
  }

  function syncSidebarActiveState() {
    const ids = ['btnResumen', 'btnDashboard', 'btnCalendario', 'btnRepartidores', 'btnHistorial'];
    ids.forEach((id) => document.getElementById(id)?.classList.remove('active'));

    if (state.currentView === 'resumen') {
      document.getElementById('btnResumen')?.classList.add('active');
      return;
    }

    if (state.currentView === 'dashboard') {
      const targetId = state.activeKPI === 'repartidores' ? 'btnRepartidores' : 'btnDashboard';
      document.getElementById(targetId)?.classList.add('active');
      return;
    }

    if (state.currentView === 'calendario') {
      document.getElementById('btnCalendario')?.classList.add('active');
      return;
    }

    if (state.currentView === 'historial') {
      document.getElementById('btnHistorial')?.classList.add('active');
    }
  }

  function setHeaderDates() {
    const text = new Date().toLocaleDateString('es-PY', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    });

    setText('currentDate', text);
    setText('currentDate2', text);
    setText('currentDate3', text);
  }

  async function loadSummary() {
    syncSummaryPeriodLabel();
    const params = buildSummaryParams();
    const comparisonParams = buildPreviousSummaryParams();
    const [summary, comparison] = await Promise.all([
      AcuseAPI.get('/api/dashboard/interactivo/summary', params),
      comparisonParams
        ? AcuseAPI.get('/api/dashboard/interactivo/summary', comparisonParams).catch(() => null)
        : Promise.resolve(null)
    ]);

    state.summary = summary;
    state.summaryComparison = comparison;
    applySummaryPeriod(state.summary && state.summary.periodo);
    syncSummaryPeriodLabel();
    renderKpis();
    renderSummaryCardsEnhanced();
    if (state.currentView === 'resumen') renderChartsEnhanced();
  }

  async function loadKpiSummary() {
    state.kpiSummary = await AcuseAPI.get('/api/dashboard/interactivo/summary', {
      scope: 'all',
      anchor: TODAY_ISO
    });
    renderKpis();
  }

  function syncSummaryPeriodLabel() {
    const label = document.getElementById('summaryMonthLabel');
    if (!label) return;
    label.textContent = state.summaryPeriod.scope === 'week'
      ? formatWeekRangeLabel(...weekRangeFromAnchor(state.summaryPeriod.anchorDate))
      : state.summaryPeriod.scope === 'all'
        ? 'Todo el periodo'
        : formatMonthPeriodLabel(state.summaryPeriod.year, state.summaryPeriod.month);
    syncSummaryControls();
  }

  function changeSummaryMonth(direction) {
    if (state.summaryPeriod.scope === 'all') return;
    if (state.summaryPeriod.scope === 'week') {
      setPeriodAnchor(state.summaryPeriod, toIsoDate(addDays(parseIsoDate(state.summaryPeriod.anchorDate), direction * 7)));
    } else {
      setPeriodAnchor(state.summaryPeriod, shiftIsoMonth(state.summaryPeriod.anchorDate, direction));
    }
    loadSummary().catch(handleError);
  }

  function goSummaryToday() {
    setPeriodAnchor(state.summaryPeriod, currentDateValue());
    state.summaryPeriod.scope = 'month';
    loadSummary().catch(handleError);
  }

  function toggleSummaryScope() {
    state.summaryPeriod.scope = state.summaryPeriod.scope === 'week' ? 'month' : 'week';
    syncSummaryPeriodLabel();
    loadSummary().catch(handleError);
  }

  function toggleSummaryAll() {
    state.summaryPeriod.scope = state.summaryPeriod.scope === 'all' ? 'month' : 'all';
    syncSummaryPeriodLabel();
    loadSummary().catch(handleError);
  }

  async function loadRepartidoresCatalog() {
    if (window.StorageUtils && typeof window.StorageUtils.cargarCatalogo === 'function') {
      state.repartidoresCatalog = await window.StorageUtils.cargarCatalogo('acuse.repartidores', '/api/repartidores');
      return;
    }

    const response = await AcuseAPI.get('/api/repartidores');
    state.repartidoresCatalog = response.items || [];
  }

  function initDashboardDatePickers() {
    const historyInput = document.getElementById('histDateInput');
    if (historyInput && window.DatePickerPro) {
      window.DatePickerPro.attach(historyInput, {
        variant: 'filter',
        placeholder: 'Fecha...'
      });
    }
  }

  function syncDatePicker(inputId, value) {
    const input = document.getElementById(inputId);
    if (!input) return;
    input.value = value || '';
    if (input._proDatePicker && typeof input._proDatePicker.sync === 'function') {
      input._proDatePicker.sync();
    }
  }

  function renderKpis() {
    const kpis = state.kpiSummary && state.kpiSummary.kpis
      ? state.kpiSummary.kpis
      : state.summary && state.summary.kpis
        ? state.summary.kpis
        : {};
    setText('val-pendientes', formatNumber(kpis.pendientes || 0));
    setText('val-entregados', formatNumber(kpis.entregados || 0));
    setText('val-acuses', formatNumber(kpis.acuses || 0));
    setText('val-en_transito', formatNumber(kpis.en_transito || 0));
    setText('val-anulados', formatNumber(kpis.anulados || 0));
  }

  function renderSummaryCards() {
    const cards = document.querySelectorAll('#viewResumen .resumen-card');
    const donut = state.summary && state.summary.donut ? state.summary.donut : {};
    const acusesPorDia = state.summary && Array.isArray(state.summary.acusesPorDia) ? state.summary.acusesPorDia : [];
    const acusesPorSemana = state.summary && Array.isArray(state.summary.acusesPorSemana) ? state.summary.acusesPorSemana : [];
    const acusesPorMes = state.summary && Array.isArray(state.summary.acusesPorMes) ? state.summary.acusesPorMes : [];
    const acusesPorAnio = groupRowsByYear(acusesPorMes);
    const isWeekScope = state.summary && state.summary.periodo && state.summary.periodo.scope === 'week';
    const isAllScope = state.summary && state.summary.periodo && state.summary.periodo.scope === 'all';

    if (cards[0]) {
      const legendValues = cards[0].querySelectorAll('strong');
      if (legendValues[0]) legendValues[0].textContent = `${Number(donut.porcentajeEntregados || 0)}%`;
      if (legendValues[1]) legendValues[1].textContent = `${Number(donut.porcentajePendientes || 0)}%`;
      if (legendValues[2]) legendValues[2].textContent = `${Number(donut.porcentajeTransito || 0)}%`;
    }

    if (cards[2]) {
      const title = cards[2].querySelector('h3');
      if (title) {
        title.innerHTML = isWeekScope
          ? '<span class="rc-dot" style="background:var(--success)"></span> Acuses por Dia'
          : isAllScope
            ? '<span class="rc-dot" style="background:var(--success)"></span> Acuses por Mes'
            : '<span class="rc-dot" style="background:var(--success)"></span> Acuses por Semana';
      }
    }

    if (cards[3]) {
      const title = cards[3].querySelector('h3');
      if (title) {
        title.innerHTML = isWeekScope
          ? '<span class="rc-dot" style="background:var(--warning)"></span> Acuses por Semana'
          : isAllScope
            ? '<span class="rc-dot" style="background:var(--warning)"></span> Acuses por Año'
            : '<span class="rc-dot" style="background:var(--warning)"></span> Acuses por Mes';
      }
    }

    if (isAllScope) {
      setText('summaryWeekTotalValue', formatNumber(countNonZero(acusesPorMes)));
      setText('summaryWeekPeakValue', formatNumber(maxRows(acusesPorMes)));
      setText('summaryWeekTotalLabel', 'Meses activos');
      setText('summaryWeekPeakLabel', 'Pico mensual');
      setText('summaryMonthTotalValue', formatNumber(sumRows(acusesPorAnio)));
      setText('summaryMonthAverageValue', formatAverage(averageRows(acusesPorAnio)));
      setText('summaryMonthTotalLabel', 'Total historico');
      setText('summaryMonthAverageLabel', 'Promedio anual');
      return;
    }

    setText('summaryWeekTotalValue', formatNumber(sumRows(isWeekScope ? acusesPorDia : acusesPorSemana)));
    setText('summaryWeekPeakValue', formatNumber(maxRows(isWeekScope ? acusesPorDia : acusesPorSemana)));
    setText('summaryWeekTotalLabel', isWeekScope ? 'Total semana' : 'Total mes');
    setText('summaryWeekPeakLabel', isWeekScope ? 'Pico diario' : 'Pico semanal');
    setText('summaryMonthTotalValue', formatNumber(sumRows(isWeekScope ? acusesPorSemana : acusesPorMes)));
    setText('summaryMonthAverageValue', formatAverage(averageRows(isWeekScope ? acusesPorSemana : acusesPorMes)));
    setText('summaryMonthTotalLabel', 'Total periodo');
    setText('summaryMonthAverageLabel', isWeekScope ? 'Promedio semanal' : 'Promedio mensual');
  }

  function renderCharts() {
    if (!window.Chart) {
      if (window.__chartJsFailed) showChartUnavailableMessage();
      return;
    }

    destroyCharts();

    const donut = state.summary && state.summary.donut ? state.summary.donut : { entregados: 0, pendientes: 0, en_transito: 0, porcentajeEntregados: 0 };
    const zonas = state.summary && Array.isArray(state.summary.zonas) ? state.summary.zonas : [];
    const acusesPorDia = state.summary && Array.isArray(state.summary.acusesPorDia) ? state.summary.acusesPorDia : [];
    const acusesPorSemana = state.summary && Array.isArray(state.summary.acusesPorSemana) ? state.summary.acusesPorSemana : [];
    const acusesPorMes = state.summary && Array.isArray(state.summary.acusesPorMes) ? state.summary.acusesPorMes : [];
    const acusesPorAnio = groupRowsByYear(acusesPorMes);
    const isWeekScope = state.summary && state.summary.periodo && state.summary.periodo.scope === 'week';
    const isAllScope = state.summary && state.summary.periodo && state.summary.periodo.scope === 'all';
    const serieVerde = isWeekScope
      ? acusesPorDia
      : isAllScope
        ? acusesPorMes.map((item) => ({ ...item, etiqueta: formatMonthSeriesLabel(item.mes, true) }))
        : acusesPorSemana;
    const serieNaranja = isWeekScope
      ? acusesPorSemana
      : isAllScope
        ? acusesPorAnio
        : acusesPorMes;

    const donutCtx = getContext('chartDona');
    if (donutCtx) {
      state.charts.dona = new Chart(donutCtx, {
        type: 'doughnut',
        data: {
          labels: ['Entregados', 'Pendientes', 'En Transito'],
          datasets: [{
            data: [Number(donut.entregados || 0), Number(donut.pendientes || 0), Number(donut.en_transito || 0)],
            backgroundColor: ['#22c55e', '#f59e0b', '#3b82f6'],
            borderWidth: 0,
            spacing: 0
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: true,
          cutout: '72%',
          plugins: {
            legend: { display: false },
            tooltip: { enabled: true }
          }
        }
      });
    }

    const zonasCtx = getContext('chartZonas');
    if (zonasCtx) {
      state.charts.zonas = new Chart(zonasCtx, {
        type: 'bar',
        data: {
          labels: zonas.map((item) => item.zona),
          datasets: [{
            data: zonas.map((item) => Number(item.total || 0)),
            backgroundColor: 'rgba(59,130,246,0.75)',
            borderRadius: 4,
            borderSkipped: false,
            barThickness: 20
          }]
        },
        options: {
          indexAxis: 'y',
          responsive: true,
          maintainAspectRatio: false,
          layout: { padding: { right: 35 } },
          plugins: {
            legend: { display: false },
            dashboardAcusesEndLabels: { enabled: true }
          },
          scales: {
            x: {
              beginAtZero: true,
              grid: { color: '#f1f5f9' },
              ticks: { color: '#94a3b8', font: { size: 10 } }
            },
            y: {
              grid: { display: false },
              ticks: { color: '#475569', font: { size: 11, family: 'DM Sans', weight: '500' } }
            }
          }
        },
        plugins: [endLabelsPlugin]
      });
    }

    const camionesDiaCtx = getContext('chartCamiones');
    if (camionesDiaCtx) {
      state.charts.camiones = new Chart(camionesDiaCtx, {
        type: 'bar',
        data: {
          labels: serieVerde.map((item) => item.etiqueta),
          datasets: [{
            type: 'line',
            data: serieVerde.map((item) => Number(item.total || 0)),
            borderColor: 'rgba(22,163,74,0.5)',
            borderWidth: 2,
            pointRadius: 3,
            pointBackgroundColor: '#16a34a',
            tension: 0.4,
            fill: false,
            order: 0
          }, {
            type: 'bar',
            data: serieVerde.map((item) => Number(item.total || 0)),
            backgroundColor: buildGradient(camionesDiaCtx, 'rgba(34,197,94,0.85)', 'rgba(34,197,94,0.35)'),
            borderRadius: 6,
            borderSkipped: false,
            barThickness: 32,
            order: 1
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          layout: { padding: { top: 25 } },
          plugins: {
            legend: { display: false },
            dashboardAcusesTopLabels: { enabled: true }
          },
          scales: {
            x: {
              grid: { display: false },
              ticks: { color: '#475569', font: { size: 11, family: 'DM Sans', weight: '500' } }
            },
            y: {
              beginAtZero: true,
              grid: { color: '#f1f5f9' },
              ticks: { color: '#94a3b8', font: { size: 10 } }
            }
          }
        },
        plugins: [topLabelsPlugin]
      });
    }

    const camionesMesCtx = getContext('chartCamionesMes');
    if (camionesMesCtx) {
      state.charts.camionesMes = new Chart(camionesMesCtx, {
        type: 'bar',
        data: {
          labels: serieNaranja.map((item) => item.etiqueta),
          datasets: [{
            type: 'line',
            data: serieNaranja.map((item) => Number(item.total || 0)),
            borderColor: 'rgba(59,130,246,0.6)',
            borderWidth: 2,
            pointRadius: 3,
            pointBackgroundColor: '#3b82f6',
            tension: 0.4,
            fill: false,
            order: 0
          }, {
            type: 'bar',
            data: serieNaranja.map((item) => Number(item.total || 0)),
            backgroundColor: buildGradient(camionesMesCtx, 'rgba(245,158,11,0.85)', 'rgba(245,158,11,0.35)'),
            borderRadius: 6,
            borderSkipped: false,
            barThickness: 32,
            order: 1
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          layout: { padding: { top: 25 } },
          plugins: {
            legend: { display: false },
            dashboardAcusesTopLabels: { enabled: true }
          },
          scales: {
            x: {
              grid: { display: false },
              ticks: { color: '#475569', font: { size: 11, family: 'DM Sans', weight: '500' } }
            },
            y: {
              beginAtZero: true,
              grid: { color: '#f1f5f9' },
              ticks: { color: '#94a3b8', font: { size: 10 } }
            }
          }
        },
        plugins: [topLabelsPlugin]
      });
    }
  }

  function destroyCharts() {
    Object.keys(state.charts).forEach((key) => {
      if (state.charts[key] && typeof state.charts[key].destroy === 'function') {
        state.charts[key].destroy();
      }
    });
    state.charts = {};
  }

  function getContext(id) {
    const canvas = document.getElementById(id);
    return canvas ? canvas.getContext('2d') : null;
  }

  function buildGradient(ctx, startColor, endColor) {
    const gradient = ctx.createLinearGradient(0, 0, 0, 250);
    gradient.addColorStop(0, startColor);
    gradient.addColorStop(1, endColor);
    return gradient;
  }

  function renderSummaryCardsEnhanced() {
    const model = buildSummaryVisualModelEnhanced();

    setText('summaryStatusTitle', 'Estado de Acuses');
    setText('summaryStatusSubtitle', model.isAllScope ? 'Distribucion porcentual del historico' : 'Distribucion porcentual de acuses');
    setHtml('summaryStatusLegend', model.statusItems.map((item) => `
      <div class="summary-status-item">
        <div class="summary-status-item__left">
          <span class="summary-status-item__dot" style="background:${item.color}"></span>
          <div>
            <div class="summary-status-item__label">${escapeHtml(item.label)}</div>
            <div class="summary-status-item__meta">${escapeHtml(formatNumber(item.count))} acuses</div>
          </div>
        </div>
        <div class="summary-status-item__value">${escapeHtml(String(item.percent))}%</div>
      </div>
    `).join(''));
    setText('summaryDonutTotalLabel', model.isAllScope ? 'Total historico' : 'Total de acuses');
    setText('summaryDonutTotalValue', formatNumber(model.donut.total || 0));
    setHtml('summaryDonutTrend', renderSummaryTrendMarkup(model.donutTrend));

    setText('summaryZonesTitle', 'Zonas con mas Envios');
    setText('summaryZonesSubtitle', model.isWeekScope ? 'Top de zonas por cantidad de envios de la semana' : 'Top de zonas por cantidad de envios');
    setText('summaryZonesTotalLabel', 'Total de envios');
    setText('summaryZonesTotalValue', formatNumber(model.kpis.acuses || 0));

    setText('summaryWeekTitle', model.greenTitle);
    setText('summaryWeekSubtitle', model.greenSubtitle);
    setText('summaryWeekLeadValue', formatNumber(model.greenLeadValue));
    setText('summaryWeekLeadLabel', model.greenLeadLabel);
    setText('summaryWeekLeadMeta', model.greenLeadMeta);
    setText('summaryWeekTotalValue', formatNumber(model.greenTotalValue));
    setText('summaryWeekTotalLabel', model.greenTotalLabel);
    setText('summaryWeekTotalMeta', model.greenTotalMeta);
    applySummaryTrendMetric('summaryWeekTrendCard', 'summaryWeekTrendValue', 'summaryWeekTrendLabel', 'summaryWeekTrendMeta', model.greenTrend);

    setText('summaryMonthTitle', model.orangeTitle);
    setText('summaryMonthSubtitle', model.orangeSubtitle);
    setText('summaryMonthTotalValue', formatNumber(model.orangeTotalValue));
    setText('summaryMonthTotalLabel', model.orangeTotalLabel);
    setText('summaryMonthTotalMeta', model.orangeTotalMeta);
    setText('summaryMonthAverageValue', formatAverage(model.orangeAverageValue));
    setText('summaryMonthAverageLabel', model.orangeAverageLabel);
    setText('summaryMonthAverageMeta', model.orangeAverageMeta);
    applySummaryTrendMetric('summaryMonthTrendCard', 'summaryMonthTrendValue', 'summaryMonthTrendLabel', 'summaryMonthTrendMeta', model.orangeTrend);
  }

  function showChartUnavailableMessage() {
    document.querySelectorAll('.chart-container, .summary-donut-shell').forEach((wrap) => {
      if (wrap.querySelector('.chart-unavailable')) return;
      const msg = document.createElement('p');
      msg.className = 'chart-unavailable';
      msg.style.cssText = 'text-align:center;font-size:12px;color:var(--gray-400);padding:20px 8px;margin:0';
      msg.textContent = 'Gráficas no disponibles (sin conexión)';
      wrap.appendChild(msg);
    });
  }

  function renderChartsEnhanced() {
    if (!window.Chart) {
      if (window.__chartJsFailed) showChartUnavailableMessage();
      return;
    }

    destroyCharts();

    const model = buildSummaryVisualModelEnhanced();
    const donutCtx = getContext('chartDona');
    if (donutCtx) {
      state.charts.dona = new Chart(donutCtx, {
        type: 'doughnut',
        data: {
          labels: model.statusItems.map((item) => item.label),
          datasets: [{
            data: model.statusItems.map((item) => Number(item.count || 0)),
            backgroundColor: model.statusItems.map((item) => item.color),
            borderColor: '#ffffff',
            borderWidth: 3,
            hoverOffset: 7,
            spacing: 0,
            borderRadius: 5
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          cutout: '64%',
          animation: {
            animateRotate: true,
            duration: 1250,
            easing: 'easeOutQuart'
          },
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                label(context) {
                  const value = Number(context.raw || 0);
                  const total = Number(model.donut.total || 0);
                  const percent = total > 0 ? Math.round((value / total) * 100) : 0;
                  return `${context.label}: ${formatNumber(value)} (${percent}%)`;
                }
              }
            }
          }
        }
      });
    }

    const zonasCtx = getContext('chartZonas');
    if (zonasCtx) {
      state.charts.zonas = new Chart(zonasCtx, {
        type: 'bar',
        data: {
          labels: model.zonas.map((item) => item.zona),
          datasets: [{
            data: model.zonas.map((item) => Number(item.total || 0)),
            backgroundColor: '#3d8ad8',
            hoverBackgroundColor: '#2563eb',
            borderRadius: 999,
            borderSkipped: false,
            barThickness: 10,
            maxBarThickness: 10
          }]
        },
        options: {
          indexAxis: 'y',
          responsive: true,
          maintainAspectRatio: false,
          animation: {
            duration: 1200,
            easing: 'easeOutQuart'
          },
          layout: { padding: { right: 30, top: 4, bottom: 2 } },
          plugins: {
            legend: { display: false },
            dashboardAcusesEndLabels: { enabled: true },
            tooltip: {
              callbacks: {
                label(context) {
                  return ` ${formatNumber(context.parsed.x || 0)} envios`;
                }
              }
            }
          },
          scales: {
            x: {
              beginAtZero: true,
              grid: { color: 'rgba(226,232,240,0.64)', drawBorder: false },
              border: { display: false },
              ticks: { color: '#94a3b8', font: { size: 10, family: 'DM Sans', weight: '600' }, padding: 4 }
            },
            y: {
              grid: { display: false },
              border: { display: false },
              ticks: { color: '#47627f', font: { size: 10.5, family: 'DM Sans', weight: '700' }, padding: 8 }
            }
          }
        },
        plugins: [endLabelsPlugin]
      });
    }

    const greenCtx = getContext('chartCamiones');
    if (greenCtx) {
      state.charts.camiones = new Chart(greenCtx, {
        type: 'line',
        data: {
          labels: model.greenSeries.map((item) => item.etiqueta),
          datasets: [{
            data: model.greenSeries.map((item) => Number(item.total || 0)),
            borderColor: '#22c55e',
            backgroundColor: buildGradient(greenCtx, 'rgba(34,197,94,0.22)', 'rgba(34,197,94,0.01)'),
            borderWidth: 2.5,
            pointRadius: 4.5,
            pointHoverRadius: 6,
            pointBackgroundColor: '#ffffff',
            pointBorderColor: '#22c55e',
            pointBorderWidth: 2.2,
            pointHoverBackgroundColor: '#ffffff',
            pointHoverBorderColor: '#22c55e',
            tension: 0.42,
            fill: true,
            clip: false
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: {
            duration: 1300,
            easing: 'easeOutQuart'
          },
          interaction: {
            mode: 'index',
            intersect: false
          },
          layout: { padding: { top: 20, right: 4, bottom: 2 } },
          plugins: {
            legend: { display: false },
            dashboardAcusesTopLabels: { enabled: true, datasetIndex: 0 },
            tooltip: {
              callbacks: {
                label(context) {
                  return ` ${formatNumber(context.parsed.y || 0)} acuses`;
                }
              }
            }
          },
          scales: {
            x: {
              grid: { display: false },
              border: { display: false },
              ticks: { color: '#64748b', font: { size: 11, family: 'DM Sans', weight: '700' } }
            },
            y: {
              beginAtZero: true,
              grace: '18%',
              grid: { color: 'rgba(226,232,240,0.72)', drawBorder: false },
              border: { display: false },
              ticks: { color: '#94a3b8', font: { size: 10, family: 'DM Sans', weight: '600' }, padding: 4 }
            }
          }
        },
        plugins: [topLabelsPlugin]
      });
    }

    const orangeCtx = getContext('chartCamionesMes');
    if (orangeCtx) {
      state.charts.camionesMes = new Chart(orangeCtx, {
        type: 'line',
        data: {
          labels: model.orangeSeries.map((item) => item.etiqueta),
          datasets: [{
            data: model.orangeSeries.map((item) => Number(item.total || 0)),
            borderColor: '#f59e0b',
            backgroundColor: buildGradient(orangeCtx, 'rgba(245,158,11,0.24)', 'rgba(245,158,11,0.01)'),
            borderWidth: 2.5,
            pointRadius: 4.5,
            pointHoverRadius: 6,
            pointBackgroundColor: '#ffffff',
            pointBorderColor: '#f59e0b',
            pointBorderWidth: 2.2,
            pointHoverBackgroundColor: '#ffffff',
            pointHoverBorderColor: '#f59e0b',
            tension: 0.38,
            fill: true,
            clip: false
          }]
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: {
            duration: 1300,
            easing: 'easeOutQuart'
          },
          interaction: {
            mode: 'index',
            intersect: false
          },
          layout: { padding: { top: 20, right: 4, bottom: 2 } },
          plugins: {
            legend: { display: false },
            dashboardAcusesTopLabels: { enabled: true, datasetIndex: 0 },
            tooltip: {
              callbacks: {
                label(context) {
                  return ` ${formatNumber(context.parsed.y || 0)} acuses`;
                }
              }
            }
          },
          scales: {
            x: {
              grid: { display: false },
              border: { display: false },
              ticks: { color: '#64748b', font: { size: 11, family: 'DM Sans', weight: '700' } }
            },
            y: {
              beginAtZero: true,
              grace: '18%',
              grid: { color: 'rgba(226,232,240,0.72)', drawBorder: false },
              border: { display: false },
              ticks: { color: '#94a3b8', font: { size: 10, family: 'DM Sans', weight: '600' }, padding: 4 }
            }
          }
        },
        plugins: [topLabelsPlugin]
      });
    }
  }

  function buildSummaryVisualModelEnhanced() {
    const summary = state.summary || {};
    const donut = summary.donut || { entregados: 0, pendientes: 0, en_transito: 0, total: 0, porcentajeEntregados: 0, porcentajePendientes: 0, porcentajeTransito: 0 };
    const kpis = summary.kpis || { acuses: 0 };
    const zonas = Array.isArray(summary.zonas) ? summary.zonas : [];
    const acusesPorDia = Array.isArray(summary.acusesPorDia) ? summary.acusesPorDia : [];
    const acusesPorSemana = Array.isArray(summary.acusesPorSemana) ? summary.acusesPorSemana : [];
    const acusesPorMes = Array.isArray(summary.acusesPorMes) ? summary.acusesPorMes : [];
    const acusesPorAnio = groupRowsByYear(acusesPorMes);
    const isWeekScope = summary.periodo && summary.periodo.scope === 'week';
    const isAllScope = summary.periodo && summary.periodo.scope === 'all';
    const comparisonTotal = Number(state.summaryComparison?.kpis?.acuses || 0);
    const weekdaySeries = buildSummaryWeekdaySeries(acusesPorDia);

    const greenSeries = isWeekScope
      ? weekdaySeries
      : isAllScope
        ? acusesPorMes.map((item) => ({ ...item, etiqueta: formatMonthSeriesLabel(item.mes, true) }))
        : weekdaySeries;
    const orangeSeries = isAllScope
      ? acusesPorAnio
      : acusesPorMes.map((item) => ({ ...item, etiqueta: formatMonthSeriesLabel(item.mes, false) }));

    const statusItems = [
      { label: 'Entregados', count: Number(donut.entregados || 0), percent: Number(donut.porcentajeEntregados || 0), color: '#22c55e' },
      { label: 'Pendientes', count: Number(donut.pendientes || 0), percent: Number(donut.porcentajePendientes || 0), color: '#f59e0b' },
      { label: 'En Transito', count: Number(donut.en_transito || 0), percent: Number(donut.porcentajeTransito || 0), color: '#3b82f6' },
      { label: 'Anulados', count: Number(donut.anulados || 0), percent: Number(donut.porcentajeAnulados || 0), color: '#ef4444' }
    ];

    const greenPeak = findPeakSummaryRow(greenSeries);
    const greenTrend = isAllScope
      ? buildTrendFromSeries(acusesPorMes, 'vs. mes anterior')
      : buildTrendMetrics(Number(kpis.acuses || 0), comparisonTotal, isWeekScope ? 'vs. semana anterior' : 'vs. mes anterior');
    const orangeTrend = isAllScope
      ? buildTrendFromSeries(acusesPorAnio, 'vs. ano anterior')
      : buildTrendFromSeries(acusesPorMes, 'vs. mes anterior');
    const donutTrend = isAllScope
      ? buildTrendFromSeries(acusesPorAnio, 'vs. ano anterior')
      : buildTrendMetrics(Number(kpis.acuses || 0), comparisonTotal, isWeekScope ? 'vs. semana anterior' : 'vs. periodo anterior');

    return {
      donut,
      kpis,
      zonas,
      statusItems,
      isWeekScope,
      isAllScope,
      greenSeries,
      orangeSeries,
      donutTrend,
      greenTrend,
      orangeTrend,
      greenTitle: isAllScope ? 'Acuses por Mes' : 'Acuses por Semana',
      greenSubtitle: isAllScope ? 'Evolucion mensual de acuses' : 'Cantidad de acuses por dia de la semana',
      greenLeadValue: Number(greenPeak?.total || 0),
      greenLeadLabel: isAllScope ? 'Mes mas alto' : 'Dia mas alto',
      greenLeadMeta: greenPeak ? (isAllScope ? greenPeak.etiqueta : (greenPeak.meta || greenPeak.etiqueta)) : 'Sin actividad',
      greenTotalValue: isAllScope ? countNonZero(acusesPorMes) : Number(kpis.acuses || 0),
      greenTotalLabel: isAllScope ? 'Meses activos' : isWeekScope ? 'Total de la semana' : 'Total del mes',
      greenTotalMeta: isAllScope ? 'Meses con actividad' : 'Acuses acumulados',
      orangeTitle: isAllScope ? 'Acuses por Ano' : 'Acuses por Mes',
      orangeSubtitle: isAllScope ? 'Totales historicos por ano' : 'Evolucion mensual de acuses',
      orangeTotalValue: sumRows(orangeSeries),
      orangeTotalLabel: isAllScope ? 'Total historico' : 'Total del periodo',
      orangeTotalMeta: isAllScope ? 'Suma por anos' : 'Suma de la serie',
      orangeAverageValue: averageRows(orangeSeries),
      orangeAverageLabel: isAllScope ? 'Promedio anual' : 'Promedio mensual',
      orangeAverageMeta: isAllScope ? 'Media por ano' : 'Media de la serie'
    };
  }

  function findPeakSummaryRow(rows) {
    return (rows || []).reduce((peak, row) => {
      if (!peak) return row;
      return Number(row.total || 0) > Number(peak.total || 0) ? row : peak;
    }, null);
  }

  function buildTrendMetrics(current, previous, label) {
    const currentValue = Number(current || 0);
    const previousValue = Number(previous || 0);
    if (!Number.isFinite(currentValue) || !Number.isFinite(previousValue)) return null;

    if (previousValue === 0) {
      if (currentValue === 0) {
        return { change: 0, tone: 'neutral', label, meta: 'Sin variacion' };
      }
      return { change: 100, tone: 'up', label, meta: 'Sin base previa' };
    }

    const change = ((currentValue - previousValue) / previousValue) * 100;
    return {
      change,
      tone: change > 0.25 ? 'up' : change < -0.25 ? 'down' : 'neutral',
      label,
      meta: previousValue > 0 ? `${formatNumber(previousValue)} previo` : 'Sin base previa'
    };
  }

  function buildTrendFromSeries(rows, label) {
    if (!Array.isArray(rows) || rows.length < 2) return null;
    const latest = rows[rows.length - 1];
    const previous = rows[rows.length - 2];
    return buildTrendMetrics(Number(latest.total || 0), Number(previous.total || 0), label);
  }

  function renderSummaryTrendMarkup(trend) {
    if (!trend) {
      return `<span class="summary-footer-trend summary-footer-trend--neutral">${trendIconSvg('neutral')}<span><strong>Sin base</strong><small>periodo anterior</small></span></span>`;
    }
    return `<span class="summary-footer-trend summary-footer-trend--${escapeHtml(trend.tone)}">${trendIconSvg(trend.tone)}<span><strong>${escapeHtml(formatTrendPercent(trend.change))}</strong><small>${escapeHtml(trend.label || 'vs. periodo anterior')}</small></span></span>`;
  }

  function applySummaryTrendMetric(cardId, valueId, labelId, metaId, trend) {
    const card = document.getElementById(cardId);
    const value = document.getElementById(valueId);
    const label = document.getElementById(labelId);
    const meta = document.getElementById(metaId);
    if (!card || !value || !label || !meta) return;

    card.classList.remove('summary-metric--up', 'summary-metric--down', 'summary-metric--neutral');
    if (!trend) {
      card.classList.add('summary-metric--neutral');
      value.innerHTML = '0%';
      label.textContent = 'vs. periodo anterior';
      meta.textContent = 'Sin base anterior';
      return;
    }

    card.classList.add(`summary-metric--${trend.tone}`);
    value.innerHTML = `${trendIconSvg(trend.tone)} ${escapeHtml(formatTrendPercent(trend.change))}`;
    label.textContent = trend.label || 'vs. periodo anterior';
    meta.textContent = trend.meta || 'Comparacion real';
  }

  function trendIconSvg(tone) {
    if (tone === 'down') {
      return '<svg fill="none" stroke="currentColor" stroke-width="2.4" viewBox="0 0 24 24"><path d="M12 19V5"/><path d="M6 13l6 6 6-6"/></svg>';
    }
    if (tone === 'neutral') {
      return '<svg fill="none" stroke="currentColor" stroke-width="2.4" viewBox="0 0 24 24"><path d="M5 12h14"/></svg>';
    }
    return '<svg fill="none" stroke="currentColor" stroke-width="2.4" viewBox="0 0 24 24"><path d="M12 5v14"/><path d="M18 11l-6-6-6 6"/></svg>';
  }

  function formatTrendPercent(value) {
    return `${formatAverage(Math.abs(Number(value || 0)))}%`;
  }

  function buildSummaryWeekdaySeries(rows) {
    const totals = new Map(SUMMARY_WEEKDAY_ORDER.map((item) => [item.jsDay, 0]));
    (rows || []).forEach((item) => {
      const weekday = getSummaryWeekdayDefinition(item.fecha);
      if (!weekday) return;
      totals.set(weekday.jsDay, totals.get(weekday.jsDay) + Number(item.total || 0));
    });
    return SUMMARY_WEEKDAY_ORDER.map((item) => ({
      etiqueta: item.label,
      meta: item.name,
      total: Number(totals.get(item.jsDay) || 0)
    }));
  }

  const SUMMARY_WEEKDAY_ORDER = [
    { jsDay: 1, label: 'LUNES', name: 'Lunes' },
    { jsDay: 2, label: 'MARTES', name: 'Martes' },
    { jsDay: 3, label: 'MIERCOLES', name: 'Miercoles' },
    { jsDay: 4, label: 'JUEVES', name: 'Jueves' },
    { jsDay: 5, label: 'VIERNES', name: 'Viernes' },
    { jsDay: 6, label: 'SABADO', name: 'Sabado' }
  ];

  function getSummaryWeekdayDefinition(value) {
    const date = parseIsoDate(value);
    if (!date) return null;
    return SUMMARY_WEEKDAY_ORDER.find((item) => item.jsDay === date.getDay()) || null;
  }

  function formatSummaryWeekdayLabel(value) {
    return getSummaryWeekdayDefinition(value)?.label || '';
  }

  function formatSummaryWeekdayName(value) {
    return getSummaryWeekdayDefinition(value)?.name || 'Sin actividad';
  }

  window.openSummaryDetail = async function openSummaryDetail(kpi = 'acuses') {
    const targetKpi = normalizeDashboardKpi(kpi, { fallback: 'acuses' });
    await showView('dashboard');
    if (targetKpi && state.activeKPI !== targetKpi) {
      await selectKPI(targetKpi);
    }
  };

  function renderPanelLoaderMarkup(message) {
    return `
      <div class="content-panel__loading">
        <div class="dash-pro-loader" aria-hidden="true">
          <div class="dash-pro-loader__base"></div>
          <div class="dash-pro-loader__spin"></div>
          <div class="dash-pro-loader__core"></div>
        </div>
        <div>${escapeHtml(message || 'Cargando datos...')}</div>
      </div>
    `;
  }

  function renderPanelErrorMarkup(message) {
    return `
      <div class="content-panel__loading">
        <div class="dash-pro-loader" aria-hidden="true" style="opacity:.34;filter:none">
          <div class="dash-pro-loader__base"></div>
          <div class="dash-pro-loader__core" style="box-shadow: inset 0 0 0 2px rgba(239,68,68,0.14); border: 2px solid rgba(239,68,68,0.08);"></div>
        </div>
        <div>${escapeHtml(message || 'No se pudo cargar el panel.')}</div>
      </div>
    `;
  }

  async function selectKPI(kpi) {
    const normalizedKpi = normalizeDashboardKpi(kpi, { fallback: 'acuses' });
    state.activeKPI = normalizedKpi;
    state.panelOpenFilter = null;
    saveDashboardState();
    syncActiveKpiCards();
    syncDashboardChrome();
    syncSidebarActiveState();
    await loadPanel(normalizedKpi);
  }

  function syncActiveKpiCards() {
    document.querySelectorAll('.kpi-card').forEach((card) => {
      card.classList.toggle('active', card.dataset.kpi === state.activeKPI);
    });
  }

  function syncDashboardChrome() {
    const kpiGrid = document.getElementById('dashboardKpiGrid');
    if (kpiGrid) {
      kpiGrid.classList.toggle('is-hidden', state.currentView === 'dashboard' && state.activeKPI === 'repartidores');
    }
  }

  async function loadPanel(kpi, options = {}) {
    const normalizedKpi = normalizeDashboardKpi(kpi, {
      allowRepartidores: true,
      fallback: normalizeDashboardKpi(state.activeKPI, { allowRepartidores: true, fallback: 'acuses' })
    });
    if (state.activeKPI !== normalizedKpi) {
      state.activeKPI = normalizedKpi;
      syncActiveKpiCards();
      syncDashboardChrome();
      syncSidebarActiveState();
    }

    const soft = Boolean(options.soft);
    const panel = document.getElementById('contentPanel');
    const currentShell = panel ? panel.querySelector('.content-panel') : null;
    const useSoft = soft && Boolean(currentShell);

    if (currentShell) {
      currentShell.classList.remove('content-panel--soft-loading');
    }

    if (panel && !useSoft) {
      panel.innerHTML = `<div class="content-panel">${renderPanelLoaderMarkup('Cargando datos reales...')}</div>`;
    } else if (useSoft && currentShell) {
      currentShell.classList.add('content-panel--soft-loading');
    }

    const params = buildPanelParams(normalizedKpi);
    const requestSeq = ++state.panelRequestSeq;

    try {
      const response = await fetchPanelResponse(normalizedKpi, params);

      if (requestSeq !== state.panelRequestSeq) return;

      state.panelResponse = response;
      renderPanel(normalizedKpi, response, { preserveShell: useSoft });
    } catch (error) {
      if (requestSeq === state.panelRequestSeq) {
        if (useSoft && currentShell) {
          currentShell.classList.remove('content-panel--soft-loading');
        } else if (panel) {
          panel.innerHTML = `<div class="content-panel">${renderPanelErrorMarkup('No se pudo actualizar la tabla de acuses.')}</div>`;
        }
      }
      throw error;
    }
  }

  async function refreshDashboardData(options = {}) {
    const refreshHistory = options.history === true || state.currentView === 'historial';
    const softPanel = options.softPanel !== false;
    const tasks = [
      { key: 'summary', run: () => loadSummary() },
      { key: 'kpis', run: () => loadKpiSummary() },
      { key: 'panel', run: () => loadPanel(state.activeKPI, { soft: softPanel }) },
      { key: 'calendar', run: () => loadCalendarMonth() }
    ];

    if (refreshHistory) {
      tasks.push({ key: 'history', run: () => loadHistorial() });
    }

    const results = await Promise.allSettled(tasks.map((task) => task.run()));
    const failures = results
      .map((result, index) => ({ result, key: tasks[index].key }))
      .filter(({ result }) => result.status === 'rejected');

    if (failures.length) {
      const panelFailure = failures.find(({ key }) => key === 'panel');
      const firstError = panelFailure || failures[0];
      throw firstError.result.reason;
    }
  }

  function buildPanelParams(kpi) {
    const normalizedKpi = normalizeDashboardKpi(kpi, {
      allowRepartidores: true,
      fallback: normalizeDashboardKpi(state.activeKPI, { allowRepartidores: true, fallback: 'acuses' })
    });
    const params = { all: 1 };

    if (state.panelFilters.fecha) params.fecha = state.panelFilters.fecha;

    if (normalizedKpi === 'repartidores') {
      if (state.panelFilters.repartidorId) params.idRepartidor = state.panelFilters.repartidorId;
    } else if (state.panelFilters.clienteCode) {
      params.codCliente = state.panelFilters.clienteCode;
    }

    return params;
  }

  async function requestPanelEndpoint(kpi, params) {
    return kpi === 'repartidores'
      ? AcuseAPI.get('/api/dashboard/interactivo/repartidores', params)
      : AcuseAPI.get(`/api/dashboard/interactivo/panel/${kpi}`, params);
  }

  async function fetchPanelResponse(kpi, params = {}) {
    const baseParams = { ...params };
    const firstResponse = await requestPanelEndpoint(kpi, baseParams);
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
      const nextResponse = await requestPanelEndpoint(kpi, {
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

  function renderPanel(kpi, response, options = {}) {
    const preserveShell = Boolean(options.preserveShell);
    const cfg = PANEL_CONFIG[kpi];
    const total = Number(response.total || 0);
    const badgeText = kpi === 'repartidores'
      ? `${formatNumber(total)} activos`
      : kpi === 'anulados'
        ? `${formatNumber(total)} anulados`
        : `${formatNumber(total)} registros`;
    const colCount = kpi === 'repartidores' ? 6 : 8;
    const rowsHtml = renderPanelRows(kpi, response.items || []);

    const panel = document.getElementById('contentPanel');
    if (!panel) return;

    const innerHtml = `
      ${panelHeaderHTML(kpi, cfg, badgeText)}
      <div class="table-wrapper"><table>
        <thead><tr>${panelTableHeaders(kpi)}</tr></thead>
        <tbody>${rowsHtml || `<tr><td colspan="${colCount}" style="text-align:center;padding:24px;color:var(--gray-400)">Sin resultados para este filtro</td></tr>`}</tbody>
      </table></div>`;

    if (preserveShell) {
      const shell = panel.querySelector('.content-panel');
      if (shell) {
        shell.classList.remove('content-panel--soft-loading');
        shell.innerHTML = innerHtml;
        initPanelDatePicker(kpi);
        syncDashboardSelectedRowState({ focus: Boolean(state.highlightedAcuseId), behavior: 'smooth' });
        return;
      }
    }

    panel.innerHTML = `<div class="content-panel">${innerHtml}</div>`;
    initPanelDatePicker(kpi);
    syncDashboardSelectedRowState({ focus: Boolean(state.highlightedAcuseId), behavior: 'smooth' });
  }

  function panelHeaderHTML(kpi, cfg, badgeText) {
    const actionsHtml = kpi === 'repartidores'
      ? ''
      : `<div class="panel-header-right">
        <button class="btn-action btn-nuevo" type="button" onclick="openNewAcuse(this)"><svg class="btn-action__icon" fill="none" stroke="currentColor" stroke-width="1.9" viewBox="0 0 24 24"><path d="M12 6.5v11" stroke-linecap="round"/><path d="M6.5 12h11" stroke-linecap="round"/></svg><span class="btn-action__spinner" aria-hidden="true"></span><span class="btn-action__label">Nuevo Acuse</span></button>
        <button class="btn-action btn-exportar" type="button" onclick="exportCurrentPanel(this)">${excelIcon()}<span class="btn-action__spinner" aria-hidden="true"></span><span class="btn-action__label">Exportar Excel</span></button>
      </div>`;

    return `<div class="panel-header">
      <div class="panel-header-left">
        <div class="panel-title"><span class="dot" style="background:${cfg.dot}"></span> ${cfg.title}</div>
        <div class="panel-badge" style="background:${cfg.bg};color:${cfg.color}">${badgeText}</div>
        ${panelDateFilterHTML(kpi)}
        ${panelEntityFilterHTML(kpi)}
        <button class="btn-action btn-clear-filters btn-clear-filters--inline" type="button" onclick="clearCurrentPanelFilters(this)"><svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M4 4v5h.582m14.356 2A8 8 0 005.582 9m0 0H9m11 11v-5h-.581m0 0A8.003 8.003 0 016.343 15m13.076 0H15"/></svg><span class="btn-action__label">Limpiar filtros</span></button>
      </div>
      ${actionsHtml}
    </div>`;
  }

  function activeFilterTypeForKpi(kpi) {
    return kpi === 'repartidores' ? 'repartidor' : 'cliente';
  }

  function panelDateFilterHTML(kpi) {
    const value = state.panelFilters.fecha;
    return `<div class="filter-wrap filter-date-wrap filter-wrap--date-pro">
      <input type="date" id="panel-date-filter-${kpi}" value="${value}" onchange="pickDateFilter('${kpi}', this.value)">
    </div>`;
  }

  function panelEntityFilterHTML(kpi) {
    const type = activeFilterTypeForKpi(kpi);
    const filterId = `filter-${kpi}`;
    const open = state.panelOpenFilter === type;
    const query = state.panelFilterQuery[type] || '';
    const value = type === 'cliente' ? state.panelFilters.clienteLabel : state.panelFilters.repartidorLabel;
    const placeholder = type === 'cliente' ? 'Filtrar cliente...' : 'Filtrar repartidor...';

    return `<div class="filter-wrap filter-wrap--entity${type === 'cliente' ? ' filter-wrap--panel-client' : ''}" id="${filterId}">
      <div class="filter-trigger ${value ? 'has-val' : ''}${open ? ' open' : ''}" onclick="toggleFilter('${filterId}', '${kpi}')">
        <div class="f-dot"></div>
        <div class="f-main"><span class="f-val">${escapeHtml(value || placeholder)}</span></div>
        <div class="f-actions">
          <button class="f-clr" onclick="event.stopPropagation();clearFilter('${kpi}')" title="Limpiar">
            <svg width="9" height="9" viewBox="0 0 10 10" fill="none"><path d="M1 1l8 8M9 1L1 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          </button>
          <svg class="f-arr" width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M3 5l4 4 4-4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </div>
      </div>
      <div class="filter-dd${open ? ' open' : ''}" id="${filterId}-dd">
        <div class="filter-search">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="1.4"/><path d="M11 11l3 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
          <input type="text" placeholder="Buscar..." value="${escapeHtml(query)}" oninput="renderFilterItems('${kpi}', this.value)" autocomplete="off" spellcheck="false">
        </div>
        <div class="filter-list" id="${filterId}-list">${panelFilterItemsHTML(kpi)}</div>
      </div>
    </div>`;
  }

  function panelFilterItemsHTML(kpi) {
    const type = activeFilterTypeForKpi(kpi);
    const rows = state.panelFilterResults[type] || [];
    if (!rows.length) return '<div class="filter-empty">Sin resultados</div>';

    const selectedValue = type === 'cliente' ? state.panelFilters.clienteCode : state.panelFilters.repartidorId;

    return rows.map((item, index) => {
      const value = type === 'cliente' ? item.Cod_Cliente : item.ID;
      const label = type === 'cliente'
        ? `${item.Cod_Cliente || ''} - ${item.Nom_Cliente || item.Cod_Cliente || 'Sin cliente'}`
        : item.Nombre_Repartidor || item.Codigo_Repartidor || String(item.ID || '');
      const name = type === 'cliente'
        ? item.Nom_Cliente || item.Cod_Cliente || 'Sin cliente'
        : item.Nombre_Repartidor || item.Codigo_Repartidor || String(item.ID || '');
      const code = type === 'cliente' ? item.Cod_Cliente || '' : '';
      const selected = String(selectedValue || '') === String(value || '');

      return `<div class="filter-item ${selected ? 'sel' : ''}" style="animation-delay:${Math.min(index * 0.025, 0.18)}s" onmousedown="event.preventDefault();pickFilter('${kpi}','${escapeInlineJs(String(value))}','${escapeInlineJs(label)}')">
        <div class="fi-dot"></div>
        <div class="fi-row">
          <span class="fi-name">${escapeHtml(name)}</span>
          ${code ? `<span class="fi-code">${escapeHtml(code)}</span>` : ''}
        </div>
        <svg class="fi-check" viewBox="0 0 20 20" fill="none"><path d="M4.5 10.5l3.2 3.2L15.5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </div>`;
    }).join('');
  }

  function panelTableHeaders(kpi) {
    if (kpi === 'repartidores') {
      return '<th>Repartidor</th><th>Zona</th><th>Entregas</th><th>Pendientes</th><th>Acuses</th><th>Eficiencia</th>';
    }
    if (kpi === 'anulados') {
      return '<th>Fecha</th><th>Guia</th><th>Cliente</th><th>Destino</th><th>Repartidor</th><th>Estado</th><th>Detalles</th><th>Motivo de anulacion</th>';
    }
    return '<th>Fecha</th><th>Guia</th><th>Cliente</th><th>Destino</th><th>Repartidor</th><th>Estado</th><th>Detalles</th><th>Acciones</th>';
  }

  function renderPanelRows(kpi, items) {
    if (kpi === 'repartidores') {
      return items.map((item, index) => renderRepartidorRow(item, index)).join('');
    }
    return items.map((item) => renderAcuseRow(item)).join('');
  }

  function renderRepartidorRow(item, index) {
    const color = COLORS_AVATAR[index % COLORS_AVATAR.length];
    const eficiencia = Number(item.eficiencia || 0);
    const colorEficiencia = eficiencia >= 90 ? '#10B981' : eficiencia >= 80 ? '#F59E0B' : '#EF4444';

    return `<tr>
      <td><span class="repartidor-avatar" style="background:${color}">${escapeHtml(getInitials(item.Nombre_Repartidor || 'RP'))}</span>${escapeHtml(item.Nombre_Repartidor || 'Sin nombre')}</td>
      <td>${escapeHtml(item.zona || 'Sin zona')}</td>
      <td style="font-weight:600;color:var(--primary)">${formatNumber(item.entregas || 0)}</td>
      <td style="font-weight:600;color:#B45309">${formatNumber(item.pendientes || 0)}</td>
      <td style="font-weight:600;color:#6D28D9">${formatNumber(item.acuses || 0)}</td>
      <td>
        <div class="progress-bar"><div class="progress-bar-fill" style="width:${Math.max(Math.min(eficiencia, 100), 0)}%;background:${colorEficiencia}"></div></div>
        <span style="font-weight:700;color:${colorEficiencia};font-size:13px">${formatNumber(eficiencia)}%</span>
      </td>
    </tr>`;
  }

  function renderAcuseRow(item) {
    const acuseId = Number(item.ID_Acuse || 0);
    const estado = normalizeEstadoValue(item.Estado);
    const delivered = estado === 'entregado';
    const cancelled = estado === 'anulado';
    const guide = item.Nro_Acuse || `#${acuseId}`;
    const clientLabel = item.Nom_Cliente || item.Cod_Cliente || 'Sin cliente';
    const destination = item.Zona || item.Ciudad_Cliente || item.Zona_Cliente || 'Sin zona';
    const motivoAnulacion = escapeHtml(item.Motivo_Anulacion || item.Observacion || 'Sin motivo registrado');
    const accionesHtml = cancelled
      ? `<div style="font-size:12px;color:#6b7280;font-weight:600;max-width:200px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${motivoAnulacion}">${motivoAnulacion}</div>`
      : delivered
      ? `<div class="tbl-actions tbl-actions--single">
          <button class="tbl-btn act-print" onclick="event.stopPropagation();openPrintAcuse(${acuseId}, this)"><span class="tip">Imprimir</span>${printIcon()}</button>
        </div>`
      : `<div class="tbl-actions">
          <button class="tbl-btn act-deliver" onclick="event.stopPropagation();markAcuseDelivered(${acuseId}, this)"><span class="tip">Entregado</span>${deliverIcon()}</button>
          <button class="tbl-btn act-edit" onclick="event.stopPropagation();openEditAcuse(${acuseId}, this)"><span class="tip">Editar</span>${editIcon()}</button>
          <button class="tbl-btn act-delete" onclick="event.stopPropagation();openDeleteAcuse(${acuseId}, this)"><span class="tip">Anular</span>${deleteIcon()}</button>
          <button class="tbl-btn act-print" onclick="event.stopPropagation();openPrintAcuse(${acuseId}, this)"><span class="tip">Imprimir</span>${printIcon()}</button>
        </div>`;

    return `<tr class="tbl-row-selectable" data-acuse-id="${acuseId}" tabindex="0" role="button" aria-pressed="false" aria-label="Seleccionar acuse ${escapeHtml(String(guide))}" onclick="selectDashboardAcuse(${acuseId})" onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();selectDashboardAcuse(${acuseId});}">
      <td>${escapeHtml(formatDate(item.Fecha_Emision))}</td>
      <td><span class="guide-code">${escapeHtml(guide)}</span></td>
      <td><span class="tbl-cell-meta">${clientRowIcon()}<span class="tbl-cell-meta__text">${escapeHtml(clientLabel)}</span></span></td>
      <td><span class="tbl-cell-meta">${destinationRowIcon()}<span class="tbl-cell-meta__text">${escapeHtml(destination)}</span></span></td>
      <td>${escapeHtml(item.Nombre_Repartidor || 'Sin repartidor')}</td>
      <td>${renderStatusBadge(item.Estado)}</td>
      <td><a class="tbl-link" onclick="event.stopPropagation();openViewAcuse(${acuseId}, this)">${viewIcon()} <span class="tbl-link__label">Ver detalles</span></a></td>
      <td>${accionesHtml}</td>
    </tr>`;
  }

  function destacarFilaGuardada(acuseId) {
    if (!acuseId) return;
    window.requestAnimationFrame(() => {
      const row = document.querySelector(`#contentPanel .tbl-row-selectable[data-acuse-id="${acuseId}"]`);
      if (!row) return;
      row.classList.remove('acuse-row-new');
      void row.offsetHeight;
      row.classList.add('acuse-row-new');
      window.setTimeout(() => row.classList.remove('acuse-row-new'), 2000);
    });
  }

  function clearDashboardSelectionEffect() {
    if (dashboardSelectionEffectTimer) {
      window.clearTimeout(dashboardSelectionEffectTimer);
      dashboardSelectionEffectTimer = null;
    }
    state.highlightedAcuseId = null;
  }

  function scheduleDashboardSelectionEffectClear() {
    if (dashboardSelectionEffectTimer) {
      window.clearTimeout(dashboardSelectionEffectTimer);
    }
    dashboardSelectionEffectTimer = window.setTimeout(() => {
      state.highlightedAcuseId = null;
      syncDashboardSelectedRowState();
      dashboardSelectionEffectTimer = null;
    }, 520);
  }

  function setDashboardSelectedAcuse(id, options = {}) {
    const normalizedId = Number(id || 0) || null;
    state.selectedAcuseId = normalizedId;

    if (options.highlight && normalizedId) {
      state.highlightedAcuseId = normalizedId;
      scheduleDashboardSelectionEffectClear();
    } else if (options.clearHighlight !== false && state.highlightedAcuseId && state.highlightedAcuseId !== normalizedId) {
      clearDashboardSelectionEffect();
    }

    syncDashboardSelectedRowState({
      focus: Boolean(options.focus),
      behavior: options.behavior || 'smooth',
      delay: options.delay
    });
  }

  function selectDashboardAcuse(id) {
    const normalizedId = Number(id || 0) || null;
    if (!normalizedId) {
      setDashboardSelectedAcuse(null);
      return;
    }

    if (state.selectedAcuseId === normalizedId) {
      setDashboardSelectedAcuse(null);
      return;
    }

    setDashboardSelectedAcuse(normalizedId);
  }

  function syncDashboardSelectedRowState(options = {}) {
    document.querySelectorAll('#contentPanel .tbl-row-selectable').forEach((row) => {
      const rowId = Number(row.dataset.acuseId || 0) || null;
      const isSelected = rowId !== null && rowId === state.selectedAcuseId;
      const isHighlighted = rowId !== null && rowId === state.highlightedAcuseId;
      row.classList.toggle('tbl-row-selected', isSelected);
      row.classList.toggle('tbl-row-created', isHighlighted);
      row.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
    });

    if (options.focus && state.selectedAcuseId) {
      focusSelectedDashboardAcuse(options);
    }
  }

  function focusSelectedDashboardAcuse(options = {}) {
    if (dashboardSelectionFocusTimer) {
      window.clearTimeout(dashboardSelectionFocusTimer);
    }

    dashboardSelectionFocusTimer = window.setTimeout(() => {
      const row = document.querySelector(`#contentPanel .tbl-row-selectable[data-acuse-id="${state.selectedAcuseId}"]`);
      if (!row) {
        dashboardSelectionFocusTimer = null;
        return;
      }

      row.scrollIntoView({
        behavior: options.behavior || 'smooth',
        block: 'nearest'
      });

      dashboardSelectionFocusTimer = null;
    }, Number(options.delay || 70));
  }

  function pickDateFilter(kpi, isoValue) {
    state.panelFilters.fecha = isoValue || '';
    resetPanelPages();
    loadPanel(state.activeKPI, { soft: true }).catch(handleError);
  }

  function clearDateFilter(kpi) {
    state.panelFilters.fecha = '';
    resetPanelPages();
    loadPanel(state.activeKPI, { soft: true }).catch(handleError);
  }

  function initPanelDatePicker(kpi) {
    const input = document.getElementById(`panel-date-filter-${kpi}`);
    if (!input || !window.DatePickerPro) return;
    window.DatePickerPro.attach(input, {
      variant: 'filter',
      placeholder: 'Fecha...'
    });
  }

  function toggleFilter(filterId, kpi) {
    const type = activeFilterTypeForKpi(kpi);
    const shouldOpen = state.panelOpenFilter !== type;
    closePanelFilter();
    if (!shouldOpen) return;

    state.panelOpenFilter = type;
    const wrap = document.getElementById(filterId);
    const dropdown = document.getElementById(`${filterId}-dd`);
    const trigger = wrap ? wrap.querySelector('.filter-trigger') : null;
    if (!wrap || !dropdown || !trigger) return;

    state.panelFilterQuery[type] = '';
    dropdown.classList.add('open');
    trigger.classList.add('open');
    renderFilterItems(kpi, '').catch(handleError);
    window.setTimeout(() => {
      dropdown.querySelector('input')?.focus();
    }, 40);
  }

  async function renderFilterItems(kpi, query) {
    const type = activeFilterTypeForKpi(kpi);
    state.panelFilterQuery[type] = query;

    if (type === 'cliente') {
      const response = await AcuseAPI.get('/api/clientes', { q: query, limit: 12 });
      state.panelFilterResults.cliente = response.items || [];
    } else {
      const needle = String(query || '').trim().toLowerCase();
      state.panelFilterResults.repartidor = state.repartidoresCatalog.filter((item) => {
        const text = `${item.Nombre_Repartidor || ''} ${item.Codigo_Repartidor || ''}`.toLowerCase();
        return !needle || text.includes(needle);
      }).slice(0, 12);
    }

    const list = document.getElementById(`filter-${kpi}-list`);
    if (list) list.innerHTML = panelFilterItemsHTML(kpi);
  }

  function pickFilter(kpi, value, label) {
    const type = activeFilterTypeForKpi(kpi);
    if (type === 'cliente') {
      state.panelFilters.clienteCode = value;
      state.panelFilters.clienteLabel = label || value;
    } else {
      state.panelFilters.repartidorId = value;
      state.panelFilters.repartidorLabel = label || value;
    }

    closePanelFilter();
    resetPanelPages();
    loadPanel(state.activeKPI, { soft: true }).catch(handleError);
  }

  function clearFilter(kpi) {
    const type = activeFilterTypeForKpi(kpi);
    if (type === 'cliente') {
      state.panelFilters.clienteCode = '';
      state.panelFilters.clienteLabel = '';
    } else {
      state.panelFilters.repartidorId = '';
      state.panelFilters.repartidorLabel = '';
    }

    closePanelFilter();
    resetPanelPages();
    loadPanel(state.activeKPI, { soft: true }).catch(handleError);
  }

  function closePanelFilter() {
    document.querySelectorAll('#contentPanel .filter-dd.open').forEach((node) => node.classList.remove('open'));
    document.querySelectorAll('#contentPanel .filter-trigger.open').forEach((node) => node.classList.remove('open'));
    state.panelOpenFilter = null;
  }

  async function openNewAcuse(button) {
    await runButtonLoading(button, async () => {
      openAcuseEmbed('new');
    });
  }

  async function openEditAcuse(id, button) {
    setDashboardSelectedAcuse(id, { clearHighlight: false });
    await runButtonLoading(button, async () => {
      openAcuseEmbed('edit', id);
    });
  }

  async function openViewAcuse(id, button) {
    setDashboardSelectedAcuse(id, { clearHighlight: false });
    await runButtonLoading(button, async () => {
      openAcuseEmbed('view', id);
    });
  }

  async function openDeleteAcuse(id, button) {
    setDashboardSelectedAcuse(id, { clearHighlight: false });
    await runButtonLoading(button, async () => {
      openAcuseEmbed('delete', id);
    });
  }

  async function openPrintAcuse(id, button) {
    setDashboardSelectedAcuse(id, { clearHighlight: false });
    await runButtonLoading(button, async () => {
      openAcuseEmbed('print', id);
    });
  }

  function openAcuseEmbed(action, id) {
    const overlay = document.getElementById('acuseEmbedOverlay');
    const frame = document.getElementById('acuseEmbedFrame');
    if (!overlay || !frame) return;
    if (embedOverlayCloseTimer) {
      window.clearTimeout(embedOverlayCloseTimer);
      embedOverlayCloseTimer = null;
    }

    const params = new URLSearchParams({ embed: '1', action });
    if (id) params.set('id', String(id));

    overlay.dataset.action = action;
    overlay.classList.remove('closing', 'ready');
    overlay.classList.add('loading');
    window.requestAnimationFrame(() => {
      overlay.classList.add('open');
    });
    frame.src = `/views/acuses.html?${params.toString()}`;
  }

  function closeAcuseEmbed() {
    const overlay = document.getElementById('acuseEmbedOverlay');
    const frame = document.getElementById('acuseEmbedFrame');
    if (!overlay || (!overlay.classList.contains('open') && !overlay.classList.contains('closing'))) return;

    if (embedOverlayCloseTimer) {
      window.clearTimeout(embedOverlayCloseTimer);
      embedOverlayCloseTimer = null;
    }
    overlay.classList.remove('open', 'loading', 'ready');
    overlay.classList.add('closing');
    embedOverlayCloseTimer = window.setTimeout(() => {
      overlay.classList.remove('closing');
      if (frame) frame.src = '';
      delete overlay.dataset.action;
      embedOverlayCloseTimer = null;
    }, EMBED_OVERLAY_MS);
  }

  async function handleEmbedMessage(event) {
    if (event.origin !== window.location.origin) return;
    if (!event.data || event.data.source !== 'acuse-embed') return;

    if (event.data.type === 'close') {
      closeAcuseEmbed();
      return;
    }

    if (event.data.type === 'ready') {
      const overlay = document.getElementById('acuseEmbedOverlay');
      overlay?.classList.remove('loading');
      overlay?.classList.add('ready');
      return;
    }

    if (event.data.type === 'error') {
      const overlay = document.getElementById('acuseEmbedOverlay');
      overlay?.classList.remove('loading');
      overlay?.classList.add('ready');
      notify(event.data.message || 'No se pudo completar la accion embebida.', 'error');
      return;
    }

    if (event.data.type === 'toast') {
      notify(event.data.message || '', normalizeToastType(event.data.toastType));
      return;
    }

    if (event.data.type === 'completed') {
      closeAcuseEmbed();
      const completedId = Number(event.data.id || 0) || null;
      const completedAction = String(event.data.action || '').trim().toLowerCase();
      const completionToastMessage = String(event.data.toastMessage || '').trim();
      const completionToastType = normalizeToastType(
        event.data.toastType
          || (completedAction === 'annul' ? 'annul' : completedAction === 'create' || completedAction === 'edit' ? 'complete' : 'success')
      );

      if (completedAction === 'create' && completedId) {
        state.activeKPI = 'acuses';
        state.currentPage.acuses = 1;
        syncActiveKpiCards();
        syncDashboardChrome();
        syncSidebarActiveState();
      } else if (completedAction === 'annul' && completedId) {
        state.activeKPI = 'anulados';
        state.currentPage.anulados = 1;
        syncActiveKpiCards();
        syncDashboardChrome();
        syncSidebarActiveState();
        setDashboardSelectedAcuse(completedId, {
          highlight: true,
          focus: false,
          delay: 90,
          clearHighlight: false
        });
      } else if (completedAction === 'print' && completedId) {
        state.activeKPI = 'en_transito';
        state.currentPage.en_transito = 1;
        syncActiveKpiCards();
        syncDashboardChrome();
        syncSidebarActiveState();
        setDashboardSelectedAcuse(completedId, {
          highlight: true,
          focus: false,
          delay: 90,
          clearHighlight: false
        });
      } else if (completedAction === 'delete' && completedId && completedId === state.selectedAcuseId) {
        setDashboardSelectedAcuse(null);
      } else if (completedId) {
        setDashboardSelectedAcuse(completedId, { clearHighlight: false });
      }

      if (completionToastMessage) {
        notify(completionToastMessage, completionToastType);
      }

      try {
        await refreshDashboardData({ softPanel: true });
        if ((completedAction === 'create' || completedAction === 'edit') && completedId) {
          destacarFilaGuardada(completedId);
        }
      } catch (error) {
        notify(error.message || 'Se guardo el acuse, pero no se pudo refrescar el dashboard completo.', 'warning');
      }
    }
  }

  async function markAcuseDelivered(id, button) {
    const usuario = resolveCurrentOperator();
    if (!usuario) {
      notify('Debés iniciar sesión para marcar un acuse como entregado.', 'warning');
      return;
    }
    setDashboardSelectedAcuse(id, { clearHighlight: false });

    try {
      await runButtonLoading(button, async () => {
        await AcuseAPI.patch(`/api/acuses/${id}/estado`, {
          Estado: 'Entregado',
          Fecha_Entrega: currentDateTimeValue(),
          Usuario: usuario,
          Observacion: 'Cambio a entregado desde dashboard Acuses'
        });

        await refreshDashboardData({ softPanel: true });

        notify('Acuse marcado como entregado.', 'success');
      });
    } catch (error) {
      notify(error.message, 'error');
    }
  }

  function openExportConfirm(button) {
    ensureRuntimeChrome();
    pendingExportButton = button || document.querySelector('#contentPanel .btn-exportar');
    const overlay = document.getElementById('exportConfirmOverlay');
    if (overlay) overlay.classList.add('open');
  }

  function closeExportConfirm() {
    const overlay = document.getElementById('exportConfirmOverlay');
    if (overlay) overlay.classList.remove('open');
  }

  function cancelExportPanel() {
    pendingExportButton = null;
    closeExportConfirm();
  }

  async function confirmExportPanel() {
    const button = pendingExportButton || document.querySelector('#contentPanel .btn-exportar');
    pendingExportButton = null;
    closeExportConfirm();
    await exportCurrentPanel(button, { confirmed: true });
  }

  async function exportCurrentPanel(button, options = {}) {
    if (!options.confirmed) {
      openExportConfirm(button);
      return;
    }

    try {
      await runButtonLoading(button || document.querySelector('#contentPanel .btn-exportar'), async () => {
        const rows = await fetchAllCurrentPanelRows();
        if (!rows.length) {
          notify('No hay datos para exportar con los filtros actuales.', 'warning');
          return;
        }

        const exportRows = state.activeKPI === 'repartidores'
          ? rows
          : await fetchDetailedAcusesForExport(rows);
        const csv = buildExportCsv(exportRows, state.activeKPI);
        downloadCsv(csv, acuseExportFilename(currentExportDate()));
        notify(state.activeKPI === 'repartidores' ? 'Exportacion generada.' : 'Exportacion completa generada.', 'success');
      });
    } catch (error) {
      notify(error.message, 'error');
    }
  }

  async function fetchAllCurrentPanelRows() {
    const exportKpi = normalizeDashboardKpi(state.activeKPI, { allowRepartidores: true, fallback: 'acuses' });
    const params = buildPanelParams(exportKpi);
    const response = await fetchPanelResponse(exportKpi, params);
    return response.items || [];
  }

  async function fetchDetailedAcusesForExport(rows) {
    const detailed = [];
    const batchSize = 6;

    for (let index = 0; index < rows.length; index += batchSize) {
      const batch = rows.slice(index, index + batchSize);
      const resolved = await Promise.all(batch.map(async (row) => {
        const id = row.ID_Acuse || row.id;
        if (!id) return row;
        try {
          return await AcuseAPI.get(`/api/acuses/${id}`);
        } catch (error) {
          return row;
        }
      }));
      detailed.push(...resolved);
    }

    return detailed;
  }

  function buildExportCsv(rows, kpi) {
    if (kpi === 'repartidores') {
      const headers = [['Repartidor', 'Zona', 'Entregas', 'Pendientes', 'Acuses', 'Eficiencia']];
      const data = rows.map((row) => [
        row.Nombre_Repartidor || '',
        row.zona || '',
        row.entregas || 0,
        row.pendientes || 0,
        row.acuses || 0,
        `${row.eficiencia || 0}%`
      ]);
      return csvFromRows(headers.concat(data));
    }

    return buildDetailedAcusesCsv(rows);
  }

  function buildDetailedAcusesCsv(rows) {
    const output = [[
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

    rows.forEach((row) => {
      const detalles = Array.isArray(row.detalles) && row.detalles.length ? row.detalles : [null];
      const ultimoEstado = Array.isArray(row.historial) && row.historial.length ? row.historial[0] : null;
      const ultimaAccion = Array.isArray(row.acciones) && row.acciones.length ? row.acciones[0] : null;
      const totalUnidades = row.Detalle_Cantidad_Total
        ? detalles.reduce((total, item) => total + Number(item?.Cantidad || 0), 0)
        : Number(row.Detalle_Cantidad_Total || 0);

      detalles.forEach((detalle, index) => {
        output.push([
          row.Nro_Acuse || row.ID_Acuse || '',
          row.ID_Acuse || '',
          formatDate(row.Fecha_Emision),
          formatDateTime(row.Fecha_Entrega),
          formatDateTime(row.Fecha_Creacion),
          formatEstado(row.Estado),
          row.Usuario_Creacion || '',
          row.Cod_Cliente || '',
          row.Nom_Cliente || '',
          row.Ruc_Cliente || '',
          row.Telefono_Cliente || row.Telef_Cliente || row.TelF_Cliente || '',
          row.Direc_Cliente || '',
          row.Ciudad_Cliente || '',
          row.Zona || row.Zona_Cliente || '',
          row.ID_Repartidor || '',
          row.Codigo_Repartidor || '',
          row.Nombre_Repartidor || '',
          row.Observacion || '',
          row.Detalle_Items ? detalles.filter(Boolean).length : 0,
          formatNumber(totalUnidades),
          detalle ? index + 1 : '',
          detalle?.Cod_Mercaderia || '',
          detalle?.Descr_SAP || '',
          detalle ? formatNumber(detalle.Cantidad) : '',
          detalle?.UM || '',
          detalle?.Nota || '',
          detalle?.Status_SAP || '',
          detalle?.Jerarquia_SAP || '',
          ultimoEstado?.Estado || '',
          formatDateTime(ultimoEstado?.Fecha),
          ultimoEstado?.Usuario || '',
          ultimaAccion?.Accion || '',
          formatDateTime(ultimaAccion?.FechaHora),
          ultimaAccion?.Usuario || '',
          ultimaAccion?.Observacion || ''
        ]);
      });
    });

    return csvFromRows(output);
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

  function currentExportDate() {
    return currentDateTimeValue().slice(0, 10);
  }

  async function showView(view) {
    const previousView = state.currentView;
    if (previousView === 'calendario' && view !== 'calendario') {
      resetCalendarSelection(false);
    }

    state.currentView = view;
    saveDashboardState();

    ['viewResumen', 'viewDashboard', 'viewCalendario', 'viewHistorial'].forEach((id) => {
      const node = document.getElementById(id);
      if (node) node.style.display = 'none';
    });

    const canvas = document.querySelector('.canvas');
    if (canvas) canvas.classList.toggle('no-scroll', view === 'dashboard');

    if (view === 'resumen') {
      const node = document.getElementById('viewResumen');
      node.style.display = 'flex';
      syncSidebarActiveState();
      playViewEntrance(node);
      renderSummaryCardsEnhanced();
      renderChartsEnhanced();
      return;
    }

    if (view === 'dashboard') {
      const node = document.getElementById('viewDashboard');
      node.style.display = 'flex';
      syncSidebarActiveState();
      syncDashboardChrome();
      playViewEntrance(node);
      return;
    }

    if (view === 'calendario') {
      const node = document.getElementById('viewCalendario');
      node.style.display = 'block';
      syncSidebarActiveState();
      playViewEntrance(node);
      await loadCalendarMonth();
      if (state.calendar.selectedDate) {
        await loadCalendarDayDetail(state.calendar.selectedDate);
      } else {
        renderEmptyCalendarDetail();
      }
      return;
    }

    if (view === 'historial') {
      const node = document.getElementById('viewHistorial');
      node.style.display = 'block';
      syncSidebarActiveState();
      playViewEntrance(node);
      await loadHistorial();
    }
  }

  async function loadCalendarMonth() {
    syncCalendarScopeButton();
    state.calendar.monthResponse = await AcuseAPI.get('/api/dashboard/interactivo/calendar', buildCalendarParams());
    applyCalendarPeriod(state.calendar.monthResponse);
    if (!isCalendarDateVisible(state.calendar.selectedDate)) {
      resetCalendarSelection(false);
    }
    renderCalendar();
  }

  function changeMonth(direction) {
    if (state.calendar.scope === 'week') {
      setPeriodAnchor(state.calendar, toIsoDate(addDays(parseIsoDate(state.calendar.anchorDate), direction * 7)));
    } else {
      setPeriodAnchor(state.calendar, shiftIsoMonth(state.calendar.anchorDate, direction));
    }
    resetCalendarSelection(false);
    loadCalendarMonth().then(() => renderEmptyCalendarDetail()).catch(handleError);
  }

  function goToday() {
    const today = currentDateValue();
    setPeriodAnchor(state.calendar, today);
    resetCalendarSelection(false);
    loadCalendarMonth().then(() => activateCalendarDate(today)).catch(handleError);
  }

  function toggleCalendarScope() {
    const nextScope = state.calendar.scope === 'week' ? 'month' : 'week';
    if (nextScope === 'week' && state.calendar.selectedDate) {
      setPeriodAnchor(state.calendar, state.calendar.selectedDate);
    }
    state.calendar.scope = nextScope;
    resetCalendarSelection(false);
    syncCalendarScopeButton();
    loadCalendarMonth().then(() => renderEmptyCalendarDetail()).catch(handleError);
  }

  function renderEmptyCalendarDetail(date) {
    const detail = document.getElementById('calDayDetail');
    if (!detail) return;

    if (!date) {
      detail.innerHTML = `
        <div class="cal-detail-panel">
          <div class="cal-empty">
            <div class="cal-empty-icon">
              <svg width="24" height="24" fill="none" stroke="var(--gray-300)" stroke-width="1.5" viewBox="0 0 24 24"><path d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5"/></svg>
            </div>
            <p>Selecciona un dia para ver los acuses</p>
            <p class="cal-empty-hint">Los dias marcados se calculan desde tu base de datos real</p>
          </div>
        </div>`;
      return;
    }

    detail.innerHTML = `
      <div class="cal-detail-panel">
        <div class="cal-empty">
          <div class="cal-empty-icon">
            <svg width="24" height="24" fill="none" stroke="var(--gray-300)" stroke-width="1.5" viewBox="0 0 24 24"><path d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
          </div>
          <p>Sin acuses para el ${formatLongDay(date)}</p>
          <p class="cal-empty-hint">Este dia no tiene acuses registrados</p>
        </div>
      </div>`;
  }

  function renderCalendar() {
    const response = state.calendar.monthResponse || { days: [] };
    const dayMap = new Map((response.days || []).map((item) => [item.fecha, item]));
    const label = document.getElementById('calMonthLabel');
    const grid = document.getElementById('calendarGrid');
    if (!label || !grid) return;

    let html = '';
    syncCalendarLayout();
    label.textContent = state.calendar.scope === 'week'
      ? formatWeekRangeLabel(response.start, response.end)
      : formatMonthPeriodLabel(state.calendar.year, state.calendar.month);
    syncCalendarScopeButton();

    if (state.calendar.scope === 'week') {
      const visibleDates = buildDateRange(response.start, response.end);
      visibleDates.forEach((date) => {
        html += `<div class="cal-header-cell">${escapeHtml(formatCalendarWeekday(date))}</div>`;
      });

      visibleDates.forEach((date) => {
        html += renderCalendarDayCell(date, dayMap.get(date));
      });
      grid.innerHTML = html;
      return;
    }

    DIAS_ES.forEach((dia) => {
      html += `<div class="cal-header-cell">${dia}</div>`;
    });

    const firstDay = new Date(state.calendar.year, state.calendar.month - 1, 1).getDay();
    const daysInMonth = new Date(state.calendar.year, state.calendar.month, 0).getDate();

    for (let index = 0; index < firstDay; index += 1) {
      html += '<div class="cal-day empty"></div>';
    }

    for (let day = 1; day <= daysInMonth; day += 1) {
      const date = buildCalendarDate(day);
      html += renderCalendarDayCell(date, dayMap.get(date), { useDayNumberOnly: true });
    }

    grid.innerHTML = html;
  }

  async function selectCalDay(day) {
    await selectCalDate(buildCalendarDate(day));
  }

  async function selectCalDate(date) {
    if (state.calendar.selectedDate === date) {
      resetCalendarSelection();
      renderCalendar();
      return;
    }

    await activateCalendarDate(date);
  }

  async function activateCalendarDate(date) {
    state.calendar.selectedDate = date;
    state.calendar.dayResponse = null;
    renderCalendar();
    await loadCalendarDayDetail(date);
  }

  async function loadCalendarDayDetail(date) {
    const detail = document.getElementById('calDayDetail');
    if (!detail) return;
    const requestId = state.calendar.detailRequestId + 1;
    state.calendar.detailRequestId = requestId;

    detail.innerHTML = `
      <div class="cal-detail-panel">
        <div class="cal-empty">
          <div class="cal-empty-icon">
            <svg width="24" height="24" fill="none" stroke="var(--gray-300)" stroke-width="1.5" viewBox="0 0 24 24"><path d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"/></svg>
          </div>
          <p>Cargando acuses del dia...</p>
        </div>
      </div>`;

    try {
      const response = await AcuseAPI.get('/api/dashboard/interactivo/panel/acuses', {
        fecha: date,
        limit: 500,
        offset: 0
      });

      if (
        requestId !== state.calendar.detailRequestId ||
        state.calendar.selectedDate === null ||
        state.calendar.selectedDate !== date
      ) {
        return;
      }

      state.calendar.dayResponse = response;

      const items = state.calendar.dayResponse.items || [];
      if (!items.length) {
        renderEmptyCalendarDetail(date);
        return;
      }

      detail.innerHTML = `
        <div class="cal-detail-panel">
          <div class="cal-detail-header">
            <div class="cal-detail-title"><span class="dot"></span> Acuses del ${formatLongDay(date)}</div>
            <div class="panel-badge" style="background:var(--purple-soft);color:#6D28D9">${formatNumber(items.length)} acuse${items.length === 1 ? '' : 's'}</div>
          </div>
          <div class="table-wrapper"><table>
            <thead><tr><th>Guia</th><th>Cliente</th><th>Destino</th><th>Receptor</th><th>Hora</th><th>Estado</th></tr></thead>
            <tbody>${items.map((item) => `<tr>
              <td><span class="guide-code">${escapeHtml(item.Nro_Acuse || `#${item.ID_Acuse}`)}</span></td>
              <td>${escapeHtml(item.Nom_Cliente || item.Cod_Cliente || 'Sin cliente')}</td>
              <td>${escapeHtml(item.Zona || item.Ciudad_Cliente || item.Zona_Cliente || 'Sin zona')}</td>
              <td>${escapeHtml(item.Observacion || item.Nombre_Repartidor || '--')}</td>
              <td><span class="status-badge status-acuse">${escapeHtml(extractTime(item.Fecha_Entrega || item.Fecha_Emision))}</span></td>
              <td>${renderStatusBadge(item.Estado)}</td>
            </tr>`).join('')}</tbody>
          </table></div>
        </div>`;

      detail.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (error) {
      if (
        requestId !== state.calendar.detailRequestId ||
        state.calendar.selectedDate === null ||
        state.calendar.selectedDate !== date
      ) {
        return;
      }

      detail.innerHTML = `
        <div class="cal-detail-panel">
          <div class="cal-empty">
            <div class="cal-empty-icon">
              <svg width="24" height="24" fill="none" stroke="var(--gray-300)" stroke-width="1.5" viewBox="0 0 24 24"><path d="M12 8v4m0 4h.01M10.29 3.86l-7 12.124A1 1 0 004.16 17h15.68a1 1 0 00.87-1.516l-7-12.124a1 1 0 00-1.74 0z"/></svg>
            </div>
            <p>No se pudo cargar el detalle del calendario.</p>
          </div>
        </div>`;
      notify(error.message, 'error');
    }
  }

  function resetCalendarSelection(resetDetail = true) {
    state.calendar.selectedDate = null;
    state.calendar.dayResponse = null;
    state.calendar.detailRequestId += 1;

    if (resetDetail) {
      renderEmptyCalendarDetail();
    }
  }

  async function loadHistorial() {
    const items = [];
    let offset = 0;
    let total = 0;
    let iterations = 0;
    const maxIterations = Math.ceil(HISTORY_MAX_ROWS / HISTORY_BATCH_SIZE) + 2;

    do {
      if (++iterations > maxIterations) break;

      const params = {
        limit: HISTORY_BATCH_SIZE,
        offset
      };

      if (state.history.filters.fecha) params.fecha = state.history.filters.fecha;
      if (state.history.filters.usuario) params.usuario = state.history.filters.usuario;
      if (state.history.filters.cliente) params.cliente = state.history.filters.cliente;

      const response = await AcuseAPI.get('/api/auditoria', params);
      const batch = Array.isArray(response.items) ? response.items : [];
      total = Number(response.total || 0);
      items.push(...batch);
      offset += batch.length;

      if (!batch.length) break;
    } while (offset < total && items.length < HISTORY_MAX_ROWS);

    state.history.response = {
      total,
      items: items.slice(0, HISTORY_MAX_ROWS)
    };
    state.history.suggestions.usuario = uniqueValues(state.history.response.items || [], 'Usuario');
    state.history.suggestions.cliente = uniqueValues(state.history.response.items || [], 'Cliente');
    renderHistorial();
  }

  function renderHistorial() {
    const list = document.getElementById('histList');
    const pagination = document.getElementById('histPagination');
    if (!list || !pagination) return;

    const items = state.history.response && Array.isArray(state.history.response.items)
      ? state.history.response.items
      : [];

    if (!items.length) {
      list.innerHTML = '<div style="text-align:center;padding:30px;color:var(--gray-400);font-size:13px">Sin resultados para este filtro</div>';
    } else {
      list.innerHTML = items.map((item) => renderHistoryItem(item)).join('');
    }

    renderHistoryTriggerState();
    pagination.innerHTML = '';
  }

  function renderHistoryItem(item) {
    const type = mapHistoryType(item);
    const city = escapeHtml(item.Ciudad || item.Zona || item.Ciudad_Cliente || item.Zona_Cliente || 'CIUDAD');
    const meta = `${formatDateTime(item.Fecha)} · PARA LA CIUDAD ${city}`;

    return `<div class="hist-item">
      <div class="hist-dot-col"><div class="hist-dot ${historyClass(type)}">${historyIcon(type)}</div></div>
      <div class="hist-body">
        <div class="hist-text">${historyText(type, item)}</div>
        <div class="hist-meta">${meta}</div>
      </div>
    </div>`;
  }

  function mapHistoryType(item) {
    const text = `${item.Tipo || ''} ${item.Accion || ''}`.toLowerCase();
    if (text.includes('impres')) return 'impreso';
    if (text.includes('crear')) return 'creado';
    if (text.includes('edit')) return 'editado';
    if (text.includes('elim') || text.includes('anular')) return 'eliminado';
    if (text.includes('estado') || text.includes('entregado')) return 'entregado';
    return 'editado';
  }

  function historyIcon(type) {
    if (type === 'creado') return '<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 4v16m8-8H4"/></svg>';
    if (type === 'eliminado') return '<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>';
    if (type === 'impreso') return '<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"/></svg>';
    if (type === 'entregado') return '<svg fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg>';
    return '<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>';
  }

  function historyClass(type) {
    if (type === 'creado') return 'h-create';
    if (type === 'eliminado') return 'h-delete';
    if (type === 'impreso') return 'h-print';
    if (type === 'entregado') return 'h-deliver';
    return 'h-edit';
  }

  function historyText(type, item) {
    const user = escapeHtml(item.Usuario || 'Sistema');
    const client = escapeHtml(item.Cliente || 'Sin cliente');
    const acuse = escapeHtml(item.Nro_Acuse || `#${item.ID_Acuse || '--'}`);

    if (type === 'creado') return `<strong>${user}</strong> creo nuevo acuse <strong>${acuse}</strong> para el cliente <strong>${client}</strong>`;
    if (type === 'eliminado') return `<strong>${user}</strong> elimino el acuse <strong>${acuse}</strong> del cliente <strong>${client}</strong>`;
    if (type === 'impreso') return `<strong>${user}</strong> imprimio el acuse <strong>${acuse}</strong> del cliente <strong>${client}</strong>`;
    if (type === 'entregado') return `<strong>${user}</strong> marco como entregado el acuse <strong>${acuse}</strong> del cliente <strong>${client}</strong>`;
    return `<strong>${user}</strong> edito el acuse <strong>${acuse}</strong> del cliente <strong>${client}</strong>`;
  }

  function renderHistoryTriggerState() {
    const mappings = [
      ['usuario', 'filter-hist-user', 'Filtrar usuario...'],
      ['cliente', 'filter-hist-client', 'Filtrar cliente...']
    ];

    mappings.forEach(([type, id, placeholder]) => {
      const wrap = document.getElementById(id);
      if (!wrap) return;
      const trigger = wrap.querySelector('.filter-trigger');
      const valueNode = wrap.querySelector('.f-val');
      if (state.history.filters[type]) {
        trigger?.classList.add('has-val');
        if (valueNode) valueNode.textContent = state.history.filters[type];
      } else {
        trigger?.classList.remove('has-val');
        if (valueNode) valueNode.textContent = placeholder;
      }
    });

    syncDatePicker('histDateInput', state.history.filters.fecha);
  }


  function toggleHistFilter(filterId, type) {
    const wrap = document.getElementById(filterId);
    const dropdown = document.getElementById(`${filterId}-dd`);
    const trigger = wrap ? wrap.querySelector('.filter-trigger') : null;
    if (!wrap || !dropdown || !trigger) return;

    const shouldOpen = state.history.openFilter !== type;
    closeHistoryFilters();
    if (!shouldOpen) return;

    state.history.openFilter = type;
    dropdown.classList.add('open');
    trigger.classList.add('open');
    renderHistFilterItems(type, '');
    window.setTimeout(() => dropdown.querySelector('input')?.focus(), 40);
  }

  function renderHistFilterItems(type, query) {
    const listId = `filter-hist-${type === 'usuario' ? 'user' : 'client'}-list`;
    const list = document.getElementById(listId);
    if (!list) return;

    const source = state.history.suggestions[type] || [];
    const needle = String(query || '').trim().toLowerCase();
    const filtered = source.filter((value) => !needle || String(value).toLowerCase().includes(needle));

    if (!filtered.length && !needle) {
      list.innerHTML = '<div class="filter-empty">Sin resultados</div>';
      return;
    }

    const rows = filtered.slice(0, 12).map((value, index) => (
      `<div class="filter-item ${value === state.history.filters[type] ? 'sel' : ''}" style="animation-delay:${Math.min(index * 0.025, 0.18)}s" onmousedown="event.preventDefault();pickHistFilter('${type}','${escapeInlineJs(String(value))}')">
        <div class="fi-dot"></div>
        <div class="fi-row"><span class="fi-name">${escapeHtml(String(value))}</span></div>
        <svg class="fi-check" viewBox="0 0 20 20" fill="none"><path d="M4.5 10.5l3.2 3.2L15.5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </div>`
    ));

    if (needle) {
      rows.unshift(`<div class="filter-item" onmousedown="event.preventDefault();pickHistFilter('${type}','${escapeInlineJs(query)}')">
        <div class="fi-dot"></div>
        <div class="fi-row"><span class="fi-name">Usar "${escapeHtml(query)}"</span></div>
        <svg class="fi-check" viewBox="0 0 20 20" fill="none"><path d="M4.5 10.5l3.2 3.2L15.5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </div>`);
    }

    list.innerHTML = rows.join('');
  }

  async function pickHistFilter(type, value) {
    state.history.filters[type] = value;
    state.history.page = 1;
    closeHistoryFilters();
    await loadHistorial();
  }

  async function clearHistFilter(type) {
    state.history.filters[type] = '';
    state.history.page = 1;
    closeHistoryFilters();
    await loadHistorial();
  }

  async function clearHistoryFiltersAll(button) {
    await runButtonLoading(button, async () => {
      state.history.filters.fecha = '';
      state.history.filters.usuario = '';
      state.history.filters.cliente = '';
      state.history.page = 1;
      closeHistoryFilters();
      renderHistoryTriggerState();
      await loadHistorial();
    });
  }

  async function pickHistDateFilter(isoValue) {
    state.history.filters.fecha = isoValue || '';
    state.history.page = 1;
    await loadHistorial();
  }

  async function clearCurrentPanelFilters(button) {
    await runButtonLoading(button, async () => {
      state.panelFilters.fecha = '';
      state.panelFilters.clienteCode = '';
      state.panelFilters.clienteLabel = '';
      state.panelFilters.repartidorId = '';
      state.panelFilters.repartidorLabel = '';
      state.panelFilterQuery.cliente = '';
      state.panelFilterQuery.repartidor = '';
      closePanelFilter();
      resetPanelPages();
      await loadPanel(state.activeKPI, { soft: true });
    });
  }

  function closeHistoryFilters() {
    document.querySelectorAll('#viewHistorial .filter-dd.open').forEach((node) => node.classList.remove('open'));
    document.querySelectorAll('#viewHistorial .filter-trigger.open').forEach((node) => node.classList.remove('open'));
    state.history.openFilter = null;
  }

  function resolveCurrentOperator() {
    const sessionUser = String(window.AlasSession?.getCurrentUser?.() || window.AlasSession?.defaultUser || '').trim();
    if (sessionUser) return sessionUser;

    try {
      return String(window.localStorage.getItem(STORAGE_USER_KEY) || 'Operador General').trim();
    } catch (error) {
      return 'Operador General';
    }
  }

  let _audioCtx = null;

  function getAudioCtx() {
    if (!_audioCtx) {
      try {
        _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      } catch (_) { /* audio no disponible */ }
    }
    return _audioCtx;
  }

  function playTone(ctx, freq, startAt, duration, peak = 0.28) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, startAt);
    gain.gain.setValueAtTime(0, startAt);
    gain.gain.linearRampToValueAtTime(peak, startAt + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.001, startAt + duration);
    osc.start(startAt);
    osc.stop(startAt + duration + 0.02);
  }

  function playNotificationSound(type) {
    try {
      const ctx = getAudioCtx();
      if (!ctx) return;
      if (ctx.state === 'suspended') ctx.resume();
      const t = ctx.currentTime;

      if (type === 'success' || type === 'complete') {
        playTone(ctx, 660, t,        0.13, 0.22);
        playTone(ctx, 880, t + 0.11, 0.20, 0.18);
      } else if (type === 'error') {
        playTone(ctx, 320, t,        0.14, 0.28);
        playTone(ctx, 220, t + 0.12, 0.22, 0.22);
      } else if (type === 'warning') {
        playTone(ctx, 520, t,        0.09, 0.24);
        playTone(ctx, 520, t + 0.13, 0.14, 0.18);
      } else if (type === 'annul') {
        playTone(ctx, 440, t,        0.11, 0.20);
        playTone(ctx, 330, t + 0.09, 0.22, 0.16);
      } else {
        playTone(ctx, 660, t, 0.10, 0.16);
      }
    } catch (_) { /* fallo de audio no es fatal */ }
  }

  function notify(message, type) {
    const wrap = document.getElementById('dashToastWrap');
    if (!wrap) return;

    const normalizedType = normalizeToastType(type);
    playNotificationSound(normalizedType);

    const toast = document.createElement('div');
    toast.className = `dash-toast ${normalizedType}`;
    toast.innerHTML = `
      <span class="dash-toast__icon" aria-hidden="true">${toastIconSvg(normalizedType)}</span>
      <span class="dash-toast__text">${escapeHtml(message)}</span>
    `;
    wrap.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('show'));
    window.setTimeout(() => {
      toast.classList.remove('show');
      toast.classList.add('hide');
      window.setTimeout(() => toast.remove(), 260);
    }, 2200);
  }

  function toastIconSvg(type) {
    const paths = {
      success: '<path d="M5 12.5l4 4L19 7"/>',
      complete: '<path d="M5 12.5l4 4L19 7"/>',
      annul: '<path d="M9 4.75h6" stroke-linecap="round"/><path d="M7.75 7.5h8.5" stroke-linecap="round"/><path d="M9 10.25v6.5" stroke-linecap="round"/><path d="M12 10.25v6.5" stroke-linecap="round"/><path d="M15 10.25v6.5" stroke-linecap="round"/><path d="M8.75 19.25h6.5a1.5 1.5 0 001.49-1.325l.95-8.925h-11.88l.95 8.925a1.5 1.5 0 001.49 1.325z" stroke-linejoin="round" stroke-linecap="round"/>',
      error: '<path d="M7 7l10 10"/><path d="M17 7L7 17"/>',
      warning: '<path d="M12 7v6"/><path d="M12 17h.01"/>',
      info: '<path d="M12 11v6"/><path d="M12 7h.01"/>'
    };

    return `<svg class="dash-toast__icon-svg" viewBox="0 0 24 24" aria-hidden="true">${paths[type] || paths.info}</svg>`;
  }

  function normalizeToastType(type) {
    const normalized = String(type || '').trim().toLowerCase();
    return ['success', 'complete', 'annul', 'error', 'warning', 'info'].includes(normalized)
      ? normalized
      : 'success';
  }

  function handleError(error) {
    notify(error.message || String(error), 'error');
  }

  function setButtonLoading(button, isLoading) {
    if (!button) return;
    button.classList.toggle('btn-loading', Boolean(isLoading));
    button.setAttribute('aria-busy', isLoading ? 'true' : 'false');
    if ('disabled' in button) {
      button.disabled = Boolean(isLoading);
    } else if (isLoading) {
      button.setAttribute('aria-disabled', 'true');
    } else {
      button.removeAttribute('aria-disabled');
    }
  }

  async function runButtonLoading(button, action, minimumMs = BUTTON_LOADING_MS) {
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

  function nextPaint() {
    return new Promise((resolve) => {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(resolve);
      });
    });
  }

  function wait(ms) {
    return new Promise((resolve) => {
      window.setTimeout(resolve, ms);
    });
  }

  function playViewEntrance(node) {
    if (!node) return;
    node.classList.remove('view-enter');
    void node.offsetWidth;
    node.classList.add('view-enter');
    window.setTimeout(() => node.classList.remove('view-enter'), 420);
  }

  function resetPanelPages() {
    Object.keys(state.currentPage).forEach((key) => {
      state.currentPage[key] = 1;
    });
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

  function formatEstado(estado) {
    const key = normalizeEstadoValue(estado);
    if (key === 'anulado') return 'Anulado';
    if (key === 'en_transito') return 'En Tránsito';
    if (key === 'entregado') return 'Entregado';
    return 'Pendiente';
  }

  function estadoClass(estado) {
    const key = normalizeEstadoValue(estado);
    if (key === 'anulado') return 'status-cancelled';
    if (key === 'entregado') return 'status-delivered';
    if (key === 'en_transito') return 'status-transit';
    return 'status-pending';
  }

  function renderStatusBadge(estado) {
    const key = normalizeEstadoValue(estado);
    const label = escapeHtml(formatEstado(estado));
    const indicator = key === 'entregado'
      ? '<svg class="status-badge__check" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M4.5 10.5l3.2 3.2L15.5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>'
      : '<span class="status-badge__dot" aria-hidden="true"></span>';
    return `<span class="status-badge ${estadoClass(estado)}">${indicator}<span class="status-badge__text">${label}</span></span>`;
  }

  function formatDate(value) {
    if (!value) return '--';
    const text = String(value).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return String(value);
    const parts = text.split('-');
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }

  function formatDateTime(value) {
    if (!value) return '--';
    const text = String(value).replace('T', ' ').slice(0, 19);
    const [datePart, timePart = ''] = text.split(' ');
    return `${formatDate(datePart)}${timePart ? ` ${timePart.slice(0, 5)}` : ''}`;
  }

  function formatLongDay(value) {
    const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
    return date.toLocaleDateString('es-PY', {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    });
  }

  function extractTime(value) {
    const text = String(value || '');
    const match = text.match(/(\d{2}:\d{2})/);
    return match ? match[1] : '--';
  }

  function currentDateValue() {
    return toIsoDate(new Date());
  }

  function currentDateTimeValue() {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hour = String(date.getHours()).padStart(2, '0');
    const minute = String(date.getMinutes()).padStart(2, '0');
    const second = String(date.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
  }

  function parseIsoDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))) return null;
    return new Date(`${value}T00:00:00`);
  }

  function toIsoDate(value) {
    const date = value instanceof Date ? value : parseIsoDate(value);
    if (!date || Number.isNaN(date.getTime())) return '';
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function addDays(date, days) {
    const value = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    value.setDate(value.getDate() + days);
    return value;
  }

  function shiftIsoMonth(value, direction) {
    const date = parseIsoDate(value) || parseIsoDate(currentDateValue());
    const day = date.getDate();
    const target = new Date(date.getFullYear(), date.getMonth() + direction, 1);
    const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
    target.setDate(Math.min(day, lastDay));
    return toIsoDate(target);
  }

  function startOfWeekDate(date) {
    const value = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const offset = (value.getDay() + 6) % 7;
    value.setDate(value.getDate() - offset);
    return value;
  }

  function endOfWeekDate(date) {
    return addDays(startOfWeekDate(date), 6);
  }

  function weekRangeFromAnchor(anchorDate) {
    const anchor = parseIsoDate(anchorDate) || parseIsoDate(currentDateValue());
    return [toIsoDate(startOfWeekDate(anchor)), toIsoDate(endOfWeekDate(anchor))];
  }

  function buildSummaryParams() {
    if (state.summaryPeriod.scope === 'all') {
      return {
        scope: 'all',
        anchor: state.summaryPeriod.anchorDate
      };
    }

    if (state.summaryPeriod.scope === 'week') {
      const [start, end] = weekRangeFromAnchor(state.summaryPeriod.anchorDate);
      return {
        scope: 'week',
        anchor: state.summaryPeriod.anchorDate,
        start,
        end
      };
    }

    return {
      year: state.summaryPeriod.year,
      month: state.summaryPeriod.month
    };
  }

  function buildPreviousSummaryParams() {
    if (state.summaryPeriod.scope === 'all') return null;

    if (state.summaryPeriod.scope === 'week') {
      const previousAnchor = toIsoDate(addDays(parseIsoDate(state.summaryPeriod.anchorDate), -7));
      const [start, end] = weekRangeFromAnchor(previousAnchor);
      return {
        scope: 'week',
        anchor: previousAnchor,
        start,
        end
      };
    }

    const previousAnchor = shiftIsoMonth(state.summaryPeriod.anchorDate, -1);
    const date = parseIsoDate(previousAnchor);
    return {
      year: date.getFullYear(),
      month: date.getMonth() + 1
    };
  }

  function buildCalendarParams() {
    if (state.calendar.scope === 'week') {
      const [start, end] = weekRangeFromAnchor(state.calendar.anchorDate);
      return {
        scope: 'week',
        anchor: state.calendar.anchorDate,
        start,
        end
      };
    }

    return {
      year: state.calendar.year,
      month: state.calendar.month
    };
  }

  function applySummaryPeriod(periodo) {
    if (!periodo) return;
    const scope = periodo.scope === 'week'
      ? 'week'
      : periodo.scope === 'all'
        ? 'all'
        : 'month';
    state.summaryPeriod.scope = scope;
    if (scope === 'week') {
      setPeriodAnchor(state.summaryPeriod, periodo.anchor || state.summaryPeriod.anchorDate || TODAY_ISO);
      return;
    }
    if (scope === 'all') {
      setPeriodAnchor(state.summaryPeriod, periodo.end || periodo.anchor || state.summaryPeriod.anchorDate || TODAY_ISO);
      return;
    }
    setPeriodMonth(state.summaryPeriod, periodo.year, periodo.month);
  }

  function applyCalendarPeriod(periodo) {
    if (!periodo) return;
    const scope = periodo.scope === 'week' ? 'week' : 'month';
    state.calendar.scope = scope;
    if (scope === 'week') {
      setPeriodAnchor(state.calendar, periodo.anchor || state.calendar.anchorDate || TODAY_ISO);
      return;
    }
    setPeriodMonth(state.calendar, periodo.year, periodo.month);
  }

  function setPeriodAnchor(target, value) {
    const isoDate = toIsoDate(value) || TODAY_ISO;
    const date = parseIsoDate(isoDate);
    target.anchorDate = isoDate;
    target.year = date.getFullYear();
    target.month = date.getMonth() + 1;
  }

  function setPeriodMonth(target, year, month) {
    const anchor = parseIsoDate(target.anchorDate) || parseIsoDate(TODAY_ISO);
    const day = anchor.getDate();
    const lastDay = new Date(year, month, 0).getDate();
    setPeriodAnchor(target, new Date(year, month - 1, Math.min(day, lastDay)));
  }

  function formatMonthPeriodLabel(year, month) {
    return `${MESES_ES[Number(month || 1) - 1]} ${year}`;
  }

  function formatWeekRangeLabel(start, end) {
    const startDate = parseIsoDate(start);
    const endDate = parseIsoDate(end);
    if (!startDate || !endDate) return '';

    const startDay = startDate.getDate();
    const endDay = endDate.getDate();
    const startMonth = MESES_ES[startDate.getMonth()];
    const endMonth = MESES_ES[endDate.getMonth()];
    const startYear = startDate.getFullYear();
    const endYear = endDate.getFullYear();

    if (startYear === endYear && startDate.getMonth() === endDate.getMonth()) {
      return `${startDay}-${endDay} ${startMonth} ${startYear}`;
    }
    if (startYear === endYear) {
      return `${startDay} ${startMonth} - ${endDay} ${endMonth} ${endYear}`;
    }
    return `${startDay} ${startMonth} ${startYear} - ${endDay} ${endMonth} ${endYear}`;
  }

  function formatCalendarWeekday(value) {
    const date = parseIsoDate(value);
    if (!date) return '';
    return date.toLocaleDateString('es-PY', { weekday: 'short' }).replace('.', '');
  }

  function buildDateRange(start, end) {
    const startDate = parseIsoDate(start);
    const endDate = parseIsoDate(end);
    if (!startDate || !endDate || startDate.getTime() > endDate.getTime()) return [];

    const dates = [];
    let cursor = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
    while (cursor.getTime() <= endDate.getTime()) {
      dates.push(toIsoDate(cursor));
      cursor = addDays(cursor, 1);
    }
    return dates;
  }

  function isCalendarDateVisible(value) {
    if (!value || !state.calendar.monthResponse) return false;
    const start = state.calendar.monthResponse.start;
    const end = state.calendar.monthResponse.end;
    if (!start || !end) return false;
    return value >= start && value <= end;
  }

  function syncSummaryControls() {
    syncSummaryScopeButton();
    syncSummaryAllButton();
    syncSummaryNavButtons();
  }

  function syncSummaryScopeButton() {
    const button = document.getElementById('summaryWeekToggle');
    if (!button) return;
    button.classList.toggle('is-active', state.summaryPeriod.scope === 'week');
  }

  function syncSummaryAllButton() {
    const button = document.getElementById('summaryAllToggle');
    if (!button) return;
    button.classList.toggle('is-active', state.summaryPeriod.scope === 'all');
  }

  function syncSummaryNavButtons() {
    const previous = document.getElementById('summaryPrevBtn');
    const next = document.getElementById('summaryNextBtn');
    const disabled = state.summaryPeriod.scope === 'all';
    if (previous) previous.disabled = disabled;
    if (next) next.disabled = disabled;
  }

  function syncCalendarScopeButton() {
    const button = document.getElementById('calendarWeekToggle');
    if (!button) return;
    button.classList.toggle('is-active', state.calendar.scope === 'week');
  }

  function syncCalendarLayout() {
    const panel = document.querySelector('#viewCalendario .cal-panel');
    const grid = document.getElementById('calendarGrid');
    const detail = document.getElementById('calDayDetail');
    const isWeekScope = state.calendar.scope === 'week';

    panel?.classList.toggle('week-mode', isWeekScope);
    grid?.classList.toggle('week-mode', isWeekScope);
    detail?.classList.toggle('week-mode', isWeekScope);
  }

  function renderCalendarDayCell(date, summary, options = {}) {
    const dayNumber = parseIsoDate(date)?.getDate() || '--';
    const isToday = date === currentDateValue();
    const isSelected = state.calendar.selectedDate === date;

    let classes = 'cal-day';
    if (state.calendar.scope === 'week' && !summary) classes += ' week-idle';
    if (isToday) classes += ' today';
    if (summary && Number(summary.total || 0) > 0) {
      classes += ' has-acuses';
      classes += summary.estadoDia === 'entregado' ? ' status-entregado' : ' status-pendiente';
    }
    if (isSelected) classes += ' selected';

    const dots = summary && Number(summary.total || 0) > 0
      ? `<div class="cal-dots">${Array(Math.min(Number(summary.total || 0), 4)).fill('<div class="cal-dot"></div>').join('')}</div>`
      : '';
    const label = options.useDayNumberOnly ? dayNumber : `${dayNumber}`;

    return `<div class="${classes}" onclick="selectCalDate('${escapeInlineJs(date)}')">
      <span class="day-num">${label}</span>
      ${dots}
    </div>`;
  }

  function buildCalendarDate(day) {
    return `${state.calendar.year}-${String(state.calendar.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  function sumRows(rows) {
    return rows.reduce((total, row) => total + Number(row.total || 0), 0);
  }

  function maxRows(rows) {
    return rows.reduce((max, row) => Math.max(max, Number(row.total || 0)), 0);
  }

  function averageRows(rows) {
    if (!rows.length) return 0;
    return sumRows(rows) / rows.length;
  }

  function countNonZero(rows) {
    return rows.filter((row) => Number(row.total || 0) > 0).length;
  }

  function groupRowsByYear(rows) {
    const totals = new Map();

    (rows || []).forEach((row) => {
      const key = String(row.mes || '').slice(0, 4);
      if (!key) return;
      totals.set(key, Number(totals.get(key) || 0) + Number(row.total || 0));
    });

    return Array.from(totals.entries())
      .sort((a, b) => a[0].localeCompare(b[0], 'es'))
      .map(([anio, total]) => ({
        anio,
        etiqueta: anio,
        total
      }));
  }

  function formatMonthSeriesLabel(value, includeYear = false) {
    const date = parseIsoDate(String(value || '').slice(0, 10));
    if (!date) return '';
    return date.toLocaleDateString('es-PY', {
      month: 'short',
      ...(includeYear ? { year: '2-digit' } : {})
    }).replace('.', '');
  }

  function uniqueValues(rows, field) {
    return Array.from(new Set((rows || []).map((row) => String(row[field] || '').trim()).filter(Boolean)))
      .sort((a, b) => a.localeCompare(b, 'es'));
  }

  function formatNumber(value) {
    return Number(value || 0).toLocaleString('es-PY');
  }

  function formatAverage(value) {
    const number = Number(value || 0);
    if (!Number.isFinite(number)) return '0';
    const digits = Number.isInteger(number) ? 0 : 1;
    return number.toLocaleString('es-PY', {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    });
  }

  function getInitials(name) {
    return String(name || '')
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word.charAt(0).toUpperCase())
      .join('') || 'RP';
  }

  function setText(id, value) {
    if (window.AlasShared?.dom?.setText) {
      return window.AlasShared.dom.setText(id, value);
    }

    const element = document.getElementById(id);
    if (element) element.textContent = value;
  }

  function setHtml(id, value) {
    if (window.AlasShared?.dom?.setHtml) {
      return window.AlasShared.dom.setHtml(id, value);
    }

    const element = document.getElementById(id);
    if (element) element.innerHTML = value;
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

  function escapeInlineJs(value) {
    return String(value ?? '')
      .replace(/\\/g, '\\\\')
      .replace(/'/g, "\\'")
      .replace(/\r/g, '\\r')
      .replace(/\n/g, '\\n')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function viewIcon() {
    return '<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"/><path d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"/></svg>';
  }

  function clientRowIcon() {
    return '<svg class="tbl-cell-meta__icon" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 21a8 8 0 00-16 0"/><circle cx="12" cy="8" r="4"/></svg>';
  }

  function destinationRowIcon() {
    return '<svg class="tbl-cell-meta__icon" fill="none" stroke="currentColor" stroke-width="1.8" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s6-5.686 6-11a6 6 0 10-12 0c0 5.314 6 11 6 11z"/><circle cx="12" cy="10" r="2.5"/></svg>';
  }

  function deliverIcon() {
    return '<svg fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg>';
  }

  function editIcon() {
    return '<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>';
  }

  function deleteIcon() {
    return '<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>';
  }

  function excelIcon() {
    return '<svg class="btn-action__icon" fill="none" stroke="currentColor" stroke-width="1.9" viewBox="0 0 24 24" aria-hidden="true"><path d="M7.5 3.5h6.8L18 7.2v13.3H7.5A1.5 1.5 0 016 19V5a1.5 1.5 0 011.5-1.5z" stroke-linejoin="round"/><path d="M14 3.7V8h4" stroke-linejoin="round"/><path d="M9 12h6M9 15h6M9 18h3.8" stroke-linecap="round"/></svg>';
  }

  function printIcon() {
    return '<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"/></svg>';
  }

})();

