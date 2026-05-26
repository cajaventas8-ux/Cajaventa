const { config, pool, quoteIdentifier } = require('../db');
const { HttpError } = require('../errors');
const logger = require('../logger');

const tableDefinitions = {
  acuse: { db: config.acuseDb, name: 'acuse' },
  detalle: { db: config.acuseDb, name: 'acuse_detalle' },
  historial: { db: config.acuseDb, name: 'acuse_historial_estado' },
  log: { db: config.acuseDb, name: 'acuse_log_acciones' },
  repartidor: { db: config.acuseDb, name: 'repartidor' },
  clientes: { db: config.sapDb, name: 'clientes_SAP' },
  articulos: { db: config.sapDb, name: 'articulos_SAP' },
  precios: { db: config.sapDb, name: 'precios_SAP' },
  stock: { db: config.sapDb, name: 'stock_SAP' }
};

const cache = new Map();

function normalize(value) {
  return String(value || '').toLowerCase();
}

function getDefinition(key) {
  const definition = tableDefinitions[key];
  if (!definition) throw new Error(`Tabla no configurada: ${key}`);
  return definition;
}

function unavailable(message, details) {
  return new HttpError(503, message, details);
}

async function resolveTable(key, options = {}) {
  const definition = getDefinition(key);
  const cacheKey = `table:${key}`;
  const required = options.required !== false;
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  const [rows] = await pool.execute(
    `SELECT TABLE_NAME
       FROM INFORMATION_SCHEMA.TABLES
      WHERE TABLE_SCHEMA = ?
        AND LOWER(TABLE_NAME) = LOWER(?)
      LIMIT 1`,
    [definition.db, definition.name]
  );

  if (!rows.length) {
    if (!required) return null;
    logger.warn('Tabla no accesible', { key, database: definition.db, table: definition.name });
    throw unavailable('Recurso de datos no disponible temporalmente', {
      code: 'TABLE_NOT_FOUND_OR_NO_PERMISSION'
    });
  }

  const table = {
    key,
    database: definition.db,
    name: rows[0].TABLE_NAME,
    ref: `${quoteIdentifier(definition.db)}.${quoteIdentifier(rows[0].TABLE_NAME)}`
  };
  cache.set(cacheKey, table);
  return table;
}

async function resolveColumns(key, options = {}) {
  const table = await resolveTable(key, options);
  const required = options.required !== false;
  if (!table) return null;

  const cacheKey = `columns:${key}:${table.name}`;
  if (cache.has(cacheKey)) return cache.get(cacheKey);

  const [rows] = await pool.execute(
    `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = ?
        AND TABLE_NAME = ?`,
    [table.database, table.name]
  );

  if (!rows.length) {
    if (!required) return null;
    logger.warn('Columnas no accesibles', { key, database: table.database, table: table.name });
    throw unavailable('Recurso de datos no disponible temporalmente', {
      code: 'COLUMNS_NOT_FOUND_OR_NO_PERMISSION'
    });
  }

  const byLower = new Map();
  rows.forEach((row) => byLower.set(normalize(row.COLUMN_NAME), row.COLUMN_NAME));

  const info = {
    table,
    columns: rows.map((row) => row.COLUMN_NAME),
    byLower
  };
  cache.set(cacheKey, info);
  return info;
}

async function requireColumns(key, columns, options = {}) {
  const required = options.required !== false;
  const info = await resolveColumns(key, options);
  if (!info) return null;

  const missing = columns.filter((column) => !info.byLower.has(normalize(column)));
  if (missing.length) {
    if (!required) return null;
    logger.warn('Columnas requeridas faltantes', {
      key,
      database: info.table.database,
      table: info.table.name,
      columns: missing
    });
    throw unavailable('Recurso de datos no disponible temporalmente', {
      code: 'REQUIRED_COLUMNS_MISSING'
    });
  }

  return info;
}

function columnName(info, requested) {
  if (!info) return null;
  return info.byLower.get(normalize(requested)) || null;
}

function aliasColumn(info, alias, requested) {
  const actual = columnName(info, requested);
  return actual ? `${alias}.${quoteIdentifier(actual)}` : null;
}

function selectColumn(info, alias, requested, output = requested, fallback = 'NULL') {
  const column = aliasColumn(info, alias, requested);
  return `${column || fallback} AS ${quoteIdentifier(output)}`;
}

function orderColumn(info, alias, preferred, fallback) {
  return aliasColumn(info, alias, preferred) || aliasColumn(info, alias, fallback);
}

async function healthCheck() {
  const checks = {};

  for (const key of Object.keys(tableDefinitions)) {
    try {
      const info = await resolveColumns(key, { required: false });
      checks[key] = info
        ? { ok: true, database: info.table.database, table: info.table.name, columns: info.columns.length }
        : { ok: false, reason: 'No accesible' };
    } catch (error) {
      checks[key] = { ok: false, reason: error.message, code: error.code || error.details?.code || null };
    }
  }

  return checks;
}

module.exports = {
  aliasColumn,
  columnName,
  healthCheck,
  orderColumn,
  requireColumns,
  resolveColumns,
  resolveTable,
  selectColumn
};
