const { randomInt } = require('crypto');
const { pool, tables, withTransaction, config, quoteIdentifier } = require('../db');
const { badRequest, notFound } = require('../errors');
const schema = require('./schemaService');
const {
  completedStates, cancelledStates, statePlaceholders,
  terminadoSql, pendienteSql, anuladoLegacySql,
  mapEstado, estadoUiKey, summarizeEstadoRows
} = require('./estadoUtils');
const { API_MAX_LIMIT } = require('../config/constants');
const { cleanString, toNullableString, normalizeOffset, parsePositiveInt } = require('../utils/queryHelpers');

const MAX_LIMIT = API_MAX_LIMIT;

function normalizeLimit(value) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) return 100;
  return Math.min(parsed, MAX_LIMIT);
}

function shouldFetchAllRows(query) {
  const raw = String(query?.all ?? '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'all';
}

function requireField(payload, field, label = field) {
  const value = cleanString(payload[field]);
  if (!value) throw badRequest(`${label} es obligatorio`);
  return value;
}

function isValidISODate(str) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  const d = new Date(`${str}T00:00:00`);
  return !isNaN(d.getTime()) && d.toISOString().startsWith(str);
}

async function optionalColumns(key, requiredColumns) {
  return schema.requireColumns(key, requiredColumns, { required: false });
}

function clienteSelect(info, alias = 'c', extraColumns = []) {
  const columns = [
    'Nom_Cliente',
    'Ruc_Cliente',
    'Direc_Cliente',
    'Ciudad_Cliente',
    'Zona_Cliente',
    ...extraColumns
  ];
  return columns.map((column) => schema.selectColumn(info, alias, column)).join(',\n        ');
}

function clienteTelefonoSelect(info, alias = 'c', output = 'Telefono_Cliente') {
  const candidates = ['Telef_Cliente', 'TelF_Cliente', 'Telefono_Cliente'];
  const resolved = candidates
    .map((column) => schema.aliasColumn(info, alias, column))
    .filter(Boolean);
  const expression = resolved.length ? `COALESCE(${resolved.join(', ')})` : 'NULL';
  return `${expression} AS ${quoteIdentifier(output)}`;
}

function clienteJoin(info, alias = 'c') {
  const codColumn = schema.aliasColumn(info, alias, 'Cod_Cliente');
  return codColumn ? `LEFT JOIN ${info.table.ref} ${alias} ON ${codColumn} = a.Cod_Cliente` : '';
}

function normalizeDetalle(input) {
  const detalles = Array.isArray(input.detalles) ? input.detalles : [];

  if (!detalles.length && input.Cod_Mercaderia) {
    detalles.push({
      Cod_Mercaderia: input.Cod_Mercaderia,
      Cantidad: input.Cantidad,
      UM: input.UM,
      Nota: input.Nota
    });
  }

  return detalles
    .map((item) => ({
      Cod_Mercaderia: cleanString(item.Cod_Mercaderia),
      Cantidad: Number(item.Cantidad),
      UM: cleanString(item.UM),
      Nota: toNullableString(item.Nota)
    }))
    .filter((item) => item.Cod_Mercaderia);
}

function isAnuladoEnumUnsupportedError(error) {
  const code = String(error?.code || '').trim();
  const message = String(error?.message || '').toLowerCase();
  return code === 'WARN_DATA_TRUNCATED'
    || code === 'ER_TRUNCATED_WRONG_VALUE_FOR_FIELD'
    || message.includes('data truncated')
    || message.includes('incorrect enum value')
    || message.includes('column \'estado\'');
}

async function validateCliente(codCliente) {
  const info = await schema.requireColumns('clientes', ['Cod_Cliente']);
  const codColumn = schema.aliasColumn(info, 'c', 'Cod_Cliente');
  const [rows] = await pool.execute(
    `SELECT
        ${schema.selectColumn(info, 'c', 'Cod_Cliente')},
        ${clienteSelect(info)},
        ${clienteTelefonoSelect(info)}
       FROM ${info.table.ref} c
      WHERE ${codColumn} = ?
      LIMIT 1`,
    [codCliente]
  );

  if (!rows.length) throw badRequest('El cliente no existe en BD_ALAS_SAP.clientes_SAP');
  return rows[0];
}

