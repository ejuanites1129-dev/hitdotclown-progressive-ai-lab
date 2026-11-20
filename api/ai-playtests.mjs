import { createOnlinePlaytestStore } from '../server/supabase-playtests.mjs';

const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export function createPlaytestHandler(openStore = createOnlinePlaytestStore, maxBodyBytes = 16 * 1024) {
  return async function handle(request) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');
    if ((origin && origin !== url.origin) || request.headers.get('Sec-Fetch-Site') === 'cross-site') {
      return json({ error: 'Use AI Carnival Challenge on its own page.' }, 403);
    }
    if (request.method === 'GET') {
      if (url.searchParams.has('export')) return json({ error: 'Dataset export is available to the study operator.' }, 403);
      try { return json(await openStore().status()); }
      catch { return json({ error: 'The playtest database is temporarily unavailable.' }, 503); }
    }
    if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
    if (!/^application\/json(?:;|$)/i.test(request.headers.get('Content-Type') ?? '')) {
      return json({ error: 'Expected a JSON playthrough.' }, 415);
    }
    if (Number(request.headers.get('Content-Length')) > maxBodyBytes) return json({ error: 'Playthrough is too large.' }, 413);
    let incoming;
    try {
      const payload = await request.text();
      if (Buffer.byteLength(payload) > maxBodyBytes) return json({ error: 'Playthrough is too large.' }, 413);
      incoming = JSON.parse(payload);
    } catch { return json({ error: 'Could not read the playthrough.' }, 400); }
    if (incoming?.run?.input !== 'browser' || !['playthrough', 'browser_archive'].includes(incoming?.source)) {
      return json({ error: 'Invalid browser playthrough.' }, 422);
    }
    try {
      const saved = await openStore().save(incoming.run, incoming.source);
      return saved ? json({ saved }) : json({ error: 'Invalid browser playthrough.' }, 422);
    } catch { return json({ error: 'Could not save this playthrough.' }, 503); }
  };
}

const playtests = { fetch: createPlaytestHandler() };
export default playtests;
