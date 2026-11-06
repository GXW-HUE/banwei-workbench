const ALLOWED_ORIGINS = [
  'https://gxw-hue.github.io',
  'https://banwei-sync-api.pages.dev'
];
const OWNER = 'GXW-HUE';
const REPO = 'banwei-workbench';
const BRANCH = 'main';
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
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Max-Age': '86400',
    'Cache-Control': 'no-store',
    'Vary': 'Origin'
  };
  if (echo) headers['Access-Control-Allow-Origin'] = echo;
  return headers;
}

export async function onRequest({ request, env }) {
  const origin = checkOrigin(request);
  const cors = corsHeaders(origin.echo);
  if (!origin.allowed) return new Response('Forbidden', { status: 403, headers: cors });
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: cors });
  const token = env && (env.GITHUB_TOKEN || env.GIST_TOKEN);
  if (!token) return new Response(JSON.stringify({ error: 'Cloud sync credentials are not configured' }), { status: 503, headers: { ...cors, 'Content-Type': 'application/json' } });

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 90000);
  try {
    const rawBody = await request.text();
    if (new TextEncoder().encode(rawBody).length > LIMIT) return new Response('Too large', { status: 413, headers: cors });
    const payload = JSON.parse(rawBody);
    if (!payload || typeof payload.content !== 'string' || !payload.content.length) {
      return new Response(JSON.stringify({ error: 'Missing mirror content' }), { status: 400, headers: { ...cors, 'Content-Type': 'application/json' } });
    }
    const base = `https://api.github.com/repos/${OWNER}/${REPO}/git/`;
    const headers = {
      'Authorization': 'Bearer ' + token,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json',
      'User-Agent': 'banwei-workbench-sync'
    };
    const api = async (path, method = 'GET', body) => {
      const response = await fetch(base + path, {
        method, headers, signal: ctl.signal,
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`GitHub HTTP ${response.status}: ${text.slice(0, 240)}`);
      return JSON.parse(text);
    };
    const ref = await api(`refs/heads/${BRANCH}`);
    const parent = ref && ref.object && ref.object.sha;
    if (!parent) throw new Error('Git branch reference unavailable');
    const parentCommit = await api(`commits/${parent}`);
    const baseTree = parentCommit && parentCommit.tree && parentCommit.tree.sha;
    if (!baseTree) throw new Error('Git base tree unavailable');
    const target = payload.name === 'index.json' ? 'sync/index.json' : 'sync/data.json';
    const entries = [{ path: target, mode: '100644', type: 'blob', content: payload.content }];
    const existing = await api(`trees/${baseTree}?recursive=1`);
    (existing.tree || []).forEach(item => {
      if (item.path && item.path.startsWith('sync/files_blob')) {
        entries.push({ path: item.path, mode: '100644', type: 'blob', sha: null });
      }
    });
    const blob = await api('blobs', 'POST', { content: payload.content, encoding: 'utf-8' });
    if (!blob.sha || (typeof blob.size === 'number' && blob.size !== new TextEncoder().encode(payload.content).length)) {
      throw new Error('Mirror blob validation failed');
    }
    entries[0].sha = blob.sha;
    delete entries[0].content;
    const tree = await api('trees', 'POST', { base_tree: baseTree, tree: entries });
    const commit = await api('commits', 'POST', {
      message: 'sync: data mirror', tree: tree.sha, parents: [parent]
    });
    await api(`refs/heads/${BRANCH}`, 'PATCH', { sha: commit.sha });
    return new Response(JSON.stringify({ success: true, sha: commit.sha }), {
      headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' }
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: String((error && error.message) || error) }), {
      status: 502, headers: { ...cors, 'Content-Type': 'application/json; charset=utf-8' }
    });
  } finally {
    clearTimeout(timer);
  }
}
