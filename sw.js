/* 班委工作台 Service Worker - PWA 离线支持（v35 重写）
   设计原则：宁可不要离线，也绝不让设备跑旧代码/读旧数据。
   - 同源的 JS / CSS / HTML / version.json / sync/ 数据镜像：全部放行给浏览器直连，
     不做 SW 缓存。新鲜度由 index.html 里 script 标签的 ?v= 与拉取时的 ?t= 保证。
     → 彻底消灭“手机一直跑旧代码、一直读旧数据”的问题。
   - 外部 CDN 库（xlsx/jspdf/pptxgenjs 等）：缓存优先，支持弱网/离线打开已缓存的库。
   - 云同步请求（GitHub API / Gist / 代理）：完全不拦截、不缓存。
   - 始终 skipWaiting + clients.claim，新版本部署后立刻接管页面。 */
const CACHE_NAME = 'class-workbench-v47';

// 云同步相关域名：数据请求一律直连网络，绝不缓存
const CLOUD_HOSTS = [
  'api.github.com',
  'gist.githubusercontent.com',
  'gh-proxy.com',
  'ghfast.top',
  'ghproxy.net'
];

// 仅缓存这些 CDN 库（外部、URL 自带版本号、几乎不变），用于弱网/离线
const CDN_CACHEABLE = [
  'cdnjs.cloudflare.com',
  'cdn.jsdelivr.net',
  'unpkg.com'
];

// 安装：预缓存 CDN 库（失败也不影响）
self.addEventListener('install', (event) => {
  self.skipWaiting();
});

// 激活：清理所有旧版本缓存，立即接管所有页面
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.map((k) => (k === CACHE_NAME ? null : caches.delete(k)))))
      .then(() => self.clients.claim())
  );
});

// 收到页面指令：立即接管（用于“强制更新”）
self.addEventListener('message', (event) => {
  if (event && event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// CDN 库：缓存优先，失败回退网络
function cdnCacheFirst(req) {
  return caches.match(req).then((cached) => {
    if (cached) return cached;
    return fetch(req).then((res) => {
      if (res && res.ok) {
        const clone = res.clone();
        caches.open(CACHE_NAME).then((c) => c.put(req, clone)).catch(() => {});
      }
      return res;
    });
  });
}

// 请求拦截
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // 云同步请求（GitHub API / Gist raw / 代理通道）：直接走网络，不拦截、不缓存
  if (CLOUD_HOSTS.some((h) => url.hostname === h || url.hostname.endsWith('.' + h))) {
    return;
  }

  // 同源资源（JS/CSS/HTML/version.json/sync 数据镜像）：放行给浏览器直连，不缓存。
  // 新鲜度由 ?v= / ?t= 保证，绝不会因为 SW 旧缓存而读到过期代码或数据。
  if (url.origin === self.location.origin) {
    return;
  }

  // 外部 CDN 库：缓存优先，支持弱网/离线
  if (CDN_CACHEABLE.some((h) => url.hostname === h || url.hostname.endsWith('.' + h))) {
    event.respondWith(cdnCacheFirst(req));
    return;
  }

  // 其它外部资源：直接网络
});
