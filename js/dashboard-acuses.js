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
    pendientes:   { dot: 'var(--warning)',       title: 'Pendientes',          bg: 'var(--warning-soft)',           color: '#B45309' },
    entregados:   { dot: 'var(--success)',        title: 'Facturados',           bg: 'var(--success-soft)',           color: '#047857' },
    acuses:       { dot: 'var(--purple)',         title: 'Total de Pedidos',     bg: 'var(--purple-soft)',            color: '#6D28D9' },
    en_transito:  { dot: 'var(--accent)',         title: 'Contabilizados',       bg: 'var(--accent-soft)',            color: '#1D4ED8' },
    anulados:     { dot: '#ef4444',               title: 'Anulados',             bg: 'rgba(239,68,68,0.12)',          color: '#dc2626' },
  };
  const COLORS_AVATAR = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4', '#F97316', '#6366F1', '#14B8A6', '#E11D48', '#7C3AED'];
  let embedOverlayCloseTimer = null;
  let pendingExportButton = null;
  let dashboardSelectionEffectTimer = null;
  let dashboardSelectionFocusTimer = null;
  const TODAY_ISO = currentDateValue();

  const state = {
    activeKPI: 'pendientes',
    currentView: 'dashboard',
    panelMonth: { year: new Date().getFullYear(), month: new Date().getMonth() + 1 },
    currentPage: {
      pendientes: 1,
      entregados: 1,
      acuses: 1,
      en_transito: 1,
      anulados: 1
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
      fechaDesde: '',
      fechaHasta: '',
      clienteCode: '',
      clienteLabel: '',
      repartidorId: '',
      repartidorLabel: '',
      almacen: 'DEPOSITO',
      condExp: ''
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
        histDesde: '',
        histHasta: '',
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
    charts: {}
  };
  const PANEL_KPIS = new Set(['pendientes', 'entregados', 'acuses', 'en_transito', 'anulados']);
  const DASHBOARD_KPIS = new Set([...PANEL_KPIS]);

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
    const fallback = options.fallback || 'acuses';
    const normalized = normalizeDashboardLookup(value);

    if (!normalized) return fallback;
    if (['acuse', 'acuses', 'total', 'totales', 'todo', 'todos', 'all'].includes(normalized)) return 'acuses';
    if (['pendiente', 'pendientes'].includes(normalized)) return 'pendientes';
    if (['entregado', 'entregados', 'completado', 'completados'].includes(normalized)) return 'entregados';
    if (['en_transito', 'transito', 'en_reparto', 'reparto'].includes(normalized)) return 'en_transito';
    if (['anulado', 'anulados', 'cancelado', 'cancelados', 'annul', 'delete', 'deleted'].includes(normalized)) return 'anulados';
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
  function setAlmacenFilter(val) {
    if (state.panelFilters.almacen === val) return;
    state.panelFilters.almacen = val;
    state.panelFilters.condExp = '';
    const btnDep = document.getElementById('btnAlmacenDeposito');
    const btnFab = document.getElementById('btnAlmacenFabrica');
    if (btnDep) btnDep.classList.toggle('active', val === 'DEPOSITO');
    if (btnFab) btnFab.classList.toggle('active', val === 'FABRICA');
    resetPanelPages();
    loadPanel(state.activeKPI, { soft: true }).catch(handleError);
    loadKpiSummary().catch(handleError);
  }

  window.selectKPI = selectKPI;
  window.setAlmacenFilter = setAlmacenFilter;
  window.changePanelMonth = changePanelMonth;
  window.setPanelMonthAll = setPanelMonthAll;
  window.openPanelDateModal = openPanelDateModal;
  window.closePanelDateModal = closePanelDateModal;
  window.applyPanelDateRange = applyPanelDateRange;
  window.applyPanelQuickDate = applyPanelQuickDate;
  window.clearCurrentPanelFilters = clearCurrentPanelFilters;
  window.toggleFilter = toggleFilter;
  window.renderFilterItems = debounce((kpi, query, type) => { renderFilterItems(kpi, query, type).catch(handleError); }, 300);
  window.pickFilter = pickFilter;
  window.clearFilter = clearFilter;
  window.openNewAcuse = openNewAcuse;
  window.openEditAcuse = openEditAcuse;
  window.openViewAcuse = openViewAcuse;
  window.openDeleteAcuse = openDeleteAcuse;
  window.openPrintAcuse = openPrintAcuse;
  window.selectDashboardAcuse = selectDashboardAcuse;
  window.openDetalleModal = openDetalleModal;
  window.closeDetalleModal = closeDetalleModal;
  window.abrirObservacion = abrirObservacion;
  window.guardarObservacion = guardarObservacion;
  window.abrirMonto = abrirMonto;
  window.guardarMonto = guardarMonto;
  window.copiarAlPortapapeles = copiarAlPortapapeles;
  window.markAcuseDelivered = markAcuseDelivered;
  window.markAcuseContabilizado = markAcuseContabilizado;
  window.markAcuseFacturado = markAcuseFacturado;
  window.openWhatsAppAcuse = openWhatsAppAcuse;
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
  window.openHistDateModal = openHistDateModal;
  window.closeAcuseEmbed = closeAcuseEmbed;
  window.showDashboardToast = notify;
  window.refreshDashboardData = refreshDashboardData;

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
      // activeKPI no se restaura: siempre se entra en Pendientes
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
      // Mostrar dashboard de inmediato (skeleton visible antes del primer API call)
      void showView('dashboard');
      // Alinear mes antes que loadPanel (panelMonth debe estar seteado)
      await alignInitialPeriodsToData();
      // Cargar todo en paralelo: reducción de ~2 roundtrips a 1
      await Promise.allSettled([
        loadSummary(),
        loadKpiSummary(),
        loadPanel(state.activeKPI),
        loadCalendarMonth(),
      ]);
      window.syncLastImportChip?.();
      startRealtimeSync();
    } catch (error) {
      handleError(error);
    }
  }

  async function alignInitialPeriodsToData() {
    if (!state.panelMonth) return;

    try {
      const summary = await AcuseAPI.get('/api/dashboard/interactivo/summary', {
        scope: 'all',
        anchor: TODAY_ISO
      });
      // Only accept properly formatted "YYYY-MM" month keys
      const months = (summary && Array.isArray(summary.acusesPorMes) ? summary.acusesPorMes : [])
        .filter((item) => item && item.mes && /^\d{4}-\d{2}$/.test(item.mes) && Number(item.total || item.value || 0) > 0)
        .sort((a, b) => String(a.mes).localeCompare(String(b.mes)));

      if (!months.length) {
        // No valid month keys found (dates stored in wrong format or no data).
        // Remove the month filter so all data is visible without a date constraint.
        state.panelMonth = null;
        syncPanelMonthLabel();
        return;
      }

      const currentMonthKey = `${state.panelMonth.year}-${String(state.panelMonth.month).padStart(2, '0')}`;
      if (months.some((item) => item.mes === currentMonthKey)) return;

      const latestMonth = String(months[months.length - 1].mes || '');
      const match = latestMonth.match(/^(\d{4})-(\d{2})$/);
      if (!match) {
        state.panelMonth = null;
        syncPanelMonthLabel();
        return;
      }

      const year = Number(match[1]);
      const month = Number(match[2]);
      state.panelMonth = { year, month };
      state.summaryPeriod.scope = 'month';
      state.calendar.scope = 'month';
      setPeriodMonth(state.summaryPeriod, year, month);
      setPeriodMonth(state.calendar, year, month);
      state.calendar.selectedDate = null;
      syncPanelMonthLabel();
      syncSummaryPeriodLabel();
    } catch (error) {
      console.warn('[Dashboard] No se pudo detectar el ultimo mes con datos:', error);
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
          animation: dashToastDropIn var(--alas-dur-normal) var(--alas-ease) forwards;
          pointer-events: auto;
        }
        .dash-toast.hide {
          animation: dashToastLiftOut var(--alas-dur-fast) var(--alas-ease-in) forwards;
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
          animation: dashboardViewIn var(--alas-dur-page) var(--alas-ease);
          transform-origin: top center;
        }
        @keyframes dashboardViewIn {
          from {
            opacity: 0;
            transform: translateY(5px) scale(0.996);
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
            opacity var(--alas-dur-fast) var(--alas-ease),
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
          transition: opacity var(--alas-dur-fast) var(--alas-ease);
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
            transform var(--alas-dur-fast) var(--alas-ease),
            opacity   var(--alas-dur-fast) var(--alas-ease);
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
          transition: opacity var(--alas-dur-fast) var(--alas-ease);
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
          transition: transform var(--alas-dur-fast) var(--alas-ease);
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
        closeDetalleModal();
        cancelExportPanel();
        closeAcuseEmbed();
        closePanelFilter();
        closeHistoryFilters();
      }
    });

    document.addEventListener('mousedown', (event) => {
      if (state.panelOpenFilter && !event.target.closest(`#${state.panelOpenFilter}`)) {
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
      home.onclick = function (e) {
        if (e) e.preventDefault();
        var url = (typeof ALAS_SSO_CONFIG !== 'undefined' && ALAS_SSO_CONFIG.launcherUrl)
          ? ALAS_SSO_CONFIG.launcherUrl
          : 'https://launcher-tawny.vercel.app';
        if (window.ALASTransition) {
          ALASTransition.exitToLauncher(url);
        } else {
          window.location.href = url;
        }
      };
    }
  }

  async function showDashboardPanel(kpi = 'acuses') {
    const targetKpi = normalizeDashboardKpi(kpi, { fallback: 'acuses' });
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
    const ids = ['btnResumen', 'btnDashboard', 'btnCalendario', 'btnHistorial', 'btnCargarDatos'];
    ids.forEach((id) => document.getElementById(id)?.classList.remove('active'));

    if (state.currentView === 'resumen') {
      document.getElementById('btnResumen')?.classList.add('active');
      return;
    }
    if (state.currentView === 'dashboard') {
      document.getElementById('btnDashboard')?.classList.add('active');
      return;
    }
    if (state.currentView === 'calendario') {
      document.getElementById('btnCalendario')?.classList.add('active');
      return;
    }
    if (state.currentView === 'historial') {
      document.getElementById('btnHistorial')?.classList.add('active');
      return;
    }
    if (state.currentView === 'cargarDatos') {
      document.getElementById('btnCargarDatos')?.classList.add('active');
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
    const params = state.panelMonth
      ? { scope: 'month', year: state.panelMonth.year, month: state.panelMonth.month }
      : { scope: 'all', anchor: TODAY_ISO };
    if (state.panelFilters.almacen) params.almacen = state.panelFilters.almacen;
    state.kpiSummary = await AcuseAPI.get('/api/dashboard/interactivo/summary', params);
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

  const MESES_LABEL = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

  function syncPanelMonthLabel() {
    const lbl = document.getElementById('panelMonthLabel');
    const allBtn = document.getElementById('panelMonthAll');
    if (!lbl) return;
    if (!state.panelMonth) {
      lbl.textContent = 'Todos';
      if (allBtn) allBtn.classList.add('active');
    } else {
      lbl.textContent = `${MESES_LABEL[state.panelMonth.month - 1]} ${state.panelMonth.year}`;
      if (allBtn) allBtn.classList.remove('active');
    }
  }

  async function loadKpiSummaryForPanel() {
    let params;
    if (state.panelMonth) {
      params = { scope: 'month', year: state.panelMonth.year, month: state.panelMonth.month };
    } else {
      params = { scope: 'all', anchor: TODAY_ISO };
    }
    if (state.panelFilters.almacen) params.almacen = state.panelFilters.almacen;
    state.kpiSummary = await AcuseAPI.get('/api/dashboard/interactivo/summary', params);
    renderKpis();
  }

  function changePanelMonth(direction) {
    if (!state.panelMonth) {
      const now = new Date();
      state.panelMonth = { year: now.getFullYear(), month: now.getMonth() + 1 };
    }
    let { year, month } = state.panelMonth;
    month += direction;
    if (month > 12) { month = 1; year++; }
    if (month < 1)  { month = 12; year--; }
    state.panelMonth = { year, month };
    syncPanelMonthLabel();
    Promise.all([
      loadPanel(state.activeKPI),
      loadKpiSummaryForPanel()
    ]).catch(handleError);
  }

  function setPanelMonthAll() {
    state.panelMonth = null;
    syncPanelMonthLabel();
    Promise.all([
      loadPanel(state.activeKPI),
      loadKpiSummaryForPanel()
    ]).catch(handleError);
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

  function initDashboardDatePickers() {
    // date pickers por módulo — historial usa botón modal, no input nativo
  }

  function syncDatePicker(inputId, value) {
    const input = document.getElementById(inputId);
    if (!input) return;
    input.value = value || '';
    if (input._proDatePicker && typeof input._proDatePicker.sync === 'function') {
      input._proDatePicker.sync();
    }
  }

  // ── GSAP KPI animations ──────────────────────────────────────────────────
  function _kpiRawNum(el) {
    return parseInt(String(el ? el.textContent : '0').replace(/\D/g, ''), 10) || 0;
  }

  function animateKpiVal(id, target, kpiKey) {
    const el = document.getElementById(id);
    if (!el) return;
    if (!window.gsap) { el.textContent = formatNumber(target); return; }
    const from = _kpiRawNum(el);
    if (from === target) return;
    if (kpiKey) {
      const card = document.querySelector(`.kpi-card[data-kpi="${kpiKey}"]`);
      if (card) gsap.fromTo(card, { scale: 1 }, { scale: 1.018, duration: 0.13, ease: 'power2.out', yoyo: true, repeat: 1 });
    }
    const obj = { n: from };
    gsap.to(obj, { n: target, duration: 0.65, ease: 'power2.out',
      onUpdate() { el.textContent = formatNumber(Math.round(obj.n)); } });
  }

  function animateKpiMonto(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    const n = Math.round(Number(value) || 0);
    if (n === 0) { el.textContent = ''; el.style.display = 'none'; return; }
    el.style.display = '';
    if (!window.gsap) { el.textContent = 'Gs ' + n.toLocaleString('es-PY'); return; }
    const obj = { n: _kpiRawNum(el) };
    gsap.to(obj, { n, duration: 0.65, ease: 'power2.out',
      onUpdate() { el.textContent = 'Gs ' + Math.round(obj.n).toLocaleString('es-PY'); } });
  }

  function gsapPanelEnter(panel, full = true) {
    if (!panel) return;
    const shell = panel.querySelector('.content-panel');
    if (!shell) return;
    if (full && window.gsap) {
      shell.style.animation = 'none';
      // gsap.set aplica sincrónicamente (antes del siguiente paint) — evita el flash
      // que causaba fromTo porque este aplicaba el estado inicial en el siguiente rAF
      gsap.set(shell, { opacity: 0, y: 12, scale: 0.996 });
      gsap.to(shell, { opacity: 1, y: 0, scale: 1, duration: 0.38, ease: 'power3.out', clearProps: 'opacity,transform' });
    }
    // CSS stagger — cada fila baja desde -6px (mismo patrón que itemsborrados)
    const rows = shell.querySelectorAll('tbody tr');
    if (rows.length) {
      rows.forEach(r => { r.style.animation = 'none'; });
      void shell.offsetHeight; // un único reflow para todas las filas
      rows.forEach((r, i) => {
        r.style.animation = '';
        r.style.animationDelay = (i * 0.04) + 's';
      });
    }
  }
  // ─────────────────────────────────────────────────────────────────────────

  function renderKpis() {
    const kpis = state.kpiSummary && state.kpiSummary.kpis
      ? state.kpiSummary.kpis
      : state.summary && state.summary.kpis
        ? state.summary.kpis
        : {};

    animateKpiVal('val-pendientes',  kpis.pendientes  || 0, 'pendientes');
    animateKpiVal('val-entregados',  kpis.entregados  || 0, 'entregados');
    animateKpiVal('val-acuses',      kpis.acuses      || 0, 'acuses');
    animateKpiVal('val-en_transito', kpis.en_transito || 0, 'en_transito');
    animateKpiVal('val-anulados',    kpis.anulados    || 0, 'anulados');
    setText('val-deposito', formatNumber(kpis.deposito || 0));
    setText('val-fabrica',  formatNumber(kpis.fabrica  || 0));

    animateKpiMonto('monto-pendientes',  kpis.monto_pendientes);
    animateKpiMonto('monto-entregados',  kpis.monto_entregados);
    animateKpiMonto('monto-en_transito', kpis.monto_en_transito);
    animateKpiMonto('monto-anulados',    kpis.monto_anulados);
    animateKpiMonto('monto-acuses',      kpis.monto_total);
  }

  function setKpiMonto(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    const n = Math.round(Number(value) || 0);
    el.textContent = n > 0 ? 'Gs ' + n.toLocaleString('es-PY') : '';
    el.style.display = n > 0 ? '' : 'none';
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

    setText('summaryZonesTitle', 'Top Clientes');
    setText('summaryZonesSubtitle', 'Top 10 clientes por cantidad de pedidos');
    setText('summaryZonesTotalLabel', 'Total pedidos');
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

    const summary  = state.summary || {};
    const donut    = summary.donut    || {};
    const zonas    = Array.isArray(summary.zonas)       ? summary.zonas       : [];
    const vendedor = Array.isArray(summary.porVendedor) ? summary.porVendedor : [];
    const porMes   = Array.isArray(summary.acusesPorMes) ? summary.acusesPorMes : [];

    const CHART_OPTS = {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 900, easing: 'easeOutQuart' },
      plugins: { legend: { display: false } }
    };

    const TICK_X = { color: '#94a3b8', font: { size: 10, family: 'DM Sans', weight: '600' }, padding: 4 };
    const TICK_Y = { color: '#47627f', font: { size: 10.5, family: 'DM Sans', weight: '700' }, padding: 8 };
    const GRID   = { color: 'rgba(226,232,240,0.64)', drawBorder: false };

    // ── 1. DONUT — distribución de estados ───────────────────────────────
    const donutCtx = getContext('chartDona');
    if (donutCtx) {
      const labels = ['Facturados', 'Pendientes', 'Contabilizados', 'Anulados'];
      const values = [
        Number(donut.entregados  || 0),
        Number(donut.pendientes  || 0),
        Number(donut.en_transito || 0),
        Number(donut.anulados    || 0)
      ];
      const colors = ['#22c55e', '#f59e0b', '#3b82f6', '#ef4444'];
      const total  = values.reduce((a, b) => a + b, 0);

      state.charts.dona = new Chart(donutCtx, {
        type: 'doughnut',
        data: { labels, datasets: [{ data: values, backgroundColor: colors, borderColor: '#fff', borderWidth: 3, hoverOffset: 6, borderRadius: 4 }] },
        options: {
          ...CHART_OPTS,
          cutout: '64%',
          animation: { animateRotate: true, duration: 1000, easing: 'easeOutQuart' },
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label(ctx) { const pct = total > 0 ? Math.round(ctx.raw / total * 100) : 0; return ` ${ctx.label}: ${formatNumber(ctx.raw)} (${pct}%)`; } } }
          }
        }
      });
    }

    // ── 2. TOP CLIENTES — barras horizontales ────────────────────────────
    const zonasCtx = getContext('chartZonas');
    if (zonasCtx) {
      state.charts.zonas = new Chart(zonasCtx, {
        type: 'bar',
        data: {
          labels: zonas.map((i) => i.label),
          datasets: [{ data: zonas.map((i) => Number(i.value || 0)), backgroundColor: 'rgba(59,130,246,0.72)', hoverBackgroundColor: '#2563eb', borderRadius: 6, borderSkipped: false, barThickness: 12, maxBarThickness: 14 }]
        },
        options: {
          ...CHART_OPTS,
          indexAxis: 'y',
          layout: { padding: { right: 32, top: 2, bottom: 2 } },
          plugins: {
            legend: { display: false },
            dashboardAcusesEndLabels: { enabled: true },
            tooltip: { callbacks: { label(ctx) { return ` ${formatNumber(ctx.parsed.x)} pedidos`; } } }
          },
          scales: {
            x: { beginAtZero: true, border: { display: false }, grid: GRID, ticks: TICK_X },
            y: { border: { display: false }, grid: { display: false }, ticks: TICK_Y }
          }
        },
        plugins: [endLabelsPlugin]
      });
    }

    // ── 3. PEDIDOS POR FECHA — barras por día de ingreso ────────────────
    const porDia = Array.isArray(summary.acusesPorDia) ? summary.acusesPorDia : [];
    const greenCtx = getContext('chartCamiones');
    if (greenCtx) {
      const MESES_C = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
      const fechasLabel = porDia.map((i) => {
        const parts = i.fecha.split('-');
        return `${parseInt(parts[2], 10)} ${MESES_C[parseInt(parts[1], 10) - 1]}`;
      });
      state.charts.camiones = new Chart(greenCtx, {
        type: 'bar',
        data: {
          labels: fechasLabel,
          datasets: [{
            data: porDia.map((i) => Number(i.total || 0)),
            backgroundColor: buildGradient(greenCtx, 'rgba(59,130,246,0.85)', 'rgba(59,130,246,0.55)'),
            hoverBackgroundColor: '#2563eb',
            borderRadius: 6,
            borderSkipped: false,
            barThickness: 'flex',
            maxBarThickness: 32
          }]
        },
        options: {
          ...CHART_OPTS,
          interaction: { mode: 'index', intersect: false },
          layout: { padding: { top: 20, right: 4 } },
          plugins: {
            legend: { display: false },
            dashboardAcusesTopLabels: { enabled: true, datasetIndex: 0 },
            tooltip: { callbacks: {
              title(items) { return porDia[items[0]?.dataIndex]?.fecha || ''; },
              label(ctx) { return ` ${formatNumber(ctx.parsed.y)} pedido${ctx.parsed.y !== 1 ? 's' : ''}`; }
            }}
          },
          scales: {
            x: { border: { display: false }, grid: { display: false }, ticks: { color: '#64748b', font: { size: 10, family: 'DM Sans', weight: '600' }, maxRotation: 45, minRotation: 30 } },
            y: { beginAtZero: true, grace: '15%', border: { display: false }, grid: GRID, ticks: TICK_X }
          }
        },
        plugins: [topLabelsPlugin]
      });
    }

    // ── 4. POR VENDEDOR — barras horizontales ────────────────────────────
    const orangeCtx = getContext('chartCamionesMes');
    if (orangeCtx) {
      state.charts.camionesMes = new Chart(orangeCtx, {
        type: 'bar',
        data: {
          labels: vendedor.map((i) => i.label),
          datasets: [{ data: vendedor.map((i) => Number(i.value || 0)), backgroundColor: 'rgba(245,158,11,0.75)', hoverBackgroundColor: '#d97706', borderRadius: 6, borderSkipped: false, barThickness: 12, maxBarThickness: 14 }]
        },
        options: {
          ...CHART_OPTS,
          indexAxis: 'y',
          layout: { padding: { right: 32, top: 2, bottom: 2 } },
          plugins: {
            legend: { display: false },
            dashboardAcusesEndLabels: { enabled: true },
            tooltip: { callbacks: { label(ctx) { return ` ${formatNumber(ctx.parsed.x)} pedidos`; } } }
          },
          scales: {
            x: { beginAtZero: true, border: { display: false }, grid: GRID, ticks: TICK_X },
            y: { border: { display: false }, grid: { display: false }, ticks: TICK_Y }
          }
        },
        plugins: [endLabelsPlugin]
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
      { label: 'Facturados',     count: Number(donut.entregados  || 0), percent: Number(donut.porcentajeEntregados || 0), color: '#22c55e' },
      { label: 'Pendientes',     count: Number(donut.pendientes  || 0), percent: Number(donut.porcentajePendientes || 0), color: '#f59e0b' },
      { label: 'Contabilizados', count: Number(donut.en_transito || 0), percent: Number(donut.porcentajeTransito   || 0), color: '#3b82f6' },
      { label: 'Anulados',       count: Number(donut.anulados    || 0), percent: Number(donut.porcentajeAnulados   || 0), color: '#ef4444' }
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
      greenTitle: 'Pedidos por Fecha',
      greenSubtitle: 'Pedidos ingresados por fecha',
      greenLeadValue: Number(greenPeak?.total || 0),
      greenLeadLabel: isAllScope ? 'Mes mas alto' : 'Dia mas alto',
      greenLeadMeta: greenPeak ? (isAllScope ? greenPeak.etiqueta : (greenPeak.meta || greenPeak.etiqueta)) : 'Sin actividad',
      greenTotalValue: isAllScope ? countNonZero(acusesPorMes) : Number(kpis.acuses || 0),
      greenTotalLabel: isAllScope ? 'Meses activos' : isWeekScope ? 'Total de la semana' : 'Total del mes',
      greenTotalMeta: isAllScope ? 'Meses con actividad' : 'Pedidos contados acumulados',
      orangeTitle: 'Pedidos por Vendedor',
      orangeSubtitle: 'Top 10 vendedores por cantidad de pedidos',
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
    state.panelFilters.condExp = '';
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
    if (kpiGrid) kpiGrid.classList.remove('is-hidden');
    const btnDep = document.getElementById('btnAlmacenDeposito');
    const btnFab = document.getElementById('btnAlmacenFabrica');
    if (btnDep) btnDep.classList.toggle('active', state.panelFilters.almacen === 'DEPOSITO');
    if (btnFab) btnFab.classList.toggle('active', state.panelFilters.almacen === 'FABRICA');
  }

  async function loadPanel(kpi, options = {}) {
    const normalizedKpi = normalizeDashboardKpi(kpi, {
      fallback: normalizeDashboardKpi(state.activeKPI, { fallback: 'acuses' })
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
      const _exitShell = panel.querySelector('.content-panel');
      if (_exitShell && window.gsap) {
        await new Promise(r => gsap.to(_exitShell, { opacity: 0, y: -8, duration: 0.15, ease: 'power2.in', onComplete: r }));
      }
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

  // ── Sincronización en tiempo real (polling + Page Visibility) ──────────────
  // Mantiene la vista actualizada para todos los usuarios sin recargar la página.
  function startRealtimeSync() {
    const POLL_MS     = 30000; // refresco cada 30 s en tab activo
    const STALE_MS    = 8000;  // si la tab estuvo oculta >8 s, refrescar al volver
    let _timer        = null;
    let _lastPoll     = Date.now();
    let _running      = false;

    async function poll() {
      if (_running) return;           // evitar solapamiento si la respuesta tarda
      if (document.visibilityState === 'hidden') { schedule(); return; }
      _running = true;
      try {
        await refreshDashboardData({ softPanel: true, backgroundPoll: true });
      } catch (_) { /* silencioso — el usuario no ve errores de fondo */ }
      _lastPoll = Date.now();
      _running  = false;
      schedule();
    }

    function schedule() {
      clearTimeout(_timer);
      _timer = setTimeout(poll, POLL_MS);
    }

    // Al volver a la pestaña, refrescar si los datos tienen más de STALE_MS
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        if (Date.now() - _lastPoll > STALE_MS) {
          clearTimeout(_timer);
          poll();
        }
      }
    });

    schedule();
  }

  async function refreshDashboardData(options = {}) {
    if (options.resetPeriod) await alignInitialPeriodsToData();
    const refreshHistory = options.history === true || state.currentView === 'historial';
    const softPanel = options.softPanel !== false;
    // backgroundPoll: refresh liviano — omite calendario salvo que el usuario lo esté viendo
    const isBackground = Boolean(options.backgroundPoll);

    const tasks = [
      { key: 'summary', run: () => loadSummary() },
      { key: 'kpis',    run: () => loadKpiSummary() },
    ];

    // En background: solo actualizar números (KPIs/resumen) sin tocar la tabla.
    // La tabla solo se refresca en acciones del usuario o cambios de panel.
    if (!isBackground) {
      tasks.push({ key: 'panel', run: () => loadPanel(state.activeKPI, { soft: softPanel }) });
    }
    if (!isBackground || state.currentView === 'calendario') {
      tasks.push({ key: 'calendar', run: () => loadCalendarMonth() });
    }
    if (refreshHistory) {
      tasks.push({ key: 'history', run: () => loadHistorial() });
    }

    const results = await Promise.allSettled(tasks.map((task) => task.run()));
    const failures = results
      .map((result, index) => ({ result, key: tasks[index].key }))
      .filter(({ result }) => result.status === 'rejected');

    if (failures.length && !isBackground) {
      const panelFailure = failures.find(({ key }) => key === 'panel');
      const firstError = panelFailure || failures[0];
      throw firstError.result.reason;
    }
  }

  function buildPanelParams(kpi) {
    const normalizedKpi = normalizeDashboardKpi(kpi, {
      fallback: normalizeDashboardKpi(state.activeKPI, { fallback: 'acuses' })
    });
    const params = { all: 1 };

    if (state.panelMonth) {
      const { year, month } = state.panelMonth;
      const mStr = String(month).padStart(2, '0');
      const lastDay = new Date(year, month, 0).getDate();
      params.fechaDesde = `${year}-${mStr}-01`;
      params.fechaHasta = `${year}-${mStr}-${String(lastDay).padStart(2, '0')}`;
    }
    if (state.panelFilters.fechaDesde) params.fechaDesde = state.panelFilters.fechaDesde;
    if (state.panelFilters.fechaHasta) params.fechaHasta = state.panelFilters.fechaHasta;
    if (state.panelFilters.repartidorId) params.idRepartidor = state.panelFilters.repartidorId;
    if (state.panelFilters.clienteCode) params.codCliente = state.panelFilters.clienteCode;
    if (state.panelFilters.almacen) params.almacen = state.panelFilters.almacen;
    if (state.panelFilters.condExp) params.condExp = state.panelFilters.condExp;

    return params;
  }

  async function requestPanelEndpoint(kpi, params) {
    return AcuseAPI.get(`/api/dashboard/interactivo/panel/${kpi}`, params);
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
    const colCount = kpi === 'entregados' ? 9 : 10;
    _selectedEntregas.clear();
    updateBulkBar();
    const rowsHtml = renderPanelRows(kpi, response.items || []);

    const panel = document.getElementById('contentPanel');
    if (!panel) return;

    const innerHtml = kpi === 'acuses'
      ? `${panelHeaderHTML(kpi, cfg)}${rowsHtml || '<div style="padding:40px;text-align:center;color:var(--gray-400);font-weight:600;">Sin datos</div>'}`
      : `
      ${panelHeaderHTML(kpi, cfg)}
      <div class="table-wrapper"><table>
        <thead><tr>${panelTableHeaders(kpi)}</tr></thead>
        <tbody>${rowsHtml || `<tr><td colspan="${colCount}" style="text-align:center;padding:32px;color:var(--gray-400);font-weight:600;">Sin resultados para este filtro</td></tr>`}</tbody>
      </table></div>`;

    if (preserveShell) {
      const shell = panel.querySelector('.content-panel');
      if (shell) {
        shell.classList.remove('content-panel--soft-loading');
        shell.innerHTML = innerHtml;
        initPanelDatePicker(kpi);
        syncDashboardSelectedRowState({ focus: Boolean(state.highlightedAcuseId), behavior: 'smooth' });
        gsapPanelEnter(panel, false);
        return;
      }
    }

    panel.innerHTML = `<div class="content-panel">${innerHtml}</div>`;
    initPanelDatePicker(kpi);
    syncDashboardSelectedRowState({ focus: Boolean(state.highlightedAcuseId), behavior: 'smooth' });
    gsapPanelEnter(panel, true);
  }

  function panelHeaderHTML(kpi, cfg) {
    const actionsHtml = `<div class="panel-header-right">
        <button class="btn-action btn-exportar" type="button" onclick="exportCurrentPanel(this)">${excelIcon()}<span class="btn-action__spinner" aria-hidden="true"></span><span class="btn-action__label">Exportar Excel</span></button>
      </div>`;

    return `<div class="panel-header">
      <div class="panel-header-left">
        <div class="panel-title"><span class="dot" style="background:${cfg.dot}"></span> ${cfg.title}</div>
        ${panelDateFilterHTML(kpi)}
        ${state.panelFilters.almacen === 'FABRICA' ? panelCondExpFilterHTML() : ''}
        ${panelEntityFilterHTML(kpi)}
        <button class="btn-action btn-clear-filters btn-clear-filters--inline" type="button" onclick="clearCurrentPanelFilters(this)"><svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M4 4v5h.582m14.356 2A8 8 0 005.582 9m0 0H9m11 11v-5h-.581m0 0A8.003 8.003 0 016.343 15m13.076 0H15"/></svg><span class="btn-action__label">Limpiar filtros</span></button>
      </div>
      ${actionsHtml}
    </div>`;
  }

  function activeFilterTypeForKpi(kpi) {
    return 'repartidor';
  }

  function panelDateFilterHTML() {
    const desde = state.panelFilters.fechaDesde;
    const hasta = state.panelFilters.fechaHasta;
    const active = desde || hasta;
    const label = buildDateTriggerLabel(desde, hasta);
    return `<button class="date-btn-trigger${active ? ' active' : ''}" onclick="openPanelDateModal()">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
      <span>${escapeHtml(label)}</span>
    </button>`;
  }

  window.setPanelCondExp = function(val) {
    if (state.panelFilters.condExp === val) return;
    state.panelFilters.condExp = val;
    resetPanelPages();
    loadPanel(state.activeKPI, { soft: true }).catch(handleError);
  };

  function panelCondExpFilterHTML() {
    const cur = state.panelFilters.condExp || '';
    const opts = [['', 'Todos'], ['08', 'Cod. 08'], ['09', 'Cod. 09']];
    return `<div class="cond-exp-seg">${opts.map(([v, lbl]) =>
      `<button class="cond-exp-btn${cur === v ? ' active' : ''}" onclick="setPanelCondExp('${v}')">${lbl}</button>`
    ).join('')}</div>`;
  }

  function panelEntityFilterHTML(kpi) {
    return renderSingleFilterHTML(kpi, 'repartidor', 'Filtrar vendedor...') +
           renderSingleFilterHTML(kpi, 'cliente', 'Filtrar cliente...');
  }

  function renderSingleFilterHTML(kpi, type, placeholder) {
    const filterId = `filter-${kpi}-${type}`;
    const open = state.panelOpenFilter === filterId;
    const query = state.panelFilterQuery[type] || '';
    const value = type === 'repartidor' ? state.panelFilters.repartidorLabel : state.panelFilters.clienteLabel;

    return `<div class="filter-wrap filter-wrap--entity" id="${filterId}">
      <div class="filter-trigger ${value ? 'has-val' : ''}${open ? ' open' : ''}" onclick="toggleFilter('${filterId}', '${kpi}', '${type}')">
        <div class="f-dot"></div>
        <div class="f-main"><span class="f-val">${escapeHtml(value || placeholder)}</span></div>
        <div class="f-actions">
          <button class="f-clr" onclick="event.stopPropagation();clearFilter('${kpi}','${type}')" title="Limpiar">
            <svg width="9" height="9" viewBox="0 0 10 10" fill="none"><path d="M1 1l8 8M9 1L1 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
          </button>
          <svg class="f-arr" width="12" height="12" viewBox="0 0 14 14" fill="none"><path d="M3 5l4 4 4-4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </div>
      </div>
      <div class="filter-dd${open ? ' open' : ''}" id="${filterId}-dd">
        <div class="filter-search">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none"><circle cx="7" cy="7" r="5" stroke="currentColor" stroke-width="1.4"/><path d="M11 11l3 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
          <input type="text" placeholder="Buscar..." value="${escapeHtml(query)}" oninput="renderFilterItems('${kpi}', this.value, '${type}')" autocomplete="off" spellcheck="false">
        </div>
        <div class="filter-list" id="${filterId}-list">${panelFilterItemsHTML(kpi, type)}</div>
      </div>
    </div>`;
  }

  function panelFilterItemsHTML(kpi, type) {
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

      return `<div class="filter-item ${selected ? 'sel' : ''}" style="animation-delay:${Math.min(index * 0.025, 0.18)}s" onmousedown="event.preventDefault();pickFilter('${kpi}','${escapeInlineJs(String(value))}','${escapeInlineJs(label)}','${type}')">
        <div class="fi-dot"></div>
        <div class="fi-row">
          <span class="fi-name">${escapeHtml(name)}</span>
          ${code && code !== name ? `<span class="fi-code">${escapeHtml(code)}</span>` : ''}
        </div>
        <svg class="fi-check" viewBox="0 0 20 20" fill="none"><path d="M4.5 10.5l3.2 3.2L15.5 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </div>`;
    }).join('');
  }

  function panelTableHeaders(kpi) {
    const cbHead = '<th class="th-cb"><label class="cb-all-wrap"><input type="checkbox" id="cb-select-all" onclick="cvSelectAll(this)"></label></th>';
    if (kpi === 'anulados') {
      return cbHead + '<th>Fecha</th><th>Entrega</th><th>Pedido</th><th>Cod.cliente</th><th>Almacén</th><th>Monto Gs</th><th>Observación</th><th></th><th>Motivo de anulacion</th>';
    }
    if (kpi === 'entregados') {
      return cbHead + '<th>Fecha</th><th>Entrega</th><th>Pedido</th><th>Cod.cliente</th><th>Almacén</th><th>Monto Gs</th><th>Observación</th><th>Detalles</th>';
    }
    return cbHead + '<th>Fecha</th><th>Entrega</th><th>Pedido</th><th>Cod.cliente</th><th>Almacén</th><th>Monto Gs</th><th>Observación</th><th>Detalles</th><th>Acciones</th>';
  }

  let _gruposMap = new Map();
  let _renderingKpi = ''; // KPI activo en el último render (para renderAcuseRow)
  let _selectedEntregas = new Set();

  function updateBulkBar() {
    const bar = document.getElementById('bulkActionBar');
    const cnt = document.getElementById('bulkCount');
    if (!bar) return;
    const n = _selectedEntregas.size;
    if (n > 0) {
      bar.style.display = 'flex';
      if (cnt) {
        const prev = cnt.textContent;
        cnt.textContent = n;
        if (prev !== String(n)) { cnt.classList.remove('bump'); void cnt.offsetWidth; cnt.classList.add('bump'); }
      }
    } else {
      bar.style.display = 'none';
    }
    const cbAll = document.getElementById('cb-select-all');
    if (cbAll) {
      const all = document.querySelectorAll('#contentPanel .row-cb');
      cbAll.checked = all.length > 0 && _selectedEntregas.size >= all.length;
      cbAll.indeterminate = _selectedEntregas.size > 0 && _selectedEntregas.size < all.length;
    }
  }

  function setBulkLoading(loading, label) {
    const actEl  = document.getElementById('bulkBarActions');
    const loadEl = document.getElementById('bulkBarLoading');
    const lblEl  = document.getElementById('bulkLoadingLabel');
    if (actEl)  actEl.style.display  = loading ? 'none' : '';
    if (loadEl) loadEl.style.display = loading ? 'flex' : 'none';
    if (lblEl && label) lblEl.textContent = label;
  }

  window.cvToggleSelect = function (entrega, cb) {
    if (cb.checked) _selectedEntregas.add(entrega);
    else _selectedEntregas.delete(entrega);
    const row = cb.closest('tr');
    if (row) row.classList.toggle('tbl-row--checked', cb.checked);
    updateBulkBar();
  };

  window.cvSelectAll = function (cbAll) {
    document.querySelectorAll('#contentPanel .row-cb').forEach((cb) => {
      const entrega = cb.dataset.entrega || '';
      if (!entrega) return;
      cb.checked = cbAll.checked;
      if (cbAll.checked) _selectedEntregas.add(entrega);
      else _selectedEntregas.delete(entrega);
      const row = cb.closest('tr');
      if (row) row.classList.toggle('tbl-row--checked', cbAll.checked);
    });
    updateBulkBar();
  };

  window.cvClearSelection = function () {
    _selectedEntregas.clear();
    document.querySelectorAll('#contentPanel .row-cb').forEach((cb) => {
      cb.checked = false;
      const row = cb.closest('tr');
      if (row) row.classList.remove('tbl-row--checked');
    });
    updateBulkBar();
  };

  window.cvBulkChangeEstado = async function (estado) {
    if (!estado || !_selectedEntregas.size) return;
    const ids = [..._selectedEntregas];
    const labels    = { pendiente: 'Pendiente', en_transito: 'Contabilizado', entregado: 'Facturado', anulado: 'Anulado' };
    const apiEstados = { pendiente: 'Pendiente', en_transito: 'En Transito', entregado: 'Entregado', anulado: 'Anulado' };
    const variantMap = { pendiente: '', en_transito: 'blue', entregado: 'green', anulado: '' };
    const label   = labels[estado] || estado;
    const count   = ids.length;
    const isDanger = estado === 'anulado';

    const ok = await showCvConfirm(
      `¿Cambiar a ${label}?`,
      count === 1 ? `1 entrega pasará a estado "${label}".` : `${count} entregas pasarán a estado "${label}".`,
      { confirmLabel: `Pasar a ${label}`, variant: variantMap[estado], danger: isDanger }
    );
    if (!ok) return;

    const usuario   = resolveCurrentOperator() || 'sistema';
    const apiEstado = apiEstados[estado] || estado;
    setBulkLoading(true, `Aplicando ${label}…`);

    const results = await Promise.allSettled(ids.map(entrega =>
      AcuseAPI.patch(`/api/acuses/${encodeURIComponent(entrega)}/estado`, {
        Estado: apiEstado,
        Usuario: usuario,
        Observacion: `Pasado a ${label} — cambio masivo (${ids.length} entregas)`
      })
    ));

    const errors = results.filter(r => r.status === 'rejected').length;
    setBulkLoading(false);
    window.cvClearSelection();
    if (!errors) registrarAccion('bulk_estado', usuario, null, null, `${count} entrega(s) pasadas a ${label}`);
    await refreshDashboardData({ softPanel: true });
    if (errors) notify(`${errors} entrega(s) no se pudieron actualizar.`, 'warning');
    else        notify(`${count} entrega(s) actualizadas a ${label}.`, 'success');
  };

  function showDeleteConfirm(count) {
    return new Promise((resolve) => {
      const modal = document.getElementById('deleteConfirmModal');
      if (!modal) { resolve(window.confirm(count === 1 ? '¿Eliminar 1 entrega?' : `¿Eliminar ${count} entregas?`)); return; }
      const msgEl    = document.getElementById('delModalMsg');
      const confirmB = document.getElementById('delModalConfirm');
      const cancelB  = document.getElementById('delModalCancel');
      if (msgEl) msgEl.innerHTML = count === 1
        ? 'Se eliminará <strong>1 entrega</strong> permanentemente.'
        : `Se eliminarán <strong>${count} entregas</strong> permanentemente.`;
      const close = (result) => {
        modal.classList.remove('is-open');
        confirmB.removeEventListener('click', onOk);
        cancelB.removeEventListener('click', onCancel);
        modal.removeEventListener('click', onOverlay);
        setTimeout(() => resolve(result), 240);
      };
      const onOk      = () => close(true);
      const onCancel  = () => close(false);
      const onOverlay = (e) => { if (e.target === modal) close(false); };
      confirmB.addEventListener('click', onOk);
      cancelB.addEventListener('click', onCancel);
      modal.addEventListener('click', onOverlay);
      requestAnimationFrame(() => modal.classList.add('is-open'));
    });
  }

  window.cvBulkEliminar = async function () {
    if (!_selectedEntregas.size) return;
    const ids = [..._selectedEntregas];
    const confirmed = await showDeleteConfirm(ids.length);
    if (!confirmed) return;

    const usuario = resolveCurrentOperator() || 'sistema';
    setBulkLoading(true, `Eliminando ${ids.length}…`);

    const results = await Promise.allSettled(
      ids.map(entrega => window.Supabase.Pedidos.borrar(entrega, usuario))
    );

    const errors = results.filter(r => r.status === 'rejected').length;
    setBulkLoading(false);
    window.cvClearSelection();
    if (!errors) registrarAccion('bulk_anular', usuario, null, null, `${ids.length} entrega(s) eliminadas`);
    await refreshDashboardData({ softPanel: false });
    if (errors) notify(`${errors} entrega(s) no se pudieron eliminar.`, 'warning');
    else        notify(`${ids.length} entrega(s) eliminadas.`, 'success');
  };

  function renderPanelRows(kpi, items) {
    _renderingKpi = kpi;

    // ── KANBAN para vista Total ──────────────────────────────────────────────
    if (kpi === 'acuses') {
      const grupos = new Map();
      items.forEach(item => {
        const key = item.Nom_Cliente || item.Cod_Cliente || 'Sin cliente';
        if (!grupos.has(key)) grupos.set(key, []);
        grupos.get(key).push(item);
      });

      function estadoKb(gItems) {
        const act = gItems.filter(i => normalizeEstadoValue(i.Estado) !== 'anulado');
        if (!act.length) return 'anulado';
        const est = act.map(i => normalizeEstadoValue(i.Estado));
        if (est.every(e => e === 'entregado')) return 'facturado';
        if (est.every(e => e === 'en_transito' || e === 'entregado')) return 'contabilizado';
        return 'pendiente';
      }

      const cols = { pendiente: [], contabilizado: [], facturado: [] };
      _gruposMap = new Map();
      grupos.forEach((gItems, cliente) => {
        const col = estadoKb(gItems);
        if (col !== 'anulado') { cols[col].push({ cliente, gItems }); _gruposMap.set(cliente, gItems); }
      });

      function kbCard(cliente, gItems, col) {
        const act = gItems.filter(i => normalizeEstadoValue(i.Estado) !== 'anulado');
        const first = gItems[0] || {};
        const fecha    = first.Fecha_Emision ? formatDate(first.Fecha_Emision) : '';
        const vendedor = escapeHtml(first.Nombre_Repartidor || first.vendedor || '');
        const totalMonto = gItems.reduce((s, i) => s + (Number(i.Monto) || 0), 0);
        const clienteJs  = escapeInlineJs(cliente);

        const filas = act.slice(0, 4).map(i => {
          const e = normalizeEstadoValue(i.Estado);
          const lbl = e === 'entregado' ? 'Facturado' : e === 'en_transito' ? 'Contabilizado' : 'Pendiente';
          const cls = e === 'entregado' ? 'kb-est--facturado' : e === 'en_transito' ? 'kb-est--cont' : 'kb-est--pend';
          const alm = i.Almacen ? `<span class="kb-entrega-alm">${escapeHtml(String(i.Almacen).toUpperCase())}</span>` : '';
          return `<div class="kb-entrega-row"><span class="kb-entrega-num">${escapeHtml(i.Nro_Acuse || i.entrega || String(i.ID_Acuse || ''))}</span>${alm}<span class="kb-entrega-est ${cls}">${lbl}</span></div>`;
        }).join('');
        const mas = act.length > 4 ? `<div class="kb-entrega-mas">+${act.length - 4} más</div>` : '';

        return `<div class="kb-chip" onclick="irAGrupoKanban('${col}','${clienteJs}')" title="Ver detalle">
          <div class="kb-chip-top">
            <svg class="kb-chip-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.582-7 8-7s8 3 8 7"/></svg>
            <span class="kb-chip-name">${escapeHtml(cliente)}</span>
          </div>
          <div class="kb-chip-info">
            ${fecha    ? `<span class="kb-chip-info-item"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="3" width="12" height="11" rx="2"/><path d="M5 1v3M11 1v3M2 7h12"/></svg>${fecha}</span>` : ''}
            ${vendedor ? `<span class="kb-chip-info-item"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="5" r="3"/><path d="M2 14c0-3 2.686-5 6-5s6 2 6 5"/></svg>${vendedor}</span>` : ''}
          </div>
          <div class="kb-entregas">${filas}${mas}</div>
          <div class="kb-chip-footer">
            <span class="kb-chip-count">${act.length} entrega${act.length !== 1 ? 's' : ''}</span>
            ${totalMonto > 0 ? `<span class="kb-chip-monto">${formatGs(totalMonto)}</span>` : ''}
          </div>
        </div>`;
      }

      const KB_COL = {
        pendiente:    { label: 'Pendiente',     cls: 'kb-col--pendiente' },
        contabilizado:{ label: 'Contabilizado', cls: 'kb-col--contabilizado' },
        facturado:    { label: 'Facturado',     cls: 'kb-col--facturado' }
      };
      let kb = '<div class="kb-board">';
      ['pendiente','contabilizado','facturado'].forEach(col => {
        const { label, cls } = KB_COL[col];
        const cards = cols[col];
        kb += `<div class="kb-col ${cls}"><div class="kb-col-header"><span class="kb-col-title">${label}</span><span class="kb-col-count">${cards.length}</span></div><div class="kb-col-body">${cards.length ? cards.map(({ cliente, gItems }) => kbCard(cliente, gItems, col)).join('') : '<div class="kb-empty">Sin pedidos</div>'}</div></div>`;
      });
      kb += '</div>';
      return kb;
    }
    // ── FIN KANBAN ───────────────────────────────────────────────────────────

    let displayItems = items;

    // Filtro de estado por KPI
    const ESTADO_POR_KPI = {
      pendientes:  new Set(['pendiente']),
      en_transito: new Set(['en_transito']),
      entregados:  new Set(['entregado']),
      anulados:    new Set(['anulado']),
      acuses:      new Set(['pendiente', 'en_transito'])   // total: solo activos
    };
    if (ESTADO_POR_KPI[kpi]) {
      displayItems = displayItems.filter(i => ESTADO_POR_KPI[kpi].has(normalizeEstadoValue(i.Estado)));
    }

    // Agrupar por cliente
    const groups = new Map();
    displayItems.forEach((item) => {
      const key = item.Nom_Cliente || item.Cod_Cliente || 'Sin cliente';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(item);
    });

    if (!groups.size) return '';

    _gruposMap = new Map();
    let html = '';

    groups.forEach((groupItems, cliente) => {
      _gruposMap.set(cliente, groupItems);

      const totalMonto = groupItems.reduce((s, i) => s + (Number(i.Monto) || 0), 0);
      const chipMonto = totalMonto > 0
        ? `<span class="tbl-group-sep">•</span><span>Total: <strong class="monto-gs">${formatGs(totalMonto)}</strong></span>`
        : '';

      const activos = groupItems.filter(i => normalizeEstadoValue(i.Estado) !== 'anulado');

      // Etiqueta y conteo directo por KPI
      const KPI_CHIP = {
        pendientes:  { label: 'Pendiente',     n: activos.filter(i => normalizeEstadoValue(i.Estado) === 'pendiente').length },
        en_transito: { label: 'Contabilizado', n: activos.filter(i => normalizeEstadoValue(i.Estado) === 'en_transito').length },
        entregados:  { label: 'Facturado',     n: activos.filter(i => normalizeEstadoValue(i.Estado) === 'entregado').length },
        anulados:    { label: 'Anulado',       n: groupItems.filter(i => normalizeEstadoValue(i.Estado) === 'anulado').length },
        acuses:      { label: 'Contabilizado', n: activos.filter(i => { const e = normalizeEstadoValue(i.Estado); return e === 'en_transito' || e === 'entregado'; }).length }
      };
      const kpiChip = KPI_CHIP[kpi] || { label: 'Entrega', n: activos.length };

      // Clase de color por KPI para la fila sticky
      const KPI_ROW_CLS = { pendientes: 'tgr--pend', en_transito: 'tgr--cont', entregados: 'tgr--fact', anulados: 'tgr--anul' };
      const rowCls = KPI_ROW_CLS[kpi] || '';

      const clienteJs = escapeInlineJs(cliente);
      const waIcon = `<img src="/assets/img/whatsapp.png" alt="WhatsApp" style="width:26px;height:26px;display:block;object-fit:contain">`;
      const waBtnHtml = kpi !== 'acuses'
        ? `<button class="tbl-group-wa-btn act-wa" onclick="event.stopPropagation();abrirPedidoContado('${clienteJs}')"><span class="tip">Enviar Pedido</span>${waIcon}</button>`
        : '';

      html += `<tr class="group-header-row ${rowCls}"><td colspan="10">
        <div class="group-header-content">
          <div class="group-vendor-name">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
            ${escapeHtml(cliente)}
          </div>
          <div class="group-vendor-stats">
            <span>${kpiChip.n} entrega${kpiChip.n !== 1 ? 's' : ''}</span>
            ${totalMonto > 0 ? `<span class="dot-sep">&bull;</span><span class="tot-monto">Total: <strong>${formatGs(totalMonto)}</strong></span>` : ''}
          </div>
          ${waBtnHtml}
        </div>
      </td></tr>`;
      html += groupItems.map((item) => renderAcuseRow(item)).join('');
    });
    return html;
  }

  function renderAcuseRow(item) {
    const acuseId = Number(item.ID_Acuse || 0);
    const estado = normalizeEstadoValue(item.Estado);
    const pending = estado === 'pendiente';
    const enTransito = estado === 'en_transito';
    const delivered = estado === 'entregado';
    const cancelled = estado === 'anulado';
    const guide = item.Nro_Acuse || `#${acuseId}`;
    const clientLabel = item.Nom_Cliente || item.Cod_Cliente || 'Sin cliente';
    const destination = item.Zona || item.Ciudad_Cliente || item.Zona_Cliente || 'Sin zona';
    const telefono = escapeHtml(item.Telefono_Cliente || item.Telef_Cliente || item.TelF_Cliente || '');
    const motivoAnulacion = escapeHtml(item.Motivo_Anulacion || '—');

    const esFabrica = (item.Almacen || '').toUpperCase() === 'FABRICA';
    const enSegmentoDeposito = (state.panelFilters.almacen || '').toUpperCase() === 'DEPOSITO';
    const traspasarBtnHtml = (esFabrica && !cancelled && !enSegmentoDeposito)
      ? `<button class="tbl-btn act-traspasar" onclick="event.stopPropagation();traspasarPedido(${acuseId}, this)"><span class="tip">Traspasar a Depósito</span>${traspasarIcon()}</button>`
      : '';

    let accionesHtml;
    if (cancelled) {
      accionesHtml = `<div class="tbl-actions tbl-actions--single">
          <div style="font-size:12px;color:#6b7280;font-weight:600;max-width:110px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${motivoAnulacion}">${motivoAnulacion}</div>
        </div>`;
    } else if (delivered) {
      accionesHtml = `<div class="tbl-actions tbl-actions--single"><span style="font-size:12px;color:#9ca3af;font-weight:600;">Facturado</span></div>`;
    } else if (pending) {
      accionesHtml = `<div class="tbl-actions">
          <button class="tbl-btn act-contabilizar" onclick="event.stopPropagation();markAcuseContabilizado(${acuseId}, this)"><span class="tip">Contabilizado</span>${contabilizarIcon()}</button>
          ${traspasarBtnHtml}
          <button class="tbl-btn act-delete" onclick="event.stopPropagation();openDeleteAcuse(${acuseId}, this)"><span class="tip">Anular</span>${deleteIcon()}</button>
        </div>`;
    } else {
      accionesHtml = `<div class="tbl-actions">
          <button class="tbl-btn act-facturar" onclick="event.stopPropagation();markAcuseFacturado(${acuseId}, this)"><span class="tip">Facturado</span>${facturarIcon()}</button>
          ${traspasarBtnHtml}
          <button class="tbl-btn act-delete" onclick="event.stopPropagation();openDeleteAcuse(${acuseId}, this)"><span class="tip">Anular</span>${deleteIcon()}</button>
        </div>`;
    }

    const pedidoVal = escapeHtml(item.pedido || item.Pedido || '');
    const solicVal  = escapeHtml(item.solicitud || item.Solicitud || '');
    const entregaStr = escapeHtml(item.entrega || String(acuseId));

    // Fecha principal según KPI activo
    let primaryDate;
    if (_renderingKpi === 'en_transito')  primaryDate = item.Fecha_Contabilizado || item.Fecha_Emision;
    else if (_renderingKpi === 'entregados') primaryDate = item.Fecha_Facturado  || item.Fecha_Emision;
    else if (_renderingKpi === 'anulados')   primaryDate = item.Fecha_Anulado    || item.Fecha_Emision;
    else                                     primaryDate = item.Fecha_Emision;

    return `<tr class="tbl-row-selectable" data-acuse-id="${acuseId}" data-entrega="${entregaStr}" onclick="selectDashboardAcuse(${acuseId})">
      <td class="td-cb" onclick="event.stopPropagation()"><label class="cb-wrap"><input type="checkbox" class="row-cb" data-entrega="${entregaStr}" onchange="cvToggleSelect('${escapeInlineJs(item.entrega || String(acuseId))}',this)"></label></td>
      <td>${escapeHtml(formatDate(primaryDate))}</td>
      <td>${copyCell(guide, false, acuseId)}</td>
      <td>${pedidoVal ? copyCell(pedidoVal, false, acuseId) : '<span style="color:#cbd5e1">—</span>'}</td>
      <td>${solicVal ? copyCell(solicVal, false, acuseId) : '<span style="color:#cbd5e1">—</span>'}</td>
      <td>${renderAlmacenBadge(item.Almacen, item.Almacen_Origen)}</td>
      <td class="monto-cell" onclick="event.stopPropagation();abrirMonto(this,'${acuseId}')" title="Click para ingresar monto">${renderMontoCell(item.Monto)}</td>
      <td class="obs-cell" onclick="event.stopPropagation();openObsView(this,'${acuseId}','${escapeInlineJs(item.Observacion||'')}','${escapeInlineJs(clientLabel)}')">${renderObservacionCell(item.Observacion)}</td>
      <td><button class="tbl-btn-ver" onclick="openDetalleModal('${acuseId}')">Ver detalles</button></td>
      ${!delivered ? `<td>${accionesHtml}</td>` : ''}
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
      const wasSelected = row.classList.contains('tbl-row-selected');
      const isHighlighted = rowId !== null && rowId === state.highlightedAcuseId;
      row.classList.toggle('tbl-row-selected', isSelected);
      row.classList.toggle('tbl-row-created', isHighlighted);
      row.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
      if (isSelected && !wasSelected) {
        row.classList.remove('tbl-row-select-pop');
        requestAnimationFrame(() => {
          row.classList.add('tbl-row-select-pop');
          setTimeout(() => row.classList.remove('tbl-row-select-pop'), 400);
        });
      }
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

  function buildDateTriggerLabel(desde, hasta) {
    if (!desde && !hasta) return 'Fechas';
    const fmt = (iso) => { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y.slice(2)}`; };
    if (desde && hasta && desde === hasta) return fmt(desde);
    if (desde && hasta) return `${fmt(desde)} – ${fmt(hasta)}`;
    if (desde) return `Desde ${fmt(desde)}`;
    return `Hasta ${fmt(hasta)}`;
  }

  let _dateModalCtx = 'panel';

  function openPanelDateModal() {
    const modal = document.getElementById('panelDateModal');
    if (!modal) return;
    _dateModalCtx = 'panel';
    document.getElementById('panelDateDesde').value = state.panelFilters.fechaDesde || '';
    document.getElementById('panelDateHasta').value = state.panelFilters.fechaHasta || '';
    updatePanelDateFooterInfo(state.panelFilters.fechaDesde, state.panelFilters.fechaHasta);
    populatePanelDateLabels();
    modal.style.display = 'flex';
    requestAnimationFrame(() => modal.classList.add('is-open'));
  }

  function openHistDateModal() {
    const modal = document.getElementById('panelDateModal');
    if (!modal) return;
    _dateModalCtx = 'hist';
    document.getElementById('panelDateDesde').value = state.history.filters.histDesde || '';
    document.getElementById('panelDateHasta').value = state.history.filters.histHasta || '';
    updatePanelDateFooterInfo(state.history.filters.histDesde, state.history.filters.histHasta);
    populatePanelDateLabels();
    modal.style.display = 'flex';
    requestAnimationFrame(() => modal.classList.add('is-open'));
  }

  function closePanelDateModal() {
    const modal = document.getElementById('panelDateModal');
    if (!modal) return;
    modal.classList.remove('is-open');
    modal.classList.add('is-closing');
    setTimeout(() => { modal.classList.remove('is-closing'); modal.style.display = 'none'; }, 250);
  }

  function applyPanelDateRange() {
    const desde = document.getElementById('panelDateDesde').value || '';
    const hasta = document.getElementById('panelDateHasta').value || '';
    if (desde && hasta && desde > hasta) {
      notify('La fecha "Desde" no puede ser mayor a "Hasta"', 'error');
      return;
    }
    if (_dateModalCtx === 'hist') {
      state.history.filters.histDesde = desde;
      state.history.filters.histHasta = hasta;
      syncHistDateTrigger();
      closePanelDateModal();
      state.history.page = 1;
      loadHistorial().catch(handleError);
    } else {
      state.panelFilters.fechaDesde = desde;
      state.panelFilters.fechaHasta = hasta;
      closePanelDateModal();
      resetPanelPages();
      loadPanel(state.activeKPI, { soft: true }).catch(handleError);
    }
  }

  function syncHistDateTrigger() {
    const btn = document.getElementById('histDateTrigger');
    const label = document.getElementById('histDateTriggerLabel');
    if (!btn || !label) return;
    const d = state.history.filters.histDesde;
    const h = state.history.filters.histHasta;
    label.textContent = buildDateTriggerLabel(d, h);
    btn.classList.toggle('active', !!(d || h));
  }

  function applyPanelQuickDate(type) {
    const today = new Date();
    const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    let desde = '', hasta = '';
    if (type === 'hoy') {
      desde = hasta = fmt(today);
    } else if (type === 'ayer') {
      const d = new Date(today); d.setDate(d.getDate() - 1); desde = hasta = fmt(d);
    } else if (type === 'semana') {
      const d = new Date(today); d.setDate(d.getDate() - 6); desde = fmt(d); hasta = fmt(today);
    } else if (type === 'mes') {
      desde = fmt(new Date(today.getFullYear(), today.getMonth(), 1)); hasta = fmt(today);
    }
    document.getElementById('panelDateDesde').value = desde;
    document.getElementById('panelDateHasta').value = hasta;
    applyPanelDateRange();
  }

  function updatePanelDateFooterInfo(desde, hasta) {
    const text = document.getElementById('panelDateFooterText');
    const info = document.getElementById('panelDateFooterInfo');
    if (!text || !info) return;
    if (desde || hasta) {
      const fmt = (iso) => { const [y,m,d] = iso.split('-'); return `${d}/${m}/${y}`; };
      text.textContent = (desde && hasta) ? `Desde ${fmt(desde)} hasta ${fmt(hasta)}`
        : desde ? `Desde ${fmt(desde)}` : `Hasta ${fmt(hasta)}`;
      info.style.color = 'var(--primary)';
    } else {
      text.textContent = 'Sin filtro aplicado';
      info.style.color = '';
    }
  }

  function populatePanelDateLabels() {
    const today = new Date();
    const fmt = (d) => d.toLocaleDateString('es-PY', { day: '2-digit', month: '2-digit' });
    const set = (id, txt) => { const el = document.getElementById('qdLabel_' + id); if (el) el.textContent = txt; };
    set('hoy', fmt(today));
    const ayer = new Date(today); ayer.setDate(ayer.getDate() - 1);
    set('ayer', fmt(ayer));
    const semD = new Date(today); semD.setDate(semD.getDate() - 6);
    set('semana', fmt(semD) + ' - ' + fmt(today));
    set('mes', fmt(new Date(today.getFullYear(), today.getMonth(), 1)) + ' - ' + fmt(today));
  }

  function initPanelDatePicker() { /* reemplazado por modal de fechas */ }

  function toggleFilter(filterId, kpi, type) {
    const shouldOpen = state.panelOpenFilter !== filterId;
    closePanelFilter();
    if (!shouldOpen) return;

    state.panelOpenFilter = filterId;
    const wrap = document.getElementById(filterId);
    const dropdown = document.getElementById(`${filterId}-dd`);
    const trigger = wrap ? wrap.querySelector('.filter-trigger') : null;
    if (!wrap || !dropdown || !trigger) return;

    state.panelFilterQuery[type] = '';
    dropdown.classList.add('open');
    trigger.classList.add('open');
    renderFilterItems(kpi, '', type).catch(handleError);
    window.setTimeout(() => {
      dropdown.querySelector('input')?.focus();
    }, 40);
  }

  async function renderFilterItems(kpi, query, type) {
    type = type || 'repartidor';
    state.panelFilterQuery[type] = query;
    const filterId = `filter-${kpi}-${type}`;

    if (type === 'cliente') {
      const response = await AcuseAPI.get('/api/clientes', { q: query });
      state.panelFilterResults.cliente = (response.items || []).slice(0, 15);
    } else {
      const response = await AcuseAPI.get('/api/vendedores', { q: query });
      state.panelFilterResults.repartidor = (response.items || []).slice(0, 15);
    }

    const list = document.getElementById(`${filterId}-list`);
    if (list) list.innerHTML = panelFilterItemsHTML(kpi, type);
  }

  function pickFilter(kpi, value, label, type) {
    type = type || 'repartidor';
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

  function clearFilter(kpi, type) {
    type = type || 'repartidor';
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
    const rowDel = document.querySelector(`#contentPanel .tbl-row-selectable[data-acuse-id="${id}"]`);
    if (rowDel) { rowDel.classList.add('row-sweep-red'); _createSweepOverlay(rowDel, 'red'); }
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
    frame.src = `/views/pedidos.html?${params.toString()}`;
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
        if (completedAction === 'annul' && completedId) {
          await new Promise(r => setTimeout(r, 120));
          const arrivedRed = document.querySelector(`#contentPanel .tbl-row-selectable[data-acuse-id="${completedId}"]`);
          if (arrivedRed) {
            arrivedRed.scrollIntoView({ behavior: 'smooth', block: 'center' });
            arrivedRed.classList.add('row-arrive-red');
            setTimeout(() => arrivedRed.classList.remove('row-arrive-red'), 1800);
          }
        }
      } catch (error) {
        notify(error.message || 'Se guardo el acuse, pero no se pudo refrescar el dashboard completo.', 'warning');
      }
    }
  }

  // ── Confirmación genérica (patrón itemsborrados portado a dark theme) ──
  function showCvConfirm(title, message, opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
      var overlay = document.createElement('div');
      overlay.className = 'cv-confirm-overlay';
      var isDanger  = Boolean(opts.danger);
      var variant   = isDanger ? 'danger' : (opts.variant || '');
      var okLabel   = opts.confirmLabel || 'Confirmar';
      var okClass   = isDanger        ? 'cv-confirm-btn--danger'
                    : variant === 'blue'  ? 'cv-confirm-btn--blue'
                    : variant === 'green' ? 'cv-confirm-btn--green'
                    : 'cv-confirm-btn--primary';
      var cardClass = 'cv-confirm-card' + (variant && variant !== 'danger' ? ' cv-confirm-card--' + variant : '');
      var iconSvg   = isDanger
        ? '<svg width="28" height="28" fill="none" stroke="#f87171" stroke-width="1.8" viewBox="0 0 24 24"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>'
        : variant === 'blue'
        ? '<svg width="32" height="32" fill="none" stroke="#2563eb" stroke-width="1.8" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path stroke-linecap="round" stroke-linejoin="round" d="M8 12l3 3 5-6"/></svg>'
        : variant === 'green'
        ? '<svg width="32" height="32" fill="none" stroke="#10b981" stroke-width="1.8" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path stroke-linecap="round" stroke-linejoin="round" d="M8 12l3 3 5-6"/></svg>'
        : '<svg width="28" height="28" fill="none" stroke="#60a5fa" stroke-width="1.8" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>';
      overlay.innerHTML =
        '<div class="' + cardClass + '" onclick="event.stopPropagation()">' +
          '<div class="cv-confirm-icon">' + iconSvg + '</div>' +
          '<h3 class="cv-confirm-title">' + escapeHtml(title) + '</h3>' +
          '<p class="cv-confirm-msg">' + escapeHtml(message) + '</p>' +
          '<div class="cv-confirm-actions">' +
            '<button class="cv-confirm-btn cv-confirm-btn--cancel" id="cvCfmCancel">Cancelar</button>' +
            '<button class="cv-confirm-btn ' + okClass + '" id="cvCfmOk">' + escapeHtml(okLabel) + '</button>' +
          '</div>' +
        '</div>';
      document.body.appendChild(overlay);
      function close(result) {
        overlay.classList.remove('is-open');
        overlay.classList.add('is-closing');
        setTimeout(function () { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); resolve(result); }, 260);
      }
      requestAnimationFrame(function () { setTimeout(function () { overlay.classList.add('is-open'); }, 10); });
      overlay.querySelector('#cvCfmCancel').onclick = function () { close(false); };
      overlay.querySelector('#cvCfmOk').onclick     = function () { close(true); };
      overlay.onclick = function (e) { if (e.target === overlay) close(false); };
    });
  }

  // ── Check/error flotante centrado (patrón itemsborrados) ──
  function showCvCheck(label, isError) {
    var overlay = document.createElement('div');
    overlay.className = 'cv-check-overlay';
    overlay.innerHTML =
      '<div class="cv-check-box">' +
        '<div class="cv-check-circle' + (isError ? ' cv-check-circle--error' : '') + '">' +
          (isError
            ? '<svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>'
            : '<svg viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>') +
        '</div>' +
        '<div class="cv-check-label">' + escapeHtml(label) + '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    requestAnimationFrame(function () {
      setTimeout(function () {
        overlay.classList.add('is-visible');
        setTimeout(function () {
          overlay.classList.add('is-exit');
          setTimeout(function () { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); }, 380);
        }, 1300);
      }, 10);
    });
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

  async function markAcuseContabilizado(id, button) {
    const usuario = resolveCurrentOperator();
    if (!usuario) { notify('Debés iniciar sesión para cambiar el estado.', 'warning'); return; }

    const ok = await showCvConfirm(
      '¿Pasar a Contabilizado?',
      'El pedido será marcado como contabilizado.',
      { confirmLabel: 'Contabilizar', variant: 'blue' }
    );
    if (!ok) return;

    setDashboardSelectedAcuse(id, { clearHighlight: false });
    const row = document.querySelector(`#contentPanel .tbl-row-selectable[data-acuse-id="${id}"]`);
    if (row) { row.classList.add('row-sweep-blue'); _createSweepOverlay(row, 'blue'); }
    if (button) button.disabled = true;

    try {
      const [res] = await Promise.allSettled([
        AcuseAPI.patch(`/api/acuses/${id}/estado`, {
          Estado: 'En Transito', Fecha_Entrega: currentDateTimeValue(),
          Usuario: usuario, Observacion: 'Cambio a Contabilizado desde dashboard'
        }),
        new Promise(r => setTimeout(r, 640))
      ]);
      if (res.status === 'rejected') throw res.reason;

      if (row) { row.classList.remove('row-sweep-blue'); row.classList.add('row-exit-blue'); }
      const itemData = resolveItemData(id);
      registrarAccion('contabilizar', usuario, itemData.Nom_Cliente || itemData.Cod_Cliente || null, itemData.Nro_Acuse || String(id), 'Pasado a Contabilizado');
      loadKpiSummary().catch(() => {});
      await new Promise(r => setTimeout(r, 300));

      await selectKPI('en_transito');

      await new Promise(r => setTimeout(r, 120));
      const arrived = document.querySelector(`#contentPanel .tbl-row-selectable[data-acuse-id="${id}"]`);
      if (arrived) {
        arrived.scrollIntoView({ behavior: 'smooth', block: 'center' });
        arrived.classList.add('row-arrive-blue');
        setTimeout(() => arrived.classList.remove('row-arrive-blue'), 1800);
      }
      showCvCheck('Contabilizado');
    } catch (error) {
      if (row) { row.classList.remove('row-sweep-blue'); row.classList.remove('row-exit-blue'); }
      if (button) button.disabled = false;
      notify(error.message, 'error');
    }
  }

  async function markAcuseFacturado(id, button) {
    const usuario = resolveCurrentOperator();
    if (!usuario) { notify('Debés iniciar sesión para cambiar el estado.', 'warning'); return; }

    const ok = await showCvConfirm(
      '¿Pasar a Facturado?',
      'El pedido será marcado como facturado.',
      { confirmLabel: 'Facturar', variant: 'green' }
    );
    if (!ok) return;

    setDashboardSelectedAcuse(id, { clearHighlight: false });
    const row = document.querySelector(`#contentPanel .tbl-row-selectable[data-acuse-id="${id}"]`);
    if (row) { row.classList.add('row-sweep-green'); _createSweepOverlay(row, 'green'); }
    if (button) button.disabled = true;

    try {
      const [res] = await Promise.allSettled([
        AcuseAPI.patch(`/api/acuses/${id}/estado`, {
          Estado: 'Entregado', Fecha_Entrega: currentDateTimeValue(),
          Usuario: usuario, Observacion: 'Cambio a Facturado desde dashboard'
        }),
        new Promise(r => setTimeout(r, 640))
      ]);
      if (res.status === 'rejected') throw res.reason;

      if (row) { row.classList.remove('row-sweep-green'); row.classList.add('row-exit-green'); }
      const itemData = resolveItemData(id);
      registrarAccion('facturar', usuario, itemData.Nom_Cliente || itemData.Cod_Cliente || null, itemData.Nro_Acuse || String(id), 'Pasado a Facturado');
      loadKpiSummary().catch(() => {});
      await new Promise(r => setTimeout(r, 300));

      await selectKPI('entregados');

      await new Promise(r => setTimeout(r, 120));
      const arrived = document.querySelector(`#contentPanel .tbl-row-selectable[data-acuse-id="${id}"]`);
      if (arrived) {
        arrived.scrollIntoView({ behavior: 'smooth', block: 'center' });
        arrived.classList.add('row-arrive-green');
        setTimeout(() => arrived.classList.remove('row-arrive-green'), 1800);
      }
      showCvCheck('Facturado');
    } catch (error) {
      if (row) { row.classList.remove('row-sweep-green'); row.classList.remove('row-exit-green'); }
      if (button) button.disabled = false;
      notify(error.message, 'error');
    }
  }

  async function traspasarPedido(id, button) {
    const usuario = resolveCurrentOperator();
    if (!usuario) { notify('Debés iniciar sesión para traspasar.', 'warning'); return; }

    const ok = await showCvConfirm(
      '¿Traspasar a Depósito?',
      'Este pedido pasará de Fábrica a Depósito. Quedará identificado como traspasado.',
      { confirmLabel: 'Traspasar' }
    );
    if (!ok) return;

    setDashboardSelectedAcuse(id, { clearHighlight: false });
    try {
      await runButtonLoading(button, async () => {
        await AcuseAPI.patch(`/api/acuses/${id}/almacen`, { Usuario: usuario });
        await refreshDashboardData({ softPanel: true });
        showCvCheck('Traspasado a Depósito');
      });
    } catch (error) {
      notify(error.message, 'error');
    }
  }
  window.traspasarPedido = traspasarPedido;

  // ── NAVEGACIÓN DESDE KANBAN ──────────────────────────────────────────────
  window.irAGrupoKanban = async function (col, cliente) {
    const kpiMap = { pendiente: 'pendientes', contabilizado: 'en_transito', facturado: 'entregados' };
    const kpi = kpiMap[col] || 'pendientes';
    await showDashboardPanel(kpi);
    setTimeout(() => {
      const rows = document.querySelectorAll('#contentPanel .tbl-group-label');
      for (const lbl of rows) {
        if (lbl.textContent.trim() === cliente) {
          const row = lbl.closest('tr');
          if (row) {
            row.scrollIntoView({ behavior: 'smooth', block: 'center' });
            row.classList.add('kb-highlight-row');
            setTimeout(() => row.classList.remove('kb-highlight-row'), 2200);
          }
          break;
        }
      }
    }, 450);
  };

  // ── MODAL PEDIDO CONTADO ─────────────────────────────────────────────────

  window.abrirPedidoContado = function (cliente) {
    const items = _gruposMap.get(cliente);
    if (!items || !items.length) return;

    const first = items[0];
    const fecha = formatDate(first.Fecha_Emision);
    const codCliente = first.solicitud || first.Solicitud || '—';
    const vendedor = first.Nombre_Repartidor || first.vendedor || '—';
    const tel = String(items.find(i => i.Telefono_Cliente)?.Telefono_Cliente || '').replace(/\D/g, '');

    // Filas de entregas
    const filasHtml = items.map(item => {
      const e = normalizeEstadoValue(item.Estado);
      const label = e === 'entregado' ? 'FACTURADO' : e === 'en_transito' ? 'CONTABILIZADO' : 'PENDIENTE';
      const colorMap = { PENDIENTE: { bg: '#FEF3C7', color: '#92400E' }, CONTABILIZADO: { bg: '#DBEAFE', color: '#1E3A8A' }, FACTURADO: { bg: '#D1FAE5', color: '#065F46' } };
      const c = colorMap[label] || colorMap.PENDIENTE;
      const monto = Number(item.Monto) || 0;
      return `<tr>
        <td class="pc-td">${escapeHtml(item.Nro_Acuse || item.entrega || String(item.ID_Acuse || ''))}</td>
        <td class="pc-td"><span class="pc-estado-badge" style="background:${c.bg};color:${c.color}">${label}</span></td>
        <td class="pc-td pc-td--monto">${monto > 0 ? formatGs(monto) : 'Gs 0'}</td>
      </tr>`;
    }).join('');

    const totalMonto = items.reduce((s, i) => s + (Number(i.Monto) || 0), 0);

    const modal = document.getElementById('pedidoContadoModal');
    if (!modal) return;

    modal.querySelector('#pc-fecha').textContent    = fecha;
    modal.querySelector('#pc-cod').textContent      = codCliente;
    modal.querySelector('#pc-nombre').textContent   = cliente;
    modal.querySelector('#pc-vendedor').textContent = vendedor;
    modal.querySelector('#pc-entregas').innerHTML   = filasHtml;
    modal.querySelector('#pc-total').textContent    = totalMonto > 0 ? formatGs(totalMonto) : 'Gs 0';
    modal.dataset.tel = tel;
    modal.dataset.cliente = cliente;

    modal.classList.add('pc-modal--open');
    document.body.style.overflow = 'hidden';
  };

  window.cerrarPedidoContado = function () {
    const modal = document.getElementById('pedidoContadoModal');
    if (!modal || !modal.classList.contains('pc-modal--open')) return;
    const dialog = modal.querySelector('.pc-modal-dialog');
    modal.classList.add('pc-modal--closing');
    const done = () => { modal.classList.remove('pc-modal--open', 'pc-modal--closing'); document.body.style.overflow = ''; };
    if (dialog) dialog.addEventListener('animationend', done, { once: true });
    else setTimeout(done, 220);
  };

  window.descargarPedidoPdf = function () {
    const card = document.getElementById('pedidoContadoCard');
    if (!card) return;
    const win = window.open('', '_blank', 'width=420,height=640');
    win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Pedido Contado</title>
      <style>
        body { font-family: 'DM Sans', Arial, sans-serif; margin: 0; padding: 24px; color: #1e293b; }
        ${Array.from(document.styleSheets).filter(s => { try { return s.cssRules; } catch(e) { return false; } })
          .flatMap(s => Array.from(s.cssRules).filter(r => r.selectorText && r.selectorText.includes('pc-')))
          .map(r => r.cssText).join('\n')}
      </style></head><body>${card.outerHTML}
      <script>window.onload=function(){window.print();window.close();}<\/script></body></html>`);
    win.document.close();
  };

  window.compartirPedidoWhatsApp = function () {
    const modal = document.getElementById('pedidoContadoModal');
    if (!modal) return;
    const tel      = modal.dataset.tel || '';
    const cliente  = modal.dataset.cliente || '';
    const items    = _gruposMap.get(cliente) || [];
    const first    = items[0] || {};
    const fecha    = formatDate(first.Fecha_Emision);
    const vendedor = first.Nombre_Repartidor || first.vendedor || '';
    const solic    = first.solicitud || first.Solicitud || '';

    const SEP = '─────────────────────';

    const lineas = items.map(i => {
      const e    = normalizeEstadoValue(i.Estado);
      const est  = e === 'entregado' ? 'Facturado' : e === 'en_transito' ? 'Contabilizado' : 'Pendiente';
      const alm  = (i.Almacen || '').toUpperCase();
      const almL = alm === 'FABRICA' ? ' | Fábrica' : alm === 'DEPOSITO' ? ' | Depósito' : '';
      const nro  = i.Nro_Acuse || i.entrega || i.ID_Acuse || '';
      const monto = Number(i.Monto) || 0;
      return `*N° ${nro}*\n_${est}${almL}_\nMonto: ${monto > 0 ? formatGs(monto) : 'Gs 0'}`;
    }).join('\n\n');

    const total = items.reduce((s, i) => s + (Number(i.Monto) || 0), 0);

    const msg = [
      '*PEDIDO CONTADO*',
      SEP,
      `Fecha:    ${fecha}`,
      `Cliente:  *${cliente}*`,
      vendedor ? `Vendedor: ${vendedor}` : null,
      solic    ? `Solic.:   ${solic}`   : null,
      SEP,
      '*DETALLE DE ENTREGAS*',
      '',
      lineas,
      SEP,
      `*TOTAL: ${total > 0 ? formatGs(total) : 'Gs 0'}*`,
      SEP,
      '_Equipo Caja Ventas — ALAS S.A._'
    ].filter(l => l !== null).join('\n');

    const url = tel
      ? `https://wa.me/${tel}?text=${encodeURIComponent(msg)}`
      : `https://wa.me/?text=${encodeURIComponent(msg)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  };

  function openWhatsAppAcuse(id, button) {
    const tel = String(button?.dataset?.tel || '').replace(/\D/g, '');
    const row = button?.closest('tr');
    const cells = row ? row.querySelectorAll('.tbl-cell-meta__text') : [];
    const guide = row?.querySelector('.guide-code')?.textContent?.trim() || `#${id}`;
    const cliente = cells[0]?.textContent?.trim() || '';
    const msg = `Hola${cliente ? `, ${cliente}` : ''}. Le contactamos por el pedido ${guide}. Ante cualquier consulta estamos a su disposición.`;
    const url = tel
      ? `https://wa.me/${tel}?text=${encodeURIComponent(msg)}`
      : `https://wa.me/?text=${encodeURIComponent(msg)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  }


  function copyCell(value, isText = false, acuseId = null) {
    const safe = escapeHtml(String(value || ''));
    const cls = isText ? 'copy-cell copy-cell--text' : 'copy-cell';
    const sel = acuseId ? `selectDashboardAcuse(${acuseId});` : '';
    return `<span class="${cls}" onclick="event.stopPropagation();${sel}copiarAlPortapapeles('${escapeInlineJs(String(value))}',this)" title="Click para copiar">
      <span class="copy-cell__val">${safe}</span>
      <svg class="copy-icon" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
      <svg class="check-icon" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24" style="display:none"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg>
    </span>`;
  }

  async function copiarAlPortapapeles(texto, chip) {
    try {
      await navigator.clipboard.writeText(texto);
    } catch (_) {
      const ta = document.createElement('textarea');
      ta.value = texto; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    }
    const copyIcon  = chip.querySelector('.copy-icon');
    const checkIcon = chip.querySelector('.check-icon');
    if (copyIcon)  copyIcon.style.display  = 'none';
    if (checkIcon) checkIcon.style.display = 'block';
    chip.classList.add('copied');
    setTimeout(() => {
      if (copyIcon)  copyIcon.style.display  = '';
      if (checkIcon) checkIcon.style.display = 'none';
      chip.classList.remove('copied');
    }, 1500);
  }

  function formatGs(value) {
    const n = Math.round(Number(value) || 0);
    if (!n) return '';
    return 'Gs ' + n.toLocaleString('es-PY');
  }

  function renderMontoCell(monto) {
    const n = Math.round(Number(monto) || 0);
    if (!n) return `<span class="cell-action-chip cell-action-chip--green">
      <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path stroke-linecap="round" d="M12 6v6l3 3"/></svg>
      Ingresar Gs
    </span>`;
    return `<span class="monto-valor">${formatGs(n)}</span>`;
  }

  function abrirMonto(cell, acuseId) {
    if (cell.querySelector('input')) return;
    const actual = Math.round(Number(cell.querySelector('.monto-valor')?.textContent?.replace(/[^0-9]/g, '')) || 0);
    cell.innerHTML = `<input class="monto-input" type="number" min="0" step="1" value="${actual || ''}" placeholder="0"
      autofocus
      onblur="guardarMonto(this,'${acuseId}')"
      onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}if(event.key==='Escape'){event.preventDefault();event.stopPropagation();this.dataset.cancel='1';this.blur();}"
    />`;
    const inp = cell.querySelector('input');
    if (inp) {
      inp.focus();
      inp.select();
      // Permite pegar montos con formato SAP/PY: "4.239.703", "Gs 4.239.703", "4,239,703"
      inp.addEventListener('paste', function (e) {
        e.preventDefault();
        const raw = (e.clipboardData || window.clipboardData).getData('text');
        // Quitar prefijo "Gs", puntos/comas de miles y espacios; quedan solo dígitos
        const clean = raw.replace(/gs\s*/i, '').replace(/[.,\s]/g, '').replace(/\D/g, '');
        if (clean) this.value = clean;
      });
    }
  }

  async function guardarMonto(input, acuseId) {
    if (input.dataset.cancel === '1') {
      loadPanel(state.activeKPI, { soft: true }).catch(handleError);
      return;
    }
    const valor = Math.round(Number(input.value) || 0);
    const cell = input.closest('td');
    if (cell) cell.innerHTML = renderMontoCell(valor);

    try {
      await AcuseAPI.patch(`/api/acuses/${encodeURIComponent(acuseId)}/monto`, { Monto: valor });
      const row = document.querySelector(`tr[data-acuse-id="${acuseId}"]`);
      if (row) recalcularTotalGrupo(row);
    } catch (e) {
      notify('No se pudo guardar el monto.', 'error');
    }
  }

  function recalcularTotalGrupo(acuseRow) {
    // Caminar hacia atrás para encontrar el encabezado del grupo (funciona para cualquier posición)
    let groupRow = acuseRow.previousElementSibling;
    while (groupRow && !groupRow.classList.contains('tbl-group-row')) {
      groupRow = groupRow.previousElementSibling;
    }
    if (!groupRow) return;

    // Sumar todos los montos del grupo
    let sibling = groupRow.nextElementSibling;
    let total = 0;
    let count = 0;
    while (sibling && !sibling.classList.contains('tbl-group-row')) {
      const montoEl = sibling.querySelector('.monto-valor');
      if (montoEl) total += Number(montoEl.textContent.replace(/[^0-9]/g, '')) || 0;
      count++;
      sibling = sibling.nextElementSibling;
    }

    const chip = groupRow.querySelector('.tbl-group-chip');
    if (!chip) return;
    const montoHtml = total > 0
      ? `<span class="tbl-group-sep">•</span><span>Total: <strong class="monto-gs">${formatGs(total)}</strong></span>`
      : '';
    chip.innerHTML = `<span>${count} entrega${count !== 1 ? 's' : ''}</span>${montoHtml}`;
  }

  function renderObservacionCell(obs) {
    const texto = String(obs || '').trim();
    if (!texto) {
      return `<span class="cell-action-chip cell-action-chip--purple">
        <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
        Agregar nota
      </span>`;
    }
    const MAX = 70;
    const isLong = texto.length > MAX;
    const display = isLong ? texto.slice(0, MAX) + '…' : texto;
    return `<span class="obs-chip${isLong ? ' obs-chip--long' : ''}" title="${escapeHtml(texto)}">
      <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
      <span class="obs-chip__text">${escapeHtml(display)}</span>
    </span>`;
  }

  // ── Modal de observación completa ──────────────────────────────────────────
  let _obsCellRef = null;

  function openObsView(cell, acuseId, obs, clientLabel) {
    const texto = String(obs || '').trim();
    if (!texto) { abrirObservacion(cell, acuseId); return; }
    _obsCellRef = cell;
    _showObsModal(acuseId, texto, clientLabel || '');
  }

  function _showObsModal(acuseId, texto, clientLabel) {
    let overlay = document.getElementById('obsModalOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'obsModalOverlay';
      overlay.className = 'obs-modal-overlay';
      overlay.innerHTML = `
        <div class="obs-modal-card" onclick="event.stopPropagation()">
          <div class="obs-modal-header">
            <div class="obs-modal-header__icon">
              <svg width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
            </div>
            <div class="obs-modal-header__info">
              <span class="obs-modal-header__title">Observación</span>
              <span class="obs-modal-header__sub" id="obsModalSub"></span>
            </div>
            <button class="obs-modal-close" onclick="closeObsModal()" aria-label="Cerrar">
              <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M6 6l12 12M6 18L18 6"/></svg>
            </button>
          </div>
          <div class="obs-modal-body" id="obsModalBody"></div>
          <div class="obs-modal-footer">
            <button class="obs-modal-btn obs-modal-btn--cancel" onclick="closeObsModal()">Cerrar</button>
            <button class="obs-modal-btn obs-modal-btn--edit" id="obsModalEditBtn">
              <svg width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
              Editar
            </button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      overlay.addEventListener('click', function (e) { if (e.target === overlay) closeObsModal(); });
    }

    const sub  = overlay.querySelector('#obsModalSub');
    const body = overlay.querySelector('#obsModalBody');
    const editBtn = overlay.querySelector('#obsModalEditBtn');

    if (sub)  sub.textContent  = clientLabel ? clientLabel + ' · #' + acuseId : '#' + acuseId;
    if (body) body.innerHTML   = `<p class="obs-modal-text">${escapeHtml(texto)}</p>`;
    if (editBtn) {
      editBtn.onclick = function () { window.editarObsModal(acuseId); };
    }

    requestAnimationFrame(function () {
      setTimeout(function () { overlay.classList.add('is-open'); }, 10);
    });
  }

  window.closeObsModal = function () {
    const overlay = document.getElementById('obsModalOverlay');
    if (!overlay) return;
    overlay.classList.remove('is-open');
    overlay.classList.add('is-closing');
    setTimeout(function () { overlay.classList.remove('is-closing'); }, 280);
  };

  window.editarObsModal = function (acuseId) {
    const cell = _obsCellRef;
    window.closeObsModal();
    setTimeout(function () { if (cell) abrirObservacion(cell, acuseId); }, 250);
  };

  window.openObsView = openObsView;

  function abrirObservacion(cell, acuseId) {
    if (cell.querySelector('textarea')) return;
    const textoActual = cell.querySelector('.obs-text')?.textContent?.trim() || '';
    cell.innerHTML = `
      <textarea class="obs-textarea" rows="2" placeholder="Escribir observación..." autofocus
        onblur="guardarObservacion(this,'${acuseId}')"
        onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();this.blur();}if(event.key==='Escape'){event.preventDefault();event.stopPropagation();this.dataset.cancel='1';this.blur();}"
      >${escapeHtml(textoActual)}</textarea>`;
    const ta = cell.querySelector('textarea');
    if (ta) { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); }
  }

  async function guardarObservacion(textarea, acuseId) {
    if (textarea.dataset.cancel === '1') {
      loadPanel(state.activeKPI, { soft: true }).catch(handleError);
      return;
    }
    const valor = textarea.value.trim();
    const cell = textarea.closest('td');
    if (cell) cell.innerHTML = renderObservacionCell(valor);

    try {
      await AcuseAPI.patch(`/api/acuses/${encodeURIComponent(acuseId)}/observacion`, { Observacion: valor });
    } catch (e) {
      notify('No se pudo guardar la observación.', 'error');
    }
  }

  function ensureDetalleModal() {
    let overlay = document.getElementById('detalleModalOverlay');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'detalle-overlay';
      overlay.id = 'detalleModalOverlay';
      overlay.innerHTML = `
        <div class="detalle-backdrop" onclick="closeDetalleModal()"></div>
        <div class="detalle-card">
          <button class="detalle-close" onclick="closeDetalleModal()" aria-label="Cerrar">
            <svg width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" d="M6 6l12 12M6 18L18 6"/></svg>
          </button>
          <div class="detalle-header" id="detalleHeader">
            <div class="detalle-header__top">
              <div class="detalle-cliente-name" id="detalleCliente">—</div>
              <div class="detalle-header__badges" id="detalleBadges"></div>
            </div>
            <div class="detalle-entrega-num" id="detalleEntrega">—</div>
            <div class="detalle-header__kpis" id="detalleHeaderKpis"></div>
          </div>
          <div class="detalle-body" id="detalleBody">
            <div class="detalle-loader"><div class="detalle-spinner"></div>Cargando detalle...</div>
          </div>
        </div>`;
      document.body.appendChild(overlay);
    }
    return overlay;
  }

  async function openDetalleModal(id) {
    const overlay = ensureDetalleModal();
    const body = document.getElementById('detalleBody');
    const entregaEl = document.getElementById('detalleEntrega');
    const clienteEl = document.getElementById('detalleCliente');
    const badgesEl = document.getElementById('detalleBadges');

    if (body) body.innerHTML = '<div class="detalle-loader"><div class="detalle-spinner"></div>Cargando detalle...</div>';
    if (entregaEl) entregaEl.textContent = '—';
    if (clienteEl) clienteEl.textContent = '—';
    if (badgesEl) badgesEl.innerHTML = '';
    overlay.classList.add('open');

    try {
      const acuse = await AcuseAPI.get(`/api/acuses/${encodeURIComponent(id)}`);

      if (clienteEl) clienteEl.textContent = acuse.Nom_Cliente || acuse.Cod_Cliente || '—';
      if (entregaEl) entregaEl.innerHTML = `<span class="detalle-entrega-label">Entrega</span>${escapeHtml(acuse.Nro_Acuse || acuse.entrega || String(id))}`;
      if (badgesEl) badgesEl.innerHTML = renderStatusBadge(acuse.Estado) + (acuse.Almacen ? ' ' + renderAlmacenBadge(acuse.Almacen, acuse.Almacen_Origen) : '');

      const detalles = acuse.detalles || [];
      const pedido = escapeHtml(acuse.pedido || '—');
      const solicitud = escapeHtml(acuse.solicitud || '—');
      const fecha = escapeHtml(formatDateTime(acuse.Fecha_Emision));
      const vendedor = escapeHtml(acuse.Nombre_Repartidor || '—');
      const totalUnidades = detalles.reduce((s, d) => s + Number(d.Cantidad || 0), 0);

      const headerKpisEl = document.getElementById('detalleHeaderKpis');
      if (headerKpisEl) {
        const monto = Number(acuse.Monto) || 0;
        const dkpi = (icon, lbl, val) =>
          `<div class="dh-kpi"><div class="dh-kpi__icon">${icon}</div><span class="dh-kpi__val">${val}</span><span class="dh-kpi__lbl">${lbl}</span></div>`;
        const svgBox  = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/></svg>';
        const svgHash = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="4" y1="9" x2="20" y2="9"/><line x1="4" y1="15" x2="20" y2="15"/><line x1="10" y1="3" x2="8" y2="21"/><line x1="16" y1="3" x2="14" y2="21"/></svg>';
        const svgGs   = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>';
        headerKpisEl.innerHTML =
          dkpi(svgBox,  'Líneas',    detalles.length || 0) +
          dkpi(svgHash, 'Unidades',  formatNumber(totalUnidades)) +
          (monto > 0 ? dkpi(svgGs, 'Monto', formatGs(monto)) : '');
      }

      const lineasHtml = detalles.length
        ? detalles.map((d) => `<tr>
            <td><span class="detalle-material">${escapeHtml(d.Cod_Mercaderia || '—')}</span></td>
            <td>${escapeHtml(d.Descr_SAP || '—')}</td>
            <td class="detalle-td-num">${formatNumber(d.Cantidad || 0)}</td>
            <td class="detalle-td-unit">${escapeHtml(d.UM || '—')}</td>
          </tr>`).join('')
        : `<tr><td colspan="4" style="text-align:center;padding:24px;color:#94a3b8;font-weight:600">Sin líneas registradas</td></tr>`;

      // Derivar fechas de transición del historial (ORDER BY Fecha DESC → buscar de atrás = más antigua)
      const _hist = acuse.historial || [];
      const _histDateOf = (estado) => {
        const n = estado.toLowerCase();
        for (let i = _hist.length - 1; i >= 0; i--) {
          if (String(_hist[i].Estado || '').toLowerCase() === n) return _hist[i].Fecha;
        }
        return null;
      };
      // Convertir datetime UTC (MySQL NOW()) a hora Paraguay (America/Asuncion, incluye DST)
      const _toLocalDT = (v) => {
        if (!v) return null;
        const raw = String(v).trim().replace(' ', 'T');
        const date = new Date(raw.includes('Z') || raw.includes('+') ? raw : raw + 'Z');
        if (isNaN(date)) return formatDateTime(v);
        try {
          const parts = new Intl.DateTimeFormat('es-PY', {
            timeZone: 'America/Asuncion',
            day: '2-digit', month: '2-digit', year: 'numeric',
            hour: '2-digit', minute: '2-digit', hour12: false
          }).formatToParts(date);
          const get = (t) => (parts.find(p => p.type === t) || {}).value || '00';
          return `${get('day')}/${get('month')}/${get('year')} ${get('hour')}:${get('minute')}`;
        } catch (e) {
          return formatDateTime(v);
        }
      };

      const rawContab = acuse.Fecha_Contabilizado || _histDateOf('En Transito');
      const rawFact   = acuse.Fecha_Facturado     || _histDateOf('Entregado');
      const rawAnul   = acuse.Fecha_Anulado       || _histDateOf('Anulado');

      const fContab    = rawContab ? escapeHtml(_toLocalDT(rawContab)) : null;
      const fFact      = rawFact   ? escapeHtml(_toLocalDT(rawFact))   : null;
      const fAnul      = rawAnul   ? escapeHtml(_toLocalDT(rawAnul))   : null;
      const isAnulado  = (acuse.Estado || '').toLowerCase() === 'anulado';
      const isTraspasado = String(acuse.Almacen_Origen || '').toUpperCase() === 'FABRICA';

      const elCreCont  = calcElapsed(acuse.Fecha_Emision, rawContab);
      const elContFact = calcElapsed(rawContab,           rawFact);
      const elTotal    = calcElapsed(acuse.Fecha_Emision, rawFact);
      const elEnCurso  = calcElapsed(acuse.Fecha_Emision,        null);

      const elapsedBlock = (() => {
        const svgClock = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';
        if (isAnulado) return '';
        if (elTotal) {
          const breakdown = (elCreCont && elContFact)
            ? `<div class="tl-el__breakdown"><span>Creado → Cont. <b>${elCreCont}</b></span><span class="tl-el__dot">·</span><span>Cont. → Fact. <b>${elContFact}</b></span></div>`
            : '';
          return `<div class="tl-elapsed">
            ${svgClock}
            <div class="tl-elapsed__body">
              <div class="tl-elapsed__main">
                <span class="tl-el__lbl">Creado → Facturado</span>
                <span class="tl-el__val tl-el__val--total">${elTotal}</span>
              </div>
              ${breakdown}
            </div>
          </div>`;
        }
        if (elCreCont) {
          return `<div class="tl-elapsed tl-elapsed--partial">
            ${svgClock}
            <div class="tl-elapsed__body">
              <div class="tl-elapsed__main">
                <span class="tl-el__lbl">Creado → Contabilizado</span>
                <span class="tl-el__val tl-el__val--partial">${elCreCont}</span>
              </div>
              <div class="tl-el__breakdown"><span>En curso · <b>${elEnCurso}</b> desde la creación</span></div>
            </div>
          </div>`;
        }
        return `<div class="tl-elapsed tl-elapsed--pending">
          ${svgClock}
          <div class="tl-elapsed__body">
            <div class="tl-elapsed__main">
              <span class="tl-el__lbl">Pendiente</span>
              <span class="tl-el__val tl-el__val--pending">${elEnCurso} desde la creación</span>
            </div>
          </div>
        </div>`;
      })();

      const timelineStep = (icon, label, dateStr, done, variant) => `
        <div class="tl-step${done ? ' tl-step--done' : ' tl-step--pending'}${variant ? ' tl-step--' + variant : ''}">
          <div class="tl-step__track"><div class="tl-step__dot">${icon}</div><div class="tl-step__line"></div></div>
          <div class="tl-step__content">
            <span class="tl-step__label">${label}</span>
            <span class="tl-step__date">${dateStr || '<em>Pendiente</em>'}</span>
          </div>
        </div>`;

      const svgCreado    = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>';
      const svgCheck     = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>';
      const svgBill      = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>';
      const svgAnul      = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
      const svgTraspaso  = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M4 12h16M12 5l7 7-7 7" stroke-linecap="round" stroke-linejoin="round"/></svg>';

      const obsTexto = String(acuse.Observacion || '').trim();
      const obsBlock = obsTexto
        ? `<div class="detalle-obs-block">
            <div class="detalle-obs-label">
              <svg width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
              Última observación
            </div>
            <p class="detalle-obs-text">${escapeHtml(obsTexto)}</p>
          </div>`
        : '';

      if (body) body.innerHTML = `
        <div class="detalle-chips">
          <div class="detalle-chip"><span class="detalle-chip__label">Pedido</span><span class="detalle-chip__val">${pedido}</span></div>
          <div class="detalle-chip"><span class="detalle-chip__label">Solicitud</span><span class="detalle-chip__val">${solicitud}</span></div>
          <div class="detalle-chip"><span class="detalle-chip__label">Vendedor</span><span class="detalle-chip__val">${vendedor}</span></div>
        </div>
        ${obsBlock}
        <div class="detalle-section-title">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          Seguimiento
        </div>
        <div class="detalle-timeline">
          ${timelineStep(svgCreado,   'Creado',               fecha,   true)}
          ${isTraspasado ? timelineStep(svgTraspaso, 'Traspasado · Fáb → Dep', null, true, 'traspaso') : ''}
          ${timelineStep(svgCheck,    'Contabilizado',         fContab, Boolean(fContab))}
          ${timelineStep(svgBill,     'Facturado',             fFact,   Boolean(fFact))}
          ${isAnulado || fAnul ? timelineStep(svgAnul, 'Anulado', fAnul, Boolean(fAnul), 'anulado') : ''}
        </div>
        ${elapsedBlock}
        <div>
          <div class="detalle-section-title">Líneas de entrega</div>
          <div class="detalle-table-wrap">
            <table class="detalle-table">
              <thead><tr><th>Material</th><th>Denominación</th><th>Ctd. Entrega</th><th>Unidad</th></tr></thead>
              <tbody>${lineasHtml}</tbody>
            </table>
          </div>
          ${detalles.length ? `<div class="detalle-total"><span>Total unidades</span><strong>${formatNumber(totalUnidades)}</strong></div>` : ''}
        </div>`;
    } catch (e) {
      if (body) body.innerHTML = `<div class="detalle-loader" style="color:#ef4444">No se pudo cargar el detalle.</div>`;
    }
  }

  function closeDetalleModal() {
    const overlay = document.getElementById('detalleModalOverlay');
    if (!overlay || !overlay.classList.contains('open')) return;
    const card = overlay.querySelector('.detalle-card');
    overlay.classList.add('is-closing');
    const done = () => overlay.classList.remove('open', 'is-closing');
    if (card) card.addEventListener('animationend', done, { once: true });
    else setTimeout(done, 220);
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

        const exportRows = await fetchDetailedAcusesForExport(rows);
        const csv = buildExportCsv(exportRows, state.activeKPI);
        downloadCsv(csv, acuseExportFilename(currentExportDate()));
        notify('Exportacion completa generada.', 'success');
      });
    } catch (error) {
      notify(error.message, 'error');
    }
  }

  async function fetchAllCurrentPanelRows() {
    const exportKpi = normalizeDashboardKpi(state.activeKPI, { fallback: 'acuses' });
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

    ['viewResumen', 'viewDashboard', 'viewCalendario', 'viewHistorial', 'viewCargarDatos'].forEach((id) => {
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
      syncActiveKpiCards();
      syncDashboardChrome();
      window.syncLastImportChip?.();
      syncPanelMonthLabel();
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
      return;
    }

    if (view === 'cargarDatos') {
      const node = document.getElementById('viewCargarDatos');
      if (node) {
        node.style.display = 'flex';
        syncSidebarActiveState();
        playViewEntrance(node);
        if (window.volverAlDropzone) volverAlDropzone();
      }
      return;
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
            <p>Selecciona un día para ver los pedidos</p>
            <p class="cal-empty-hint">Los días marcados se calculan desde tu base de datos real</p>
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
          <p>Sin pedidos para el ${formatLongDay(date)}</p>
          <p class="cal-empty-hint">Este día no tiene pedidos registrados</p>
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

  function scrollToCalDetail() {
    requestAnimationFrame(() => {
      const canvas = document.querySelector('.canvas');
      const detail = document.getElementById('calDayDetail');
      if (!canvas || !detail) return;
      const offsetInCanvas = detail.getBoundingClientRect().top
                           - canvas.getBoundingClientRect().top
                           + canvas.scrollTop;
      canvas.scrollTo({ top: Math.max(0, offsetInCanvas - 20), behavior: 'smooth' });
    });
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
          <p>Cargando pedidos del día...</p>
        </div>
      </div>`;
    scrollToCalDetail();

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
        scrollToCalDetail();
        return;
      }

      detail.innerHTML = `
        <div class="cal-detail-panel">
          <div class="cal-detail-header">
            <div class="cal-detail-title"><span class="dot"></span> Pedidos del ${formatLongDay(date)}</div>
            <div class="panel-badge" style="background:var(--purple-soft);color:#6D28D9">${formatNumber(items.length)} entrega${items.length === 1 ? '' : 's'}</div>
          </div>
          <div class="table-wrapper"><table>
            <thead><tr><th>Fecha</th><th>Entrega</th><th>Pedido</th><th>Solic.</th><th>Cliente</th><th>Almacén</th><th>Estado</th></tr></thead>
            <tbody>${items.map((item) => `<tr>
              <td>${escapeHtml(item.Fecha_Emision || '--')}</td>
              <td><span class="guide-code">${escapeHtml(item.entrega || item.Nro_Acuse || '--')}</span></td>
              <td>${escapeHtml(item.pedido || '--')}</td>
              <td>${escapeHtml(item.solicitud || '--')}</td>
              <td>${escapeHtml(item.Nom_Cliente || item.Cod_Cliente || 'Sin cliente')}</td>
              <td>${escapeHtml(item.Almacen || '--')}</td>
              <td>${renderStatusBadge(item.Estado)}</td>
            </tr>`).join('')}</tbody>
          </table></div>
        </div>`;
      scrollToCalDetail();
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
    const params = { limit: HISTORY_MAX_ROWS };
    if (state.history.filters.histDesde) params.fechaDesde = state.history.filters.histDesde;
    if (state.history.filters.histHasta) params.fechaHasta = state.history.filters.histHasta;
    if (state.history.filters.usuario)   params.usuario    = state.history.filters.usuario;
    if (state.history.filters.cliente)   params.cliente    = state.history.filters.cliente;

    const sb = window.Supabase;
    if (!sb || !sb.getAuditoria) { renderHistorial(); return; }

    const response = await sb.getAuditoria(params);
    const raw = Array.isArray(response.items) ? response.items : [];

    const items = raw.map(r => ({
      Fecha:      r.created_at,
      Usuario:    r.usuario || 'Sistema',
      Accion:     r.accion,
      Tipo:       r.accion,
      Observacion: r.detalle,
      Cliente:    r.cliente,
      Nro_Acuse:  r.entrega,
      ID_Acuse:   null
    }));

    state.history.response = { total: response.total || items.length, items };
    state.history.suggestions.usuario = uniqueValues(items, 'Usuario');
    state.history.suggestions.cliente = uniqueValues(items, 'Cliente');
    renderHistorial();
  }

  function _createSweepOverlay(row, color) {
    const rect = row.getBoundingClientRect();
    const wrap = document.createElement('div');
    wrap.className = 'sweep-overlay';
    wrap.style.cssText = `position:fixed;top:${rect.top}px;left:${rect.left}px;width:${rect.width}px;height:${rect.height}px;z-index:50;`;
    const beam = document.createElement('div');
    beam.className = `sweep-beam sweep-beam--${color}`;
    wrap.appendChild(beam);
    document.body.appendChild(wrap);
    setTimeout(() => wrap.remove(), 700);
  }

  function registrarAccion(accion, usuario, cliente, entrega, detalle) {
    try {
      const sb = window.Supabase;
      if (sb && sb.registrarAuditoria) {
        sb.registrarAuditoria(accion, usuario || 'Sistema', cliente || null, entrega ? String(entrega) : null, detalle || '').catch(() => {});
      }
    } catch (_) {}
  }

  function resolveItemData(id) {
    const items = state.panelResponse && Array.isArray(state.panelResponse.items) ? state.panelResponse.items : [];
    return items.find(i => String(i.ID_Acuse || i.id || '') === String(id)) || {};
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
    const cityRaw = item.Ciudad || item.Zona || item.Ciudad_Cliente || item.Zona_Cliente || '';
    const cityValid = cityRaw && cityRaw.toUpperCase() !== 'CIUDAD' && cityRaw.trim().length > 1;
    const cityStr = cityValid ? ` · ${escapeHtml(cityRaw)}` : '';
    const meta = `${formatDateTime(item.Fecha)}${cityStr}`;

    return `<div class="hist-item">
      <div class="hist-dot-col"><div class="hist-dot ${historyClass(type)}">${historyIcon(type)}</div></div>
      <div class="hist-body">
        <div class="hist-text">${historyText(type, item)}</div>
        <div class="hist-meta">${meta}</div>
      </div>
    </div>`;
  }

  function mapHistoryType(item) {
    const a = String(item.Accion || item.Tipo || '').toLowerCase();
    if (a === 'facturar') return 'entregado';
    if (a === 'contabilizar') return 'estado';
    if (a === 'creacion' || a === 'importacion_excel') return 'creado';
    if (a === 'anulacion' || a === 'eliminacion' || a === 'bulk_anular') return 'eliminado';
    if (a === 'traspaso_almacen' || a === 'cambio_estado' || a === 'bulk_estado') return 'estado';
    if (a.includes('impres')) return 'impreso';
    if (a.includes('factur')) return 'entregado';
    if (a.includes('contabiliz')) return 'estado';
    if (a.includes('anul') || a.includes('elim')) return 'eliminado';
    if (a.includes('cre')) return 'creado';
    if (a.includes('estado') || a.includes('transito') || a.includes('traspas')) return 'estado';
    return 'editado';
  }

  function historyIcon(type) {
    if (type === 'creado')   return '<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M12 4v16m8-8H4"/></svg>';
    if (type === 'eliminado') return '<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>';
    if (type === 'impreso')  return '<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"/></svg>';
    if (type === 'entregado') return '<svg fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24"><path d="M5 13l4 4L19 7"/></svg>';
    if (type === 'estado')   return '<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"/></svg>';
    return '<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>';
  }

  function historyClass(type) {
    if (type === 'creado')   return 'h-create';
    if (type === 'eliminado') return 'h-delete';
    if (type === 'impreso')  return 'h-print';
    if (type === 'entregado') return 'h-deliver';
    if (type === 'estado')   return 'h-estado';
    return 'h-edit';
  }

  function historyText(type, item) {
    const user    = escapeHtml(item.Usuario || 'Sistema');
    const accion  = String(item.Accion || '').toLowerCase();
    const detalle = escapeHtml(item.Observacion || '');
    const entrega = item.Nro_Acuse ? `<strong>${escapeHtml(String(item.Nro_Acuse))}</strong>` : null;
    const cliente = item.Cliente ? ` del cliente <strong>${escapeHtml(item.Cliente)}</strong>` : '';

    if (accion === 'importacion_excel') {
      return `<strong>${user}</strong> importó datos desde Excel · <span style="color:#6b7280">${detalle}</span>`;
    }
    if (accion === 'contabilizar') {
      return `<strong>${user}</strong> contabilizó la entrega ${entrega || '—'}${cliente}`;
    }
    if (accion === 'facturar') {
      return `<strong>${user}</strong> facturó la entrega ${entrega || '—'}${cliente}`;
    }
    if (accion === 'anulacion') {
      return `<strong>${user}</strong> anuló la entrega ${entrega || '—'}${cliente}`;
    }
    if (accion === 'traspaso_almacen') {
      return `<strong>${user}</strong> traspasó ${entrega ? entrega + ' ' : ''}de Fábrica a Depósito${cliente}`;
    }
    if (accion === 'bulk_estado') {
      return `<strong>${user}</strong> cambió en masa · <span style="color:#6b7280">${detalle}</span>`;
    }
    if (accion === 'bulk_anular') {
      return `<strong>${user}</strong> anuló en masa · <span style="color:#6b7280">${detalle}</span>`;
    }
    if (accion === 'cambio_estado') {
      return `<strong>${user}</strong> cambió estado${entrega ? ' de ' + entrega : ''}${cliente} · <span style="color:#6b7280">${detalle}</span>`;
    }
    if (accion === 'creacion') {
      return `<strong>${user}</strong> creó el pedido ${entrega || '—'}${cliente}`;
    }
    if (accion === 'eliminacion') {
      return `<strong>${user}</strong> eliminó permanentemente ${entrega || 'un pedido'}${cliente}`;
    }
    // Fallback por tipo
    if (type === 'creado')    return `<strong>${user}</strong> creó la entrega ${entrega || '—'}${cliente}`;
    if (type === 'eliminado') return `<strong>${user}</strong> anuló la entrega ${entrega || '—'}${cliente}`;
    if (type === 'entregado') return `<strong>${user}</strong> facturó la entrega ${entrega || '—'}${cliente}`;
    if (type === 'estado')    return `<strong>${user}</strong> cambió ${entrega || '—'}${cliente} · <span style="color:#6b7280">${detalle}</span>`;
    if (type === 'impreso')   return `<strong>${user}</strong> imprimió ${entrega || '—'}${cliente}`;
    return `<strong>${user}</strong> editó la entrega ${entrega || '—'}${cliente}`;
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

    syncHistDateTrigger();
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
      state.history.filters.histDesde = '';
      state.history.filters.histHasta = '';
      state.history.filters.usuario = '';
      state.history.filters.cliente = '';
      state.history.page = 1;
      closeHistoryFilters();
      renderHistoryTriggerState();
      await loadHistorial();
    });
  }

  async function clearCurrentPanelFilters(button) {
    await runButtonLoading(button, async () => {
      state.panelFilters.fechaDesde = '';
      state.panelFilters.fechaHasta = '';
      state.panelFilters.clienteCode = '';
      state.panelFilters.clienteLabel = '';
      state.panelFilters.repartidorId = '';
      state.panelFilters.repartidorLabel = '';
      state.panelFilters.condExp = '';
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
    requestAnimationFrame(() => {
      node.classList.add('view-enter');
      // Limpiar al terminar la animación (--alas-dur-page = 420ms)
      window.setTimeout(() => node.classList.remove('view-enter'), 440);
    });
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
    if (key === 'en_transito') return 'Contabilizado';
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

  function renderAlmacenBadge(almacen, almacenOrigen) {
    const val = String(almacen || '').trim().toUpperCase();
    if (!val) return '<span class="alm-badge__empty">—</span>';
    const isFabrica    = val === 'FABRICA';
    const isTraspasado = !isFabrica && String(almacenOrigen || '').toUpperCase() === 'FABRICA';
    const cls   = isFabrica ? 'alm-badge--fabrica' : isTraspasado ? 'alm-badge--traspasado' : 'alm-badge--deposito';
    const label = isFabrica ? 'Fábrica' : isTraspasado ? 'Dep. ⇄ Fab' : 'Depósito';
    const icon  = isFabrica
      ? '<svg class="alm-badge__icon" viewBox="0 0 14 12" fill="none"><path d="M1 11V6l3.5-2.5V6L8 3.5V6l3.5-2.5V11H1z" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/></svg>'
      : '<svg class="alm-badge__icon" viewBox="0 0 14 12" fill="none"><path d="M1 5.5L7 2l6 3.5V11H1V5.5z" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/><path d="M5 11V8h4v3" stroke="currentColor" stroke-width="1.25"/></svg>';
    return `<span class="alm-badge ${cls}" title="${isTraspasado ? 'Traspasado de Fábrica a Depósito' : ''}">${icon}${label}</span>`;
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

  function calcElapsed(from, to) {
    if (!from) return null;
    const start = new Date(String(from).replace(' ', 'T'));
    const end   = to ? new Date(String(to).replace(' ', 'T')) : new Date();
    if (isNaN(start)) return null;
    const diffMs = end - start;
    if (diffMs < 0) return null;
    const totalMin = Math.floor(diffMs / 60000);
    const days  = Math.floor(totalMin / 1440);
    const hours = Math.floor((totalMin % 1440) / 60);
    const mins  = totalMin % 60;
    if (days > 0)  return hours > 0 ? `${days}d ${hours}h` : `${days}d`;
    if (hours > 0) return mins > 0 ? `${hours}h ${mins}min` : `${hours}h`;
    return `${mins}min`;
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
    if (!periodo || (!periodo.scope && !periodo.year && !periodo.month && !periodo.anchor)) return;
    const scope = periodo.scope === 'week' ? 'week' : 'month';
    state.calendar.scope = scope;
    if (scope === 'week') {
      setPeriodAnchor(state.calendar, periodo.anchor || state.calendar.anchorDate || TODAY_ISO);
      return;
    }
    const year = Number(periodo.year);
    const month = Number(periodo.month);
    if (Number.isFinite(year) && Number.isFinite(month)) {
      setPeriodMonth(state.calendar, year, month);
    }
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
    let estadoDia = '';
    if (summary && Number(summary.total || 0) > 0) {
      classes += ' has-acuses';
      const hasPend = Number(summary.pendientes || 0) > 0;
      const hasCont = Number(summary.contabilizados || 0) > 0;
      const hasFact = Number(summary.facturados || 0) > 0;
      if (hasPend) { estadoDia = 'pendiente'; classes += ' status-pendiente'; }
      else if (hasCont) { estadoDia = 'contabilizado'; classes += ' status-contabilizado'; }
      else if (hasFact) { estadoDia = 'entregado'; classes += ' status-entregado'; }
    }
    if (isSelected) classes += ' selected';

    let dotsHtml = '';
    if (summary && Number(summary.total || 0) > 0) {
      const dotItems = [];
      if (Number(summary.pendientes || 0) > 0)    dotItems.push('<div class="cal-dot cal-dot--pend"></div>');
      if (Number(summary.contabilizados || 0) > 0) dotItems.push('<div class="cal-dot cal-dot--cont"></div>');
      if (Number(summary.facturados || 0) > 0)    dotItems.push('<div class="cal-dot cal-dot--fact"></div>');
      dotsHtml = `<div class="cal-dots">${dotItems.join('')}</div>`;
    }
    const dots = dotsHtml;
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
    return '<svg fill="none" stroke="currentColor" stroke-width="1.75" viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6" stroke-linecap="round"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>';
  }

  function verDetalleIcon() {
    return '<svg fill="none" stroke="currentColor" stroke-width="1.75" viewBox="0 0 24 24" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
  }

  function whatsappIcon() {
    return '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path fill="currentColor" stroke="none" d="M17.6 6.32A8.86 8.86 0 0012.05 4a8.94 8.94 0 00-7.73 13.41L3 21l3.68-1.3A8.93 8.93 0 0012 21h.05a8.94 8.94 0 008.95-8.95 8.88 8.88 0 00-3.4-5.73zm-5.55 13.74h-.05a7.43 7.43 0 01-3.79-1.04l-.27-.16-2.82 1 .96-2.74-.18-.28a7.43 7.43 0 01-1.14-3.96 7.44 7.44 0 017.44-7.44 7.44 7.44 0 017.44 7.44 7.44 7.44 0 01-7.59 7.18zm4.08-5.56c-.22-.11-1.32-.65-1.52-.73-.2-.07-.35-.11-.5.11-.15.22-.58.73-.71.88-.13.15-.26.17-.49.06-.22-.11-.94-.35-1.79-1.1a6.75 6.75 0 01-1.24-1.55c-.13-.22-.01-.34.1-.45.1-.1.22-.26.33-.4.11-.13.15-.22.22-.37.07-.15.04-.28-.02-.39-.06-.11-.5-1.22-.69-1.67-.18-.43-.36-.38-.5-.38-.13 0-.28-.01-.43-.01-.15 0-.39.06-.59.28-.2.22-.78.76-.78 1.85s.8 2.14.91 2.29c.11.15 1.57 2.4 3.81 3.37.53.23.95.37 1.27.47.53.17 1.02.14 1.4.09.43-.06 1.32-.54 1.5-1.06.19-.52.19-.97.13-1.06-.06-.09-.21-.15-.43-.26z"/></svg>';
  }

  function contabilizarIcon() {
    return '<svg fill="none" stroke="currentColor" stroke-width="1.75" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M8.5 12.5l2.5 2.5 4.5-5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }

  function facturarIcon() {
    return '<svg fill="none" stroke="currentColor" stroke-width="1.75" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M8.5 12.5l2.5 2.5 4.5-5" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }

  function traspasarIcon() {
    return '<svg fill="none" stroke="currentColor" stroke-width="1.75" viewBox="0 0 24 24"><path d="M4 12h16M12 5l7 7-7 7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }

  function excelIcon() {
    return '<svg class="btn-action__icon" fill="none" stroke="currentColor" stroke-width="1.9" viewBox="0 0 24 24" aria-hidden="true"><path d="M7.5 3.5h6.8L18 7.2v13.3H7.5A1.5 1.5 0 016 19V5a1.5 1.5 0 011.5-1.5z" stroke-linejoin="round"/><path d="M14 3.7V8h4" stroke-linejoin="round"/><path d="M9 12h6M9 15h6M9 18h3.8" stroke-linecap="round"/></svg>';
  }

  function printIcon() {
    return '<svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z"/></svg>';
  }

})();
