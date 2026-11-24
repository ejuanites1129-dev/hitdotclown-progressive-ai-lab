import { createHash } from 'node:crypto';
import { PARTICIPANT_CODE, predictCompletion } from '../src/systems/aiPractice.js';
import { PROGRESSIVE_ARCHIVE, PROGRESSIVE_FEATURES, PROGRESSIVE_MODEL, PROGRESSIVE_RUN,
  progressiveFeatures } from '../src/systems/progressivePractice.js';
import { validRoundSeconds } from '../src/systems/timerSettings.js';
import { fitTree } from './train-ai-challenge.mjs';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const hash = (value) => createHash('sha256').update(value).digest('hex');
const integer = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
const sources = ['Warm-up', 'Fixed medium pace', 'Randomized pace', 'Playtest-trained model', 'Simulated-data model', 'Rule-based pace'];

export function progressiveRunData(run, synthetic = false, expectedInput = 'browser') {
  const acceptedInputs = Array.isArray(expectedInput) ? expectedInput : [expectedInput];
  if (run?.format !== PROGRESSIVE_RUN || typeof run.id !== 'string' || !uuid.test(run.id)
    || (synthetic ? run.synthetic !== true : run.synthetic !== undefined)
    || !acceptedInputs.includes(run.input) || !validRoundSeconds(run.roundSeconds)
    || !['adaptive', 'collect', 'fixed'].includes(run.policy)
    || !(run.participant === null || typeof run.participant === 'string' && PARTICIPANT_CODE.test(run.participant))
    || run.policy === 'collect' && !run.participant || !integer(run.score, 0, Number.MAX_SAFE_INTEGER)
    || !Array.isArray(run.rounds) || !run.rounds.length) return null;
  let lives = 3;
  const rounds = [];
  for (const [index, round] of run.rounds.entries()) {
    const length = index + 3;
    if (!round || round.sequenceLength !== length || !integer(round.speed, 0, 2)
      || (index === 0 || run.policy === 'fixed') && round.speed !== 1
      || round.livesAtStart !== lives || !integer(round.livesLeft, 0, lives) || round.misses !== lives - round.livesLeft
      || !integer(round.correctHits, 0, length) || !integer(round.playMs, 0, run.roundSeconds * 1000)
      || round.completed !== (index < run.rounds.length - 1) || round.completed !== (round.correctHits === length)
      || round.completed && round.livesLeft === 0) return null;
    const { sequenceLength, speed, livesAtStart, livesLeft, correctHits, misses, playMs, completed, outcome, source, probability } = round;
    lives = livesLeft;
    rounds.push({ sequenceLength, speed, livesAtStart, livesLeft, correctHits, misses, playMs, completed,
      outcome: completed ? 'Cleared' : outcome === 'Out of lives' ? 'Out of lives' : 'Timed out',
      ...(sources.includes(source) ? { source } : {}),
      ...(typeof probability === 'number' && probability >= 0 && probability <= 1 ? { probability } : {}),
    });
  }
  const date = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
  const { format, input, policy, participant, id, roundSeconds, score } = run;
  return { format, input, policy, participant, id: id.toLowerCase(), roundSeconds, score, rounds,
    startedAt: date(run.startedAt), finishedAt: date(run.finishedAt),
    modelId: typeof run.modelId === 'string' && /^[a-f0-9]{64}$/.test(run.modelId) ? run.modelId : null,
    ...(synthetic ? { synthetic: true } : {}),
  };
}

export function progressiveExamples(sessions) {
  return sessions.flatMap((run) => run.participant === null ? [] : run.rounds.slice(1).map((round, index) => ({
    runId: run.id, participant: run.participant, policy: run.policy, input: run.input, completed: round.completed,
    synthetic: run.synthetic === true,
    features: progressiveFeatures(run.rounds[index], { ...round, input: run.input, roundSeconds: run.roundSeconds }),
  })));
}

export function progressiveModelId(runs, input = 'browser') {
  return hash(PROGRESSIVE_MODEL + '\n' + input + '\n' + runs.map(({ id }) => id).join('\n'));
}

const bounds = (rows, feature) => {
  const values = rows.map(({ features }) => features[feature]);
  return [Math.min(...values), Math.max(...values)];
};

