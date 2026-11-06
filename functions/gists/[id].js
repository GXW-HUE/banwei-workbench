const ALLOWED_ORIGINS = [
  'https://gxw-hue.github.io',
  'https://banwei-sync-api.pages.dev'
];
const GIST = '1a9cbefeb7b98260e552c057924d67ae';
const LIMIT = 20 * 1024 * 1024;

function checkOrigin(request) {
  const origin = request.headers.get('Origin');
  if (!origin) return { allowed: true, echo: '' };
  if (ALLOWED_ORIGINS.includes(origin)) return { allowed: true, echo: origin };
  if (/^https:\/\/[a-z0-9-]+\.banwei-sync-api\.pages\.dev$/.test(origin)) return { allowed: true, echo: origin };
  return { allowed: false, echo: '' };
}

function corsHeaders(echo) {
  const headers = {
    'Access-Control-Allow-Methods': 'GET, PATCH, OPTIONS',
    'Access-Control-Allow-Headers': 'Accept, Authorization, Content-Type',
    'Access-Control-Allow-Max-Age': '86400',
    'Cache-Control': 'no-store',
    'Vary': 'Origin'
  };
  if (echo) headers['Access-Control-Allow-Origin'] = echo;
  return headers;
}

export async function onRequest({ request, params, env, waitUntil }) {
  const origin = checkOrigin(request);
  const cors = corsHeaders(origin.echo);
  if (!origin.allowed) return new Response('Forbidden', { status: 403, headers: cors });
  if (params.id !== GIST) return new Response('Not found', { status: 404, headers: cors });
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (!['GET', 'PATCH'].includes(request.method)) return new Response('Method not allowed', { status: 405, headers: cors });
  const token = env && (env.GIST_TOKEN || env.GITHUB_TOKEN);
  if (!token) return new Response(JSON.stringify({ error: 'Cloud sync credentials are not configured' }), { status: 503, headers: { ...cors, 'Content-Type': 'application/json' } });
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 90000);
  const requestUrl = new URL(request.url);
  const rawBase = 'https://gist.githubusercontent.com/GXW-HUE/' + GIST + '/raw/';
  const jsonCors = { ...cors, 'Content-Type': 'application/json; charset=utf-8' };
  // v64：索引与附件小文件直接走 gist raw（单文件、可缓存、约 1 秒），
  // 不再每次请求都拉整个 gist（其中含 10MB data.json，实测 2.5-14 秒且偶发 503）。
  async function fastRaw(name) {
    try {
      const r = await fetch(rawBase + name + '?t=' + Date.now(), { signal: ctl.signal, headers: { 'Cache-Control': 'no-cache' } });
      if (!r.ok) return null;
      const txt = await r.text();
      if (!txt || txt.charAt(0) !== '{') return null;
      return txt;
    } catch (e) { return null; }
  }
  // v66：gist raw 在 GitHub CDN 上会缓存数分钟——刚推上去的改动，别的设备读 raw 还是旧内容，
  // 表现就是“明明传上去了，另一边几分钟看不到”。仓库镜像（sync/index.json）走 Contents API
  // 不走 CDN，实测 1.1 秒且永远是最新，所以索引优先读仓库，raw 只做兜底。
  const REPO_INDEX = 'https://api.github.com/repos/GXW-HUE/banwei-workbench/contents/sync/index.json';
  const ghHeaders = { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'User-Agent': 'banwei-workbench-sync' };
  function decodeB64(b64) {
    const bin = atob((b64 || '').replace(/\n/g, ''));
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(arr);
  }
  async function repoIndex() {
    try {
      const r = await fetch(REPO_INDEX + '?ref=main&t=' + Date.now(), { headers: ghHeaders, signal: ctl.signal });
      if (!r.ok) return null;
      const j = await r.json();
      if (!j || !j.content) return null;
      const txt = decodeB64(j.content);
      if (!txt || txt.charAt(0) !== '{') return null;
      return JSON.parse(txt) && txt;
    } catch (e) { return null; }
  }
  async function mirrorIndex(text) {
    try {
      const enc = new TextEncoder().encode(text);
      let bin = '';
      for (let i = 0; i < enc.length; i += 8192) bin += String.fromCharCode.apply(null, enc.subarray(i, i + 8192));
      const content = btoa(bin);
      for (let attempt = 0; attempt < 2; attempt++) {
        let sha = '';
        const g = await fetch(REPO_INDEX + '?ref=main&t=' + Date.now(), { headers: ghHeaders, signal: ctl.signal });
        if (g.ok) { const j = await g.json(); sha = j.sha || ''; }
        const put = await fetch(REPO_INDEX, {
          method: 'PUT', signal: ctl.signal,
          headers: { ...ghHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: 'sync: index ' + new Date().toISOString(), content, sha, branch: 'main' })
        });
        if (put.ok) return true;
        if (put.status !== 409 && put.status !== 422) return false;
      }
      return false;
    } catch (e) { return false; }
  }
  try {
    if (request.method === 'GET' && requestUrl.searchParams.get('index') === '1') {
      const repo = await repoIndex();
      if (repo) return new Response(repo, { headers: jsonCors });
      const fast = await fastRaw('index.json');
      if (fast) return new Response(fast, { headers: jsonCors });
    }
    if (request.method === 'GET' && requestUrl.searchParams.get('file')) {
      const fid = requestUrl.searchParams.get('file');
      if (fid && /^[A-Za-z0-9_-]+$/.test(fid)) {
        const fast = await fastRaw('c_' + fid + '.json');
        if (fast) {
          try {
            const payload = JSON.parse(fast);
            if (payload && typeof payload.content === 'string' && payload.content.length) {
              return new Response(JSON.stringify({ id: fid, content: payload.content }), { headers: jsonCors });
            }
          } catch (e) {}
        }
      }
    }
    let body;
    if (request.method === 'PATCH') {
      if (Number(request.headers.get('Content-Length') || 0) > LIMIT) return new Response('Too large', { status: 413, headers: cors });
      body = await request.text();
      if (new TextEncoder().encode(body).length > LIMIT) return new Response('Too large', { status: 413, headers: cors });
    }
    const upstream = await fetch('https://api.github.com/gists/' + GIST, {
      method: request.method, signal: ctl.signal,
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'User-Agent': 'banwei-workbench-sync' }, body
    });
    // v64：写成功只回 {ok:true}。GitHub 的 PATCH 响应会把整个 gist（含 10MB data.json）回传，
    // 客户端每次等这个几 MB 的大包要花 3-5 秒；小改动（几十 KB）没必要拿回大包。
    // 超过 2MB 的整包写入仍回原始响应，让前端做“存储是否被截断”校验。
    if (!upstream.ok) return new Response(upstream.body, { status: upstream.status, headers: { ...cors, 'Content-Type': 'application/json' } });
    if (request.method !== 'GET') {
      if ((body || '').length <= 2 * 1024 * 1024) {
        // v66：写成功后立刻把索引同步到仓库镜像（后台执行，不拖慢推送），
        // 这样别的设备读索引走 Contents API 就能马上看到最新内容。
        let idxContent = '';
        try {
          const parsed = JSON.parse(body);
          idxContent = (parsed && parsed.files && parsed.files['index.json'] && parsed.files['index.json'].content) || '';
        } catch (e) {}
        if (typeof idxContent === 'string' && idxContent.length) {
          const job = mirrorIndex(idxContent);
          if (typeof waitUntil === 'function') waitUntil(job);
        }
        return new Response(JSON.stringify({ ok: true }), { headers: jsonCors });
      }
      return new Response(upstream.body, { status: upstream.status, headers: { ...cors, 'Content-Type': 'application/json' } });
    }
    const gist = await upstream.json();
    for (const file of Object.values(gist.files || {})) {
      if (!file.truncated) continue;
      const raw = new URL(file.raw_url);
      if (raw.protocol !== 'https:' || raw.hostname !== 'gist.githubusercontent.com') throw new Error('Unexpected raw host');
      const full = await fetch(raw.href, { signal: ctl.signal });
      if (!full.ok) throw new Error('Raw download failed');
      if (Number(full.headers.get('Content-Length') || 0) > LIMIT) throw new Error('Raw file too large');
      file.content = await full.text();
      if (new TextEncoder().encode(file.content).length > LIMIT) throw new Error('Raw file too large');
      file.truncated = false;
    }
    // 轻量索引：只含记录与文件元数据（几十 KB），手机端秒开/秒推用。
    // 优先读 gist 里的 index.json；首次迁移还没有时，从完整 data.json 现裁一份（兼容老数据）。
    if (requestUrl.searchParams.get('index') === '1') {
      const indexFile = gist.files && gist.files['index.json'];
      if (indexFile && typeof indexFile.content === 'string') {
        return new Response(indexFile.content, { headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' } });
      }
      const dataFile = gist.files && gist.files['data.json'];
      if (dataFile && typeof dataFile.content === 'string') {
        const data = JSON.parse(dataFile.content);
        data._fileChunks = {};
        data._metaOnly = true;
        if (Array.isArray(data._files)) {
          data._files = data._files.map(file => {
            const copy = Object.assign({}, file);
            delete copy.content;
            return copy;
          });
        }
        return new Response(JSON.stringify(data), { headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' } });
      }
      return new Response(JSON.stringify({ error: 'index not found' }), { status: 404, headers: { ...cors, 'Content-Type': 'application/json' } });
    }
    const requestedFile = requestUrl.searchParams.get('file');
    if (requestedFile && gist.files) {
      // v63：新增附件的正文放在独立小文件 c_<id>.json 里（上传只需几十 KB，不用背 10MB 整包）
      const extFile = gist.files['c_' + requestedFile + '.json'];
      if (extFile && typeof extFile.content === 'string' && extFile.content.length) {
        try {
          const payload = JSON.parse(extFile.content);
          if (payload && typeof payload.content === 'string' && payload.content.length) {
            return new Response(JSON.stringify({ id: requestedFile, content: payload.content }), { headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' } });
          }
        } catch (e) {}
      }
    }
    if (requestedFile && gist.files && gist.files['data.json'] && typeof gist.files['data.json'].content === 'string') {
      const data = JSON.parse(gist.files['data.json'].content);
      const file = (data._files || []).find(item => item && item.id === requestedFile);
      if (!file) return new Response(JSON.stringify({ error: 'file not found' }), { status: 404, headers: { ...cors, 'Content-Type': 'application/json' } });
      const chunks = data._fileChunks || {};
      let content = typeof file.content === 'string' ? file.content : '';
      if (!content && file.contentChunkCount) {
        for (let i = 0; i < file.contentChunkCount; i++) content += chunks[file.id + '|' + i] || '';
      }
      if (!content || (file.contentLength && content.length !== file.contentLength)) return new Response(JSON.stringify({ error: 'file content incomplete' }), { status: 502, headers: { ...cors, 'Content-Type': 'application/json' } });
      return new Response(JSON.stringify({ id: file.id, content }), { headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' } });
    }
    if (requestUrl.searchParams.get('meta') === '1') {
      const dataFile = gist.files && gist.files['data.json'];
      if (dataFile && typeof dataFile.content === 'string') {
        const data = JSON.parse(dataFile.content);
        data._fileChunks = {};
        data._metaOnly = true;
        if (Array.isArray(data._files)) {
          data._files = data._files.map(file => {
            const copy = Object.assign({}, file);
            if (typeof copy.content === 'string') delete copy.content;
            return copy;
          });
        }
        dataFile.content = JSON.stringify(data);
      }
    }
    return new Response(JSON.stringify(gist), { headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' } });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'Upstream unavailable; local data preserved' }), { status: 502, headers: { ...cors, 'Content-Type': 'application/json' } });
  } finally { clearTimeout(timer); }
}
