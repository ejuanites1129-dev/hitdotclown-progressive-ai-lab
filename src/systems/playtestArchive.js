import { PRACTICE_SECONDS, ROUND_COUNT } from './aiPractice.js';

export const PLAYTEST_FORMAT = 'hit-dot-clown-playtest-v1';
export const ARCHIVE_FORMAT = 'hit-dot-clown-playtest-archive-v1';
const prefix = 'hit-dot-clown-ai-playtest:';

export function completedPlaytest(session, rounds) {
  if (rounds.length !== ROUND_COUNT) throw new Error('Finish all five rounds before saving a run.');
  return { format: PLAYTEST_FORMAT, ...session, sequenceLength: 3, roundSeconds: PRACTICE_SECONDS, rounds };
}

export function savePlaytest(storage, run) {
  saveArchivedRun(storage, prefix, run);
}

export function readPlaytestArchive(storage) {
  return readArchivedRuns(storage, prefix, ARCHIVE_FORMAT,
    (value) => value?.format === PLAYTEST_FORMAT && value.rounds?.length === ROUND_COUNT);
}

export function saveArchivedRun(storage, storagePrefix, run) {
  storage.setItem(storagePrefix + run.id, JSON.stringify(run));
}

export function readArchivedRuns(storage, storagePrefix, format, include) {
  const sessions = [];
  for (let index = 0; index < storage.length; index++) {
    const key = storage.key(index);
    if (!key?.startsWith(storagePrefix)) continue;
    try {
      const value = JSON.parse(storage.getItem(key));
      if (include(value) && storagePrefix + value.id === key) sessions.push(value);
    } catch {
      continue;
    }
  }
  return { format, sessions };
}
