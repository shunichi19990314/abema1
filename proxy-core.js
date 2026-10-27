/**
 * proxy-core.js
 * ABEMA を <proxy>/<base64url(実URL)>/ 形式で中継する中核。
 * Node(Render) でも Cloudflare Workers でも動くよう Web 標準 API だけを使う。
 * ・URL の包み / 解き
 * ・HTML・CSS の URL 書き換え
 * ・クライアントスクリプトの注入
 * ・Cookie のサイト単位隔離
 * ・診断用エンドポイント（/__info, /__servers/*）
 */

import { CLIENT_BODY } from './client.js';

export const COOKIE = 'pxw';
const B64RE = /^\/([A-Za-z0-9_-]{8,})(\/.*)?$/;
const JP_COLOS = new Set(['NRT', 'KIX', 'FUK', 'OKA', 'ITM', 'CTS', 'NGO', 'HIJ']);
const PLACES = {
  NRT: '東京(成田)', KIX: '大阪(関西)', ITM: '大阪(伊丹)', FUK: '福岡', OKA: '沖縄(那覇)',
  CTS: '札幌(新千歳)', NGO: '名古屋(中部)', HIJ: '広島', ICN: 'ソウル(仁川)', SIN: 'シンガポール',
  HKG: '香港', TPE: '台北', LAX: 'ロサンゼルス', SJC: 'サンノゼ', EWR: 'ニューアーク',
  IAD: 'ワシントンD.C.', FRA: 'フランクフルト', LHR: 'ロンドン', SYD: 'シドニー'
};

/* ---------------- base64url ---------------- */

