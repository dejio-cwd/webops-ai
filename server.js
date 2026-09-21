import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import auditHandler from './api/audit.js';
import modelsHandler from './api/models.js';

const port = Number(process.env.PORT || 3000);
const root = process.cwd();
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json' };

const server = http.createServer(async (req, res) => {
  if (req.url?.startsWith('/api/audit')) return auditHandler(req, res);
  if (req.url?.startsWith('/api/models')) return modelsHandler(req, res);
  const requestPath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const safePath = normalize(requestPath).replace(/^(\.\.(\/|\\|$))+/, '');
  const filePath = join(root, safePath);
  try {
    if (!(await stat(filePath)).isFile()) throw new Error('Not found');
    res.writeHead(200, { 'Content-Type': types[extname(filePath)] || 'application/octet-stream' });
    res.end(await readFile(filePath));
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
});
server.listen(port, () => console.log(`WebOps AI running at http://localhost:${port}`));
