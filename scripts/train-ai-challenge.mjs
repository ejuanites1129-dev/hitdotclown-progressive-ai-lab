import { readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PARTICIPANT_CODE, PRACTICE_SECONDS, ROUND_COUNT, TREE_FEATURES, predictionFeatures, predictCompletion } from '../src/systems/aiPractice.js';
import { ARCHIVE_FORMAT, PLAYTEST_FORMAT } from '../src/systems/playtestArchive.js';

const positiveRate = (rows) => rows.filter(({ completed }) => completed).length / rows.length;
const impurity = (rows) => { const rate = positiveRate(rows); return 2 * rate * (1 - rate); };
const groupKey = (code) => createHash('sha256').update(code).digest('hex');

export function fitTree(rows, depth = 0, features = TREE_FEATURES) {
  const probability = positiveRate(rows);
  const leaf = { probability };
  if (depth >= 3 || rows.length < 8 || probability === 0 || probability === 1) return leaf;
  let best = null;
  let gain = 0;
  for (const feature of features) {
    const values = [...new Set(rows.map((row) => row.features[feature]))].sort((first, second) => first - second);
    for (let index = 1; index < values.length; index++) {
      const threshold = (values[index - 1] + values[index]) / 2;
      const left = rows.filter((row) => row.features[feature] <= threshold);
      const right = rows.filter((row) => row.features[feature] > threshold);
      if (left.length < 4 || right.length < 4) continue;
      const improvement = impurity(rows) - (left.length * impurity(left) + right.length * impurity(right)) / rows.length;
      if (improvement > gain + 1e-9) { best = { feature, threshold, left, right }; gain = improvement; }
    }
  }
  return best ? { feature: best.feature, threshold: best.threshold, left: fitTree(best.left, depth + 1, features), right: fitTree(best.right, depth + 1, features) } : leaf;
}

function validRound(round) {
  const inRange = (value, max) => Number.isInteger(value) && value >= 0 && value <= max;
  return round && inRange(round.speed, 2) && typeof round.completed === 'boolean'
    && inRange(round.correctHits, 3) && round.completed === (round.correctHits === 3)
    && inRange(round.misses, 3) && inRange(round.playMs, PRACTICE_SECONDS * 1000 + 1000)
    && (round.meanGapMs === null || inRange(round.meanGapMs, PRACTICE_SECONDS * 1000 + 1000));
}

export function validPlaytestRun(session) {
  return session?.format === PLAYTEST_FORMAT
    && ['browser', 'esp32'].includes(session.input)
    && (session.participant === null || typeof session.participant === 'string' && PARTICIPANT_CODE.test(session.participant))
    && ['collect', 'fixed', 'adaptive'].includes(session.policy)
    && typeof session.id === 'string' && session.sequenceLength === 3 && session.roundSeconds === PRACTICE_SECONDS
    && Array.isArray(session.rounds) && session.rounds.length === ROUND_COUNT && session.rounds.every(validRound)
    && session.rounds.slice(0, 2).every(({ speed }) => speed === 1)
    && (session.policy !== 'collect' || new Set(session.rounds.slice(2).map(({ speed }) => speed)).size === 3)
    && (session.policy !== 'fixed' || session.rounds.every(({ speed }) => speed === 1))
    && (session.policy !== 'adaptive' || session.rounds.every(({ speed }, index) => index < 2 || Math.abs(speed - session.rounds[index - 1].speed) <= 1));
}

export function trainingExamples(sessions, input) {
  const ids = new Set();
  return sessions.filter((session) => session?.input === input && session.participant != null).flatMap((session) => {
    if (!validPlaytestRun(session)) {
      throw new Error('Invalid playtest run. Use the game’s unedited JSON exports.');
    }
    if (ids.has(session.id)) return [];
    ids.add(session.id);
    return session.rounds.slice(2).map((round, index) => ({
      participant: session.participant,
      policy: session.policy,
      features: predictionFeatures(session.rounds[index + 1], round.speed),
      completed: round.completed,
    }));
  });
}

