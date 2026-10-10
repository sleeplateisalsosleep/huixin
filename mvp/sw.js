/* ============================================================
   sw.js — 蕙心 MVP Service Worker
   策略：
   - install 容错预缓存（单个资源失败不阻断整体接管，避免部署窗口期卡死旧版）
   - knowledge.json 走 stale-while-revalidate（缓存秒开 + 后台更新）
   - 其余同源 GET 走 cache-first
   作用域：/huixin/mvp/（由注册路径自动限定，与主站隔离）
   ============================================================ */
var CACHE = 'hx-mvp-v6';
var ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/cycle.js',
  './assets/knowledge.json',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/logo.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png',
  './icons/apple-touch-icon-180.png'
];
var KB_PATH = '/assets/knowledge.json';

function isKb(url) {
  return url.pathname.indexOf(KB_PATH, url.pathname.length - KB_PATH.length) >= 0;
}

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (cache) {
      // 逐个缓存：任一资源失败（如部署瞬间的 404）不影响其他资源与 SW 接管
      return Promise.all(ASSETS.map(function (u) {
        return cache.add(u).catch(function () { /* 留给下次访问时动态补缓存 */ });
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return k === CACHE ? null : caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

/* knowledge.json：有缓存先用缓存，并在后台拉新版本；无缓存才等网络 */
function staleWhileRevalidate(req) {
  return caches.match(req, { ignoreSearch: true }).then(function (cached) {
    var network = fetch(req).then(function (res) {
      if (res && res.status === 200) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
      }
      return res;
    }).catch(function () { return cached; });
    return cached || network;
  });
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  if (isKb(url)) {
    e.respondWith(staleWhileRevalidate(req));
    return;
  }

  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        // 同源成功响应动态入缓存（只缓存 200，防止 404 页面污染）
        if (res && res.status === 200) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () {
        // 导航请求离线兜底
        if (req.mode === 'navigate') return caches.match('./index.html');
      });
    })
  );
});
