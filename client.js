/**
 * client.js
 * プロキシ経由のページに注入する書き換えスクリプト（文字列）。
 * ページ側の JS から見て「素の abema.tv と通信している」状態に寄せる。
 */

export const CLIENT_BODY = String.raw`(function (REAL, PROXY, SERVERS, CUR) {
  if (window.__px) return;
  window.__px = 1;
  var NU = URL, WSP = PROXY.replace(/^http/, 'ws');
  var SKIP = /^(data|blob|javascript|about|mailto|tel|sms):/i;
  var PHOST = new NU(PROXY).host, PORIGIN = new NU(PROXY).origin;

  function b64(s) {
    var b = new TextEncoder().encode(s), r = '';
    for (var i = 0; i < b.length; i += 8192) r += String.fromCharCode.apply(null, b.subarray(i, i + 8192));
    return btoa(r).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function unb64(s) {
    var t = String(s).replace(/-/g, '+').replace(/_/g, '/');
    while (t.length % 4) t += '=';
    var bin = atob(t), arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(arr);
  }
  function isWrapped(p) {
    var m = p.match(/^\/([A-Za-z0-9_-]{8,})(\/|$)/);
    if (!m) return false;
    try { return /^https?:\/\//i.test(unb64(m[1])); } catch (e) { return false; }
  }
  function ownUrl(s, base) {
    var a; try { a = new NU(s, base || REAL); } catch (e) { return null; }
    if (a.host !== PHOST || !/^(https?|wss?):$/.test(a.protocol)) return null;
    if (isWrapped(a.pathname)) return 'keep';
    try { return new NU(a.pathname + a.search + a.hash, REAL).href; } catch (e) { return 'keep'; }
  }
  function px(u, base) {
    if (u == null) return u;
    var s = String(u).trim();
    if (!s || s.charAt(0) === '#' || SKIP.test(s)) return u;
    if (s.indexOf(PROXY + '/') === 0 || s.indexOf(WSP + '/') === 0 || /^(https?:|wss?:)?\/\//i.test(s)) {
      var ou = ownUrl(s, base);
      if (ou === 'keep') return u;
      if (ou) s = ou;
    }
    var a; try { a = new NU(s, base || REAL); } catch (e) { return u; }
    if (!/^(https?|wss?):$/.test(a.protocol)) return u;
    var h = a.hash; a.hash = '';
    return PROXY + '/' + b64(a.href.replace(/^ws/, 'http')) + '/' + h;
  }
  function pxWs(u) { return String(px(u)).replace(/^http/, 'ws'); }
  function real(u) {
    try {
      var a = new NU(String(u), location.href);
      var m = a.pathname.match(/^\/([A-Za-z0-9_-]{8,})(\/.*)?$/);
      if (m && a.origin === PORIGIN) {
        var dec = unb64(m[1]), rel = (m[2] || '').replace(/^\/+/, '');
        var t = rel ? new NU(rel, dec) : new NU(dec);
        if (a.search) t.search = a.search;
        return t.href;
      }
    } catch (e) {}
    return String(u);
  }
  function srcset(v) {
    return String(v).replace(/(\S+)(\s+[\d.]+[wx])?(\s*,\s*|\s*$)/g,
      function (m, u, d, s) { return px(u) + (d || '') + s; });
  }

  /* ============ 通信の書き換え ============ */
  var ofetch = window.fetch, OR = window.Request;
  window.Request = new Proxy(OR, { construct: function (t, a) {
    if (a[0] != null && !(a[0] instanceof OR)) a[0] = px(a[0]);
    return Reflect.construct(t, a);
  } });
  window.fetch = function (i, init) {
    if (!(i instanceof OR)) i = px(i);
    return ofetch.call(this, i, init);
  };
  var xo = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (m, u) {
    var a = [].slice.call(arguments); a[1] = px(u); return xo.apply(this, a);
  };
  if (navigator.sendBeacon) {
    var sb = navigator.sendBeacon;
    navigator.sendBeacon = function (u, d) { return sb.call(navigator, px(u), d); };
  }
  window.WebSocket = new Proxy(WebSocket, { construct: function (t, a) {
    a[0] = pxWs(a[0]); return Reflect.construct(t, a);
  } });
  if (window.EventSource) window.EventSource = new Proxy(EventSource, { construct: function (t, a) {
    a[0] = px(a[0]); return Reflect.construct(t, a);
  } });

  /* ============ Worker / SharedWorker ============ */
  function wkBoot(PROXY, BASE) {
    var NU = URL, WSP = PROXY.replace(/^http/, 'ws');
    var SKIP = /^(data|blob|javascript|about):/i;
    function b64(s) {
      var b = new TextEncoder().encode(s), r = '';
      for (var i = 0; i < b.length; i += 8192) r += String.fromCharCode.apply(null, b.subarray(i, i + 8192));
      return btoa(r).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }
    function px(u) {
      if (u == null) return u;
      var s = String(u).trim();
      if (!s || SKIP.test(s)) return u;
      if (s.indexOf(PROXY + '/') === 0 || s.indexOf(WSP + '/') === 0) return u;
      var a; try { a = new NU(s, BASE); } catch (e) { return u; }
      if (!/^(https?|wss?):$/.test(a.protocol)) return u;
      a.hash = '';
      return PROXY + '/' + b64(a.href.replace(/^ws/, 'http')) + '/';
    }
    if (self.fetch) {
      var of = self.fetch, ORr = self.Request;
      self.Request = new Proxy(ORr, { construct: function (t, a) {
        if (a[0] != null && !(a[0] instanceof ORr)) a[0] = px(a[0]);
        return Reflect.construct(t, a);
      } });
      self.fetch = function (i, init) { if (!(i instanceof ORr)) i = px(i); return of.call(this, i, init); };
    }
    if (self.XMLHttpRequest) {
      var xo = XMLHttpRequest.prototype.open;
      XMLHttpRequest.prototype.open = function (m, u) {
        var a = [].slice.call(arguments); a[1] = px(u); return xo.apply(this, a);
      };
    }
    if (self.importScripts) {
      var oi = self.importScripts;
      self.importScripts = function () {
        return oi.apply(this, [].map.call(arguments, function (u) { return px(u); }));
      };
    }
    if (self.WebSocket) {
      self.WebSocket = new Proxy(WebSocket, { construct: function (t, a) {
        a[0] = String(px(a[0])).replace(/^http/, 'ws'); return Reflect.construct(t, a);
      } });
    }
  }
  var WK_SRC = '(' + wkBoot.toString() + ')';
  function wkWrap(loadUrl, base) {
    var code = WK_SRC + '(' + JSON.stringify(PROXY) + ',' + JSON.stringify(base) +
      ');importScripts(' + JSON.stringify(loadUrl) + ');';
    return URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
  }
  if (window.Worker) {
    window.Worker = new Proxy(window.Worker, { construct: function (t, a) {
      try {
        var s0 = String(a[0]), o = a[1];
        if (!(o && o.type === 'module') && !/^data:/i.test(s0)) {
          var isBlob = /^blob:/i.test(s0);
          var pu = isBlob ? s0 : px(a[0]);
          a[0] = wkWrap(pu, isBlob ? REAL : real(pu));
        }
      } catch (e) {}
      if (!/^blob:/i.test(String(a[0]))) a[0] = px(a[0]);
      return Reflect.construct(t, a);
    } });
  }
  if (window.SharedWorker) {
    window.SharedWorker = new Proxy(window.SharedWorker, { construct: function (t, a) {
      a[0] = px(a[0]); return Reflect.construct(t, a);
    } });
  }
  var wo = window.open;
  window.open = function (u) { var a = [].slice.call(arguments); if (u) a[0] = px(u); return wo.apply(window, a); };

  /* ============ 要素の URL 属性 ============ */
  function hook(cls, prop, fn) {
    var C = window[cls]; if (!C) return;
    var d = Object.getOwnPropertyDescriptor(C.prototype, prop);
    if (!d || !d.set) return;
    Object.defineProperty(C.prototype, prop, {
      configurable: true, enumerable: d.enumerable, get: d.get,
      set: function (v) { d.set.call(this, fn(v)); }
    });
  }
  [['HTMLImageElement', 'src'], ['HTMLScriptElement', 'src'], ['HTMLSourceElement', 'src'],
   ['HTMLMediaElement', 'src'], ['HTMLTrackElement', 'src'], ['HTMLIFrameElement', 'src'],
   ['HTMLEmbedElement', 'src'], ['HTMLInputElement', 'src'], ['HTMLLinkElement', 'href'],
   ['HTMLAnchorElement', 'href'], ['HTMLAreaElement', 'href'], ['HTMLVideoElement', 'poster'],
   ['HTMLFormElement', 'action'], ['HTMLObjectElement', 'data']
  ].forEach(function (p) { hook(p[0], p[1], px); });
  hook('HTMLImageElement', 'srcset', srcset);
  hook('HTMLSourceElement', 'srcset', srcset);

  var sa = Element.prototype.setAttribute;
  var URLATTR = { src: 1, href: 1, poster: 1, action: 1, formaction: 1, data: 1 };
  Element.prototype.setAttribute = function (n, v) {
    var l = String(n).toLowerCase();
    if (URLATTR[l] && (l !== 'data' || this.tagName === 'OBJECT')) v = px(v);
    else if (l === 'srcset') v = srcset(v);
    return sa.call(this, n, v);
  };
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest && e.target.closest('a[href]');
    if (!a) return;
    var v = a.getAttribute('href'), n = px(v);
    if (n !== v) sa.call(a, 'href', n);
  }, true);

  /* ============ アドレスバーの偽装 ============ */
  var SPOOF = window.top === window;
  if (SPOOF) {
    try {
      var r0 = new NU(REAL);
      history.replaceState(history.state, '', r0.pathname + r0.search + location.hash);
    } catch (e) {}
  }
  ['pushState', 'replaceState'].forEach(function (k) {
    var o = history[k];
    history[k] = function (s, t, u) {
      if (u != null && u !== '') {
        try {
          var a = new NU(String(u), REAL), same = a.origin === new NU(REAL).origin;
          REAL = a.href;
          u = (SPOOF && same) ? a.pathname + a.search + a.hash : px(a.href);
        } catch (e) {}
      }
      return o.call(this, s, t, u);
    };
  });

  /* ============ postMessage ============ */
  try {
    Object.defineProperty(window, '__pxReal', { configurable: true, get: function () { return REAL; } });
  } catch (e) {}
  var pm0 = window.postMessage;
  if (pm0) window.postMessage = function (m, o, t) {
    var a = [].slice.call(arguments);
    if (typeof o === 'string') { if (o !== '/') a[1] = '*'; }
    else if (o && typeof o === 'object' && o.targetOrigin && o.targetOrigin !== '/') {
      a[1] = Object.assign({}, o, { targetOrigin: '*' });
    }
    return pm0.apply(this, a);
  };
  var mod = Object.getOwnPropertyDescriptor(MessageEvent.prototype, 'origin');
  if (mod && mod.get) Object.defineProperty(MessageEvent.prototype, 'origin', {
    configurable: true, enumerable: mod.enumerable,
    get: function () {
      var o = mod.get.call(this);
      if (o === PORIGIN) {
        try { var s = this.source; if (s && s.__pxReal) return new NU(s.__pxReal).origin; } catch (e) {}
        try { return new NU(REAL).origin; } catch (e) {}
      }
      return o;
    }
  });

  /* ============ Cookie をサイト単位で隔離 ============ */
  function site(h) {
    var p = String(h).split('.');
    if (p.length <= 2 || /^\d+$/.test(p[p.length - 1])) return h;
    var n = (p[p.length - 1].length === 2 && p[p.length - 2].length <= 3) ? 3 : 2;
    return p.slice(-n).join('.');
  }
  function hh(s) {
    var h = 0x811c9dc5;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
    return (h >>> 0).toString(36);
  }
  function pre() { return '_p' + hh(site(new NU(REAL).hostname)) + '_'; }
  var cd = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
  if (cd) Object.defineProperty(document, 'cookie', {
    configurable: true,
    get: function () {
      var p = pre();
      return cd.get.call(document).split(/;\s*/)
        .filter(function (c) { return c.indexOf(p) === 0; })
        .map(function (c) { return c.slice(p.length); }).join('; ');
    },
    set: function (v) {
      var parts = String(v).split(';');
      var first = pre() + parts[0].trim();
      var rest = parts.slice(1).map(function (s) { return s.trim(); })
        .filter(function (s) { return s && !/^(domain|path)=/i.test(s); });
      rest.push('path=/');
      cd.set.call(document, [first].concat(rest).join('; '));
    }
  });

  /* ============ Service Worker は使わせない ============ */
  if (navigator.serviceWorker) {
    try {
      navigator.serviceWorker.register = function () {
        return Promise.reject(new Error('serviceWorker disabled by proxy'));
      };
    } catch (e) {}
  }

  /* ============ ABEMA 固有の直し ============ */
  try {
    if (/(^|\.)(abema\.tv|abema\.io|ameba\.jp)$/i.test(new NU(REAL).hostname) && window.top === window) {
      /* 直し1: Request.url を「書き換え前の URL」のまま返す
         ABEMA の HTTP クライアントは new Request() 直後に request.url が origin で始まるか検証し、
         違えば URIError を投げて起動をやめる。プロキシ URL では必ず失敗するので読み取り値だけ戻す。 */
      try {
        var REQ_ORIG = new WeakMap();
        var RQ = window.Request;
        window.Request = new Proxy(RQ, { construct: function (t, a) {
          var r = Reflect.construct(t, a);
          try {
            var u0 = a[0];
            if (u0 != null) {
              if (u0 instanceof RQ) { if (REQ_ORIG.has(u0)) REQ_ORIG.set(r, REQ_ORIG.get(u0)); }
              else REQ_ORIG.set(r, new NU(String(u0), REAL).href);
            }
          } catch (e) {}
          return r;
        } });
        var ud = Object.getOwnPropertyDescriptor(RQ.prototype, 'url');
        if (ud && ud.get) Object.defineProperty(RQ.prototype, 'url', {
          configurable: true, enumerable: ud.enumerable,
          get: function () { var o = REQ_ORIG.get(this); return o !== undefined ? o : ud.get.call(this); }
        });
      } catch (e) {}

      /* 直し2: 前回トークンを捨てて毎回ゲスト認証からやり直す
         古いトークンがあると POST /api/auth/sessions が 401 を返し「Sorry…」画面になる。 */
      try {
        ['abm_token', 'abm_userId', 'abm_previousAccessTokenV1', 'abm_authPreviousInvalidUserId']
          .forEach(function (k) { try { localStorage.removeItem(k); } catch (e) {} });
      } catch (e) {}

      /* 直し3: responseURL / Response.url を本物の URL に戻す
         dash.js / hls.js は応答 URL を基準に相対パスを絶対化するため、プロキシ URL のままだと
         init.m4s や字幕が 404 になる。 */
      function unwrap(u) {
        try {
          var s = String(u == null ? '' : u);
          if (!s) return u;
          var r = real(s);
          if (r !== s) return r;
          var a = new NU(s);
          if (a.origin === PORIGIN) return new NU(a.pathname + a.search + a.hash, REAL).href;
        } catch (e) {}
        return u;
      }
      try {
        var xrd = Object.getOwnPropertyDescriptor(XMLHttpRequest.prototype, 'responseURL');
        if (xrd && xrd.get) Object.defineProperty(XMLHttpRequest.prototype, 'responseURL', {
          configurable: true, enumerable: xrd.enumerable,
          get: function () { var v = xrd.get.call(this), o = unwrap(v); return o; }
        });
        var rsd = Object.getOwnPropertyDescriptor(Response.prototype, 'url');
        if (rsd && rsd.get) Object.defineProperty(Response.prototype, 'url', {
          configurable: true, enumerable: rsd.enumerable,
          get: function () { var v = rsd.get.call(this); return unwrap(v); }
        });
      } catch (e) {}

      /* 直し4: about:blank への遷移を止める */
      function isBlank(u) {
        try { return String(u == null ? '' : u).trim().toLowerCase().indexOf('about:blank') === 0; }
        catch (e) { return false; }
      }
      try {
        if (window.navigation && window.navigation.addEventListener) {
          window.navigation.addEventListener('navigate', function (ev) {
            try { if (ev.destination && isBlank(ev.destination.url) && ev.cancelable) ev.preventDefault(); }
            catch (e) {}
          });
        }
      } catch (e) {}
      try {
        var wo3 = window.open;
        window.open = function (u, t) {
          var tg = String(t == null ? '_blank' : t).toLowerCase();
          if (isBlank(u) && (tg === '_self' || tg === '_top' || tg === '_parent')) return null;
          return wo3.apply(this, arguments);
        };
      } catch (e) {}
      try {
        document.addEventListener('click', function (ev) {
          try {
            var a = ev.target && ev.target.closest && ev.target.closest('a[href]');
            if (a && isBlank(a.getAttribute('href')) &&
                /^(_self|_top|_parent|)$/i.test(a.getAttribute('target') || '')) {
              ev.preventDefault(); ev.stopImmediatePropagation();
            }
          } catch (e) {}
        }, true);
      } catch (e) {}
    }
  } catch (e) {}

  /* ============ 右下の切替ボタン ============ */
  if (window.top === window && !window.__pxFab) {
    window.__pxFab = 1;
    try {
      var host = document.createElement('div');
      host.style.cssText = 'all:initial;position:fixed;right:14px;bottom:14px;z-index:2147483647;';
      var root = host.attachShadow({ mode: 'open' });
      var css = document.createElement('style');
      css.textContent =
        '.w{position:relative;font-family:system-ui,sans-serif}' +
        '.fab{font:600 12px/1 system-ui,sans-serif;color:#fff;background:rgba(26,115,232,.88);border:0;' +
        'border-radius:99px;padding:10px 14px;box-shadow:0 2px 8px rgba(0,0,0,.35);cursor:pointer;opacity:.55}' +
        '.fab:hover,.open .fab{opacity:1}' +
        '.panel{display:none;position:absolute;right:0;bottom:44px;min-width:160px;background:#222;color:#fff;' +
        'border-radius:12px;padding:6px;box-shadow:0 4px 16px rgba(0,0,0,.45)}' +
        '.open .panel{display:block}' +
        '.item{display:block;width:100%;text-align:left;background:none;border:0;color:#fff;font:14px system-ui,sans-serif;' +
        'padding:9px 12px;border-radius:8px;cursor:pointer;white-space:nowrap}' +
        '.item:hover{background:rgba(255,255,255,.14)}.item.cur{font-weight:700;color:#8ab4ff}' +
        '.sep{height:1px;background:rgba(255,255,255,.18);margin:4px 0}.sub{font-size:12px;color:#bbb}';
      var wrap = document.createElement('div'); wrap.className = 'w';
      var fab = document.createElement('button'); fab.className = 'fab'; fab.type = 'button'; fab.textContent = CUR;
      var panel = document.createElement('div'); panel.className = 'panel';
      function go(u) { window.location.assign(u); }
      SERVERS.forEach(function (n) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'item' + (n === CUR ? ' cur' : '');
        b.textContent = (n === CUR ? '✓ ' : '') + n;
        b.addEventListener('click', function () {
          if (n === CUR) { wrap.className = 'w'; return; }
          go('/__select?w=' + encodeURIComponent(n) + '&next=' +
             encodeURIComponent(location.pathname + location.search));
        });
        panel.appendChild(b);
      });
      var sep = document.createElement('div'); sep.className = 'sep'; panel.appendChild(sep);
      var more = document.createElement('button');
      more.type = 'button'; more.className = 'item sub'; more.textContent = '鯖の状態を見る';
      more.addEventListener('click', function () { go('/__servers'); });
      panel.appendChild(more);
      fab.addEventListener('click', function (e) {
        e.stopPropagation();
        wrap.className = (wrap.className === 'w') ? 'w open' : 'w';
      });
      document.addEventListener('click', function () { wrap.className = 'w'; }, true);
      wrap.appendChild(panel); wrap.appendChild(fab);
      root.appendChild(css); root.appendChild(wrap);
      document.documentElement.appendChild(host);
    } catch (e) {}
  }
})`;