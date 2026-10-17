/* 班委工作台 Service Worker - PWA 离线支持 */
const CACHE_NAME = 'class-workbench-v31';

// 云同步相关域名：数据请求一律直连网络，绝不缓存（否则设备会一直读到过期云端数据）
const CLOUD_HOSTS = [
  'api.github.com',
  'gist.githubusercontent.com',
  'gh-proxy.com',
  'ghfast.top',
  'ghproxy.net'
];

// 核心静态资源：安装时预缓存（自身域名）
const CORE_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/config.js',
  './js/store.js',
  './js/parse-docx.js',
  './js/exporter.js',
  './js/app.js',
  './assets/icons/icon-192.png',
  './assets/icons/icon-512.png',
  './assets/icons/apple-touch-icon.png'
];

// 安装：预缓存核心资源
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(CORE_ASSETS))
      .then(() => self.skipWaiting())
  );
});

// 激活：清理旧版本缓存
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

// 请求拦截：缓存优先，回退网络并更新缓存；失败时回退缓存
self.addEventListener('fetch', (event) => {
  const req = event.request;
  // 只处理 GET
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // 云同步请求（GitHub API / Gist raw / 代理通道）：直接走网络，不拦截、不缓存、不回退旧缓存
  if (CLOUD_HOSTS.some(h => url.hostname === h || url.hostname.endsWith('.' + h))) {
    return;
  }

  // 同源自身资源
  if (url.origin === self.location.origin) {
    // HTML 文档：网络优先（每次拿最新版，避免旧缓存导致功能异常），失败才用缓存
    const isDocument = req.destination === 'document' ||
      url.pathname === '/' || url.pathname.endsWith('/index.html');
    if (isDocument) {
      event.respondWith(
        fetch(req).then((res) => {
          if (res && res.ok) {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          }
          return res;
        }).catch(() => caches.match(req).then((c) => c || caches.match('./index.html')))
      );
      return;
    }
    // 静态资源：缓存优先，后台更新（stale-while-revalidate）
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) {
          // 后台更新缓存（stale-while-revalidate）
          fetch(req).then((res) => {
            if (res && res.ok && res.type === 'basic') {
              caches.open(CACHE_NAME).then((cache) => cache.put(req, res.clone()));
            }
          }).catch(() => {});
          return cached;
        }
        return fetch(req).then((res) => {
          if (res && res.ok && res.type === 'basic') {
            const clone = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
          }
          return res;
        }).catch(() => caches.match('./index.html'));
      })
    );
    return;
  }

  // CDN 外部资源：网络优先，失败时回退缓存（保证离线也能打开已缓存库）
  event.respondWith(
    fetch(req).then((res) => {
      if (res && res.ok) {
        const clone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
      }
      return res;
    }).catch(() => caches.match(req))
  );
});
