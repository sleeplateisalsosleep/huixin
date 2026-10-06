/* ============================================================
   sw.js — 蕙心 MVP Service Worker
   策略：install 预缓存 app shell；运行时同源 GET 走 cache-first
   作用域：/huixin/mvp/（由注册路径自动限定，与主站隔离）
   ============================================================ */
var CACHE = 'hx-mvp-v1';
var ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/cycle.js',
  './assets/knowledge.json',
  './manifest.webmanifest',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png',
  './icons/apple-touch-icon-180.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (cache) {
      return cache.addAll(ASSETS);
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

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        // 同源成功响应动态入缓存
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