async function validateRepartidor(idRepartidor) {
  const [rows] = await pool.execute(
    `SELECT ID, Codigo_Repartidor, Nombre_Repartidor, Estado_Repartidor
       FROM ${tables.repartidor}
      WHERE ID = ?
      LIMIT 1`,
    [idRepartidor]
  );

  if (!rows.length) throw badRequest('El repartidor no existe en BD_ALAS_ACUSE.repartidor');
  return rows[0];
}

async function validateArticulo(codMercaderia) {
  const info = await schema.requireColumns('articulos', ['Material_SAP']);
  const materialColumn = schema.aliasColumn(info, 'art', 'Material_SAP');
  const [rows] = await pool.execute(
    `SELECT
        ${schema.selectColumn(info, 'art', 'Material_SAP')},
        ${schema.selectColumn(info, 'art', 'Descr_SAP')},
        ${schema.selectColumn(info, 'art', 'UM_SAP')},
        ${schema.selectColumn(info, 'art', 'Status_SAP')}
       FROM ${info.table.ref} art
      WHERE ${materialColumn} = ?
      LIMIT 1`,
    [codMercaderia]
  );

  if (!rows.length) {
    throw badRequest(`La mercaderia ${codMercaderia} no existe en BD_ALAS_SAP.articulos_SAP`);
  }

  return rows[0];
}

async function validateArticulosBatch(codigos) {
  if (!codigos.length) return new Map();
  const info = await schema.requireColumns('articulos', ['Material_SAP']);
  const materialColumn = schema.aliasColumn(info, 'art', 'Material_SAP');
  const placeholders = codigos.map(() => '?').join(', ');
  const [rows] = await pool.execute(
    `SELECT
        ${schema.selectColumn(info, 'art', 'Material_SAP')},
        ${schema.selectColumn(info, 'art', 'Descr_SAP')},
        ${schema.selectColumn(info, 'art', 'UM_SAP')},
        ${schema.selectColumn(info, 'art', 'Status_SAP')}
       FROM ${info.table.ref} art
      WHERE ${materialColumn} IN (${placeholders})`,
    codigos
  );
  return new Map(rows.map((r) => [r.Material_SAP, r]));
}

async function normalizeAcusePayload(payload) {
  const codCliente = requireField(payload, 'Cod_Cliente', 'Cliente');
  const estado = mapEstado(requireField(payload, 'Estado', 'Estado'));
  const fechaEmision = requireField(payload, 'Fecha_Emision', 'Fecha de emision');
  const idRepartidor = parsePositiveInt(payload.ID_Repartidor, 'Repartidor');
  const usuario = toNullableString(payload.Usuario) || toNullableString(payload.Usuario_Creacion) || config.defaultUser;

  const cliente = await validateCliente(codCliente);
  const repartidor = await validateRepartidor(idRepartidor);
  const detalles = normalizeDetalle(payload);

  if (!detalles.length) throw badRequest('Debe informar al menos una mercaderia en el detalle');

  const codigosMercaderia = detalles.map((item) => item.Cod_Mercaderia);
  const articulosMap = await validateArticulosBatch(codigosMercaderia);

  for (const item of detalles) {
    const articulo = articulosMap.get(item.Cod_Mercaderia);
    if (!articulo) {
      throw badRequest(`La mercaderia ${item.Cod_Mercaderia} no existe en BD_ALAS_SAP.articulos_SAP`);
    }
    if (!item.UM) item.UM = articulo.UM_SAP || '';
    if (!Number.isFinite(item.Cantidad) || item.Cantidad <= 0) {
      throw badRequest(`Cantidad invalida para ${item.Cod_Mercaderia}`);
    }
  }

  return {
    Nro_Acuse: toNullableString(payload.Nro_Acuse),
    Cod_Cliente: codCliente,
    Estado: estado,
    Fecha_Emision: fechaEmision,
    Fecha_Entrega: toNullableString(payload.Fecha_Entrega),
    ID_Repartidor: idRepartidor,
    Observacion: toNullableString(payload.Observacion),
    Usuario: usuario,
    Zona: toNullableString(payload.Zona) || cliente.Zona_Cliente || null,
    Activo: payload.Activo === undefined ? 1 : Number(Boolean(payload.Activo)),
    detalles,
    cliente,
    repartidor
  };
}

