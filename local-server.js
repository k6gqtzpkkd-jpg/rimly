const fs = require('fs');
const http = require('http');
const path = require('path');
const { URL } = require('url');

const root = __dirname;
const port = Number(process.env.PORT || 3000);
const host = '127.0.0.1';

loadLocalEnv();
if (process.env.GOOGLE_API_KEY && !process.env.RIMLY_GOOGLE_API_KEY_SOURCE) {
  process.env.RIMLY_GOOGLE_API_KEY_SOURCE = 'environment';
}
if (process.env.OPENAI_API_KEY && !process.env.RIMLY_OPENAI_API_KEY_SOURCE) {
  process.env.RIMLY_OPENAI_API_KEY_SOURCE = 'environment';
}

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.ico': 'image/x-icon'
};

const apiRoutes = {
  '/api/ocr': './api/ocr.js',
  '/api/analyze': './api/analyze.js',
  '/api/ai-status': './api/ai-status.js',
  '/api/db': './api/db.js',
  '/api/game-vision': './api/game-vision.js'
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (apiRoutes[url.pathname]) {
      await handleApi(req, res, apiRoutes[url.pathname]);
      return;
    }
    serveStatic(url.pathname, res);
  } catch (error) {
    sendJson(res, 500, { error: 'Local server error', details: error.message });
  }
});

server.listen(port, host, () => {
  console.log(`Rimly local server: http://localhost:${port}/`);
  console.log(process.env.GOOGLE_API_KEY
    ? `GOOGLE_API_KEY: set (${process.env.RIMLY_GOOGLE_API_KEY_SOURCE || 'environment'})`
    : 'GOOGLE_API_KEY: not set');
  console.log(process.env.OPENAI_API_KEY
    ? `OPENAI_API_KEY: set (${process.env.RIMLY_OPENAI_API_KEY_SOURCE || 'environment'})`
    : 'OPENAI_API_KEY: not set');
  console.log(process.env.DATABASE_URL ? 'DATABASE_URL: set' : 'DATABASE_URL: not set');
});

function loadLocalEnv() {
  const envPath = path.join(root, '.env.local');
  if (!fs.existsSync(envPath)) return;
  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const index = trimmed.indexOf('=');
    if (index < 0) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, '');
    if (key && process.env[key] == null) {
      process.env[key] = value;
      if (key === 'GOOGLE_API_KEY') process.env.RIMLY_GOOGLE_API_KEY_SOURCE = '.env.local';
      if (key === 'OPENAI_API_KEY') process.env.RIMLY_OPENAI_API_KEY_SOURCE = '.env.local';
    }
  }
}

async function handleApi(req, res, routeFile) {
  req.body = await readJsonBody(req);
  const apiHandler = require(path.join(root, routeFile));
  await apiHandler(req, createApiResponse(res));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    if (req.method === 'GET' || req.method === 'HEAD') {
      resolve({});
      return;
    }
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 12 * 1024 * 1024) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function createApiResponse(res) {
  return {
    status(code) {
      res.statusCode = code;
      return this;
    },
    json(payload) {
      sendJson(res, res.statusCode || 200, payload);
    },
    send(payload) {
      if (typeof payload === 'object') sendJson(res, res.statusCode || 200, payload);
      else {
        res.writeHead(res.statusCode || 200, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end(String(payload));
      }
    }
  };
}

function serveStatic(requestPath, res) {
  const decoded = decodeURIComponent(requestPath === '/' ? '/index.html' : requestPath);
  const filePath = path.normalize(path.join(root, decoded));
  if (!filePath.startsWith(root)) {
    sendJson(res, 403, { error: 'Forbidden' });
    return;
  }
  fs.readFile(filePath, (error, data) => {
    if (error) {
      sendJson(res, 404, { error: 'Not found' });
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': mimeTypes[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
    res.end(data);
  });
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(payload));
}
