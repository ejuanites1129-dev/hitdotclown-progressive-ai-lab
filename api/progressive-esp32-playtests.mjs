import { createPlaytestHandler } from './ai-playtests.mjs';
import { createOnlinePlaytestStore } from '../server/supabase-playtests.mjs';
import { progressiveEsp32Profile } from '../scripts/progressive-playtest-data.mjs';

const esp32Playtests = {
  fetch: createPlaytestHandler(() => createOnlinePlaytestStore(process.env, fetch, progressiveEsp32Profile), 128 * 1024, 'esp32'),
};
export default esp32Playtests;
