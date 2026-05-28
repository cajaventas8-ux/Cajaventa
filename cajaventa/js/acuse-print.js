(function () {
  'use strict';

  function setText(id, value) {
    if (window.AlasShared?.dom?.setText) {
      return window.AlasShared.dom.setText(id, value || '--');
    }

    const node = document.getElementById(id);
    if (node) node.textContent = value || '--';
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

  function parseDateValue(value) {
    if (window.AlasShared?.format?.parseDateValue) {
      return window.AlasShared.format.parseDateValue(value);
    }

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

  function formatPrintDate(value) {
    if (window.AlasShared?.format?.formatDateTime) {
      return window.AlasShared.format.formatDateTime(value, {
        locale: 'es-PY',
        includeTime: true,
        timeJoiner: ' - ',
        timeSuffix: ' hs',
        dateOptions: {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric'
        }
      });
    }

    const parsed = parseDateValue(value);
    if (!parsed) return value || '--';

    const base = parsed.date.toLocaleDateString('es-PY', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });

    if (!parsed.hasTime) return base;

    return `${base} - ${parsed.date.toLocaleTimeString('es-PY', {
      hour: '2-digit',
      minute: '2-digit'
    })} hs`;
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

  function getTelefono(data) {
    return data.Telefono_Cliente || data.Telef_Cliente || data.TelF_Cliente || '--';
  }

  function buildDetalleRow(detalle) {
    return '<tr>' +
      `<td class="codigo">${escapeHtml(detalle.Cod_Mercaderia || detalle.Material_SAP || '--')}</td>` +
      `<td>${escapeHtml(detalle.Descr_SAP || '--')}</td>` +
      `<td class="nota">${escapeHtml(detalle.Nota || detalle.Nota_Detalle || '')}</td>` +
      `<td class="um">${escapeHtml(detalle.UM || detalle.UM_SAP || '--')}</td>` +
      `<td class="cantidad">${escapeHtml(formatQuantity(detalle.Cantidad))}</td>` +
      '</tr>';
  }

  window.poblarPagina = function poblarPagina(data) {
    const number = data.Nro_Acuse || `AC-${data.ID_Acuse}`;
    const detalles = Array.isArray(data.detalles) ? data.detalles : [];
    const tbody = document.getElementById('productosBody');
    const qrNode = document.getElementById('qrcode');
    let totalUnidades = 0;

    setText('acuseNum', `#${number}`);
    setText('barraNumero', `#${number}`);
    setText('acuseFecha', formatPrintDate(data.Fecha_Emision || data.Fecha_Creacion));
    setText('acuseCliente', data.Nom_Cliente || data.Cod_Cliente);
    setText('acuseClienteCod', data.Cod_Cliente ? `Cod. ${data.Cod_Cliente}` : '');
    setText('acuseRuc', data.Ruc_Cliente);
    setText('acuseTelefono', getTelefono(data));
    setText('acuseDireccion', data.Direc_Cliente);
    setText('acuseCiudad', data.Ciudad_Cliente || data.Zona_Cliente || data.Zona);
    setText('acuseEstado', data.Estado);
    setText('acuseObservacion', data.Observacion || 'ENTREGA DE MERCADERIA');
    setText('acuseRepartidor', data.Nombre_Repartidor || 'Pendiente de asignacion');

    if (tbody) {
      tbody.innerHTML = detalles.map(function (detalle) {
        totalUnidades += Number(detalle.Cantidad || 0);
        return buildDetalleRow(detalle);
      }).join('') +
      '<tr class="total-row">' +
      '<td colspan="4" class="total-label">TOTAL DE UNIDADES</td>' +
      `<td class="total-valor">${escapeHtml(formatQuantity(totalUnidades))}</td>` +
      '</tr>';
    }

    setText(
      'productosCounter',
      `${detalles.length} ${detalles.length === 1 ? 'item' : 'items'} · ${formatQuantity(totalUnidades)} unidades`
    );

    if (qrNode && window.QRCode) {
      qrNode.innerHTML = '';
      new window.QRCode(qrNode, {
        text: 'https://alas.com.py/',
        width: 54,
        height: 54,
        colorDark: '#111827',
        colorLight: '#ffffff',
        correctLevel: window.QRCode.CorrectLevel.M
      });
    }
  };
})();
