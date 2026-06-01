const http = require('http');
const fs = require('fs');
const path = require('path');

const root = __dirname;
const port = Number(process.env.PORT || 3000);
const publicDirs = new Set(['assets', 'css', 'js', 'vendor', 'views']);
const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;

const mime = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain; charset=utf-8'
};

const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'same-origin'
};

function send(res, status, body, contentType) {
  res.writeHead(status, {
    ...securityHeaders,
    'Content-Type': contentType || 'text/plain; charset=utf-8'
  });
  res.end(body);
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch (error) {
    return null;
  }
}

function isAllowedRelativePath(relativePath) {
  if (!relativePath || relativePath === 'index.html') return true;
  if (relativePath.startsWith('.') || relativePath.includes('/.')) return false;

  const firstPart = relativePath.split(/[\\/]/)[0];
  return publicDirs.has(firstPart);
}

function resolvePublicPath(reqUrl) {
  const pathname = new URL(reqUrl, 'http://localhost').pathname;
  const decoded = safeDecode(pathname);
  if (!decoded) return null;

  let relativePath = decoded.replace(/^\/+/, '');
  if (!relativePath) relativePath = 'index.html';

  if (!isAllowedRelativePath(relativePath)) return null;

  const filePath = path.resolve(root, relativePath);
  if (!filePath.startsWith(rootWithSep)) return null;
  return filePath;
}

function serveFile(req, res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      if (!path.extname(filePath)) {
        return serveFile(req, res, filePath + '.html');
      }
      send(res, 404, '<h1>404 - No encontrado</h1>', 'text/html; charset=utf-8');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = mime[ext];
    if (!contentType) {
      send(res, 403, 'Forbidden');
      return;
    }

    res.writeHead(200, {
      ...securityHeaders,
      'Content-Type': contentType
    });
    if (req.method === 'HEAD') res.end();
    else res.end(data);
  });
}

http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    send(res, 405, 'Method Not Allowed');
    return;
  }

  const filePath = resolvePublicPath(req.url);
  if (!filePath) {
    send(res, 403, 'Forbidden');
    return;
  }

  serveFile(req, res, filePath);
}).listen(port, () => {
  console.log('Servidor corriendo en:');
  console.log('  http://localhost:' + port);
  console.log('  http://127.0.0.1:' + port);
});