async function listAcuses(query) {
  const fetchAll = shouldFetchAllRows(query);
  const limit = fetchAll ? null : normalizeLimit(query.limit);
  const offset = fetchAll ? 0 : normalizeOffset(query.offset);
  const clienteInfo = await optionalColumns('clientes', ['Cod_Cliente']);
  const params = [];
  const normalizedEstado = cleanString(query.estado)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/_/g, ' ')
    .toLowerCase();
  const includeLegacyAnulados = ['anulado', 'cancelado'].includes(normalizedEstado);
  const where = includeLegacyAnulados ? ['1 = 1'] : ['a.Activo = 1'];

  if (query.estado && query.estado !== 'all') {
    if (['pendiente', 'hoy', 'proxima', 'proximo'].includes(normalizedEstado)) {
      where.push(pendienteSql('a', params));
    } else if (['entregado', 'terminado', 'completado'].includes(normalizedEstado)) {
      where.push(terminadoSql('a', params));
    } else if (includeLegacyAnulados) {
      where.push(anuladoLegacySql('a', params));
    } else {
      where.push('a.Estado = ?');
      params.push(mapEstado(normalizedEstado));
    }
  }

  if (query.bucket && query.bucket !== 'all') {
    if (query.bucket === 'hoy') {
      where.push('a.Fecha_Emision = CURDATE()');
    } else if (query.bucket === 'proxima') {
      where.push('a.Fecha_Emision > CURDATE()');
    } else if (query.bucket === 'completado') {
      where.push(terminadoSql('a', params));
    } else if (query.bucket === 'pendiente') {
      where.push(pendienteSql('a', params));
    } else if (query.bucket === 'terminado') {
      where.push(terminadoSql('a', params));
    }
  }

  if (query.codCliente) {
    where.push('a.Cod_Cliente = ?');
    params.push(query.codCliente);
  }

  if (query.idRepartidor || query.repartidor) {
    where.push('a.ID_Repartidor = ?');
    params.push(query.idRepartidor || query.repartidor);
  }

  if (query.zona) {
    where.push('(a.Zona LIKE ?)');
    params.push(`%${query.zona}%`);
  }

  if (query.fecha) {
    where.push('a.Fecha_Emision = ?');
    params.push(query.fecha);
  }

  if (query.fechaDesde) {
    where.push('a.Fecha_Emision >= ?');
    params.push(query.fechaDesde);
  }

  if (query.fechaHasta) {
    where.push('a.Fecha_Emision <= ?');
    params.push(query.fechaHasta);
  }

  if (query.q) {
    const searchColumns = ['a.Nro_Acuse', 'a.Cod_Cliente', 'r.Nombre_Repartidor'];
    const clienteNombre = schema.aliasColumn(clienteInfo, 'c', 'Nom_Cliente');
    if (clienteNombre) searchColumns.push(clienteNombre);
    where.push(`(${searchColumns.map((column) => `${column} LIKE ?`).join(' OR ')})`);
    const like = `%${query.q}%`;
    searchColumns.forEach(() => params.push(like));
  }

  const whereSql = `WHERE ${where.join(' AND ')}`;
  const estadoExpr = `CASE WHEN COALESCE(a.Activo, 1) = 0 THEN 'Anulado' ELSE a.Estado END`;
  const pagingSql = fetchAll ? '' : `LIMIT ${limit} OFFSET ${offset}`;

  const [rows] = await pool.execute(
    `SELECT
        a.ID_Acuse, a.Nro_Acuse, a.Cod_Cliente, ${estadoExpr} AS Estado, a.Fecha_Creacion,
        a.Fecha_Emision, a.Fecha_Entrega, a.ID_Repartidor, a.Observacion,
        a.Usuario_Creacion, a.Zona, a.Activo,
        r.Codigo_Repartidor, r.Nombre_Repartidor,
        ${clienteSelect(clienteInfo)},
        COALESCE(d.Detalle_Items, 0) AS Detalle_Items,
        COALESCE(d.Detalle_Cantidad_Total, 0) AS Detalle_Cantidad_Total
       FROM ${tables.acuse} a
       LEFT JOIN ${tables.repartidor} r ON r.ID = a.ID_Repartidor
       ${clienteJoin(clienteInfo)}
       LEFT JOIN (
         SELECT ID_Acuse, COUNT(*) AS Detalle_Items, SUM(Cantidad) AS Detalle_Cantidad_Total
           FROM ${tables.detalle}
          GROUP BY ID_Acuse
       ) d ON d.ID_Acuse = a.ID_Acuse
      ${whereSql}
      ORDER BY a.Fecha_Creacion DESC, a.ID_Acuse DESC
      ${pagingSql}`,
    params
  );

  const [countRows] = await pool.execute(
    `SELECT COUNT(*) AS total
       FROM ${tables.acuse} a
       LEFT JOIN ${tables.repartidor} r ON r.ID = a.ID_Repartidor
       ${clienteJoin(clienteInfo)}
       ${whereSql}`,
    params
  );

  const [summaryRows] = await pool.execute(
    `SELECT ${estadoExpr} AS Estado, COUNT(*) AS total
       FROM ${tables.acuse} a
       LEFT JOIN ${tables.repartidor} r ON r.ID = a.ID_Repartidor
       ${clienteJoin(clienteInfo)}
       ${whereSql}
      GROUP BY ${estadoExpr}`,
    params
  );

  const total = Number(countRows[0]?.total || 0);

  return {
    items: rows,
    total,
    limit: fetchAll ? total : limit,
    offset,
    summary: summarizeEstadoRows(summaryRows)
  };
}

