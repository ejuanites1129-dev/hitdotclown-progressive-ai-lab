import { createPlaytestHandler } from './ai-playtests.mjs';
import { createOnlinePlaytestStore } from '../server/supabase-playtests.mjs';
import { progressiveProfile } from '../scripts/progressive-playtest-data.mjs';

const progressivePlaytests = {
  fetch: createPlaytestHandler(() => createOnlinePlaytestStore(process.env, fetch, progressiveProfile), 128 * 1024),
};
export default progressivePlaytests;
