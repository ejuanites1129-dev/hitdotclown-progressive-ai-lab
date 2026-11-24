import { fixedPlaytestProfile } from '../scripts/playtest-data.mjs';

const insertHeaders = { Prefer: 'resolution=ignore-duplicates,return=minimal' };
function publicModel({ id, trained_at, model, evaluation }) {
  return { id, input: model.input ?? 'browser', trainedAt: trained_at, model, evaluation };
}

export function createOnlinePlaytestStore(env = process.env, fetcher = fetch, profile = fixedPlaytestProfile) {
  const { runTable, modelTable, snapshot, archiveFormat } = profile;
  const input = profile.input ?? 'browser';
  const key = env.AI_LAB_SUPABASE_SECRET_KEY;
  const url = new URL(env.AI_LAB_SUPABASE_URL ?? 'about:blank');
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.supabase.co') || !key) {
    throw new Error('The playtest database is not configured.');
  }

  async function rest(path, { body, headers } = {}) {
    const response = await fetcher(new URL('/rest/v1/' + path, url), {
      method: body === undefined ? 'GET' : 'POST',
      cache: 'no-store',
      headers: { apikey: key, 'Content-Type': 'application/json', ...headers },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(7000),
    });
    if (!response.ok) throw new Error('Supabase playtest request failed.');
    const data = await response.text();
    return data ? JSON.parse(data) : null;
  }

  async function latest() {
    const rows = await rest(modelTable + '?order=coded_runs.desc,trained_at.desc,id.asc&limit=1');
    return rows[0] ?? null;
  }

  async function pageAll(table) {
    const pageSize = 250;
    const rows = [];
    let after;
    do {
      const query = new URLSearchParams({ order: 'id.asc', limit: String(pageSize) });
      if (after) query.set('id', 'gt.' + after);
      const next = await rest(table + '?' + query);
      rows.push(...next);
      if (next.length < pageSize) break;
      after = next.at(-1).id;
    } while (after);
    return rows;
  }

  return {
    async save(run, source) {
      const entry = profile.clean(run);
      if (entry?.input !== input || !['playthrough', 'browser_archive', 'sqlite_import'].includes(source)) return false;
      await rest(runTable + '?on_conflict=id', {
        body: { id: entry.id, participant: entry.participant, policy: entry.policy, capture_source: source, run_data: entry },
        headers: insertHeaders,
      });
      return true;
    },
    async status() {
      let current = await latest();
      const { runs, codedRuns, randomizedPlayers, sessions } = await rest('rpc/' + snapshot, {
        body: { p_known_coded_runs: current?.coded_runs ?? -1 },
      });
      let training = current ? 'trained' : 'waiting-for-players';
      if (sessions) {
        const result = profile.train(sessions, input);
        training = result.training;
        if (training === 'trained') {
          const id = profile.modelId(sessions, input);
          const { model, evaluation, cohort } = result;
          await rest(modelTable + '?on_conflict=id', {
            body: { id, coded_runs: codedRuns, model, evaluation, cohort },
            headers: insertHeaders,
          });
          current = await latest();
        }
      }
      return { [input]: { runs, codedRuns, randomizedPlayers, training, active: current ? publicModel(current) : null } };
    },
    async dataset() {
      const models = await pageAll(modelTable);
      const runs = await pageAll(runTable);
      return { format: archiveFormat, datasetSource: 'Hit Dot Clown AI Lab Supabase', exportedAt: new Date().toISOString(),
        sessions: runs.map(({ run_data, capture_source, saved_at }) => ({ ...run_data, captureSource: capture_source, savedAt: saved_at })),
        models: models.map(({ cohort, ...row }) => ({ ...publicModel(row), ...cohort })),
      };
    },
  };
}