async function getAcuse(idAcuse, executor = pool) {
  const id = parsePositiveInt(idAcuse, 'ID_Acuse');
  const clienteInfo = await optionalColumns('clientes', ['Cod_Cliente']);
  const articuloInfo = await optionalColumns('articulos', ['Material_SAP']);
  const articuloJoinColumn = schema.aliasColumn(articuloInfo, 'art', 'Material_SAP');
  const articuloJoin = articuloJoinColumn
    ? `LEFT JOIN ${articuloInfo.table.ref} art ON ${articuloJoinColumn} = d.Cod_Mercaderia`
    : '';
  const [rows] = await executor.execute(
    `SELECT
        a.*,
        r.Codigo_Repartidor, r.Nombre_Repartidor, r.Estado_Repartidor,
       ${clienteSelect(clienteInfo, 'c', [
          'Canal_Distri',
          'Cod_Vendedor',
          'Cond_Venta',
          'Vend_Asignado',
          'Vend_Interno'
        ])},
        ${clienteTelefonoSelect(clienteInfo, 'c')}
       FROM ${tables.acuse} a
       LEFT JOIN ${tables.repartidor} r ON r.ID = a.ID_Repartidor
       ${clienteJoin(clienteInfo)}
      WHERE a.ID_Acuse = ?
      LIMIT 1`,
    [id]
  );

  if (!rows.length) throw notFound('Acuse no encontrado');

  const [detalle] = await executor.execute(
    `SELECT
        d.ID_Detalle, d.ID_Acuse, d.Cod_Mercaderia, d.Cantidad, d.UM, d.Nota,
        ${schema.selectColumn(articuloInfo, 'art', 'Descr_SAP')},
        ${schema.selectColumn(articuloInfo, 'art', 'Status_SAP')},
        ${schema.selectColumn(articuloInfo, 'art', 'Jerarquia_SAP')}
       FROM ${tables.detalle} d
       ${articuloJoin}
      WHERE d.ID_Acuse = ?
      ORDER BY d.ID_Detalle ASC`,
    [id]
  );

  const [historial] = await executor.execute(
    `SELECT ID, ID_Acuse, Estado, Fecha, Usuario, Observacion
       FROM ${tables.historial}
      WHERE ID_Acuse = ?
      ORDER BY Fecha DESC, ID DESC`,
    [id]
  );

  const [acciones] = await executor.execute(
    `SELECT ID, ID_Acuse, Accion, FechaHora, Usuario, Observacion
       FROM ${tables.log}
      WHERE ID_Acuse = ?
      ORDER BY FechaHora DESC, ID DESC`,
    [id]
  );

  const estadoActual = Number(rows[0].Activo || 0) === 0 ? 'Anulado' : rows[0].Estado;
  return { ...rows[0], Estado: estadoActual, detalles: detalle, historial, acciones };
}

async function insertLog(connection, idAcuse, accion, usuario, observacion = null) {
  await connection.execute(
    `INSERT INTO ${tables.log} (ID_Acuse, Accion, FechaHora, Usuario, Observacion)
     VALUES (?, ?, NOW(), ?, ?)`,
    [idAcuse, accion, usuario, observacion]
  );
}

async function insertHistorial(connection, idAcuse, estado, usuario, observacion = null) {
  await connection.execute(
    `INSERT INTO ${tables.historial} (ID_Acuse, Estado, Fecha, Usuario, Observacion)
     VALUES (?, ?, NOW(), ?, ?)`,
    [idAcuse, estado, usuario, observacion]
  );
}

