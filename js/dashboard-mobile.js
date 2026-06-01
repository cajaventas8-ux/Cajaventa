/* dashboard-mobile.js — Tab bar y capa de navegación mobile */
(function () {
  'use strict';

  var MOB_BP = 768;

  /* Qué vistas muestran el FAB de nuevo acuse */
  var FAB_VISIBLE = { acuses: true };

  function isMobile() {
    return window.innerWidth <= MOB_BP;
  }

  /* Cambia la tab activa y delega a las funciones existentes del dashboard */
  function mob_switchTab(view) {
    /* Actualizar estado visual de tabs */
    document.querySelectorAll('.mob-tab-item').forEach(function (t) {
      t.classList.toggle('active', t.dataset.mobView === view);
    });

    /* Delegar a la navegación existente */
    if (view === 'acuses' || view === 'repartidores') {
      if (typeof window.showDashboardPanel === 'function') {
        window.showDashboardPanel(view);
      }
    } else {
      if (typeof window.showView === 'function') {
        window.showView(view);
      }
    }

    /* Mostrar/ocultar FAB según la vista */
    var fab = document.getElementById('mobFab');
    if (fab) {
      fab.classList.toggle('mob-fab--hidden', !FAB_VISIBLE[view]);
    }
  }

  /* Sincroniza el tab bar cuando la navegación ocurre por el sidebar
     (por si se usa en desktop y luego se rota a mobile, o en tests) */
  function mob_syncFromState(view) {
    if (!isMobile()) return;
    var viewMap = {
      resumen: 'resumen',
      dashboard: 'acuses',
      calendario: 'calendario',
      historial: 'historial',
      repartidores: 'repartidores'
    };
    var tabView = viewMap[view] || view;
    document.querySelectorAll('.mob-tab-item').forEach(function (t) {
      t.classList.toggle('active', t.dataset.mobView === tabView);
    });
    var fab = document.getElementById('mobFab');
    if (fab) {
      fab.classList.toggle('mob-fab--hidden', !FAB_VISIBLE[tabView]);
    }
  }

  function mob_init() {
    if (!isMobile()) return;
    document.body.classList.add('is-mobile');
  }

  /* Recarga al rotar si cambia el breakpoint (portrait ↔ landscape extremo) */
  window.addEventListener('resize', function () {
    var wasMobile = document.body.classList.contains('is-mobile');
    var nowMobile = isMobile();
    if (wasMobile !== nowMobile) {
      location.reload();
    }
  });

  /* Exponer al scope global */
  window.mob_switchTab = mob_switchTab;
  window.mob_syncFromState = mob_syncFromState;

  document.addEventListener('DOMContentLoaded', mob_init);
})();
