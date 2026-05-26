const path = require('path');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const db = require('./db');
const logger = require('./logger');
const { asyncHandler, errorHandler } = require('./errors');
const { RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX_REQUESTS } = require('./config/constants');
const acusesService = require('./services/acuseService');
const catalogosService = require('./services/catalogService');
const schemaService = require('./services/schemaService');
const { ensureAuditTables, validateDatabaseConnection, validateRequiredTables } = require('./services/bootstrapService');
const createDashboardInteractiveRouter = require('./routes/dashboardInteractiveRoutes');
const dashboardInteractiveService = require('./services/dashboardInteractiveService');

const rootDir = path.resolve(__dirname, '..');

function normalizeFrameAncestor(ancestor) {
  if (ancestor === 'self') return "'self'";
  if (ancestor === 'none') return "'none'";
  return ancestor;
}

function buildAllowedOrigins(rawOrigins = process.env.CORS_ORIGINS) {
  return new Set(
    String(rawOrigins || '')
      .split(',')
      .map((origin) => origin.trim())
      .filter(Boolean)
  );
}

function buildFrameAncestors(rawValue = process.env.FRAME_ANCESTORS) {
  return String(rawValue || "'self'")
    .split(',')
    .map((ancestor) => ancestor.trim())
    .map(normalizeFrameAncestor)
    .filter(Boolean)
    .join(' ') || "'self'";
}

function parseOrigin(origin) {
  try {
    return new URL(origin);
  } catch (error) {
    return null;
  }
}

function isLoopbackHostname(hostname) {
  return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(String(hostname || '').toLowerCase());
}

function requestProtocol(req) {
  return String(req.get('x-forwarded-proto') || req.protocol || 'http')
    .split(',')[0]
    .trim()
    .toLowerCase();
}