export function b64u(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function unb64u(s) {
  let t = String(s).replace(/-/g, '+').replace(/_/g, '/');
  while (t.length % 4) t += '=';
  const bin = atob(t);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(arr);
}

/* ---------------- Cookie 隔離（クライアントと同一規則） ---------------- */

export function siteOf(host) {
  const p = String(host).split('.');
  if (p.length <= 2 || /^\d+$/.test(p[p.length - 1])) return host;
  const n = (p[p.length - 1].length === 2 && p[p.length - 2].length <= 3) ? 3 : 2;
  return p.slice(-n).join('.');
}

export function hash36(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export const prefixFor = (host) => '_p' + hash36(siteOf(host)) + '_';

function unprefixCookies(header, host) {
  if (!header) return '';
  const pre = prefixFor(host);
  const out = [];
  for (const c of header.split(/;\s*/)) if (c.startsWith(pre)) out.push(c.slice(pre.length));
  return out.join('; ');
}

function prefixCookie(c, host) {
  const parts = String(c).split(';');
  const nv = (parts.shift() || '').trim();
  const rest = parts.map((s) => s.trim()).filter((s) => s && !/^(domain|path)=/i.test(s));
  rest.push('Path=/');
  return prefixFor(host) + nv + '; ' + rest.join('; ');
}

export function readSetCookies(h) {
  if (typeof h.getSetCookie === 'function') {
    const a = h.getSetCookie();
    if (a && a.length) return a;
  }
  const v = h.get('set-cookie');
  if (!v) return [];
  return v.split(/,(?=[^;,=\s]+=)/g).map((s) => s.trim()).filter(Boolean);
}

/* ---------------- URL 解決 ---------------- */

export function resolveTarget(requestUrl, home) {
  const u = new URL(requestUrl);
  const m = u.pathname.match(B64RE);
  if (m) {
    let base = '';
    try { base = unb64u(m[1]); } catch { base = ''; }
    if (/^https?:\/\//i.test(base)) {
      const rest = (m[2] || '').replace(/^\/+/, '');
      try {
        const t = rest ? new URL(rest, base) : new URL(base);
        if (u.search) t.search = u.search;
        t.hash = '';
        return t.href;
      } catch { /* fallthrough */ }
    }
  }
  // b64 が無いパス（アドレスバー偽装後の再読込、書き換え漏れの相対 URL 等）は
  // 本物のサイトのルート基準で解決する
  try {
    const t = new URL(u.pathname + u.search, home);
    t.hash = '';
    return t.href;
  } catch {
    return null;
  }
}

export function wrapAttr(value, base, proxyOrigin) {
  const s = String(value).trim();
  if (!s || s.charAt(0) === '#' || /^(data|blob|javascript|about|mailto|tel|sms):/i.test(s)) return value;
  if (s.startsWith(proxyOrigin + '/')) return value;
  let a;
  try { a = new URL(s, base); } catch { return value; }
  if (!/^https?:$/.test(a.protocol)) return value;
  const h = a.hash;
  a.hash = '';
  return proxyOrigin + '/' + b64u(a.href) + '/' + h;
}

/* ---------------- HTML / CSS 書き換え ---------------- */

const ATTR_RE = /(\s(?:xlink:)?(?:href|src|action|poster|formaction|data)\s*=\s*)(["'])([^"']*)\2/gi;
const SRCSET_RE = /(\ssrcset\s*=\s*)(["'])([^"']*)\2/gi;

export function rewriteHtml(html, pageUrl, proxyOrigin) {
  let out = html.replace(ATTR_RE, (m, pre, q, v) => pre + q + wrapAttr(v, pageUrl, proxyOrigin) + q);
  out = out.replace(SRCSET_RE, (m, pre, q, v) => {
    const val = v.split(',').map((part) => {
      const t = part.trim().split(/\s+/);
      t[0] = wrapAttr(t[0], pageUrl, proxyOrigin);
      return t.join(' ');
    }).join(', ');
    return pre + q + val + q;
  });
  return out;
}

export function rewriteCss(css, cssUrl, proxyOrigin) {
  return css
    .replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi,
      (m, q, v) => 'url(' + q + wrapAttr(v, cssUrl, proxyOrigin) + q + ')')
    .replace(/@import\s+(['"])([^'"]+)\1/gi,
      (m, q, v) => '@import ' + q + wrapAttr(v, cssUrl, proxyOrigin) + q);
}

export function injectClient(html, realUrl, proxyOrigin, servers, cur) {
  const tag = '<script>' + clientScript(realUrl, proxyOrigin, servers, cur) + '</script>';
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => m + tag);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (m) => m + tag);
  return tag + html;
}

export function clientScript(realUrl, proxyOrigin, servers, cur) {
  return CLIENT_BODY + '(' + JSON.stringify(realUrl) + ',' + JSON.stringify(proxyOrigin) +
    ',' + JSON.stringify(servers) + ',' + JSON.stringify(cur) + ');';
}

/* ---------------- オプション ---------------- */

function parseServers(v) {
  if (!v) return [{ name: 'direct', url: '' }];
  const list = String(v).split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
    const i = s.indexOf('=');
    return i < 0 ? { name: s, url: '' } : { name: s.slice(0, i).trim(), url: s.slice(i + 1).trim() };
  });
  return list.length ? list : [{ name: 'direct', url: '' }];
}

function parseLinks(v) {
  if (!v) return [];
  return String(v).split(',').map((s) => s.trim()).filter(Boolean).map((s) => {
    const i = s.indexOf('=');
    return i < 0 ? { name: s, url: s } : { name: s.slice(0, i).trim(), url: s.slice(i + 1).trim() };
  });
}

export function buildOptions(env = {}, extra = {}) {
  return {
    origin: extra.origin || '',
    home: env.HOME || 'https://abema.tv/',
    servers: parseServers(env.WORKERS),
    links: parseLinks(env.LINKS),
    linksPassword: env.LINKS_PW || '',
    region: env.REGION || extra.region || '',
    cf: extra.cf || null
  };
}

function currentServer(request, opts) {
  const ck = request.headers.get('cookie') || '';
  const m = ck.match(/(?:^|;\s*)pxw=([^;]*)/);
  const name = m ? decodeURIComponent(m[1]) : '';
  return opts.servers.find((s) => s.name === name) || opts.servers[0];
}

/* ---------------- 本体 ---------------- */

export async function handle(request, opts) {
  const url = new URL(request.url);
  const p = url.pathname;

  if (p === '/__info' || p === '/__info/') return infoResponse(request, opts);
  if (p === '/__servers' || p === '/__servers/') return selectorPage(opts);
  if (p === '/__servers/status') return statusResponse(request, opts);
  if (p === '/__servers/links') return linksResponse(request, opts);
  if (p === '/__select') return selectResponse(url, opts);

  const hasCookie = /(?:^|;\s*)pxw=/.test(request.headers.get('cookie') || '');
  if (p === '/' && !hasCookie && opts.servers.length > 1) return selectorPage(opts);

  const target = resolveTarget(request.url, opts.home);
  if (!target) return new Response('Not Found', { status: 404 });
  return proxy(request, target, opts, currentServer(request, opts));
}

async function proxy(request, target, opts, server) {
  const proxyOrigin = opts.origin;
  const u = new URL(request.url);
  const upstream = server && server.url ? server.url.replace(/\/+$/, '') : '';
  const raw = request.headers.get('x-px-raw') === '1'; // Worker 中継時は書き換えを表側に任せる
  const fwdUrl = upstream ? upstream + u.pathname + u.search : target;
  const turl = new URL(target);

  const headers = new Headers();
  const DROP = new Set(['host', 'connection', 'keep-alive', 'transfer-encoding', 'accept-encoding',
    'content-length', 'cookie', 'referer', 'origin', 'te', 'upgrade', 'proxy-connection']);
  request.headers.forEach((v, k) => {
    const lk = k.toLowerCase();
    if (DROP.has(lk) || lk.startsWith('cf-') || lk.startsWith('x-forwarded') || lk.startsWith('x-render')) return;
    headers.set(k, v);
  });
  headers.set('referer', target);
  headers.set('origin', turl.origin);
  const ck = unprefixCookies(request.headers.get('cookie'), turl.hostname);
  if (ck) headers.set('cookie', ck);
  if (upstream) headers.set('x-px-raw', '1');

  const init = { method: request.method, headers, redirect: 'manual' };
  if (!/^(GET|HEAD)$/i.test(request.method)) {
    init.body = request.body;
    init.duplex = 'half';
  }

  let res;
  try {
    res = await fetch(fwdUrl, init);
  } catch (e) {
    return new Response('upstream error: ' + (e && e.message), {
      status: 502, headers: { 'content-type': 'text/plain; charset=utf-8' }
    });
  }

  const out = new Headers();
  const DROP2 = new Set(['content-encoding', 'content-length', 'transfer-encoding', 'connection',
    'content-security-policy', 'content-security-policy-report-only', 'x-frame-options',
    'strict-transport-security', 'alt-svc']);
  res.headers.forEach((v, k) => { if (!DROP2.has(k.toLowerCase())) out.set(k, v); });

  out.set('access-control-allow-origin', proxyOrigin);
  out.set('access-control-allow-credentials', 'true');

  const loc = res.headers.get('location');
  if (loc && !raw) out.set('location', wrapAttr(loc, target, proxyOrigin));

  out.delete('set-cookie');
  for (const c of readSetCookies(res.headers)) {
    out.append('set-cookie', raw ? c : prefixCookie(c, turl.hostname));
  }

  const ct = (res.headers.get('content-type') || '').toLowerCase();

  if (!raw && (ct.includes('text/html') || ct.includes('text/css'))) {
    let text = new TextDecoder('utf-8').decode(await res.arrayBuffer());
    text = ct.includes('text/html')
      ? injectClient(rewriteHtml(text, target, proxyOrigin), target, proxyOrigin,
          opts.servers.map((s) => s.name), server.name)
      : rewriteCss(text, target, proxyOrigin);
    return new Response(text, { status: res.status, headers: out });
  }

  return new Response(res.body, { status: res.status, headers: out });
}

/* ---------------- 診断・選択 UI ---------------- */

let _egress = { at: 0, data: null };
async function egressInfo() {
  if (_egress.data && Date.now() - _egress.at < 300000) return _egress.data;
  try {
    const r = await fetch('https://api.ipify.org?format=json');
    const j = await r.json();
    _egress = { at: Date.now(), data: { ip: j.ip, via: 'ipify.org' } };
  } catch {
    _egress = { at: Date.now(), data: { ip: '', via: 'ipify.org' } };
  }
  return _egress.data;
}

async function ownInfo(request, opts) {
  const cf = opts.cf || {};
  const colo = cf.colo || opts.region || 'UNKNOWN';
  return {
    execution: { colo, name: PLACES[colo] || colo, country: cf.country || '' },
    egress: await egressInfo(),
    client: {
      ip: request.headers.get('cf-connecting-ip') ||
          (request.headers.get('x-forwarded-for') || '').split(',')[0].trim(),
      country: request.headers.get('cf-ipcountry') || '',
      asOrganization: 'proxy'
    },
    inJapan: JP_COLOS.has(colo)
  };
}

async function infoResponse(request, opts) {
  const data = await ownInfo(request, opts);
  const url = new URL(request.url);
  if (url.searchParams.has('json')) {
    return new Response(JSON.stringify(data, null, 2), {
      headers: { 'content-type': 'application/json; charset=utf-8' }
    });
  }
  const e = data.execution;
  const html = '<!doctype html><meta charset="utf-8"><title>Worker 情報</title>' +
    '<body style="font:15px/1.7 system-ui,sans-serif;max-width:680px;margin:24px auto;padding:0 16px">' +
    '<h1>中継地点の情報</h1>' +
    '<p>実行拠点: <b>' + e.colo + ' / ' + e.name + '</b>' + (data.inJapan ? '（日本）' : '') + '</p>' +
    '<p>出口 IP: <b>' + (data.egress.ip || '取得できず') + '</b>（' + data.egress.via + '）</p>' +
    '<p>接続元 IP: ' + (data.client.ip || '-') + '</p>' +
    '<p><a href="/__servers">鯖の選択へ</a> / <a href="/__info?json">JSON</a></p></body>';
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}

async function statusResponse(request, opts) {
  const w = new URL(request.url).searchParams.get('w') || '';
  const s = opts.servers.find((x) => x.name === w);
  if (!s) return json({ ok: false, error: '不明な鯖: ' + w });
  if (!s.url) {
    const info = await ownInfo(request, opts);
    return json({ ok: true, status: 200, ms: 0, locked: false,
      colo: info.execution.colo, place: info.execution.name,
      inJapan: info.inJapan, egress: info.egress });
  }
  const t0 = Date.now();
  try {
    const r = await fetch(s.url.replace(/\/+$/, '') + '/__info?json', { cache: 'no-store' });
    const d = await r.json();
    return json({ ok: true, status: r.status, ms: Date.now() - t0, locked: !!d.locked,
      colo: d.execution && d.execution.colo, place: d.execution && d.execution.name,
      inJapan: !!d.inJapan, egress: d.egress });
  } catch (e) {
    return json({ ok: false, status: 0, error: String(e && e.message) });
  }
}

async function linksResponse(request, opts) {
  if (request.method !== 'POST') return json({ ok: false, error: 'POST のみ' }, 405);
  let pw = '';
  try { pw = (await request.json()).pw || ''; } catch { /* ignore */ }
  if (!opts.linksPassword) return json({ ok: false, error: 'LINKS_PW が未設定です' });
  if (pw !== opts.linksPassword) return json({ ok: false, error: 'パスワードが違います' });
  return json({ ok: true, links: opts.links });
}

function selectResponse(url, opts) {
  const w = url.searchParams.get('w') || '';
  const next = url.searchParams.get('next') || '/';
  const name = opts.servers.some((s) => s.name === w) ? w : opts.servers[0].name;
  return new Response(null, {
    status: 302,
    headers: {
      location: next.startsWith('/') ? next : '/',
      'set-cookie': COOKIE + '=' + encodeURIComponent(name) + '; Path=/; Max-Age=31536000; SameSite=Lax'
    }
  });
}

function json(o, status = 200) {
  return new Response(JSON.stringify(o), {
    status, headers: { 'content-type': 'application/json; charset=utf-8' }
  });
}

function selectorPage(opts) {
  const cards = opts.servers.map((s) =>
    '<li class="card" data-w="' + s.name + '">' +
    '<div class="top"><div class="name">' + s.name + '</div>' +
    '<a class="btn" href="/__select?w=' + encodeURIComponent(s.name) + '&next=/">この鯖を使う</a></div>' +
    '<div class="st">確認中…</div></li>').join('');

  const html = `<!doctype html><html lang="ja"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>鯖の選択</title>
<style>
:root{--bg:#fff;--fg:#1a1a1a;--mute:#777;--line:#ddd;--ok:#0a7d33;--warn:#b42318;--btn:#1a73e8}
@media(prefers-color-scheme:dark){:root{--bg:#161616;--fg:#eee;--mute:#999;--line:#333;--ok:#4cd07a;--warn:#ff8a80;--btn:#5b9cff}}
body{font:15px/1.7 system-ui,"Hiragino Sans","Noto Sans JP",sans-serif;background:var(--bg);color:var(--fg);max-width:680px;margin:0 auto;padding:20px 16px 48px}
ul{list-style:none;padding:0;display:grid;gap:12px}
.card{border:1px solid var(--line);border-radius:12px;padding:14px 16px}
.top{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}
.name{font-weight:700;font-size:17px}
.btn{background:var(--btn);color:#fff;text-decoration:none;border:0;border-radius:8px;padding:8px 14px;font-weight:600;cursor:pointer}
.st{margin-top:8px;font-size:13px;color:var(--mute)}
.st .ok{color:var(--ok);font-weight:700}.st .ng{color:var(--warn);font-weight:700}
.pw{display:flex;gap:8px;flex-wrap:wrap}
.pw input{flex:1;min-width:160px;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--fg)}
#links{margin-top:12px;display:grid;gap:8px}
#links div{border:1px solid var(--line);border-radius:8px;padding:8px 12px;word-break:break-all}
</style></head><body>
<h1>鯖を選ぶ</h1>
<p style="color:var(--mute);font-size:13px">使いたい鯖の「この鯖を使う」を押すと、以後この端末ではその鯖を経由します。鯖ごとに実行場所と出口 IP が違うことがあります。</p>
<ul>${cards}</ul>
<h2>リンクを見る</h2>
<div class="pw"><input id="pw" type="password" placeholder="パスワード"><button class="btn" id="show">表示</button></div>
<div id="links"></div>
<script>
document.querySelectorAll('.card').forEach(async function(li){
  var st=li.querySelector('.st');
  try{
    var r=await fetch('/__servers/status?w='+encodeURIComponent(li.dataset.w),{cache:'no-store'});
    var d=await r.json();
    if(!d.ok){st.innerHTML='<span class="ng">✕ '+(d.error||'エラー')+'</span>';return;}
    st.innerHTML='<span class="ok">● 稼働中</span> / '+(d.inJapan?'<span class="ok">日本</span> ':'')+d.colo+' / '+
      (d.egress&&d.egress.ip?('出口 IP '+d.egress.ip+' / '):'')+d.ms+' ms';
  }catch(e){st.innerHTML='<span class="ng">✕ 確認できませんでした</span>';}
});
async function show(){
  var pw=document.getElementById('pw').value;
  var r=await fetch('/__servers/links',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({pw:pw})});
  var d=await r.json();var box=document.getElementById('links');box.innerHTML='';
  if(!d.ok){box.textContent=d.error;return;}
  d.links.forEach(function(l){var el=document.createElement('div');
    var b=document.createElement('b');b.textContent=l.name;el.appendChild(b);
    el.appendChild(document.createTextNode(l.url));box.appendChild(el);});
}
document.getElementById('show').addEventListener('click',show);
</script></body></html>`;
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8' } });
}