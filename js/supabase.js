/* SUPABASE - Capa de datos para Caja Ventas (sin CDN, usa fetch nativo) */
(function () {
  'use strict';

  var URL = 'https://bihtbhulcqvlwadatxbk.supabase.co';
  var KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJpaHRiaHVsY3F2bHdhZGF0eGJrIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk4MjA5NTUsImV4cCI6MjA5NTM5Njk1NX0.lsoHg2HPEOv_Ie4FPdDNYGn3zoSu5SWTcejvz6KPAdM';
  var REST = URL + '/rest/v1';

  function headers(extra) {
    var h = { 'apikey': KEY, 'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json' };
    if (extra) for (var k in extra) h[k] = extra[k];
    return h;
  }

  function logErr(ctx, err) { console.error('[Supabase] ' + ctx + ':', err); }

  async function get(table, qs) {
    var url = REST + '/' + table + (qs ? '?' + qs : '');
    var r = await fetch(url, { headers: headers() });
    if (!r.ok) throw new Error('HTTP ' + r.status + ' GET ' + table);
    return r.json();
  }

  async function getOne(table, field, value) {
    var r = await get(table, field + '=eq.' + encodeURIComponent(value) + '&limit=1');
    return r && r.length ? r[0] : null;
  }

  // Batch fetch: field=in.(v1,v2,...) — chunked para evitar URLs muy largas
  async function getIn(table, field, values) {
    if (!values.length) return [];
    var CHUNK = 200;
    var results = [];
    for (var i = 0; i < values.length; i += CHUNK) {
      var chunk = values.slice(i, i + CHUNK);
      var inList = chunk.map(function(v) { return '"' + String(v).replace(/"/g, '\\"') + '"'; }).join(',');
      var rows = await get(table, field + '=in.(' + inList + ')&limit=' + (CHUNK + 1));
      results = results.concat(rows);
    }
    return results;
  }

  // Batch delete: field=in.(v1,v2,...)
  async function delIn(table, field, values) {
    if (!values.length) return;
    var CHUNK = 200;
    for (var i = 0; i < values.length; i += CHUNK) {
      var chunk = values.slice(i, i + CHUNK);
      var inList = chunk.map(function(v) { return '"' + String(v).replace(/"/g, '\\"') + '"'; }).join(',');
      var r = await fetch(REST + '/' + table + '?' + field + '=in.(' + inList + ')', {
        method: 'DELETE', headers: headers({ 'Prefer': 'return=minimal' })
      });
      if (!r.ok) throw new Error('HTTP ' + r.status + ' DELETE IN ' + table);
    }
  }

  async function post(table, body) {
    var r = await fetch(REST + '/' + table, {
      method: 'POST',
      headers: headers({ 'Prefer': 'return=representation' }),
      body: JSON.stringify(body)
    });
    if (!r.ok) throw new Error('HTTP ' + r.status + ' POST ' + table);
    if (r.status === 204 || r.headers.get('content-length') === '0') return [];
    try { return await r.json(); } catch (_) { return []; }
  }

  async function upsert(table, body, conflict) {
    var url = REST + '/' + table + '?on_conflict=' + encodeURIComponent(conflict);
    var r = await fetch(url, {
      method: 'POST',
      headers: headers({ 'Prefer': 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify(Array.isArray(body) ? body : [body])
    });
    if (!r.ok) throw new Error('HTTP ' + r.status + ' UPSERT ' + table);
    return [];
  }

  async function del(table, field, value) {
    var r = await fetch(REST + '/' + table + '?' + field + '=eq.' + encodeURIComponent(value), {
      method: 'DELETE',
      headers: headers({ 'Prefer': 'return=representation' })
    });
    if (!r.ok) throw new Error('HTTP ' + r.status + ' DELETE ' + table);
    return r.json();
  }

  async function update(table, field, value, body) {
    var r = await fetch(REST + '/' + table + '?' + field + '=eq.' + encodeURIComponent(value), {
      method: 'PATCH',
      headers: headers(),
      body: JSON.stringify(body)
    });
    if (!r.ok) throw new Error('HTTP ' + r.status + ' PATCH ' + table);
    if (r.status === 204 || r.headers.get('content-length') === '0') return {};
    try { return await r.json(); } catch (_) { return {}; }
  }

  /* ---- NORMALIZAR ---- */
  function normPedido(row) {
    return {
      entrega: row.entrega,
      pedido: row.pedido || '',
      solicitud: row.solicitud || '',
      cliente: row.cliente || '',
      vendedor: row.vendedor || '',
      fecha: row.fecha || '',
      usuarioEmpaque: row.usuario_empaque || '',
      almacen: row.almacen || '',
      almacenOrigen: row.almacen_origen || null,
      observacion: row.observacion || '',
      monto: Number(row.monto) || 0,
      estado: row.estado || 'pendiente',
      fechaImportacion: row.fecha_importacion || null,
      fechaActualizacion: row.fecha_actualizacion || null,
      fechaContabilizado: row.fecha_contabilizado || null,
      fechaFacturado: row.fecha_facturado || null,
      fechaAnulado: row.fecha_anulado || null,
      items: row.items || []
    };
  }

  function normItem(row) {
    return {
      material: row.material || '',
      denominacion: row.denominacion || '',
      cantidad: Number(row.cantidad) || 0,
      unidad: row.unidad || '',
      contEntr: Number(row.cont_entr) || 0,
      contArt: Number(row.cont_art) || 0
    };
  }

  function normalizeText(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/_/g, ' ')
      .trim()
      .toLowerCase();
  }

  function normalizePedidoEstado(value) {
    var estado = normalizeText(value);
    if (estado === 'entregado' || estado === 'terminado' || estado === 'completado') return 'contabilizado';
    if (estado === 'en transito' || estado === 'en reparto' || estado === 'transito') return 'facturado';
    if (estado === 'anulado' || estado === 'anulada' || estado === 'cancelado') return 'anulado';
    if (estado === 'contabilizado' || estado === 'facturado') return estado;
    return 'pendiente';
  }

  function normalizeApiEstado(value) {
    var estado = normalizePedidoEstado(value);
    if (estado === 'contabilizado') return 'entregado';
    if (estado === 'facturado') return 'en_transito';
    return estado;
  }

  function repartidorToApi(row) {
    row = row || {};
    return {
      ID: row.id,
      ID_Repartidor: row.id,
      Codigo_Repartidor: row.codigo || row.id || '',
      Nombre_Repartidor: row.nombre || '',
      Estado_Repartidor: row.estado || 'Activo',
      id: row.id,
      nombre: row.nombre,
      codigo: row.codigo,
      estado: row.estado
    };
  }

  function findRepartidorByPedido(pedido, repartidores) {
    var vendedor = normalizeText(pedido && pedido.vendedor);
    if (!vendedor || !Array.isArray(repartidores)) return null;
    return repartidores.find(function (rep) {
      return normalizeText(rep.nombre) === vendedor || normalizeText(rep.codigo) === vendedor || String(rep.id || '') === String(pedido.vendedor || '');
    }) || null;
  }

  function pedidoToAcuse(pedido, repartidores) {
    var p = pedido || {};
    var rep = findRepartidorByPedido(p, repartidores);
    var detalles = (p.items || []).map(function (item) {
      return {
        Cod_Mercaderia: item.material || '',
        Descr_SAP: item.denominacion || '',
        Cantidad: Number(item.cantidad) || 0,
        UM: item.unidad || '',
        Nota: '',
        Status_SAP: '',
        Jerarquia_SAP: ''
      };
    });
    var total = detalles.reduce(function (sum, item) { return sum + (Number(item.Cantidad) || 0); }, 0);
    var id = p.entrega || p.ID_Acuse || '';

    return {
      ID_Acuse: id,
      Nro_Acuse: id,
      entrega: p.entrega || '',
      pedido: p.pedido || '',
      solicitud: p.solicitud || '',
      Fecha_Emision: p.fecha || '',
      Fecha_Creacion: p.fechaImportacion || null,
      Fecha_Entrega: null,
      Fecha_Contabilizado: p.fechaContabilizado || null,
      Fecha_Facturado: p.fechaFacturado || null,
      Fecha_Anulado: p.fechaAnulado || null,
      Estado: normalizeApiEstado(p.estado),
      Almacen: p.almacen || '',
      Almacen_Origen: p.almacenOrigen || null,
      Observacion: p.observacion || '',
      Monto: Number(p.monto) || 0,
      Usuario_Creacion: p.usuarioEmpaque || '',
      Cod_Cliente: p.cliente || '',
      Nom_Cliente: p.cliente || '',
      Ruc_Cliente: '',
      Telefono_Cliente: '',
      Direc_Cliente: '',
      Ciudad_Cliente: '',
      Zona: '',
      Zona_Cliente: '',
      ID_Repartidor: rep ? rep.id : '',
      Codigo_Repartidor: rep ? (rep.codigo || rep.id || '') : '',
      Nombre_Repartidor: rep ? rep.nombre : (p.vendedor || ''),
      Observacion: '',
      Detalle_Items: detalles.length,
      Detalle_Cantidad_Total: total,
      detalles: detalles,
      historial: [],
      acciones: []
    };
  }

  function buildAcuseSummary(rows) {
    var summary = { pendiente: 0, en_transito: 0, entregado: 0 };
    (rows || []).forEach(function (pedido) {
      var estado = normalizeApiEstado(pedido.estado);
      if (summary.hasOwnProperty(estado)) summary[estado]++;
    });
    return summary;
  }

  function acusePayloadToPedido(body) {
    body = body || {};
    return {
      entrega: body.ID_Acuse || body.Nro_Acuse || body.entrega || String(Date.now()),
      pedido: body.Pedido || body.pedido || '',
      solicitud: body.Solicitud || body.solicitud || '',
      cliente: body.Nom_Cliente || body.Cod_Cliente || body.cliente || '',
      vendedor: body.Nombre_Repartidor || body.ID_Repartidor || body.vendedor || '',
      fecha: body.Fecha_Emision || body.fecha || null,
      usuarioEmpaque: body.Usuario || body.Usuario_Creacion || '',
      items: (body.detalles || body.items || []).map(function (item) {
        return {
          material: item.Cod_Mercaderia || item.material || '',
          denominacion: item.Descr_SAP || item.denominacion || item.Cod_Mercaderia || '',
          cantidad: Number(item.Cantidad || item.cantidad || 0) || 0,
          unidad: item.UM || item.unidad || '',
          contEntr: Number(item.Cont_Entr || item.contEntr || 0) || 0,
          contArt: Number(item.Cont_Art || item.contArt || 0) || 0
        };
      })
    };
  }

  /* ---- PEDIDOS ---- */
  var Pedidos = {};

  Pedidos.importar = async function (rows, onProgress) {
    var prog = typeof onProgress === 'function' ? onProgress : function () {};
    var grupos = {};
    var _condExpExcluidos = {};

    // Detectar si viene pre-parseado (pedidos-data.js) o en formato raw Excel
    var isPreparsed = rows.length > 0 && typeof rows[0].entrega === 'string' && Array.isArray(rows[0].items);
    rows.forEach(function (r) {
      if (isPreparsed) {
        var key = String(r.entrega || '').trim();
        if (!key) return;
        grupos[key] = {
          entrega: key,
          pedido: String(r.pedido || '').trim(),
          solicitud: String(r.solicitud || '').trim(),
          cliente: String(r.cliente || '').trim(),
          vendedor: String(r.vendedor || '').trim(),
          fecha: formatearFecha(String(r.fecha || '')),
          usuarioEmpaque: String(r.usuarioEmpaque || '').trim(),
          almacen: String(r.almacen || ''),
          items: (r.items || []).map(function (it) {
            return { material: String(it.material || '').trim(), denominacion: String(it.denominacion || '').trim(), cantidad: Number(it.cantidad) || 0, unidad: String(it.unidad || '').trim(), contEntr: Number(it.contEntr) || 0, contArt: Number(it.contArt) || 0 };
          })
        };
      } else {
        var key = String(r.Entrega || '').trim();
        if (!key) return;
        // Saltar entregas con Cond.exp. 08 o 09 (puede llegar como número 8/9 o string '08'/'09')
        var condExp = String(r['Cond.exp.'] || r['Cond. exp.'] || r['CondExp'] || r['Cond.Exp.'] || r['Cond.Exp'] || r['Cl.exp.'] || r['Cl. exp.'] || '').trim();
        var condExpNum = parseInt(condExp, 10);
        if (condExpNum === 8 || condExpNum === 9) { _condExpExcluidos[key] = true; return; }
        if (_condExpExcluidos[key]) return;
        if (!grupos[key]) {
          grupos[key] = {
            entrega: key,
            pedido: String(r.Pedido || '').trim(),
            solicitud: String(r['Solic.'] || r.Solic || '').trim(),
            cliente: String(r.Nombre || '').trim(),
            vendedor: String(r['Nombre Vend.'] || r.Nombre_Vend || '').trim(),
            fecha: formatearFecha(String(r['Fecha Creac'] || r.Fecha_Creac || '')),
            usuarioEmpaque: String(r['Usuario Empaque'] || r.Usuario_Empaque || '').trim(),
            almacen: '', _totalItems: 0, _aldfItems: 0, items: []
          };
        }
        var pe = String(r.PuestExped || r['Puest.Exped'] || r['Puest. Exped'] || r['Puesto Exped'] || r['PstExp'] || '').trim();
        grupos[key]._totalItems++;
        if (pe === 'ALDF') grupos[key]._aldfItems++;
        grupos[key].items.push({ material: String(r.Material || '').trim(), denominacion: String(r.Denomin || r.Denominacion || '').trim(), cantidad: Number(String(r['Ctd.entr.'] || r.Ctd_entr || '0').replace(',', '.')) || 0, unidad: String(r.Unidad || '').trim(), contEntr: Number(String(r['Cont.Entr'] || r.Cont_Entr || '0').replace(',', '.')) || 0, contArt: Number(String(r['Cont.Art'] || r.Cont_Art || '0').replace(',', '.')) || 0 });
      }
    });

    if (!isPreparsed) {
      // Eliminar entregas marcadas con Cond.exp. 08/09 (pueden haberse creado parcialmente)
      Object.keys(_condExpExcluidos).forEach(function (k) { delete grupos[k]; });
      Object.keys(grupos).forEach(function (k) {
        var g = grupos[k];
        var total = g._totalItems || 0, aldf = g._aldfItems || 0;
        g.almacen = total === 0 ? '' : aldf === total ? 'FABRICA' : 'DEPOSITO';
        delete g._totalItems; delete g._aldfItems;
      });
    }

    var entregas = Object.keys(grupos);
    if (!entregas.length) return { importados: 0, actualizados: 0, total: 0 };

    // ── PASO 1: Traer todos los existentes en UNA sola query ──────────────────
    prog(15, 'Verificando ' + entregas.length + ' pedidos...', 'Consultando base de datos');
    var existingRows = [];
    try { existingRows = await getIn('pedidos', 'entrega', entregas); } catch (e) { logErr('importar.getIn', e); }
    var existingMap = {};
    existingRows.forEach(function (r) { existingMap[r.entrega] = r; });

    // ── PASO 2: Upsert masivo de pedidos en UNA sola request ─────────────────
    prog(35, 'Guardando ' + entregas.length + ' pedidos...', 'Un solo batch a Supabase');
    var pedidosPayload = entregas.map(function (key) {
      var g = grupos[key];
      var estado = existingMap[g.entrega] ? existingMap[g.entrega].estado : 'pendiente';
      return { entrega: g.entrega, pedido: g.pedido, solicitud: g.solicitud, cliente: g.cliente, vendedor: g.vendedor, fecha: g.fecha || null, usuario_empaque: g.usuarioEmpaque, almacen: g.almacen || '', estado: estado };
    });
    try { await upsert('pedidos', pedidosPayload, 'entrega'); } catch (e) { logErr('importar.pedidos.batch', e); throw e; }

    // ── PASO 3: Borrar items anteriores en UNA sola query ────────────────────
    prog(60, 'Limpiando líneas anteriores...', entregas.length + ' entregas');
    try { await delIn('pedido_items', 'pedido_entrega', entregas); } catch (e) { logErr('importar.items.del', e); }

    // ── PASO 4: Insertar todos los items en UNA sola request ─────────────────
    var allItems = [];
    entregas.forEach(function (key) {
      var g = grupos[key];
      g.items.forEach(function (it) {
        allItems.push({ pedido_entrega: g.entrega, material: it.material, denominacion: it.denominacion, cantidad: it.cantidad, unidad: it.unidad, cont_entr: it.contEntr, cont_art: it.contArt });
      });
    });
    prog(75, 'Insertando ' + allItems.length + ' líneas...', 'Batch de items');
    try { if (allItems.length) await post('pedido_items', allItems); } catch (e) { logErr('importar.items.post', e); }

    prog(92, 'Registrando auditoría...', '');
    var importados = entregas.filter(function (k) { return !existingMap[k]; }).length;
    var actualizados = entregas.filter(function (k) { return !!existingMap[k]; }).length;
    await registrarAuditoria('importacion_excel', 'sistema', null, null, 'Importados ' + importados + ' nuevos, ' + actualizados + ' actualizados');

    prog(100, 'Completado', '');
    return { importados: importados, actualizados: actualizados, total: entregas.length };
  };

  Pedidos.getAll = async function (filters) {
    var qs = 'select=*&order=fecha.desc.nullslast,entrega.desc.nullslast';
    if (filters) {
      if (filters.estado) qs += '&estado=eq.' + encodeURIComponent(filters.estado);
      if (filters.cliente) qs += '&cliente=ilike.*' + encodeURIComponent(filters.cliente) + '*';
      if (filters.q) {
        var q = encodeURIComponent(filters.q);
        qs += '&or=(entrega.ilike.*' + q + '*,pedido.ilike.*' + q + '*,cliente.ilike.*' + q + '*)';
      }
      if (filters.vendedor) qs += '&vendedor=ilike.*' + encodeURIComponent(filters.vendedor) + '*';
      // NOTE: fecha filters are intentionally NOT sent to Supabase.
      // Dates may be stored in any text format (ISO, DD/MM/YYYY, DD.MM.YYYY, etc.)
      // so we normalize client-side via formatearFecha before comparing.
    }
    try {
      var data = await get('pedidos', qs);
      if (filters && (filters.fecha || filters.fechaDesde || filters.fechaHasta)) {
        data = (data || []).filter(function (p) {
          var f = formatearFecha(String(p.fecha || ''));
          if (filters.fecha && f !== filters.fecha) return false;
          if (filters.fechaDesde && f < filters.fechaDesde) return false;
          if (filters.fechaHasta && f > filters.fechaHasta) return false;
          return true;
        });
      }
      return (data || []).map(normPedido);
    } catch (e) { logErr('getAll', e); return []; }
  };

  Pedidos.getVendedoresUnicos = async function (query) {
    try {
      var qs = 'select=vendedor&order=vendedor.asc.nullslast&vendedor=not.is.null';
      if (query) qs += '&vendedor=ilike.*' + encodeURIComponent(query) + '*';
      var data = await get('pedidos', qs);
      var seen = new Set();
      return (data || [])
        .map(function (r) { return r.vendedor; })
        .filter(function (v) { return v && !seen.has(v) && seen.add(v); })
        .map(function (v) { return { ID: v, Nombre_Repartidor: v, Codigo_Repartidor: '' }; });
    } catch (e) { logErr('getVendedoresUnicos', e); return []; }
  };

  Pedidos.getClientesUnicos = async function (query) {
    try {
      var qs = 'select=cliente&order=cliente.asc.nullslast&cliente=not.is.null';
      if (query) qs += '&cliente=ilike.*' + encodeURIComponent(query) + '*';
      var data = await get('pedidos', qs);
      var seen = new Set();
      return (data || [])
        .map(function (r) { return r.cliente; })
        .filter(function (c) { return c && !seen.has(c) && seen.add(c); })
        .map(function (c) { return { Cod_Cliente: c, Nom_Cliente: c }; });
    } catch (e) { logErr('getClientesUnicos', e); return []; }
  };

  Pedidos.getByEntrega = async function (entrega) {
    try {
      var pedido = await getOne('pedidos', 'entrega', entrega);
      if (!pedido) return null;
      var items = await get('pedido_items', 'pedido_entrega=eq.' + encodeURIComponent(entrega));
      pedido.items = (items || []).map(normItem);
      return normPedido(pedido);
    } catch (e) { logErr('getByEntrega', e); return null; }
  };

  Pedidos.getByEstado = async function (estado) {
    return Pedidos.getAll({ estado: estado });
  };

  Pedidos.getResumen = async function () {
    try {
      var data = await get('pedidos', 'select=estado');
      var r = { pendientes: 0, contabilizados: 0, facturados: 0, anulados: 0, total: (data || []).length };
      var keys = {
        pendiente: 'pendientes',
        contabilizado: 'contabilizados',
        facturado: 'facturados',
        anulado: 'anulados'
      };
      (data || []).forEach(function (p) {
        var key = keys[p.estado];
        if (key) r[key]++;
      });
      return r;
    } catch (e) { logErr('getResumen', e); return { pendientes: 0, contabilizados: 0, facturados: 0, anulados: 0, total: 0 }; }
  };

  Pedidos.cambiarEstado = async function (entrega, nuevoEstado, usuario, observacion) {
    try {
      var updateFields = { estado: nuevoEstado };
      // DB 'facturado' = UI "Contabilizado" | DB 'contabilizado' = UI "Facturado"
      if (nuevoEstado === 'facturado')          updateFields.fecha_contabilizado = new Date().toISOString();
      else if (nuevoEstado === 'contabilizado') updateFields.fecha_facturado     = new Date().toISOString();
      else if (nuevoEstado === 'anulado')        updateFields.fecha_anulado       = new Date().toISOString();
      await update('pedidos', 'entrega', entrega, updateFields);
      await post('pedidos_historial', { entrega: entrega, estado: nuevoEstado, usuario: usuario || 'sistema', observacion: observacion || '' });
      await registrarAuditoria('cambio_estado', usuario, null, entrega, 'Estado cambiado a ' + nuevoEstado);
      return true;
    } catch (e) { logErr('cambiarEstado', e); throw e; }
  };

  Pedidos.eliminar = async function (entrega, usuario, observacion) {
    try {
      await post('pedidos_historial', { entrega: entrega, estado: 'anulado', usuario: usuario || 'sistema', observacion: observacion || 'Anulado del sistema' });
      await update('pedidos', 'entrega', entrega, { estado: 'anulado', fecha_anulado: new Date().toISOString() });
      await registrarAuditoria('anulacion', usuario, null, entrega, observacion || 'Pedido anulado');
      return true;
    } catch (e) { logErr('eliminar', e); throw e; }
  };

  Pedidos.traspasar = async function (entrega, usuario) {
    try {
      await update('pedidos', 'entrega', entrega, { almacen: 'DEPOSITO', almacen_origen: 'FABRICA' });
      await post('pedidos_historial', { entrega: entrega, estado: 'traspaso', usuario: usuario || 'sistema', observacion: 'Traspasado de Fábrica a Depósito' });
      await registrarAuditoria('traspaso_almacen', usuario, null, entrega, 'Traspaso FABRICA → DEPOSITO');
      return true;
    } catch (e) { logErr('traspasar', e); throw e; }
  };

  Pedidos.borrar = async function (entrega, usuario) {
    try {
      await del('pedido_items', 'pedido_entrega', entrega);
      await del('pedidos', 'entrega', entrega);
      await registrarAuditoria('eliminacion', usuario || 'sistema', null, entrega, 'Pedido eliminado permanentemente');
      return true;
    } catch (e) { logErr('borrar', e); throw e; }
  };

  Pedidos.crearPedido = async function (data) {
    var entrega = data.entrega || String(Date.now());
    try {
      await post('pedidos', {
        entrega: entrega, pedido: data.pedido || '', solicitud: data.solicitud || '',
        cliente: data.cliente || '', vendedor: data.vendedor || '',
        fecha: data.fecha || null, usuario_empaque: data.usuarioEmpaque || '', estado: 'pendiente'
      });
      if (data.items && data.items.length) {
        var itemsPayload = data.items.map(function (it) {
          return { pedido_entrega: entrega, material: it.material || '', denominacion: it.denominacion || '', cantidad: it.cantidad || 0, unidad: it.unidad || '', cont_entr: it.contEntr || 0, cont_art: it.contArt || 0 };
        });
        await post('pedido_items', itemsPayload);
      }
      await registrarAuditoria('creacion', data.usuario || 'sistema', null, entrega, 'Pedido creado');
      return entrega;
    } catch (e) { logErr('crearPedido', e); throw e; }
  };

  Pedidos.actualizarPedido = async function (entrega, data) {
    try {
      var payload = {};
      if (data.pedido !== undefined) payload.pedido = data.pedido;
      if (data.solicitud !== undefined) payload.solicitud = data.solicitud;
      if (data.cliente !== undefined) payload.cliente = data.cliente;
      if (data.vendedor !== undefined) payload.vendedor = data.vendedor;
      if (data.fecha !== undefined) payload.fecha = data.fecha;
      if (data.usuarioEmpaque !== undefined) payload.usuario_empaque = data.usuarioEmpaque;
      if (Object.keys(payload).length) await update('pedidos', 'entrega', entrega, payload);
      if (data.items) {
        await del('pedido_items', 'pedido_entrega', entrega);
        var itemsPayload = data.items.map(function (it) {
          return { pedido_entrega: entrega, material: it.material || '', denominacion: it.denominacion || '', cantidad: it.cantidad || 0, unidad: it.unidad || '', cont_entr: it.contEntr || 0, cont_art: it.contArt || 0 };
        });
        await post('pedido_items', itemsPayload);
      }
      return true;
    } catch (e) { logErr('actualizarPedido', e); throw e; }
  };

  /* ---- DASHBOARD / SUMMARY ---- */
  var Dashboard = {};

  Dashboard.getSummary = async function (scope, year, month, almacen) {
    var Y = year || new Date().getFullYear();
    var M = month || new Date().getMonth() + 1;
    try {
      var mesFiltro = scope !== 'all' ? (Y + '-' + String(M).padStart(2, '0')) : null;
      var inicio = mesFiltro ? mesFiltro + '-01' : null;
      var fin = mesFiltro ? (mesFiltro + '-' + String(new Date(Y, M, 0).getDate()).padStart(2, '0')) : null;

      // Always fetch ALL data — dates may be stored in non-ISO formats (DD.MM.YYYY, etc.)
      // so we normalize client-side via formatearFecha before any filtering.
      var results = await Promise.all([
        get('pedidos', 'select=estado,fecha,cliente,vendedor,almacen,monto'),
        Promise.resolve(null)
      ]);
      var data     = results[0] || [];
      var trendRaw = data;

      // Normalizar fechas (handles ISO, DD/MM/YYYY, DD.MM.YYYY, Excel serials)
      data.forEach(function (p) { p.fecha = formatearFecha(p.fecha); });

      // Client-side month filter
      if (inicio && fin) {
        data = data.filter(function (p) { return p.fecha >= inicio && p.fecha <= fin; });
      }

      // Mapa cliente → tiene DEPOSITO / tiene FABRICA (sobre datos ya filtrados por mes)
      var summaryClientMap = {};
      data.forEach(function (p) {
        var c = p.cliente || '';
        if (!summaryClientMap[c]) summaryClientMap[c] = { hasFabrica: false, hasDeposito: false };
        if ((p.almacen || '').toUpperCase() === 'FABRICA') summaryClientMap[c].hasFabrica = true;
        else summaryClientMap[c].hasDeposito = true;
      });
      // Cliente con al menos 1 DEPOSITO → DEPOSITO. Cliente 100% FABRICA → FABRICA.
      function summaryEsDeposito(p) { var i = summaryClientMap[p.cliente || '']; return i && i.hasDeposito; }
      function summaryEsFabrica(p)  { var i = summaryClientMap[p.cliente || '']; return i && i.hasFabrica && !i.hasDeposito; }

      // Filtro de almacén para KPIs (aplica sobre el slice de datos ya filtrado por mes)
      var kpiData = data;
      if (almacen === 'DEPOSITO') {
        kpiData = data.filter(summaryEsDeposito);
      } else if (almacen === 'FABRICA') {
        kpiData = data.filter(summaryEsFabrica);
      }

      // ── KPIs ──
      var kpis = {
        pendientes: 0, entregados: 0, en_transito: 0, anulados: 0, acuses: 0, total: 0,
        fabrica: 0, deposito: 0,
        monto_pendientes: 0, monto_entregados: 0, monto_en_transito: 0, monto_anulados: 0, monto_total: 0,
        monto_fabrica: 0, monto_deposito: 0
      };
      // Estado KPIs (pendientes, facturado, etc.) desde kpiData (filtrada por almacén activo)
      kpiData.forEach(function (p) {
        var m = Number(p.monto) || 0;
        kpis.total++;
        kpis.monto_total += m;
        if (p.estado === 'pendiente')          { kpis.pendientes++;  kpis.monto_pendientes  += m; }
        else if (p.estado === 'contabilizado') { kpis.entregados++;  kpis.monto_entregados  += m; }
        else if (p.estado === 'facturado')     { kpis.en_transito++; kpis.monto_en_transito += m; }
        else if (p.estado === 'anulado')       { kpis.anulados++;    kpis.monto_anulados    += m; }
      });
      // Conteos FABRICA/DEPOSITO usando la misma lógica de cliente para que los badges reflejen la vista
      data.forEach(function (p) {
        var m = Number(p.monto) || 0;
        if (summaryEsFabrica(p)) { kpis.fabrica++;  kpis.monto_fabrica  += m; }
        else                     { kpis.deposito++; kpis.monto_deposito += m; }
      });
      kpis.acuses = kpis.pendientes + kpis.entregados + kpis.en_transito;

      // ── DONUT ──
      var donut = { pendientes: 0, entregados: 0, en_transito: 0, anulados: 0, total: 0 };
      kpiData.forEach(function (p) {
        if (p.estado === 'pendiente')          donut.pendientes++;
        else if (p.estado === 'contabilizado') donut.entregados++;
        else if (p.estado === 'facturado')     donut.en_transito++;
        else if (p.estado === 'anulado')       donut.anulados++;
      });
      donut.total = donut.pendientes + donut.entregados + donut.en_transito + donut.anulados;
      donut.porcentajeEntregados = donut.total > 0 ? Math.round(donut.entregados / donut.total * 100) : 0;
      donut.porcentajePendientes = donut.total > 0 ? Math.round(donut.pendientes / donut.total * 100) : 0;
      donut.porcentajeTransito   = donut.total > 0 ? Math.round(donut.en_transito / donut.total * 100) : 0;

      // ── TOP CLIENTES ──
      var clienteCount = {};
      kpiData.forEach(function (p) {
        var c = p.cliente || 'S/C';
        clienteCount[c] = (clienteCount[c] || 0) + 1;
      });
      var zonas = Object.keys(clienteCount)
        .map(function (c) { return { label: c, value: clienteCount[c] }; })
        .sort(function (a, b) { return b.value - a.value; })
        .slice(0, 10);

      // ── POR VENDEDOR ──
      var vendedorCount = {};
      kpiData.forEach(function (p) {
        var v = p.vendedor || 'Sin vendedor';
        vendedorCount[v] = (vendedorCount[v] || 0) + 1;
      });
      var porVendedor = Object.keys(vendedorCount)
        .map(function (v) { return { label: v, value: vendedorCount[v] }; })
        .sort(function (a, b) { return b.value - a.value; })
        .slice(0, 10);

      // ── TENDENCIA: por día (mes activo) y por mes (histórico, usa trendRaw) ──
      var acusesPorDia = {}, acusesPorMes = {};
      data.forEach(function (p) {
        if (!p.fecha) return;
        acusesPorDia[p.fecha] = (acusesPorDia[p.fecha] || 0) + 1;
      });
      trendRaw.forEach(function (p) {
        if (!p.fecha) return;
        var mesKey = p.fecha.substring(0, 7);
        acusesPorMes[mesKey] = (acusesPorMes[mesKey] || 0) + 1;
      });

      return {
        kpis: kpis,
        donut: donut,
        zonas: zonas,
        porVendedor: porVendedor,
        acusesPorDia:  Object.keys(acusesPorDia).sort().map(function (k) { return { fecha: k, total: acusesPorDia[k] }; }),
        acusesPorMes:  Object.keys(acusesPorMes).sort().map(function (k) { return { mes: k, total: acusesPorMes[k] }; }),
        acusesPorSemana: []
      };
    } catch (e) { logErr('getSummary', e); return { kpis: {}, donut: {}, zonas: [], porVendedor: [] }; }
  };

  /* ---- CALENDARIO ---- */
  var Calendario = {};

  Calendario.getMonth = async function (year, month) {
    var Y = year || new Date().getFullYear();
    var M = month || new Date().getMonth() + 1;
    var inicio = Y + '-' + String(M).padStart(2, '0') + '-01';
    var ultimoDia = new Date(Y, M, 0).getDate();
    var fin = Y + '-' + String(M).padStart(2, '0') + '-' + String(ultimoDia).padStart(2, '0');
    try {
      var data = await get('pedidos', 'select=entrega,fecha,cliente,estado&fecha=gte.' + inicio + '&fecha=lte.' + fin);
      var days = {};
      (data || []).forEach(function (p) {
        if (!p.fecha) return;
        if (!days[p.fecha]) days[p.fecha] = { fecha: p.fecha, total: 0, pendientes: 0, contabilizados: 0, facturados: 0 };
        days[p.fecha].total++;
        if (days[p.fecha].hasOwnProperty(p.estado)) days[p.fecha][p.estado]++;
      });
      return {
        days: Object.keys(days).map(function (k) { return days[k]; }),
        summary: { total: (data || []).length }
      };
    } catch (e) { logErr('calendario', e); return { days: [], summary: {} }; }
  };

  Calendario.getDayDetail = async function (fecha) {
    return Pedidos.getAll({ fecha: fecha });
  };

  /* ---- HISTORIAL ---- */
  var Historial = {};

  Historial.getAll = async function (page, limit, filters) {
    page = page || 1; limit = limit || 50;
    var from = (page - 1) * limit;
    var qs = 'select=*&order=fecha.desc.nullslast&limit=' + limit + '&offset=' + from;
    if (filters) {
      if (filters.fecha) qs += '&fecha=gte.' + filters.fecha + 'T00:00:00&fecha=lte.' + filters.fecha + 'T23:59:59';
      if (filters.fechaDesde) qs += '&fecha=gte.' + filters.fechaDesde + 'T00:00:00';
      if (filters.fechaHasta) qs += '&fecha=lte.' + filters.fechaHasta + 'T23:59:59';
      if (filters.usuario) qs += '&usuario=ilike.*' + encodeURIComponent(filters.usuario) + '*';
      if (filters.cliente) qs += '&cliente=ilike.*' + encodeURIComponent(filters.cliente) + '*';
    }
    try {
      var items = await get('auditoria', qs);
      return {
        items: items || [],
        total: (items || []).length,
        suggestions: { usuario: [], cliente: [] }
      };
    } catch (e) { logErr('historial', e); return { items: [], total: 0, suggestions: { usuario: [], cliente: [] } }; }
  };

  /* ---- REPARTIDORES ---- */
  var Repartidores = {};

  Repartidores.getAll = async function () {
    try {
      return await get('repartidores', 'select=*&estado=eq.Activo&order=nombre');
    } catch (e) { logErr('repartidores.getAll', e); return []; }
  };

  Repartidores.crear = async function (nombre) {
    try {
      var d = await post('repartidores', { nombre: nombre, estado: 'Activo' });
      await registrarAuditoria('creacion_repartidor', 'sistema', null, null, 'Repartidor: ' + nombre);
      return Array.isArray(d) ? d[0] : d;
    } catch (e) { logErr('repartidores.crear', e); throw e; }
  };

  /* ---- CATÁLOGOS ---- */
  var Catalogos = {};

  Catalogos.getClientes = async function (query) {
    try {
      var qs = 'select=*&order=nom_cliente&limit=20';
      if (query) qs += '&or=(cod_cliente.ilike.*' + encodeURIComponent(query) + '*,nom_cliente.ilike.*' + encodeURIComponent(query) + '*)';
      var data = await get('clientes', qs);
      return (data || []).map(function (c) {
        return { Cod_Cliente: c.cod_cliente, Nom_Cliente: c.nom_cliente, Ruc_Cliente: c.ruc_cliente, Direc_Cliente: c.direc_cliente, Telefono_Cliente: c.telefono_cliente, Ciudad_Cliente: c.ciudad_cliente, Zona_Cliente: c.zona_cliente };
      });
    } catch (e) { logErr('clientes', e); return []; }
  };

  Catalogos.getArticulos = async function (query) {
    try {
      var qs = 'select=*&order=descr_sap&limit=20';
      if (query) qs += '&or=(material_sap.ilike.*' + encodeURIComponent(query) + '*,descr_sap.ilike.*' + encodeURIComponent(query) + '*)';
      var data = await get('articulos', qs);
      return (data || []).map(function (a) { return { Material_SAP: a.material_sap, Descr_SAP: a.descr_sap, UM_SAP: a.um_sap }; });
    } catch (e) { logErr('articulos', e); return []; }
  };

  /* ---- AUDITORÍA ---- */
  async function registrarAuditoria(accion, usuario, cliente, entrega, detalle) {
    try { await post('auditoria', { accion: accion, usuario: usuario || 'sistema', cliente: cliente || null, entrega: entrega || null, detalle: detalle || '' }); }
    catch (e) { logErr('auditoria', e); }
  }

  /* ---- HELPERS ---- */
  function formatearFecha(val) {
    if (!val) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return val;
    // DD/MM/YYYY or DD.MM.YYYY (SAP exports use dots; 1 or 2 digit day/month)
    var m = val.match(/^(\d{1,2})[\/.](\d{1,2})[\/.](\d{4})$/);
    if (m) return m[3] + '-' + String(m[2]).padStart(2, '0') + '-' + String(m[1]).padStart(2, '0');
    var n = Number(val);
    if (!isNaN(n) && n > 40000 && n < 100000) { var d = new Date((n - 25569) * 86400 * 1000); return d.toISOString().split('T')[0]; }
    return val;
  }

  /* ---- EXPORT ---- */
  window.Supabase = {
    Pedidos: Pedidos, Dashboard: Dashboard, Calendario: Calendario,
    Historial: Historial, Repartidores: Repartidores, Catalogos: Catalogos,
    registrarAuditoria: registrarAuditoria
  };

  async function getRepartidoresApi() {
    var reps = await Repartidores.getAll();
    return (reps || []).map(repartidorToApi);
  }

  async function getAcusesApiResponse(params) {
    params = params || {};
    var filters = {};

    if (params.estado && params.estado !== 'all') filters.estado = normalizePedidoEstado(params.estado);
    if (params.fecha) filters.fecha = params.fecha;
    if (params.fechaDesde) filters.fechaDesde = params.fechaDesde;
    if (params.fechaHasta) filters.fechaHasta = params.fechaHasta;
    if (params.q) filters.q = params.q;
    if (params.codCliente || params.cliente) filters.cliente = params.codCliente || params.cliente;

    var pedidos = await Pedidos.getAll(filters);
    var repartidores = [];
    try { repartidores = await Repartidores.getAll(); } catch (_) {}

    if (params.idRepartidor || params.repartidor) {
      var repId = String(params.idRepartidor || params.repartidor);
      var rep = (repartidores || []).find(function (item) {
        return String(item.id || '') === repId || String(item.codigo || '') === repId || normalizeText(item.nombre) === normalizeText(repId);
      });
      pedidos = pedidos.filter(function (pedido) {
        if (rep) return normalizeText(pedido.vendedor) === normalizeText(rep.nombre) || normalizeText(pedido.vendedor) === normalizeText(rep.codigo);
        return String(pedido.vendedor || '') === repId;
      });
    }

    if (params.almacen === 'FABRICA' || params.almacen === 'DEPOSITO') {
      // Lógica a nivel de cliente: si un cliente tiene al menos 1 entrega DEPOSITO
      // todas sus entregas (incluyendo FABRICA) van a DEPOSITO.
      // Solo clientes 100% FABRICA van al tab FABRICA.
      var panelClientMap = {};
      pedidos.forEach(function (p) {
        var c = p.cliente || '';
        if (!panelClientMap[c]) panelClientMap[c] = { hasFabrica: false, hasDeposito: false };
        if ((p.almacen || '').toUpperCase() === 'FABRICA') panelClientMap[c].hasFabrica = true;
        else panelClientMap[c].hasDeposito = true;
      });
      if (params.almacen === 'FABRICA') {
        pedidos = pedidos.filter(function (p) {
          var i = panelClientMap[p.cliente || ''];
          return i && i.hasFabrica && !i.hasDeposito;
        });
      } else {
        pedidos = pedidos.filter(function (p) {
          var i = panelClientMap[p.cliente || ''];
          return i && i.hasDeposito;
        });
      }
    }

    var total = pedidos.length;
    var offset = Math.max(Number(params.offset || 0) || 0, 0);
    var requestedLimit = Number(params.limit || 0) || 0;
    var limit = requestedLimit > 0 ? requestedLimit : total;
    var page = limit > 0 ? pedidos.slice(offset, offset + limit) : pedidos;

    return {
      items: page.map(function (pedido) { return pedidoToAcuse(pedido, repartidores); }),
      total: total,
      limit: limit,
      offset: offset,
      summary: buildAcuseSummary(pedidos)
    };
  }

  function normalizeApiGetRequest(path, params) {
    var mergedParams = {};

    try {
      var url = new window.URL(path, window.location.origin);
      url.searchParams.forEach(function (value, key) {
        if (mergedParams[key] === undefined) mergedParams[key] = value;
      });
      if (params) {
        Object.keys(params).forEach(function (key) {
          mergedParams[key] = params[key];
        });
      }
      return { path: url.pathname, params: mergedParams };
    } catch (_) {
      return { path: path, params: params || {} };
    }
  }

  /* ---- API INTERCEPTOR ---- */
  function hookAcuseAPI() {
    if (!window.AcuseAPI || !window.AcuseAPI.get) return;
    var origGet = window.AcuseAPI.get, origPost = window.AcuseAPI.post;
    var origPut = window.AcuseAPI.put, origPatch = window.AcuseAPI.patch;
    var origDelete = window.AcuseAPI.delete || window.AcuseAPI.del;

    window.AcuseAPI.get = async function (path, params) {
      var rawPath = path;
      var rawParams = params;
      var request = normalizeApiGetRequest(path, params);
      path = request.path;
      params = request.params;

      // Dashboard summary
      if (path === '/api/dashboard/interactivo/summary') {
        var scopeP = (params && params.scope) || 'month';
        var yearP, monthP;
        if (params && params.year && params.month) {
          yearP  = Number(params.year);
          monthP = Number(params.month);
        } else {
          var d = new Date((params && params.anchor) || undefined);
          yearP  = d.getFullYear();
          monthP = d.getMonth() + 1;
        }
        return await Dashboard.getSummary(scopeP, yearP, monthP, params && params.almacen);
      }
      // Dashboard resumen
      if (path === '/api/dashboard/resumen') {
        var r = await Pedidos.getResumen();
        var reps = []; try { reps = await Repartidores.getAll(); } catch (_) {}
        return { resumen: { total: r.total, pendientes: r.pendientes, repartidores: reps.length } };
      }
      // Calendar day detail
      if (path === '/api/dashboard/interactivo/panel/acuses') {
        return await getAcusesApiResponse(params && params.fecha ? params : { limit: 500 });
      }
      // Panel items
      var pm = path.match(/^\/api\/dashboard\/interactivo\/panel\/(\w+)$/);
      if (pm) {
        // Todos los paneles traen TODAS las entregas — el filtro por estado general se hace client-side
        return await getAcusesApiResponse(params);
      }
      // Pedidos list
      if (path === '/api/acuses') {
        return await getAcusesApiResponse(params);
      }
      // Single pedido
      var sm = path.match(/^\/api\/acuses\/(.+)$/);
      if (sm) {
        var p = await Pedidos.getByEntrega(decodeURIComponent(sm[1]));
        if (!p) throw new Error('Pedido no encontrado');
        var singleReps = []; try { singleReps = await Repartidores.getAll(); } catch (_) {}
        return pedidoToAcuse(p, singleReps);
      }
      // Calendar
      if (path === '/api/dashboard/interactivo/calendar') {
        return await Calendario.getMonth(Number(params && params.year) || new Date().getFullYear(), Number(params && params.month) || new Date().getMonth() + 1);
      }
      // Historial
      if (path === '/api/auditoria') {
        return await Historial.getAll((params && params.page) || 1, (params && params.limit) || 50, params);
      }
      // Clientes
      if (path === '/api/clientes') return { items: await Pedidos.getClientesUnicos((params && params.q) || '') };
      if (path === '/api/vendedores') return { items: await Pedidos.getVendedoresUnicos((params && params.q) || '') };
      // Articulos
      if (path === '/api/articulos') return { items: await Catalogos.getArticulos((params && params.q) || '') };
      // Repartidores
      if (path === '/api/repartidores') return { items: await getRepartidoresApi() };

      return origGet(rawPath, rawParams);
    };

    window.AcuseAPI.post = async function (path, body) {
      if (path === '/api/acuses') {
        var id = await Pedidos.crearPedido(acusePayloadToPedido(body));
        var created = await Pedidos.getByEntrega(id);
        return pedidoToAcuse(created);
      }
      if (/^\/api\/dashboard\/interactivo\/acuses\/.+\/print$/.test(path)) {
        var printId = decodeURIComponent(path.split('/').slice(-2)[0]);
        await registrarAuditoria('impresion', (body && body.Usuario) || localStorage.getItem('acuse.currentUser') || 'sistema', null, printId, (body && body.Observacion) || 'Impresion de acuse');
        return { success: true };
      }
      if (path === '/api/repartidores') return repartidorToApi(await Repartidores.crear(body.Nombre_Repartidor || body.nombre));
      return origPost(path, body);
    };

    window.AcuseAPI.put = async function (path, body) {
      var m = path.match(/^\/api\/acuses\/(.+)$/);
      if (m) {
        var id = decodeURIComponent(m[1]);
        await Pedidos.actualizarPedido(id, acusePayloadToPedido({ ...body, entrega: id }));
        var updated = await Pedidos.getByEntrega(id);
        return pedidoToAcuse(updated);
      }
      return origPut(path, body);
    };

    window.AcuseAPI.patch = async function (path, body) {
      var mEstado = path.match(/^\/api\/acuses\/(.+)\/estado$/);
      if (mEstado) {
        var entrega = decodeURIComponent(mEstado[1]);
        await Pedidos.cambiarEstado(entrega, normalizePedidoEstado(body.Estado), body.Usuario || localStorage.getItem('acuse.currentUser') || 'sistema', body.Observacion || '');
        var changed = await Pedidos.getByEntrega(entrega);
        return changed ? pedidoToAcuse(changed) : { ID_Acuse: entrega, Nro_Acuse: entrega, Estado: normalizeApiEstado(body.Estado) };
      }
      var mObs = path.match(/^\/api\/acuses\/(.+)\/observacion$/);
      if (mObs) {
        var entregaObs = decodeURIComponent(mObs[1]);
        await update('pedidos', 'entrega', entregaObs, { observacion: body.Observacion || '' });
        return { success: true };
      }
      var mMonto = path.match(/^\/api\/acuses\/(.+)\/monto$/);
      if (mMonto) {
        var entregaMonto = decodeURIComponent(mMonto[1]);
        await update('pedidos', 'entrega', entregaMonto, { monto: Number(body.Monto) || 0 });
        return { success: true };
      }
      var mAlmacen = path.match(/^\/api\/acuses\/(.+)\/almacen$/);
      if (mAlmacen) {
        var entregaAlm = decodeURIComponent(mAlmacen[1]);
        await Pedidos.traspasar(entregaAlm, body.Usuario || localStorage.getItem('acuse.currentUser') || 'sistema');
        var traspasado = await Pedidos.getByEntrega(entregaAlm);
        return traspasado ? pedidoToAcuse(traspasado) : { success: true };
      }
      return origPatch(path, body);
    };

    window.AcuseAPI.delete = async function (path, body) {
      var m = path.match(/^\/api\/acuses\/(.+)$/);
      if (m) {
        await Pedidos.eliminar(decodeURIComponent(m[1]), (body && body.Usuario) || localStorage.getItem('acuse.currentUser') || 'sistema', (body && body.Observacion) || '');
        return { success: true };
      }
      return origDelete(path, body);
    };
    window.AcuseAPI.del = window.AcuseAPI.delete;
  }

  hookAcuseAPI();
})();
