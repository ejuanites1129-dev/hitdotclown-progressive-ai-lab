import { createHash } from 'node:crypto';
import { trainPracticeModel, validPlaytestRun } from './train-ai-challenge.mjs';
import { ARCHIVE_FORMAT } from '../src/systems/playtestArchive.js';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const modelIdPattern = /^(?:[a-f0-9]{64}|synthetic-browser-v1)$/;
const roundSources = ['Warm-up', 'Fixed comparison', 'Playtest assignment', 'Trained decision tree', 'Rule-based baseline'];
const modelSources = ['database', 'synthetic', 'file', 'rules'];

function timestamp(value) {
  return typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value)
    && Number.isFinite(Date.parse(value)) ? value : null;
}

export function cleanPlaytest(run) {
  if (!validPlaytestRun(run) || !uuid.test(run.id) || run.synthetic !== undefined
    || run.policy === 'collect' && !run.participant) return null;
  const { format, id, input, policy, participant, sequenceLength, roundSeconds } = run;
  return { format, id, input, policy, participant, sequenceLength, roundSeconds,
    startedAt: timestamp(run.startedAt), finishedAt: timestamp(run.finishedAt),
    modelSource: modelSources.includes(run.modelSource) ? run.modelSource : null,
    modelId: typeof run.modelId === 'string' && modelIdPattern.test(run.modelId) ? run.modelId : null,
    rounds: run.rounds.map(({ speed, completed, correctHits, misses, playMs, meanGapMs, outcome, source, probability }) => ({
      speed, completed, correctHits, misses, playMs, meanGapMs,
      outcome: completed ? 'Cleared' : outcome === 'Out of lives' ? 'Out of lives' : 'Timed out',
      ...(roundSources.includes(source) ? { source } : {}),
      ...(Number.isFinite(probability) && probability >= 0 && probability <= 1 ? { probability } : {}),
    })),
  };
}

export function playtestModelId(runs, input) {
  return createHash('sha256').update('hit-dot-clown-tree-v1\n' + input + '\n' + runs.map(({ id }) => id).join('\n')).digest('hex');
}

export function buildModelSnapshot(runs, input) {
  const { model, evaluation, heldOut } = trainPracticeModel(runs, input);
  const trainingRunIds = [];
  const evaluationRunIds = [];
  for (const run of runs) {
    if (!heldOut.has(run.participant)) trainingRunIds.push(run.id);
    else if (run.policy === 'collect') evaluationRunIds.push(run.id);
  }
  return { model, evaluation, cohort: { trainingRunIds, evaluationRunIds } };
}

export const fixedPlaytestProfile = {
  archiveFormat: ARCHIVE_FORMAT,
  clean: cleanPlaytest,
  modelId: playtestModelId,
  train(runs, input) {
    try { return { training: 'trained', ...buildModelSnapshot(runs, input) }; }
    catch (error) {
      if (error.message !== 'The training participants need both completed and incomplete rounds.') throw error;
      return { training: 'waiting-for-outcomes' };
    }
  },
  localRuns: 'playtest_runs',
  localModels: 'practice_models',
  inputs: ['browser', 'esp32'],
  runTable: 'ai_lab_runs',
  modelTable: 'ai_lab_models',
  snapshot: 'hitdotclown_ai_lab_snapshot',
};
