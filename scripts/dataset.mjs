import { writeFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { createOnlinePlaytestStore } from '../server/supabase-playtests.mjs';
import { progressiveProfile } from './progressive-playtest-data.mjs';

try {
  const [action, path] = process.argv.slice(2);
  if (!path || !['export', 'import-sqlite'].includes(action)) {
    throw new Error('Choose export or import-sqlite and supply the file path.');
  }
  const store = createOnlinePlaytestStore(process.env, fetch, progressiveProfile);
  if (action === 'export') {
    const data = await store.dataset();
    await writeFile(path, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
    console.log(`Exported ${data.sessions.length} browser runs and ${data.models.length} model versions.`);
  } else {
    const db = new DatabaseSync(path, { readOnly: true });
    let runs;
    try { runs = db.prepare("SELECT run_json FROM progressive_runs WHERE input = 'browser' ORDER BY id").all(); }
    finally { db.close(); }
    let accepted = 0;
    for (const { run_json } of runs) if (await store.save(JSON.parse(run_json), 'sqlite_import')) accepted++;
    const { browser } = await store.status();
    console.log(`Processed ${accepted} browser runs. Cloud total ${browser.runs}. Training status ${browser.training}.`);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
