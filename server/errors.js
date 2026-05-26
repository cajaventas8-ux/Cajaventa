const logger = require('./logger');

class HttpError extends Error {
  constructor(status, message, details = null) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.details = details;
  }
}

function badRequest(message, details = null) {
  return new HttpError(400, message, details);
}

function notFound(message = 'Registro no encontrado') {
  return new HttpError(404, message);
}

function asyncHandler(handler) {
  return function wrapped(req, res, next) {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  const status = error.status || 500;
  const payload = { error: status >= 500 ? 'Error interno del servidor' : error.message };
  if (error.details) payload.details = error.details;
  if (status >= 500) {
    logger.error('Unhandled server error', {
      reqId: req._logId,
      method: req.method,
      path: req.path,
      message: error.message,
      stack: error.stack
    });
  }
  res.status(status).json(payload);
}

module.exports = { HttpError, badRequest, notFound, asyncHandler, errorHandler };
