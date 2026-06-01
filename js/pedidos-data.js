(function () {
  'use strict';

  var ESTADOS = ['pendiente', 'contabilizado', 'facturado', 'anulado'];
  var ESTADOS_LABEL = {
    pendiente: 'Pendiente',
    contabilizado: 'Facturado',
    facturado: 'Contabilizado',
    anulado: 'Anulado'
  };
  var ESTADOS_COLOR = {
    pendiente: '#F59E0B',
    contabilizado: '#3B82F6',
    facturado: '#10B981',
    anulado: '#EF4444'
  };
  var ESTADOS_BG = {
    pendiente: '#FEF3C7',
    contabilizado: '#DBEAFE',
    facturado: '#D1FAE5',
    anulado: '#FEE2E2'
  };

  var cache = [];
  var cacheLoaded = false;
  var cacheResumen = { pendiente: 0, contabilizado: 0, facturado: 0, anulado: 0, total: 0 };

  function rebuildResumen() {
    var r = { pendiente: 0, contabilizado: 0, facturado: 0, anulado: 0, total: cache.length };
    cache.forEach(function (p) { if (r.hasOwnProperty(p.estado)) r[p.estado]++; });
    cacheResumen = r;
  }

  async function loadFromSupabase() {
    if (!window.Supabase) return false;
    try {
      cache = await window.Supabase.Pedidos.getAll();
      cacheLoaded = true;
      rebuildResumen();
      return true;
    } catch (e) {
      console.error('[PedidosData] Error cargando desde Supabase:', e);
      return false;
    }
  }

  function parseExcelData(workbook) {
    var sheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!sheet) return [];

    var rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    var entregasMap = {};

    // Log de columnas disponibles (solo primera fila, para diagnóstico)
    if (rows.length > 0) {
      console.log('[Import] Columnas Excel:', Object.keys(rows[0]).join(', '));
    }

    rows.forEach(function (row) {
      var entrega = String(row['Entrega'] || '').trim();
      if (!entrega) return;

      if (!entregasMap[entrega]) {
        var puestExped = String(
          row['PuestExped'] || row['Puest.Exped'] || row['Puest. Exped'] ||
          row['Puesto Exped'] || row['Puesto de Expedición'] || row['PstExp'] ||
          row['Puest.Exped.'] || row['Puest Exped'] || ''
        ).trim();
        var almacen = puestExped === '' ? '' : (puestExped === 'ALDF' ? 'FABRICA' : 'DEPOSITO');
        if (puestExped) console.log('[Import] PuestExped detectado:', puestExped, '→', almacen);
        entregasMap[entrega] = {
          entrega: entrega,
          pedido: String(row['Pedido'] || '').trim(),
          solicitud: String(row['Solic.'] || '').trim(),
          cliente: String(row['Nombre'] || '').trim(),
          vendedor: String(row['Nombre Vend.'] || '').trim(),
          fecha: String(row['Fecha Creac'] || '').trim(),
          usuarioEmpaque: String(row['Usuario Empaque'] || '').trim(),
          almacen: almacen,
          items: [],
          estado: 'pendiente',
          fechaImportacion: new Date().toISOString()
        };
      }

      entregasMap[entrega].items.push({
        material: String(row['Material'] || '').trim(),
        denominacion: String(row['Denomin.'] || '').trim(),
        cantidad: parseFloat(String(row['Ctd.entr.'] || '0').replace(',', '.')) || 0,
        unidad: String(row['Unidad'] || '').trim(),
        contEntr: parseFloat(String(row['Cont.Entr'] || '0').replace(',', '.')) || 0,
        contArt: parseFloat(String(row['Cont.Art'] || '0').replace(',', '.')) || 0
      });
    });

    return Object.values(entregasMap);
  }

  function importarExcelBuffer(buffer) {
    return new Promise(function (resolve, reject) {
      try {
        var data = new Uint8Array(buffer);
        var workbook = XLSX.read(data, { type: 'array' });
        var nuevos = parseExcelData(workbook);

        if (!window.Supabase) {
          reject('Supabase no disponible');
          return;
        }

        window.Supabase.Pedidos.importar(nuevos).then(function (result) {
          return loadFromSupabase().then(function () { resolve(result); });
        }).catch(function (err) {
          reject('Error al importar: ' + (err.message || err));
        });
      } catch (err) {
        reject('Error al procesar el archivo: ' + (err.message || err));
      }
    });
  }

  function importarExcel(file) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function (e) {
        importarExcelBuffer(e.target.result).then(resolve).catch(reject);
      };
      reader.onerror = function () { reject('Error al leer el archivo'); };
      reader.readAsArrayBuffer(file);
    });
  }

  async function cambiarEstado(entrega, nuevoEstado) {
    if (!ESTADOS.includes(nuevoEstado)) return false;
    if (!window.Supabase) return false;
    try {
      var usuario = localStorage.getItem('acuse.currentUser') || 'sistema';
      await window.Supabase.Pedidos.cambiarEstado(entrega, nuevoEstado, usuario, '');
      await loadFromSupabase();
      return true;
    } catch (e) {
      console.error('[PedidosData] cambiarEstado error:', e);
      return false;
    }
  }

  function getPedidos() {
    if (!cacheLoaded) loadFromSupabase();
    return cache;
  }

  function getPedidosPorEstado(estado) {
    return getPedidos().filter(function (p) { return p.estado === estado; });
  }

  function getResumen() {
    return cacheResumen;
  }

  function tieneDatos() {
    return cache.length > 0;
  }

  // ── AGRUPADO POR PEDIDO ──────────────────────────────────────────────────
  // Deriva el estado general del grupo: solo sube cuando TODAS las entregas
  // activas alcanzan el estado requerido.
  function calcularEstadoGeneral(entregasActivas) {
    if (!entregasActivas.length) return 'anulado';
    if (entregasActivas.every(function (e) { return e.estado === 'facturado'; })) return 'facturado';
    if (entregasActivas.every(function (e) { return e.estado === 'contabilizado' || e.estado === 'facturado'; })) return 'listo_facturar';
    return 'pendiente';
  }

  function getPedidosAgrupados() {
    var pedidos = getPedidos();
    var grupos = {};
    pedidos.forEach(function (p) {
      var key = p.pedido || p.entrega;
      if (!grupos[key]) {
        grupos[key] = {
          pedido: key,
          cliente: p.cliente,
          vendedor: p.vendedor,
          fecha: p.fecha,
          solicitud: p.solicitud,
          entregas: [],
          totalEntregas: 0,
          contabilizados: 0,
          facturados: 0,
          estadoGeneral: 'pendiente'
        };
      }
      grupos[key].entregas.push(p);
    });
    return Object.values(grupos).map(function (g) {
      var activas = g.entregas.filter(function (e) { return e.estado !== 'anulado'; });
      g.totalEntregas = activas.length;
      g.contabilizados = activas.filter(function (e) { return e.estado === 'contabilizado'; }).length;
      g.facturados = activas.filter(function (e) { return e.estado === 'facturado'; }).length;
      g.estadoGeneral = calcularEstadoGeneral(activas);
      return g;
    });
  }

  function getResumenAgrupado() {
    var grupos = getPedidosAgrupados();
    return {
      total: grupos.length,
      pendiente: grupos.filter(function (g) { return g.estadoGeneral === 'pendiente'; }).length,
      listo_facturar: grupos.filter(function (g) { return g.estadoGeneral === 'listo_facturar'; }).length,
      facturado: grupos.filter(function (g) { return g.estadoGeneral === 'facturado'; }).length,
      anulado: grupos.filter(function (g) { return g.estadoGeneral === 'anulado'; }).length
    };
  }

  // Inicializar: cargar datos de Supabase al arrancar
  var initPromise = null;
  function init() {
    if (!initPromise) initPromise = loadFromSupabase();
    return initPromise;
  }

  window.PedidosData = {
    init: init,
    importarExcel: importarExcel,
    importarExcelDesdeBuffer: importarExcelBuffer,
    cambiarEstado: cambiarEstado,
    getPedidos: getPedidos,
    getPedidosPorEstado: getPedidosPorEstado,
    getResumen: getResumen,
    getPedidosAgrupados: getPedidosAgrupados,
    getResumenAgrupado: getResumenAgrupado,
    calcularEstadoGeneral: calcularEstadoGeneral,
    tieneDatos: tieneDatos,
    loadFromSupabase: loadFromSupabase,
    ESTADOS: ESTADOS,
    ESTADOS_LABEL: ESTADOS_LABEL,
    ESTADOS_COLOR: ESTADOS_COLOR,
    ESTADOS_BG: ESTADOS_BG
  };

  // Auto-init cuando el DOM esté listo
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { init(); });
  } else {
    init();
  }
})();
