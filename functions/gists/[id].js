const ORIGIN = 'https://gxw-hue.github.io';
const GIST = '1a9cbefeb7b98260e552c057924d67ae';
const UPSTREAM = 'https://banwei-workbench-sync.3596098158.workers.dev';
const LIMIT = 20 * 1024 * 1024;
const cors = { 'Access-Control-Allow-Origin': ORIGIN, 'Access-Control-Allow-Methods': 'GET, PATCH, OPTIONS', 'Access-Control-Allow-Headers': 'Accept, Authorization, Content-Type', 'Cache-Control': 'no-store', 'Vary': 'Origin' };
export async function onRequest({request, params}) {
  if (request.headers.get('Origin') !== ORIGIN) return new Response('Forbidden', {status:403});
  if (params.id !== GIST) return new Response('Not found', {status:404,headers:cors});
  if (request.method === 'OPTIONS') return new Response(null,{status:204,headers:cors});
  if (!['GET','PATCH'].includes(request.method)) return new Response('Method not allowed',{status:405,headers:cors});
  const ctl = new AbortController();
  const timer = setTimeout(()=>ctl.abort(),90000);
  try {
    let body;
    if (request.method === 'PATCH') {
      if (Number(request.headers.get('Content-Length') || 0) > LIMIT) return new Response('Too large',{status:413,headers:cors});
      body = await request.text();
      if (new TextEncoder().encode(body).length > LIMIT) return new Response('Too large',{status:413,headers:cors});
    }
    const authorization = request.headers.get('Authorization');
    const upstream = await fetch(authorization ? 'https://api.github.com/gists/' + GIST : UPSTREAM + '/gists/' + GIST, {
      method:request.method, signal:ctl.signal,
      headers: authorization ? {Authorization:authorization,Accept:'application/vnd.github+json','Content-Type':'application/json','User-Agent':'banwei-workbench-sync'} : {Origin:ORIGIN,Accept:'application/json','Content-Type':'application/json'}, body
    });
    if (!upstream.ok || request.method !== 'GET') return new Response(upstream.body,{status:upstream.status,headers:{...cors,'Content-Type':'application/json'}});
    const gist = await upstream.json();
    for (const file of Object.values(gist.files || {})) {
      if (!file.truncated) continue;
      const raw = new URL(file.raw_url);
      if (raw.protocol !== 'https:' || raw.hostname !== 'gist.githubusercontent.com') throw new Error('Unexpected raw host');
      const full = await fetch(raw.href,{signal:ctl.signal});
      if (!full.ok) throw new Error('Raw download failed');
      if (Number(full.headers.get('Content-Length') || 0) > LIMIT) throw new Error('Raw file too large');
      file.content = await full.text();
      if (new TextEncoder().encode(file.content).length > LIMIT) throw new Error('Raw file too large');
      file.truncated = false;
    }
    return new Response(JSON.stringify(gist),{headers:{...cors,'Content-Type':'application/json; charset=utf-8'}});
  } catch { return new Response(JSON.stringify({error:'Upstream unavailable; local data preserved'}),{status:502,headers:{...cors,'Content-Type':'application/json'}}); }
  finally { clearTimeout(timer); }
}