async function insertDetalles(connection, idAcuse, detalles) {
  for (const item of detalles) {
    await connection.execute(
      `INSERT INTO ${tables.detalle} (ID_Acuse, Cod_Mercaderia, Cantidad, UM, Nota)
       VALUES (?, ?, ?, ?, ?)`,
      [idAcuse, item.Cod_Mercaderia, item.Cantidad, item.UM, item.Nota]
    );
  }
}

function formatAcuseNumberFromId(idAcuse) {
  const numericId = Number.parseInt(idAcuse, 10);
  if (!Number.isInteger(numericId) || numericId <= 0) {
    throw new Error('No se pudo generar el numero correlativo del acuse');
  }
  return `AC-${String(numericId).padStart(4, '0')}`;
}

function ensureAcuseIsMutable(acuse, message = 'El acuse anulado no puede modificarse') {
  if (estadoUiKey(acuse?.Estado) === 'anulado') {
    throw badRequest(message);
  }
}

async function createAcuseFlow(payload, dependencies = {}) {
  const normalizeAcusePayloadFn = dependencies.normalizeAcusePayload || normalizeAcusePayload;
  const withTransactionFn = dependencies.withTransaction || withTransaction;
  const insertDetallesFn = dependencies.insertDetalles || insertDetalles;
  const insertHistorialFn = dependencies.insertHistorial || insertHistorial;
  const insertLogFn = dependencies.insertLog || insertLog;
  const getAcuseFn = dependencies.getAcuse || getAcuse;
  const formatAcuseNumberFromIdFn = dependencies.formatAcuseNumberFromId || formatAcuseNumberFromId;
  const nowFn = dependencies.now || Date.now;
  const randomFn = dependencies.random || null;
  const data = await normalizeAcusePayloadFn(payload);

  return withTransactionFn(async (connection) => {
    const randNum = randomFn != null ? Math.floor(randomFn() * 10000) : randomInt(10000);
    const provisionalNroAcuse = data.Nro_Acuse || `TMP-AC-${nowFn()}-${randNum}`;
    const [result] = await connection.execute(
      `INSERT INTO ${tables.acuse}
        (Nro_Acuse, Cod_Cliente, Estado, Fecha_Creacion, Fecha_Emision, Fecha_Entrega,
         ID_Repartidor, Observacion, Usuario_Creacion, Zona, Activo)
       VALUES (?, ?, ?, NOW(), ?, ?, ?, ?, ?, ?, ?)`,
      [
        provisionalNroAcuse,
        data.Cod_Cliente,
        data.Estado,
        data.Fecha_Emision,
        data.Fecha_Entrega,
        data.ID_Repartidor,
        data.Observacion,
        data.Usuario,
        data.Zona,
        data.Activo
      ]
    );

    const idAcuse = result.insertId;
    const nroAcuse = data.Nro_Acuse || formatAcuseNumberFromIdFn(idAcuse);
    if (nroAcuse !== provisionalNroAcuse) {
      await connection.execute(
        `UPDATE ${tables.acuse}
            SET Nro_Acuse = ?
          WHERE ID_Acuse = ?`,
        [nroAcuse, idAcuse]
      );
    }
    await insertDetallesFn(connection, idAcuse, data.detalles);
    await insertHistorialFn(connection, idAcuse, data.Estado, data.Usuario, 'Creacion del acuse');
    await insertLogFn(connection, idAcuse, 'CREAR', data.Usuario, 'Acuse creado desde modulo web');
    return getAcuseFn(idAcuse, connection);
  });
}

async function createAcuse(payload) {
  return createAcuseFlow(payload);
}

