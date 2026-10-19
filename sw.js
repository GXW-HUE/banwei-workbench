/* 班委工作台 Service Worker - PWA 离线支持
   策略说明（v32 起）：
   - 自身 JS/CSS/HTML 一律「网络优先 + 超时回退缓存」，确保每次打开都是最新代码，
     只有断网或网络极慢时才用旧缓存兜底（离线仍可用）。
   - 云同步请求（GitHub API / Gist / 代理）完全不拦截、不缓存，避免读到过期数据。
*/
<<<<<<< HEAD
const CACHE_NAME = 'class-workbench-v35';
=======
const CACHE_NAME = 'class-workbench-v35';
>>>>>>> ce68301 (v20261019-31: 修复换设备/刷新后推送会丢失其他设备文件内容 + 设置页新增一键补传)
// 网络优先的等待上限：超过这个时间还没拿到网络响应，就用缓存兜底（保证弱网也能秒开）
const NET_TIMEOUT = 2500;

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
      .catch(() => {})
      .then(() => self.skipWaiting())
  );
});

// 激活：清理所有旧版本缓存（不再局限于已知名字，避免历史残留导致页面一直跑旧代码）
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.map((key) => (key === CACHE_NAME ? null : caches.delete(key)))
      ))
      .then(() => self.clients.claim())
  );
});

// 收到页面指令：立即接管（用于"强制更新"）
self.addEventListener('message', (event) => {
  if (event && event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// 网络优先：给定时间内拿不到网络响应就用缓存兜底
function networkFirst(req, cacheFallbackQuery) {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      caches.match(cacheFallbackQuery || req).then((c) => {
        if (c) { resolve(c); return; }
        resolve(fetch(req));
      });
    }, NET_TIMEOUT);
    fetch(req).then((res) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (res && res.ok) {
        try {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone)).catch(() => {});
        } catch (e) {}
      }
      resolve(res);
    }).catch(() => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      caches.match(cacheFallbackQuery || req).then((c) => {
        resolve(c || caches.match('./index.html'));
      });
    });
  });
}

// 请求拦截
self.addEventListener('fetch', (event) => {
  const req = event.request;
  // 只处理 GET
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // 云同步请求（GitHub API / Gist raw / 代理通道）：直接走网络，不拦截、不缓存、不回退旧缓存
  if (CLOUD_HOSTS.some(h => url.hostname === h || url.hostname.endsWith('.' + h))) {
    return;
  }

  // 版本文件：绝不缓存，永远取最新（用于页面判断是否是最新代码）
  if (url.pathname.indexOf('version.json') !== -1) {
    event.respondWith(fetch(req, { cache: 'no-store' }));
    return;
  }

  // 同源自身资源
  if (url.origin === self.location.origin) {
    // HTML 文档：网络优先（每次拿最新版），超时/失败才用缓存
    const isDocument = req.destination === 'document' ||
      url.pathname === '/' || url.pathname.endsWith('/index.html');
    if (isDocument) {
      event.respondWith(networkFirst(req, './index.html'));
      return;
    }
    // JS / CSS：网络优先 + 超时回退缓存。
    // （旧策略是"先返回缓存再后台更新"，导致手机上第一次打开永远是旧代码）
    if (req.destination === 'script' || req.destination === 'style' ||
        /\.(js|css)(\?|$)/.test(url.pathname)) {
      event.respondWith(networkFirst(req));
      return;
    }
    // 其余资源（图片/图标等）：缓存优先（几乎不变，省流量）
    event.respondWith(
      caches.match(req).then((cached) => cached || fetch(req).then((res) => {
        if (res && res.ok) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone)).catch(() => {});
        }
        return res;
      }))
    );
    return;
  }

  // CDN 外部资源：网络优先，失败时回退缓存（保证离线也能打开已缓存库）
  event.respondWith(
    fetch(req).then((res) => {
      if (res && res.ok) {
        const clone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(req, clone)).catch(() => {});
      }
      return res;
    }).catch(() => caches.match(req))
  );
});