function requestHost(req) {
  return String(req.get('x-forwarded-host') || req.get('host') || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
}

function requestOrigin(req) {
  const host = requestHost(req);
  if (!host) return '';
  return `${requestProtocol(req)}://${host}`;
}

function isAllowedOrigin(origin, allowedOrigins, req = null) {
  if (!origin) return true;
  if (allowedOrigins.has(origin)) return true;

  const parsed = parseOrigin(origin);
  if (!parsed) return false;
  if (isLoopbackHostname(parsed.hostname)) return true;
  if (!req) return false;
  return origin.toLowerCase() === requestOrigin(req);
}

function createApp(services = {}) {
  const pool = services.pool || db.pool;
  const config = services.config || db.config;
  const acuses = services.acuses || acusesService;
  const catalogos = services.catalogos || catalogosService;
  const schema = services.schema || schemaService;
  const dashboardInteractive = services.dashboardInteractive || dashboardInteractiveService;
  const allowedOrigins = buildAllowedOrigins(services.corsOrigins);
  const frameAncestors = buildFrameAncestors(services.frameAncestors);
  const hasExternalFrameAncestor = frameAncestors
    .split(/\s+/)
    .some((ancestor) => !["'self'", "'none'"].includes(ancestor));

  const app = express();

  app.disable('x-powered-by');

  app.use(helmet({
    contentSecurityPolicy: false,
    frameguard: false,
    referrerPolicy: false
  }));

  const apiLimiter = rateLimit({
    windowMs: RATE_LIMIT_WINDOW_MS,
    max: Number(process.env.API_RATE_LIMIT || RATE_LIMIT_MAX_REQUESTS),
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Demasiadas solicitudes, intentá de nuevo en unos minutos.' }
  });
  app.use('/api/', apiLimiter);

  app.use((req, res, next) => cors({
    origin(origin, callback) {
      if (isAllowedOrigin(origin, allowedOrigins, req)) return callback(null, true);
      const error = new Error('Origen no permitido por CORS');
      error.status = 403;
      return callback(error);
    }
  })(req, res, next));
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', `frame-ancestors ${frameAncestors}`);
    if (!hasExternalFrameAncestor) {
      res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    }
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    return next();
  });
  app.use(logger.requestLogger());
  app.use('/api/', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use((req, res, next) => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();

    const origin = req.get('Origin');
    const referer = req.get('Referer');
    if (origin && !isAllowedOrigin(origin, allowedOrigins, req)) {
      return res.status(403).json({ error: 'Origen no permitido' });
    }
    if (!origin && referer) {
      const parsedReferer = parseOrigin(referer);
      if (!parsedReferer || !isAllowedOrigin(parsedReferer.origin, allowedOrigins, req)) {
        return res.status(403).json({ error: 'Origen no permitido' });
      }
    }

    return next();
  });

  app.use((req, res, next) => {
    const pathname = decodeURIComponent(req.path).replace(/\\/g, '/');
    const blocked = [
      /^\/\./,
      /^\/(?:server|node_modules)(?:\/|$)/i,
      /(?:^|\/)[^/]*\.bak\d*$/i,
      /(?:^|\/)[^/]*\.log$/i,
      /^\/(?:package(?:-lock)?\.json|README\.md|serve\.ps1|update_ui\.ps1)$/i
    ];

    if (blocked.some((pattern) => pattern.test(pathname))) {
      return res.status(404).send('404 - Archivo no encontrado');
    }

    return next();
  });

  app.get('/api/health', asyncHandler(async (req, res) => {
    const [rows] = await pool.execute('SELECT 1 AS ok');
    const tablas = await schema.healthCheck();
    const requiredTables = ['acuse', 'detalle', 'historial', 'log', 'repartidor', 'clientes', 'articulos'];
    res.json({
      ok: rows[0]?.ok === 1 && requiredTables.every((key) => tablas[key]?.ok),
      acuseDatabase: config.acuseDb,
      sapDatabase: config.sapDb,
      tablas
    });
  }));

  app.get('/api/repartidores', asyncHandler(async (req, res) => {
    res.json({ items: await catalogos.listRepartidores() });
  }));

  app.post('/api/repartidores', asyncHandler(async (req, res) => {
    res.status(201).json(await catalogos.createRepartidor(req.body));
  }));

  app.get('/api/repartidores/resumen', asyncHandler(async (req, res) => {
    res.json({ items: await acuses.resumenRepartidores() });
  }));

  app.get('/api/clientes', asyncHandler(async (req, res) => {
    res.json({ items: await catalogos.searchClientes(req.query) });
  }));

  app.get('/api/articulos', asyncHandler(async (req, res) => {
    res.json({ items: await catalogos.searchArticulos(req.query) });
  }));

  app.get('/api/articulos/:material/stock', asyncHandler(async (req, res) => {
    res.json({ items: await catalogos.stockArticulo(req.params.material, req.query) });
  }));

  app.get('/api/articulos/:material/precios', asyncHandler(async (req, res) => {
    res.json({ items: await catalogos.preciosArticulo(req.params.material, req.query) });
  }));

  app.get('/api/acuses', asyncHandler(async (req, res) => {
    res.json(await acuses.listAcuses(req.query));
  }));

  app.post('/api/acuses', asyncHandler(async (req, res) => {
    res.status(201).json(await acuses.createAcuse(req.body));
  }));

  app.get('/api/acuses/:id', asyncHandler(async (req, res) => {
    res.json(await acuses.getAcuse(req.params.id));
  }));

  app.put('/api/acuses/:id', asyncHandler(async (req, res) => {
    res.json(await acuses.updateAcuse(req.params.id, req.body));
  }));

  app.patch('/api/acuses/:id/estado', asyncHandler(async (req, res) => {
    res.json(await acuses.changeEstado(req.params.id, req.body));
  }));

  app.delete('/api/acuses/:id', asyncHandler(async (req, res) => {
    res.json(await acuses.deactivateAcuse(req.params.id, req.body));
  }));

  app.get('/api/dashboard/resumen', asyncHandler(async (req, res) => {
    res.json(await acuses.dashboardResumen());
  }));

  app.get('/api/auditoria', asyncHandler(async (req, res) => {
    res.json(await acuses.historialAcciones(req.query));
  }));

  app.use('/api/dashboard/interactivo', createDashboardInteractiveRouter(dashboardInteractive));

  const legacyHtmlRoutes = new Map([
    ['/dashboard-Acuses.html', '/views/dashboard-Acuses.html'],
    ['/dashboard-kpi.html', '/views/dashboard-Acuses.html'],
    ['/resumen-mes.html', '/views/dashboard-Acuses.html'],
    ['/resumen-zona.html', '/views/dashboard-Acuses.html'],
    ['/acuses.html', '/views/acuses.html'],
    ['/acuse-imprimir.html', '/views/acuse-imprimir.html']
  ]);

  legacyHtmlRoutes.forEach((target, routePath) => {
    app.get(routePath, (req, res) => {
      const query = new URLSearchParams(req.query).toString();
      res.redirect(`${target}${query ? `?${query}` : ''}`);
    });
  });

  [
    ['/assets', path.join(rootDir, 'assets')],
    ['/css', path.join(rootDir, 'css')],
    ['/js', path.join(rootDir, 'js')],
    ['/vendor', path.join(rootDir, 'vendor')],
    ['/views', path.join(rootDir, 'views')]
  ].forEach(([mountPath, targetPath]) => {
    app.use(mountPath, express.static(targetPath, {
      dotfiles: 'deny',
      fallthrough: true,
      extensions: mountPath === '/views' ? ['html'] : undefined
    }));
  });

  app.get('/', (req, res) => {
    res.sendFile(path.join(rootDir, 'index.html'));
  });

  app.get('/index.html', (req, res) => {
    res.sendFile(path.join(rootDir, 'index.html'));
  });

  app.use(errorHandler);

  return app;
}

async function startServer(options = {}) {
  const app = options.app || createApp(options.services);
  const port = Number(options.port || process.env.PORT || 3000);
  const ensureAuditTablesFn = options.ensureAuditTables || ensureAuditTables;

  try {
    await validateDatabaseConnection();
  } catch (error) {
    logger.error('Startup abortado: sin conexion a BD', { message: error.message });
    process.exit(1);
  }

  try {
    await validateRequiredTables();
  } catch (error) {
    logger.warn('Validacion de tablas con advertencias', { message: error.message });
  }

  try {
    await ensureAuditTablesFn();
  } catch (error) {
    logger.error('No se pudieron asegurar las tablas de auditoria', { message: error.message });
  }

  return app.listen(port, () => {
    logger.info('Servidor iniciado', { port, url: `http://localhost:${port}` });
  });
}

if (require.main === module) {
  startServer();
}

module.exports = {
  createApp,
  startServer,
  __test__: {
    buildAllowedOrigins,
    buildFrameAncestors,
    isAllowedOrigin,
    isLoopbackHostname,
    requestOrigin
  }
};