async function updateAcuseFlow(idAcuse, payload, dependencies = {}) {
  const getAcuseFn = dependencies.getAcuse || getAcuse;
  const normalizeAcusePayloadFn = dependencies.normalizeAcusePayload || normalizeAcusePayload;
  const withTransactionFn = dependencies.withTransaction || withTransaction;
  const insertDetallesFn = dependencies.insertDetalles || insertDetalles;
  const insertHistorialFn = dependencies.insertHistorial || insertHistorial;
  const insertLogFn = dependencies.insertLog || insertLog;
  const id = parsePositiveInt(idAcuse, 'ID_Acuse');
  const existing = await getAcuseFn(id);
  ensureAcuseIsMutable(existing, 'El acuse anulado no puede editarse');
  const data = await normalizeAcusePayloadFn(payload);

  return withTransactionFn(async (connection) => {
    await connection.execute(
      `UPDATE ${tables.acuse}
          SET Nro_Acuse = ?,
              Cod_Cliente = ?,
              Estado = ?,
              Fecha_Emision = ?,
              Fecha_Entrega = ?,
              ID_Repartidor = ?,
              Observacion = ?,
              Zona = ?,
              Activo = ?
        WHERE ID_Acuse = ?`,
      [
        data.Nro_Acuse || existing.Nro_Acuse,
        data.Cod_Cliente,
        data.Estado,
        data.Fecha_Emision,
        data.Fecha_Entrega,
        data.ID_Repartidor,
        data.Observacion,
        data.Zona,
        data.Activo,
        id
      ]
    );

    await connection.execute(`DELETE FROM ${tables.detalle} WHERE ID_Acuse = ?`, [id]);
    await insertDetallesFn(connection, id, data.detalles);

    if (existing.Estado !== data.Estado) {
      await insertHistorialFn(connection, id, data.Estado, data.Usuario, 'Cambio de estado desde edicion');
    }

    await insertLogFn(connection, id, 'EDITAR', data.Usuario, 'Acuse actualizado desde modulo web');
    return getAcuseFn(id, connection);
  });
}

async function updateAcuse(idAcuse, payload) {
  return updateAcuseFlow(idAcuse, payload);
}

async function changeEstadoFlow(idAcuse, payload, dependencies = {}) {
  const mapEstadoFn = dependencies.mapEstado || mapEstado;
  const getAcuseFn = dependencies.getAcuse || getAcuse;
  const withTransactionFn = dependencies.withTransaction || withTransaction;
  const insertHistorialFn = dependencies.insertHistorial || insertHistorial;
  const insertLogFn = dependencies.insertLog || insertLog;
  const id = parsePositiveInt(idAcuse, 'ID_Acuse');
  const estado = mapEstadoFn(requireField(payload, 'Estado'));
  const usuario = toNullableString(payload.Usuario) || config.defaultUser;
  const observacion = toNullableString(payload.Observacion);
  const existing = await getAcuseFn(id);
  ensureAcuseIsMutable(existing, 'El acuse anulado no puede cambiar de estado');

  return withTransactionFn(async (connection) => {
    await connection.execute(
      `UPDATE ${tables.acuse}
          SET Estado = ?,
              Fecha_Entrega = CASE WHEN ? IS NULL THEN Fecha_Entrega ELSE ? END
        WHERE ID_Acuse = ?`,
      [estado, payload.Fecha_Entrega || null, payload.Fecha_Entrega || null, id]
    );
    await insertHistorialFn(connection, id, estado, usuario, observacion);
    await insertLogFn(connection, id, 'CAMBIO_ESTADO', usuario, observacion);
    return getAcuseFn(id, connection);
  });
}

async function changeEstado(idAcuse, payload) {
  return changeEstadoFlow(idAcuse, payload);
}

async function deactivateAcuseFlow(idAcuse, payload = {}, dependencies = {}) {
  const getAcuseFn = dependencies.getAcuse || getAcuse;
  const withTransactionFn = dependencies.withTransaction || withTransaction;
  const insertHistorialFn = dependencies.insertHistorial || insertHistorial;
  const insertLogFn = dependencies.insertLog || insertLog;
  const id = parsePositiveInt(idAcuse, 'ID_Acuse');
  const usuario = toNullableString(payload.Usuario) || config.defaultUser;
  const observacion = requireField(payload, 'Observacion', 'Motivo de anulacion');
  const existing = await getAcuseFn(id);

  if (estadoUiKey(existing.Estado) === 'entregado') {
    throw badRequest('El acuse entregado no puede anularse');
  }

  if (estadoUiKey(existing.Estado) === 'anulado') {
    throw badRequest('El acuse ya se encuentra anulado');
  }

  return withTransactionFn(async (connection) => {
    let legacyFallback = false;
    try {
      await connection.execute(
        `UPDATE ${tables.acuse}
            SET Estado = ?,
                Activo = 0
          WHERE ID_Acuse = ?`,
        ['Anulado', id]
      );
    } catch (error) {
      if (!isAnuladoEnumUnsupportedError(error)) throw error;
      legacyFallback = true;
      await connection.execute(
        `UPDATE ${tables.acuse}
            SET Activo = 0
          WHERE ID_Acuse = ?`,
        [id]
      );
    }
    await insertHistorialFn(connection, id, 'Anulado', usuario, observacion);
    await insertLogFn(connection, id, 'ANULAR', usuario, observacion);
    return { ok: true, Estado: 'Anulado', legacyFallback };
  });
}

