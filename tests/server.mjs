// Tiny static server for fixtures (and the bench bundle under /__oho/).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const roots = { '/__oho/': join(here, '..', 'dist', 'bench'), '/': join(here, 'fixtures') };
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

export function start(port = 0) {
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    const prefix = Object.keys(roots).find((p) => path.startsWith(p));
    const file = normalize(join(roots[prefix], path.slice(prefix.length) || 'index.html'));
    if (!file.startsWith(roots[prefix])) return res.writeHead(403).end();
    try {
      const body = await readFile(file);
      res.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' }).end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === normalize(process.argv[1])) {
  const s = await start(Number(process.argv[2] ?? 4517));
  console.log(`fixtures on http://127.0.0.1:${s.address().port}/`);
}
