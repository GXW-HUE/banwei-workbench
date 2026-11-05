const ORIGIN = 'https://gxw-hue.github.io';
const GIST = '1a9cbefeb7b98260e552c057924d67ae';
const LIMIT = 20 * 1024 * 1024;
const cors = { 'Access-Control-Allow-Origin': ORIGIN, 'Access-Control-Allow-Methods': 'GET, PATCH, OPTIONS', 'Access-Control-Allow-Headers': 'Accept, Authorization, Content-Type', 'Cache-Control': 'no-store', 'Vary': 'Origin' };
export async function onRequest({request, params, env}) {
  if (request.headers.get('Origin') !== ORIGIN) return new Response('Forbidden', {status:403});
  if (params.id !== GIST) return new Response('Not found', {status:404,headers:cors});
  if (request.method === 'OPTIONS') return new Response(null,{status:204,headers:cors});
  if (!['GET','PATCH'].includes(request.method)) return new Response('Method not allowed',{status:405,headers:cors});
  const token = env && env.GIST_TOKEN;
  if (!token) return new Response(JSON.stringify({error:'Cloud sync credentials are not configured'}),{status:503,headers:{...cors,'Content-Type':'application/json'}});
  const ctl = new AbortController();
  const timer = setTimeout(()=>ctl.abort(),90000);
  try {
    let body;
    if (request.method === 'PATCH') {
      if (Number(request.headers.get('Content-Length') || 0) > LIMIT) return new Response('Too large',{status:413,headers:cors});
      body = await request.text();
      if (new TextEncoder().encode(body).length > LIMIT) return new Response('Too large',{status:413,headers:cors});
    }
    const upstream = await fetch('https://api.github.com/gists/' + GIST, {
      method:request.method, signal:ctl.signal,
      headers: {Authorization:'Bearer '+token,Accept:'application/vnd.github+json','Content-Type':'application/json','User-Agent':'banwei-workbench-sync'}, body
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
    const requestUrl = new URL(request.url);
    const requestedFile = requestUrl.searchParams.get('file');
    if (requestedFile && gist.files && gist.files['data.json'] && typeof gist.files['data.json'].content === 'string') {
      const data = JSON.parse(gist.files['data.json'].content);
      const file = (data._files || []).find(item => item && item.id === requestedFile);
      if (!file) return new Response(JSON.stringify({error:'file not found'}), {status:404, headers:{...cors,'Content-Type':'application/json'}});
      const chunks = data._fileChunks || {};
      let content = typeof file.content === 'string' ? file.content : '';
      if (!content && file.contentChunkCount) {
        for (let i = 0; i < file.contentChunkCount; i++) content += chunks[file.id + '|' + i] || '';
      }
      if (!content || (file.contentLength && content.length !== file.contentLength)) return new Response(JSON.stringify({error:'file content incomplete'}), {status:502, headers:{...cors,'Content-Type':'application/json'}});
      return new Response(JSON.stringify({id:file.id, content}), {headers:{...cors,'Content-Type':'application/json; charset=utf-8'}});
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
    return new Response(JSON.stringify(gist),{headers:{...cors,'Content-Type':'application/json; charset=utf-8'}});
  } catch { return new Response(JSON.stringify({error:'Upstream unavailable; local data preserved'}),{status:502,headers:{...cors,'Content-Type':'application/json'}}); }
  finally { clearTimeout(timer); }
}
