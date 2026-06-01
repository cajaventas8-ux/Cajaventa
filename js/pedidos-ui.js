(function () {
  'use strict';

  var DASHBOARD_STATE_KEY = 'alas.dashboard.state';

  var originalSelectKPI = window.selectKPI;
  var originalShowDashboardPanel = window.showDashboardPanel;

  var estadoPedidosActivo = 'total';

  var MAPA_KPI_ESTADO = {
    pendientes: 'pendiente',
    entregados: 'contabilizado',
    en_transito: 'facturado',
    anulados: 'anulado',
    acuses: 'total'
  };

  function $id(id) { return document.getElementById(id); }
  function setText(id, val) { var e = $id(id); if (e) e.textContent = val ?? ''; }
  function esc(v) { return String(v ?? '').replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }

  function kpiLabel(estado) {
    var map = { pendiente: 'Pedidos Pendientes', contabilizado: 'Facturados', facturado: 'Contabilizados', anulado: 'Anulados', total: 'Total Pedidos' };
    return map[estado] || estado;
  }

  function actualizarKpisUI() {
    var r = PedidosData.getResumen();
    setText('val-pendientes', r.pendiente);
    setText('val-anulados', r.anulado);
    setText('val-entregados', r.contabilizado);
    setText('val-en_transito', r.facturado);
    setText('val-acuses', r.total);
  }

  function mostrarPanelPedidos(estadoFiltro) {
    var pedidos;
    if (estadoFiltro === 'total') {
      pedidos = PedidosData.getPedidos();
    } else {
      pedidos = PedidosData.getPedidosPorEstado(estadoFiltro);
    }

    var panel = $id('contentPanel');
    if (!panel) return;

    if (!pedidos.length) {
      var label = estadoFiltro !== 'total' ? (PedidosData.ESTADOS_LABEL[estadoFiltro] || estadoFiltro).toLowerCase() : '';
      panel.innerHTML = '<div class="content-panel"><div class="empty-state" style="padding:60px 20px;"><i class="fas fa-inbox empty-icon"></i><h3 style="margin-bottom:6px;">' + (estadoFiltro === 'total' && !PedidosData.tieneDatos() ? 'No hay datos importados' : 'No hay pedidos ' + label) + '</h3><p style="color:#64748B;">' + (estadoFiltro === 'total' && !PedidosData.tieneDatos() ? 'Usá el botón "Cargar Datos" de la barra lateral para importar tu Excel.' : '') + '</p></div></div>';
      return;
    }

    var html = '<div class="content-panel"><div class="pedidos-header"><span class="pedidos-count">' + pedidos.length + ' pedido' + (pedidos.length !== 1 ? 's' : '') + '</span></div><div class="pedidos-table-wrap"><table class="table table--compact pedidos-table"><thead class="table__head"><tr class="table__row">' +
      '<th class="table__cell table__cell--header">Entrega</th>' +
      '<th class="table__cell table__cell--header">Pedido</th>' +
      '<th class="table__cell table__cell--header">Cliente</th>' +
      '<th class="table__cell table__cell--header">Items</th>' +
      '<th class="table__cell table__cell--header">Vendedor</th>' +
      '<th class="table__cell table__cell--header">Estado</th>' +
      '<th class="table__cell table__cell--header">Acción</th>' +
      '</tr></thead><tbody class="table__body">';

    pedidos.forEach(function (p) {
      var color = PedidosData.ESTADOS_COLOR[p.estado] || '#6B7280';
      var bg = PedidosData.ESTADOS_BG[p.estado] || '#F3F4F6';
      var label = PedidosData.ESTADOS_LABEL[p.estado] || p.estado;
      var itemsCount = (p.items || []).length;

      html += '<tr class="table__row">' +
        '<td class="table__cell"><strong>' + esc(p.entrega) + '</strong></td>' +
        '<td class="table__cell">' + esc(p.pedido) + '</td>' +
        '<td class="table__cell"><div class="cell-cliente"><i class="far fa-user cell-cliente__icon"></i><span>' + esc(p.cliente) + '</span></div></td>' +
        '<td class="table__cell">' + itemsCount + ' item' + (itemsCount !== 1 ? 's' : '') + '</td>' +
        '<td class="table__cell">' + esc(p.vendedor) + '</td>' +
        '<td class="table__cell"><span class="estado-badge" style="background:' + bg + ';color:' + color + ';padding:4px 10px;border-radius:20px;font-size:12px;font-weight:600;display:inline-block;">' + label + '</span></td>' +
        '<td class="table__cell"><select class="estado-select" data-entrega="' + esc(p.entrega) + '" onchange="window.actualizarEstadoPedido(this)" aria-label="Cambiar estado">';
      PedidosData.ESTADOS.forEach(function (e) {
        html += '<option value="' + e + '"' + (e === p.estado ? ' selected' : '') + '>' + PedidosData.ESTADOS_LABEL[e] + '</option>';
      });
      html += '</select></td></tr>';
    });

    html += '</tbody></table></div></div>';
    panel.innerHTML = html;
  }

  function syncKpiCards(kpi) {
    document.querySelectorAll('.kpi-card').forEach(function (card) {
      card.classList.toggle('active', card.dataset.kpi === kpi);
    });
  }

  window.selectKPI = function (kpi) {
    if (PedidosData.tieneDatos()) actualizarKpisUI();
    return originalSelectKPI(kpi);
  };

  window.showDashboardPanel = function (kpi) {
    if (PedidosData.tieneDatos()) actualizarKpisUI();
    return originalShowDashboardPanel(kpi);
  };

  window.actualizarEstadoPedido = async function (select) {
    var entrega = select.dataset.entrega;
    var nuevoEstado = select.value;
    var ok = await PedidosData.cambiarEstado(entrega, nuevoEstado);
    if (ok) {
      actualizarKpisUI();
      mostrarPanelPedidos(estadoPedidosActivo);
      if (typeof window.showDashboardToast === 'function') {
        window.showDashboardToast('Pedido ' + entrega + ' → ' + PedidosData.ESTADOS_LABEL[nuevoEstado], 'success');
      }
    }
  };

  // Cargar datos al iniciar y actualizar KPIs si hay datos
  PedidosData.init().then(function () {
    if (PedidosData.tieneDatos()) {
      actualizarKpisUI();
    }
  });

  // ══════════════════════════════════════════════════════════════════
  // CAJA VENTA PEDIDOS — vista agrupada por número de pedido
  // ══════════════════════════════════════════════════════════════════

  var CV_LABEL = {
    pendiente:     'PENDIENTE',
    listo_facturar: 'LISTO PARA FACTURAR',
    facturado:     'FACTURADO',
    anulado:       'ANULADO'
  };

  var CV_ORDER = ['pendiente', 'listo_facturar', 'facturado'];

  // Genera una clave CSS-safe para usar como sufijo de ID
  function cvKey(pedido) {
    return String(pedido).replace(/[^a-zA-Z0-9]/g, '_');
  }

  function actualizarKpisCajaVenta() {
    var r = PedidosData.getResumenAgrupado();
    setText('cv-val-total',     r.total);
    setText('cv-val-pendiente', r.pendiente);
    setText('cv-val-listo',     r.listo_facturar);
    setText('cv-val-facturado', r.facturado);
  }

  function renderEntregasPanel(grupo) {
    var html = '<div class="cv-entregas-card"><div class="cv-entregas-title">ENTREGAS</div><div class="cv-entregas-list">';
    grupo.entregas.forEach(function (e) {
      if (e.estado === 'anulado') return;
      var color = { pendiente: '#F59E0B', contabilizado: '#3B82F6', facturado: '#10B981' }[e.estado] || '#6B7280';
      var bg    = { pendiente: '#FEF3C7', contabilizado: '#DBEAFE', facturado: '#D1FAE5' }[e.estado] || '#F3F4F6';
      var eLabel = { pendiente: 'PENDIENTE', contabilizado: 'CONTABILIZADO', facturado: 'FACTURADO' }[e.estado] || e.estado.toUpperCase();
      var almTag = e.almacen ? '<span class="cv-almacen-tag">' + esc(e.almacen) + '</span>' : '';
      html +=
        '<div class="cv-entrega-item">' +
          '<div class="cv-entrega-left">' +
            '<svg class="cv-entrega-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M9 8h6M9 12h4"/></svg>' +
            '<div class="cv-entrega-info"><span class="cv-entrega-num">Entrega: ' + esc(e.entrega) + '</span>' + almTag + '</div>' +
          '</div>' +
          '<div class="cv-entrega-right">' +
            '<span class="cv-estado-badge" style="background:' + bg + ';color:' + color + ';">' + eLabel + '</span>' +
            '<select class="cv-estado-select" data-entrega="' + esc(e.entrega) + '" data-pedido-key="' + cvKey(grupo.pedido) + '" onchange="window.cvCambiarEstado(this)" aria-label="Cambiar estado">' +
              '<option value="pendiente"'     + (e.estado === 'pendiente'     ? ' selected' : '') + '>Pendiente</option>'     +
              '<option value="contabilizado"' + (e.estado === 'contabilizado' ? ' selected' : '') + '>Contabilizado</option>' +
              '<option value="facturado"'     + (e.estado === 'facturado'     ? ' selected' : '') + '>Facturado</option>'     +
              '<option value="anulado"'       + (e.estado === 'anulado'       ? ' selected' : '') + '>Anulado</option>'       +
            '</select>' +
          '</div>' +
        '</div>';
    });
    html += '</div>';
    var obs = grupo.entregas.find(function (e) { return e.observacion; });
    if (obs && obs.observacion) {
      html += '<div class="cv-observacion"><span class="cv-obs-label">Observaciones</span><strong>' + esc(obs.observacion) + '</strong></div>';
    }
    html += '</div>';
    return html;
  }

  function mostrarCajaVentaPedidos() {
    var panel = $id('cvContentPanel');
    if (!panel) return;
    actualizarKpisCajaVenta();

    var grupos = PedidosData.getPedidosAgrupados();
    if (!grupos.length) {
      panel.innerHTML = '<div class="cv-empty"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0H4"/></svg><p>No hay pedidos cargados.<br>Usá "Cargar Datos" para importar tu Excel.</p></div>';
      return;
    }

    // Agrupar por estadoGeneral
    var porEstado = { pendiente: [], listo_facturar: [], facturado: [] };
    grupos.forEach(function (g) {
      if (porEstado[g.estadoGeneral]) porEstado[g.estadoGeneral].push(g);
    });
    // Ordenar cada grupo por nombre de cliente
    CV_ORDER.forEach(function (e) {
      porEstado[e].sort(function (a, b) { return (a.cliente || '').localeCompare(b.cliente || ''); });
    });

    var html = '';
    CV_ORDER.forEach(function (estadoGrupo) {
      var items = porEstado[estadoGrupo];
      if (!items.length) return;

      html += '<div class="cv-group">';
      html += '<div class="cv-group-header cv-gh--' + estadoGrupo.replace('_', '-') + '">';

      if (estadoGrupo === 'pendiente') {
        html += '<svg class="cv-gh-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M9 5l7 7-7 7"/></svg>';
      } else if (estadoGrupo === 'listo_facturar') {
        html += '<svg class="cv-gh-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M9 8h6M9 12h4"/></svg>';
      } else {
        html += '<svg class="cv-gh-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 12l2 2 4-4"/><rect x="4" y="3" width="16" height="18" rx="2"/></svg>';
      }

      html += '<span class="cv-gh-label">' + CV_LABEL[estadoGrupo] + '</span>';
      html += '<span class="cv-gh-count">' + items.length + '</span>';
      html += '</div>'; // cv-group-header

      items.forEach(function (g) {
        var key = cvKey(g.pedido);
        var nombreTrunc = (g.cliente || '').length > 30 ? (g.cliente || '').substring(0, 30) + '...' : (g.cliente || '');
        var contLabel = g.contabilizados + '/' + g.totalEntregas;
        var isListo = estadoGrupo === 'listo_facturar';

        var waBtn = isListo
          ? '<button class="cv-btn-wa" onclick="event.stopPropagation();window.cvEnviarWhatsApp(\'' + key + '\')" title="Enviar por WhatsApp">' +
              '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z"/></svg>' +
            '</button>'
          : '';

        html +=
          '<div class="cv-row cv-row--' + estadoGrupo.replace('_', '-') + '" data-cv-key="' + key + '" onclick="window.cvToggleEntregas(\'' + key + '\')">' +
            '<div class="cv-cell cv-cell--cliente">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" class="cv-cliente-icon"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.582-7 8-7s8 3 8 7"/></svg>' +
              '<span>' + esc(nombreTrunc) + '</span>' +
            '</div>' +
            '<div class="cv-cell cv-cell--entregas">' +
              '<span class="cv-link-entregas">Entregas (' + g.totalEntregas + ')</span>' +
            '</div>' +
            '<div class="cv-cell cv-cell--cont">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="cv-check-icon"><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M8 12l3 3 5-5"/></svg>' +
              '<span>' + contLabel + '</span>' +
            '</div>' +
            '<div class="cv-cell cv-cell--estado-gen">' +
              '<span class="cv-estado-gen cv-eg--' + estadoGrupo.replace('_', '-') + '">' + CV_LABEL[estadoGrupo] + '</span>' +
              waBtn +
            '</div>' +
          '</div>' +
          '<div class="cv-entregas-panel" id="cvp-' + key + '" style="display:none">' +
            renderEntregasPanel(g) +
          '</div>';
      });

      html += '</div>'; // cv-group
    });

    panel.innerHTML = html;
  }

  function iniciarCajaVenta() {
    if (PedidosData.tieneDatos()) {
      mostrarCajaVentaPedidos();
    } else {
      PedidosData.init().then(function () { mostrarCajaVentaPedidos(); });
    }
  }

  // Wrapper de showView para interceptar 'cajaVenta'
  var _origShowView = window.showView;
  window.showView = async function (view) {
    var cvNode = $id('viewCajaVenta');
    if (view === 'cajaVenta') {
      ['viewResumen', 'viewDashboard', 'viewCalendario', 'viewHistorial'].forEach(function (id) {
        var n = $id(id); if (n) n.style.display = 'none';
      });
      if (cvNode) cvNode.style.display = 'block';
      ['btnResumen', 'btnDashboard', 'btnCalendario', 'btnRepartidores', 'btnHistorial'].forEach(function (id) {
        var b = $id(id); if (b) b.classList.remove('active');
      });
      var btnCV = $id('btnCajaVenta');
      if (btnCV) btnCV.classList.add('active');
      iniciarCajaVenta();
      return;
    }
    if (cvNode) cvNode.style.display = 'none';
    var btnCV2 = $id('btnCajaVenta');
    if (btnCV2) btnCV2.classList.remove('active');
    return _origShowView(view);
  };

  // Expande / colapsa el panel de entregas de un grupo
  window.cvToggleEntregas = function (key) {
    var panel = $id('cvp-' + key);
    if (!panel) return;
    panel.style.display = panel.style.display === 'none' ? 'block' : 'none';
  };

  // Cambia el estado de una entrega individual desde la vista CV
  window.cvCambiarEstado = async function (select) {
    var entrega = select.dataset.entrega;
    var pedidoKey = select.dataset.pedidoKey;
    var nuevoEstado = select.value;
    var ok = await PedidosData.cambiarEstado(entrega, nuevoEstado);
    if (ok) {
      actualizarKpisUI();
      mostrarCajaVentaPedidos();
      if (typeof window.showDashboardToast === 'function') {
        window.showDashboardToast('Entrega ' + entrega + ' → ' + nuevoEstado.toUpperCase(), 'success');
      }
      // Re-abrir el panel del grupo después del re-render
      setTimeout(function () {
        var panel = $id('cvp-' + pedidoKey);
        if (panel) panel.style.display = 'block';
      }, 60);
    }
  };

  // Abre WhatsApp con resumen del pedido "Listo para Facturar"
  window.cvEnviarWhatsApp = function (key) {
    var grupos = PedidosData.getPedidosAgrupados();
    var g = grupos.find(function (gr) { return cvKey(gr.pedido) === key; });
    if (!g) return;
    var lines = [
      '*Pedido Contado*',
      'Pedido N°: ' + (g.pedido || '-'),
      'Fecha: ' + (g.fecha || '-'),
      'Cliente: ' + (g.cliente || '-'),
      'Vendedor: ' + (g.vendedor || '-'),
      ''
    ];
    lines.push('*Entregas:*');
    g.entregas.forEach(function (e) {
      if (e.estado === 'anulado') return;
      var eLabel = { pendiente: 'Pendiente', contabilizado: 'Contabilizado', facturado: 'Facturado' }[e.estado] || e.estado;
      var almacen = e.almacen ? ' (' + e.almacen + ')' : '';
      var monto = e.monto ? ' - Gs ' + Number(e.monto).toLocaleString('es-PY') : '';
      lines.push('• Entrega ' + e.entrega + almacen + ' - ' + eLabel + monto);
    });
    lines.push('');
    lines.push('Estado: *LISTO PARA FACTURAR*');
    window.open('https://wa.me/?text=' + encodeURIComponent(lines.join('\n')), '_blank');
  };

})();
