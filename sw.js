/* ==========================================================
   Game Arcade Service Worker — 离线缓存(大厅 + 全部游戏)
   注意:修改了任何被预缓存的文件后,必须把 CACHE_VERSION
   升一位(如 v2 → v3),客户端才会拿到新版本。
   ========================================================== */
'use strict';

const CACHE_VERSION = 'v5';
const PRECACHE = [
  './',
  './index.html',
  './lobby.css',
  './manifest.json',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './games/schulte/',
  './games/schulte/index.html',
  './games/schulte/style.css',
  './games/schulte/app.js',
  './games/tetris/',
  './games/tetris/index.html',
  './games/tetris/tetris.css',
  './games/tetris/engine.js',
  './games/tetris/app.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_VERSION)
      .then((cache) =>
        // cache:'reload' 绕过 HTTP 缓存,确保预缓存的是最新文件
        Promise.all(PRECACHE.map((url) => cache.add(new Request(url, { cache: 'reload' }))))
      )
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || !req.url.startsWith(self.location.origin)) return;
  event.respondWith(
    caches.match(req, { ignoreSearch: true }).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy));
          }
          return res;
        })
    )
  );
});
