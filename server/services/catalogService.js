const { pool, tables, quoteIdentifier, withTransaction } = require('../db');
const { badRequest } = require('../errors');
const schema = require('./schemaService');

function normalizeSearch(value) {
  return String(value || '').trim();
}

function normalizeLimit(value, fallback = 50) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, 200);
}

async function listRepartidores() {
  const [rows] = await pool.execute(
    `SELECT ID, Codigo_Repartidor, Nombre_Repartidor, Estado_Repartidor
       FROM ${tables.repartidor}
      ORDER BY Nombre_Repartidor ASC`
  );
  return rows;
}

function clienteTelefonoSelect(info, alias = 'c', output = 'Telefono_Cliente') {
  const candidates = ['Telef_Cliente', 'TelF_Cliente', 'Telefono_Cliente'];
  const resolved = candidates
    .map((column) => schema.aliasColumn(info, alias, column))
    .filter(Boolean);
  const expression = resolved.length ? `COALESCE(${resolved.join(', ')})` : 'NULL';
  return `${expression} AS ${quoteIdentifier(output)}`;
}

async function createRepartidor(payload = {}) {
  const nombre = normalizeSearch(payload.Nombre_Repartidor || payload.nombre);
  let codigo = normalizeSearch(payload.Codigo_Repartidor || payload.codigo).toUpperCase();
  const estado = normalizeSearch(payload.Estado_Repartidor || payload.estado || 'Activo') || 'Activo';

  if (!nombre) throw badRequest('Nombre del repartidor es obligatorio');

  return withTransaction(async (connection) => {
    const [existingName] = await connection.execute(
      `SELECT ID
         FROM ${tables.repartidor}
        WHERE UPPER(Nombre_Repartidor) = UPPER(?)
        LIMIT 1`,
      [nombre]
    );

    if (existingName.length) throw badRequest('Ya existe un repartidor con ese nombre');

    if (codigo) {
      const [existingCode] = await connection.execute(
        `SELECT ID
           FROM ${tables.repartidor}
          WHERE UPPER(Codigo_Repartidor) = UPPER(?)
          LIMIT 1`,
        [codigo]
      );
      if (existingCode.length) throw badRequest('El codigo de repartidor ya existe');
    } else {
      codigo = `REP-TMP-${Date.now()}`;
    }

    const [result] = await connection.execute(
      `INSERT INTO ${tables.repartidor} (Codigo_Repartidor, Nombre_Repartidor, Estado_Repartidor)
       VALUES (?, ?, ?)`,
      [codigo, nombre, estado]
    );

    const id = Number(result.insertId);
    if (!id) throw badRequest('No se pudo crear el repartidor');

    if (codigo.startsWith('REP-TMP-')) {
      codigo = `REP${String(id).padStart(3, '0')}`;
      await connection.execute(
        `UPDATE ${tables.repartidor}
            SET Codigo_Repartidor = ?
          WHERE ID = ?`,
        [codigo, id]
      );
    }

    const [rows] = await connection.execute(
      `SELECT ID, Codigo_Repartidor, Nombre_Repartidor, Estado_Repartidor
         FROM ${tables.repartidor}
        WHERE ID = ?
        LIMIT 1`,
      [id]
    );

    return rows[0];
  });
}

async function searchClientes(query) {
  const q = normalizeSearch(query.q || query.search);
  const limit = normalizeLimit(query.limit);
  const info = await schema.requireColumns('clientes', [
    'Cod_Cliente',
    'Nom_Cliente',
    'Ruc_Cliente',
    'Direc_Cliente',
    'Zona_Cliente',
    'Ciudad_Cliente'
  ]);
  const searchable = ['Cod_Cliente', 'Nom_Cliente', 'Ruc_Cliente']
    .map((column) => schema.aliasColumn(info, 'c', column))
    .filter(Boolean);
  const params = [];
  let where = '';

  if (q && searchable.length) {
    where = `WHERE ${searchable.map((column) => `${column} LIKE ?`).join(' OR ')}`;
    const like = `%${q}%`;
    searchable.forEach(() => params.push(like));
  }

  const orderBy = schema.orderColumn(info, 'c', 'Nom_Cliente', 'Cod_Cliente');
  const [rows] = await pool.execute(
    `SELECT
        ${schema.selectColumn(info, 'c', 'Cod_Cliente')},
        ${schema.selectColumn(info, 'c', 'Nom_Cliente')},
        ${schema.selectColumn(info, 'c', 'Ruc_Cliente')},
        ${schema.selectColumn(info, 'c', 'Direc_Cliente')},
        ${schema.selectColumn(info, 'c', 'Ciudad_Cliente')},
        ${schema.selectColumn(info, 'c', 'Zona_Cliente')},
        ${clienteTelefonoSelect(info)}
      FROM ${info.table.ref} c
       ${where}
      ORDER BY ${orderBy} ASC
      LIMIT ${limit}`,
    params
  );

  return rows;
}