async function deactivateAcuse(idAcuse, payload = {}) {
  return deactivateAcuseFlow(idAcuse, payload);
}

async function dashboardResumen() {
  const resumenParams = [];
  const pendientesCondition = pendienteSql('a', resumenParams);
  const terminadosCondition = terminadoSql('a', resumenParams);

  const [estadoRows] = await pool.execute(
    `SELECT Estado, COUNT(*) AS total
       FROM ${tables.acuse}
      WHERE Activo = 1
      GROUP BY Estado`
  );

  const [fechaRows] = await pool.execute(
    `SELECT
        SUM(CASE WHEN Fecha_Emision = CURDATE() THEN 1 ELSE 0 END) AS hoy,
        SUM(CASE WHEN Fecha_Emision > CURDATE() THEN 1 ELSE 0 END) AS proximas,
        SUM(CASE WHEN Fecha_Entrega IS NOT NULL THEN 1 ELSE 0 END) AS entregadas,
        COUNT(*) AS total
       FROM ${tables.acuse}
      WHERE Activo = 1`
  );

  const [resumenRows] = await pool.execute(
    `SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN ${pendientesCondition} THEN 1 ELSE 0 END) AS pendientes,
        SUM(CASE WHEN ${terminadosCondition} THEN 1 ELSE 0 END) AS terminados
       FROM ${tables.acuse} a
      WHERE a.Activo = 1`,
    resumenParams
  );

  const [repartidorRows] = await pool.execute(
    `SELECT COUNT(*) AS total
       FROM ${tables.repartidor}
      WHERE Estado_Repartidor IS NULL OR Estado_Repartidor <> 'Inactivo'`
  );

  const [diaRows] = await pool.execute(
    `SELECT DATE(Fecha_Emision) AS fecha, COUNT(*) AS total
       FROM ${tables.acuse}
      WHERE Activo = 1
        AND Fecha_Emision >= DATE_SUB(CURDATE(), INTERVAL 6 DAY)
      GROUP BY DATE(Fecha_Emision)
      ORDER BY fecha ASC`
  );

  return {
    porEstado: estadoRows,
    fechas: fechaRows[0] || { hoy: 0, proximas: 0, entregadas: 0, total: 0 },
    resumen: {
      total: Number(resumenRows[0]?.total || 0),
      pendientes: Number(resumenRows[0]?.pendientes || 0),
      entregados: Number(resumenRows[0]?.terminados || 0),
      terminados: Number(resumenRows[0]?.terminados || 0),
      repartidores: Number(repartidorRows[0]?.total || 0)
    },
    porDia: diaRows
  };
}

async function resumenRepartidores() {
  const params = [];
  const pendientesCondition = pendienteSql('a', params);
  const terminadosCondition = terminadoSql('a', params);

  const [rows] = await pool.execute(
    `SELECT
        r.ID,
        r.Codigo_Repartidor,
        r.Nombre_Repartidor,
        r.Estado_Repartidor,
        COUNT(a.ID_Acuse) AS total,
        SUM(CASE WHEN a.ID_Acuse IS NOT NULL AND ${pendientesCondition} THEN 1 ELSE 0 END) AS pendientes,
        SUM(CASE WHEN a.ID_Acuse IS NOT NULL AND ${terminadosCondition} THEN 1 ELSE 0 END) AS terminados
       FROM ${tables.repartidor} r
       LEFT JOIN ${tables.acuse} a ON a.ID_Repartidor = r.ID AND a.Activo = 1
      GROUP BY r.ID, r.Codigo_Repartidor, r.Nombre_Repartidor, r.Estado_Repartidor
      ORDER BY r.Nombre_Repartidor ASC`,
    params
  );

  return rows.map((row) => ({
    ...row,
    total: Number(row.total || 0),
    pendientes: Number(row.pendientes || 0),
    entregados: Number(row.terminados || 0),
    terminados: Number(row.terminados || 0)
  }));
}