export function trainProgressive(runs, synthetic = false, input = 'browser') {
  const allowMixed = synthetic === 'mixed';
  const acceptedInputs = input === 'combined' ? ['browser', 'esp32'] : [input];
  const sessions = runs.map((run) => {
    const isSynthetic = allowMixed ? run?.synthetic === true : synthetic;
    const cleaned = progressiveRunData(run, isSynthetic, acceptedInputs);
    if (!cleaned) throw new Error('Invalid or mixed-provenance progressive playthrough.');
    return cleaned;
  });
  const rows = progressiveExamples(sessions);
  const randomized = rows.filter(({ policy, synthetic: isSynthetic }) => policy === 'collect'
    && (allowMixed ? !isSynthetic : isSynthetic === synthetic));
  const players = [...new Set(randomized.map(({ participant }) => participant))].sort((a, b) => hash(a).localeCompare(hash(b)));
  if (players.length < 5) return { training: 'waiting-for-players' };
  const heldOut = new Set(players.slice(0, Math.ceil(players.length / 5)));
  const testing = randomized.filter(({ participant }) => heldOut.has(participant));
  const realTrainingRandomized = allowMixed
    ? randomized.filter(({ participant }) => !heldOut.has(participant))
    : randomized.filter(({ participant }) => !heldOut.has(participant));
  if (!realTrainingRandomized.some(({ completed }) => completed) || realTrainingRandomized.every(({ completed }) => completed)) {
    return { training: 'waiting-for-outcomes' };
  }
  const training = allowMixed
    ? [...rows.filter(({ synthetic: isSynthetic }) => isSynthetic),
      ...rows.filter(({ synthetic: isSynthetic, participant }) => !isSynthetic && !heldOut.has(participant))]
    : rows.filter(({ participant }) => !heldOut.has(participant));
  const tree = fitTree(training, 0, PROGRESSIVE_FEATURES);
  const lengthRates = new Map();
  for (const { features: { sequenceLength }, completed } of training) {
    const counts = lengthRates.get(sequenceLength) ?? [0, 0];
    counts[0] += Number(completed);
    counts[1]++;
    lengthRates.set(sequenceLength, counts);
  }
  const average = training.filter(({ completed }) => completed).length / training.length;
  function evaluate(predict) {
    const confusion = { truePositive: 0, falseNegative: 0, falsePositive: 0, trueNegative: 0 };
    let brier = 0;
    for (const { features, completed } of testing) {
      const probability = predict(features);
      confusion[completed ? (probability >= 0.5 ? 'truePositive' : 'falseNegative')
        : (probability >= 0.5 ? 'falsePositive' : 'trueNegative')]++;
      brier += (probability - Number(completed)) ** 2;
    }
    return { accuracy: (confusion.truePositive + confusion.trueNegative) / testing.length, brier: brier / testing.length, confusion };
  }
  const [minSequenceLength, maxSequenceLength] = bounds(training, 'sequenceLength');
  const [minRoundSeconds, maxRoundSeconds] = bounds(training, 'roundSeconds');
  const containsSynthetic = sessions.some(({ synthetic: isSynthetic }) => isSynthetic);
  const containsReal = sessions.some(({ synthetic: isSynthetic }) => !isSynthetic);
  const model = { format: PROGRESSIVE_MODEL, input, tree, coverage: { minSequenceLength, maxSequenceLength, minRoundSeconds, maxRoundSeconds },
    ...(containsSynthetic ? { synthetic: true, provenance: containsReal ? 'synthetic-seeded' : 'simulated' } : {}) };
  const evaluation = {
    trainingParticipants: new Set(training.map(({ participant }) => participant)).size,
    trainingRealParticipants: new Set(training.filter(({ synthetic: isSynthetic }) => !isSynthetic).map(({ participant }) => participant)).size,
    trainingSyntheticParticipants: new Set(training.filter(({ synthetic: isSynthetic }) => isSynthetic).map(({ participant }) => participant)).size,
    heldOutParticipants: heldOut.size, trainingRounds: training.length, heldOutRounds: testing.length,
    heldOutCleared: testing.filter(({ completed }) => completed).length,
    evaluationProvenance: allowMixed ? 'held-out real randomized participants' : synthetic ? 'held-out simulated participants' : 'held-out real randomized participants',
    tree: evaluate((features) => predictCompletion(tree, features)),
    lengthOnlyBaseline: evaluate(({ sequenceLength }) => {
      const counts = lengthRates.get(sequenceLength);
      return counts ? counts[0] / counts[1] : average;
    }),
  };
  return { training: 'trained', model, evaluation, cohort: {
    trainingRunIds: [...new Set(training.map(({ runId }) => runId))],
    evaluationRunIds: [...new Set(testing.map(({ runId }) => runId))],
  } };
}

function createProgressiveProfile(input) {
  const combined = input === 'combined';
  return {
  input,
  archiveFormat: PROGRESSIVE_ARCHIVE,
  clean: (run, synthetic = false) => progressiveRunData(run, synthetic, combined ? ['browser', 'esp32'] : input),
  modelId: (runs) => progressiveModelId(runs, input),
  train: (runs) => trainProgressive(runs, combined ? 'mixed' : false, input),
  localRuns: 'progressive_runs',
  localModels: 'progressive_models',
  inputs: combined ? ['browser', 'esp32'] : [input],
  requireSecondCycle: true,
  runTables: combined ? ['ai_progressive_runs', 'ai_progressive_esp32_runs'] : [`ai_progressive${input === 'esp32' ? '_esp32' : ''}_runs`],
  runTableFor: combined ? (run) => run.input === 'esp32' ? 'ai_progressive_esp32_runs' : 'ai_progressive_runs' : null,
  modelTable: 'ai_progressive_models',
  modelInput: input,
  snapshot: 'hitdotclown_progressive_snapshot',
  };
}

export const progressiveProfile = createProgressiveProfile('combined');
export const progressiveEsp32Profile = progressiveProfile;