async function searchArticulos(query) {
  const q = normalizeSearch(query.q || query.search);
  const limit = normalizeLimit(query.limit);
  const info = await schema.requireColumns('articulos', [
    'Material_SAP',
    'Descr_SAP',
    'UM_SAP'
  ]);
  const searchable = ['Material_SAP', 'Descr_SAP']
    .map((column) => schema.aliasColumn(info, 'a', column))
    .filter(Boolean);
  const params = [];
  let where = '';

  if (q && searchable.length) {
    where = `WHERE ${searchable.map((column) => `${column} LIKE ?`).join(' OR ')}`;
    const like = `%${q}%`;
    searchable.forEach(() => params.push(like));
  }

  const orderBy = schema.orderColumn(info, 'a', 'Descr_SAP', 'Material_SAP');
  const [rows] = await pool.execute(
    `SELECT
        ${schema.selectColumn(info, 'a', 'Material_SAP')},
        ${schema.selectColumn(info, 'a', 'Descr_SAP')},
        ${schema.selectColumn(info, 'a', 'UM_SAP')}
      FROM ${info.table.ref} a
       ${where}
      ORDER BY ${orderBy} ASC
      LIMIT ${limit}`,
    params
  );

  return rows;
}

async function stockArticulo(material, query) {
  const info = await schema.requireColumns('stock', ['Material_SAP']);
  const params = [material];
  const materialColumn = schema.aliasColumn(info, 's', 'Material_SAP');
  const where = [`${materialColumn} = ?`];

  if (query.centro) {
    const centroColumn = schema.aliasColumn(info, 's', 'Centro_SAP');
    if (!centroColumn) throw badRequest('La tabla stock_SAP no tiene Centro_SAP');
    where.push(`${centroColumn} = ?`);
    params.push(query.centro);
  }

  if (query.almacen) {
    const almacenColumn = schema.aliasColumn(info, 's', 'Almacen_SAP');
    if (!almacenColumn) throw badRequest('La tabla stock_SAP no tiene Almacen_SAP');
    where.push(`${almacenColumn} = ?`);
    params.push(query.almacen);
  }

  const orderBy = schema.aliasColumn(info, 's', 'Ult_Actualizacion');
  const [rows] = await pool.execute(
    `SELECT
        ${schema.selectColumn(info, 's', 'Material_SAP')},
        ${schema.selectColumn(info, 's', 'Centro_SAP')},
        ${schema.selectColumn(info, 's', 'Almacen_SAP')},
        ${schema.selectColumn(info, 's', 'Batch_ID')},
        ${schema.selectColumn(info, 's', 'Stock_SAP')},
        ${schema.selectColumn(info, 's', 'Ult_Actualizacion')}
       FROM ${info.table.ref} s
      WHERE ${where.join(' AND ')}
      ${orderBy ? `ORDER BY ${orderBy} DESC` : ''}
      LIMIT 100`,
    params
  );

  return rows;
}

async function preciosArticulo(material, query) {
  const info = await schema.requireColumns('precios', ['Material_SAP']);
  const params = [material];
  const materialColumn = schema.aliasColumn(info, 'p', 'Material_SAP');
  const where = [`${materialColumn} = ?`];

  if (query.centro) {
    const centroColumn = schema.aliasColumn(info, 'p', 'Centro_SAP');
    if (!centroColumn) throw badRequest('La tabla precios_SAP no tiene Centro_SAP');
    where.push(`${centroColumn} = ?`);
    params.push(query.centro);
  }

  if (query.lista) {
    const listaColumn = schema.aliasColumn(info, 'p', 'Lista_Precio_SAP');
    if (!listaColumn) throw badRequest('La tabla precios_SAP no tiene Lista_Precio_SAP');
    where.push(`${listaColumn} = ?`);
    params.push(query.lista);
  }

  const orderBy = schema.aliasColumn(info, 'p', 'Ult_Actualizacion');
  const [rows] = await pool.execute(
    `SELECT
        ${schema.selectColumn(info, 'p', 'Material_SAP')},
        ${schema.selectColumn(info, 'p', 'Centro_SAP')},
        ${schema.selectColumn(info, 'p', 'Lista_Precio_SAP')},
        ${schema.selectColumn(info, 'p', 'Precio_SAP')},
        ${schema.selectColumn(info, 'p', 'Fecha_Crea_SAP')},
        ${schema.selectColumn(info, 'p', 'Ult_Actualizacion')}
       FROM ${info.table.ref} p
      WHERE ${where.join(' AND ')}
      ${orderBy ? `ORDER BY ${orderBy} DESC` : ''}
      LIMIT 100`,
    params
  );

  return rows;
}

module.exports = {
  createRepartidor,
  listRepartidores,
  searchClientes,
  searchArticulos,
  stockArticulo,
  preciosArticulo
};
