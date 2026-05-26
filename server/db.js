const mysql = require('mysql2/promise');
require('dotenv').config();

function requiredEnv(name, fallback = '') {
  const value = process.env[name] || fallback;
  if (!value) throw new Error(`Falta configurar ${name}`);
  return value;
}

function assertIdentifier(value, label) {
  if (!/^[A-Za-z0-9_]+$/.test(value)) {
    throw new Error(`${label} no es un identificador MySQL valido`);
  }
  return value;
}

const config = {
  host: requiredEnv('MYSQL_HOST', '172.17.10.101'),
  port: Number(process.env.MYSQL_PORT || 3306),
  user: requiredEnv('MYSQL_USER'),
  password: requiredEnv('MYSQL_PASSWORD'),
  acuseDb: assertIdentifier(requiredEnv('MYSQL_ACUSE_DATABASE', 'BD_ALAS_ACUSE'), 'MYSQL_ACUSE_DATABASE'),
  sapDb: assertIdentifier(requiredEnv('MYSQL_SAP_DATABASE', 'BD_ALAS_SAP'), 'MYSQL_SAP_DATABASE'),
  defaultUser: process.env.ACUSE_DEFAULT_USER || 'Operador General',
  estados: {
    hoy: process.env.ACUSE_ESTADO_HOY || 'hoy',
    proxima: process.env.ACUSE_ESTADO_PROXIMA || 'proxima',
    completado: process.env.ACUSE_ESTADO_COMPLETADO || 'completado'
  }
};

const pool = mysql.createPool({
  host: config.host,
  port: config.port,
  user: config.user,
  password: config.password,
  waitForConnections: true,
  connectionLimit: Number(process.env.MYSQL_CONNECTION_LIMIT || 10),
  queueLimit: 0,
  decimalNumbers: true,
  multipleStatements: false,
  dateStrings: true
});

function quoteIdentifier(value) {
  return `\`${String(value).replace(/`/g, '``')}\``;
}

function table(dbName, tableName) {
  return `${quoteIdentifier(dbName)}.${quoteIdentifier(tableName)}`;
}

const tables = {
  acuse: table(config.acuseDb, 'acuse'),
  detalle: table(config.acuseDb, 'acuse_detalle'),
  historial: table(config.acuseDb, 'acuse_historial_estado'),
  log: table(config.acuseDb, 'acuse_log_acciones'),
  repartidor: table(config.acuseDb, 'repartidor'),
  clientes: table(config.sapDb, 'clientes_SAP'),
  articulos: table(config.sapDb, 'articulos_SAP'),
  precios: table(config.sapDb, 'precios_SAP'),
  stock: table(config.sapDb, 'stock_SAP')
};

async function withTransaction(work) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = { config, pool, quoteIdentifier, table, tables, withTransaction };
