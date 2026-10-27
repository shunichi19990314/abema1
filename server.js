/**
 * server.js
 * Render で動かすための薄いアダプタ。
 * Node の http ⇔ Web 標準の Request/Response を変換するだけ。
 */

import http from 'node:http';
import { Readable } from 'node:stream';
import { handle, buildOptions, readSetCookies } from './proxy-core.js';

const PORT = process.env.PORT || 3000;

function optionsFor(req, origin) {
  return buildOptions(process.env, { origin, region: process.env.RENDER_REGION || 'RENDER' });
}

const server = http.createServer(async (req, res) => {
  try {
    const proto = (req.headers['x-forwarded-proto'] || 'https').split(',')[0].trim();
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const origin = proto + '://' + host;
    const url = origin + req.url;

    const init = { method: req.method, headers: req.headers, redirect: 'manual' };
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      init.body = Readable.toWeb(req);
      init.duplex = 'half';
    }

    const out = await handle(new Request(url, init), optionsFor(req, origin));

    res.statusCode = out.status;
    for (const [k, v] of out.headers) {
      if (k.toLowerCase() === 'set-cookie') continue;
      res.setHeader(k, v);
    }
    const cookies = readSetCookies(out.headers);
    if (cookies.length) res.setHeader('set-cookie', cookies);

    if (out.body && req.method !== 'HEAD') {
      Readable.fromWeb(out.body).pipe(res);
    } else {
      res.end();
    }
  } catch (e) {
    res.statusCode = 500;
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.end(String((e && e.stack) || e));
  }
});

server.listen(PORT, () => console.log('listening on ' + PORT));