async function historialAcciones(query = {}) {
  const limit = normalizeLimit(query.limit || 200);
  const offset = normalizeOffset(query.offset);
  const params = [];
  const where = [];
  const fecha = cleanString(query.fecha);
  const usuario = cleanString(query.usuario);
  const cliente = cleanString(query.cliente);
  const clienteInfo = await optionalColumns('clientes', ['Cod_Cliente', 'Ciudad_Cliente', 'Zona_Cliente']);
  const clienteNombre = schema.aliasColumn(clienteInfo, 'c', 'Nom_Cliente');
  const clienteExpr = clienteNombre ? `COALESCE(${clienteNombre}, a.Cod_Cliente)` : 'a.Cod_Cliente';
  const ciudadExprParts = [
    'a.Zona',
    schema.aliasColumn(clienteInfo, 'c', 'Ciudad_Cliente'),
    schema.aliasColumn(clienteInfo, 'c', 'Zona_Cliente')
  ].filter(Boolean);
  const ciudadExpr = ciudadExprParts.length ? `COALESCE(${ciudadExprParts.join(', ')})` : 'NULL';
  const clienteJoinSql = clienteJoin(clienteInfo, 'c');

  if (fecha) {
    if (!isValidISODate(fecha)) throw badRequest('Fecha invalida');
    where.push('DATE(auditoria.Fecha) = ?');
    params.push(fecha);
  }

  if (usuario) {
    where.push("COALESCE(auditoria.Usuario, 'Sistema') LIKE ?");
    params.push(`%${usuario}%`);
  }

  if (cliente) {
    where.push("COALESCE(auditoria.Cliente, '') LIKE ?");
    params.push(`%${cliente}%`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const auditoriaSql = `
      SELECT
         l.FechaHora AS Fecha,
         l.Usuario AS Usuario,
         l.Accion AS Accion,
         CASE
           WHEN l.Accion = 'CREAR' THEN 'Crear'
           WHEN l.Accion = 'EDITAR' THEN 'Editar'
           WHEN l.Accion = 'ANULAR' THEN 'Anular'
           WHEN l.Accion = 'IMPRIMIR' THEN 'Impresion'
           WHEN l.Accion = 'CAMBIO_ESTADO' THEN 'Cambio de estado'
           ELSE l.Accion
         END AS Tipo,
         l.Observacion AS Observacion,
         l.ID_Acuse AS ID_Acuse,
         a.Nro_Acuse AS Nro_Acuse,
         ${clienteExpr} AS Cliente,
         ${ciudadExpr} AS Ciudad
        FROM ${tables.log} l
        LEFT JOIN ${tables.acuse} a ON a.ID_Acuse = l.ID_Acuse
        ${clienteJoinSql}
       WHERE COALESCE(l.Accion, '') <> 'CAMBIO_ESTADO'
      UNION ALL
      SELECT
         h.Fecha AS Fecha,
         h.Usuario AS Usuario,
         CONCAT('Estado: ', h.Estado) AS Accion,
         'Cambio de estado' AS Tipo,
         h.Observacion AS Observacion,
         h.ID_Acuse AS ID_Acuse,
         a.Nro_Acuse AS Nro_Acuse,
         ${clienteExpr} AS Cliente,
         ${ciudadExpr} AS Ciudad
        FROM ${tables.historial} h
        LEFT JOIN ${tables.acuse} a ON a.ID_Acuse = h.ID_Acuse
        ${clienteJoinSql}
       WHERE COALESCE(h.Observacion, '') <> 'Creacion del acuse'
  `;

  const [rows] = await pool.execute(
    `SELECT *, COUNT(*) OVER() AS _total
       FROM (
         ${auditoriaSql}
      ) auditoria
      ${whereSql}
      ORDER BY Fecha DESC
      LIMIT ${limit} OFFSET ${offset}`,
    params
  );

  const total = rows.length > 0 ? Number(rows[0]._total || 0) : 0;
  const items = rows.map(({ _total, ...row }) => row);

  return {
    items,
    total,
    limit,
    offset
  };
}

module.exports = {
  listAcuses,
  getAcuse,
  createAcuse,
  updateAcuse,
  changeEstado,
  deactivateAcuse,
  dashboardResumen,
  resumenRepartidores,
  historialAcciones,
  validateCliente,
  validateArticulo,
  __test__: {
    mapEstado,
    estadoUiKey,
    summarizeEstadoRows,
    normalizeDetalle,
    isAnuladoEnumUnsupportedError,
    shouldFetchAllRows,
    createAcuseFlow,
    updateAcuseFlow,
    changeEstadoFlow,
    deactivateAcuseFlow,
    formatAcuseNumberFromId
  }
};