export function trainPracticeModel(sessions, input) {
  const matching = sessions.filter((session) => session?.input === input && session.participant != null);
  const syntheticCount = matching.filter((session) => session.synthetic === true).length;
  if (syntheticCount && syntheticCount < matching.length) throw new Error('Keep synthetic and real playtests in separate training exports.');
  const rows = trainingExamples(sessions, input);
  const randomized = rows.filter(({ policy }) => policy === 'collect');
  const groups = [...new Set(randomized.map(({ participant }) => participant))].sort((first, second) => groupKey(first).localeCompare(groupKey(second)));
  if (groups.length < 5) throw new Error('Collect a complete Randomized pace run from at least five distinct participants for this input before training.');
  const heldOut = new Set(groups.slice(0, Math.max(1, Math.ceil(groups.length / 5))));
  const training = rows.filter(({ participant }) => !heldOut.has(participant));
  const testing = randomized.filter(({ participant }) => heldOut.has(participant));
  const rate = positiveRate(training);
  if (rate === 0 || rate === 1) throw new Error('The training participants need both completed and incomplete rounds.');
  const tree = fitTree(training);
  const speedBaseline = [0, 1, 2].map((speed) => positiveRate(training.filter((row) => row.features.speed === speed)));
  const evaluate = (predict) => {
    const confusion = { truePositive: 0, trueNegative: 0, falsePositive: 0, falseNegative: 0 };
    let brier = 0;
    for (const row of testing) {
      const probability = predict(row);
      const predicted = probability >= 0.5;
      confusion[row.completed ? (predicted ? 'truePositive' : 'falseNegative') : (predicted ? 'falsePositive' : 'trueNegative')]++;
      brier += (probability - Number(row.completed)) ** 2;
    }
    return { accuracy: (confusion.truePositive + confusion.trueNegative) / testing.length, brier: brier / testing.length, confusion };
  };
  return {
    model: { format: 'hit-dot-clown-tree-v1', input, tree, ...(syntheticCount ? { synthetic: true } : {}) },
    heldOut,
    evaluation: {
      trainingParticipants: new Set(training.map(({ participant }) => participant)).size, heldOutParticipants: heldOut.size,
      trainingRounds: training.length, heldOutRounds: testing.length, heldOutCleared: testing.filter(({ completed }) => completed).length,
      trainingByMode: { randomized: training.filter(({ policy }) => policy === 'collect').length,
        adaptive: training.filter(({ policy }) => policy === 'adaptive').length,
        fixed: training.filter(({ policy }) => policy === 'fixed').length },
      tree: evaluate((row) => predictCompletion(tree, row.features)),
      speedOnlyBaseline: evaluate((row) => speedBaseline[row.features.speed]),
    },
  };
}

async function readPlaytests(path) {
  if ((await stat(path)).size > 16 * 1024 * 1024) throw new Error('Playtest export exceeds 16 MB. Train with a smaller batch of exports.');
  const data = JSON.parse(await readFile(path, 'utf8'));
  if (data?.format === PLAYTEST_FORMAT) return [data];
  if (data?.format === ARCHIVE_FORMAT && Array.isArray(data.sessions)) return data.sessions;
  throw new Error('Invalid export format. Use Export saved runs or Download round data.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const [source, input, output] = process.argv.slice(2);
    if (!source || !['browser', 'esp32'].includes(input) || !output) throw new Error('Usage: node scripts/train-ai-challenge.mjs <export.json|export-folder> <browser|esp32> <new-model.json>');
    const files = (await stat(source)).isDirectory()
      ? (await readdir(source, { withFileTypes: true })).filter((entry) => entry.isFile() && entry.name.startsWith('hit-dot-clown-') && entry.name.endsWith('.json'))
        .map(({ name }) => resolve(source, name))
      : [source];
    const sessions = (await Promise.all(files.map(readPlaytests))).flat();
    const { model, evaluation } = trainPracticeModel(sessions, input);
    await writeFile(output, JSON.stringify(model, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify(evaluation, null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
