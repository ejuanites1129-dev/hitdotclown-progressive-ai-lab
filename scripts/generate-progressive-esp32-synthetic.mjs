import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SPEEDS } from '../src/systems/aiPractice.js';
import { DEFAULT_ROUND_SECONDS } from '../src/systems/timerSettings.js';
import { PROGRESSIVE_ARCHIVE, PROGRESSIVE_MODEL, PROGRESSIVE_RUN, progressiveFeatures } from '../src/systems/progressivePractice.js';
import { progressiveExamples, progressiveModelId, trainProgressive } from './progressive-playtest-data.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const seed = 20261125;
const participantCount = 300;
const maxCycles = 18;
const roundSeconds = DEFAULT_ROUND_SECONDS;
const provenance = 'Deterministic simulated ESP32-style playthroughs. No humans, physical ESP32 signals, or live database records are included.';

function seededRandom(initialSeed) {
  let value = initialSeed >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let next = value;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

function normal(random) {
  const first = Math.max(Number.EPSILON, random());
  return Math.sqrt(-2 * Math.log(first)) * Math.cos(2 * Math.PI * random());
}

function uuidFromSeed(value) {
  const digits = createHash('sha256').update(value).digest('hex').slice(0, 32).split('');
  digits[12] = '4';
  digits[16] = ((Number.parseInt(digits[16], 16) & 0x3) | 0x8).toString(16);
  const hex = digits.join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function clamp(value, low, high) {
  return Math.max(low, Math.min(high, value));
}

function completionChance({ sequenceLength, speed, livesAtStart, previousSpeed, previousMisses, previousMsPerHit }, skill, cycle) {
  const logit = 2.0 + 1.35 * skill
    - 0.2 * (sequenceLength - 4)
    - 0.9 * speed
    + 0.22 * (livesAtStart - 2)
    - 0.6 * previousMisses
    - 0.6 * Math.max(0, (previousMsPerHit - 900) / 1000)
    - 0.025 * cycle
    + 0.08 * ((previousSpeed ?? 1) - 1);
  return 1 / (1 + Math.exp(-logit));
}

function sampleCount(random, count, probability) {
  let value = 0;
  for (let index = 0; index < count; index++) if (random() < probability) value++;
  return value;
}

function generateRun(participantNumber, random) {
  const participant = `P-FFFF${participantNumber.toString(16).padStart(4, '0').toUpperCase()}`;
  const skill = clamp(normal(random) * 0.8, -1.8, 1.8);
  const reactionBase = clamp(900 - skill * 170 + normal(random) * 55, 430, 1350);
  let lives = 3;
  let previous = null;
  const rounds = [];

  for (let cycle = 0; cycle < maxCycles; cycle++) {
    const sequenceLength = cycle + 3;
    const speed = cycle === 0 ? 1 : Math.floor(random() * SPEEDS.length);
    const previousMsPerHit = previous
      ? Math.round(previous.playMs / Math.max(1, previous.correctHits) / 250) * 250
      : 1000;
    const chance = completionChance({ sequenceLength, speed, livesAtStart: lives,
      previousSpeed: previous?.speed, previousMisses: previous?.misses ?? 0, previousMsPerHit }, skill, cycle);
    const completed = random() < chance;
    const speedDifficulty = [0, 0.035, 0.07][speed];
    const targetErrorRate = clamp(0.055 + speedDifficulty + (sequenceLength - 3) * 0.003 - skill * 0.012, 0.015, 0.22);
    const reactionMs = clamp(reactionBase + speed * 65 + normal(random) * 50, 350, 1600);
    let misses;
    let livesLeft;
    let correctHits;
    let playMs;
    let outcome;

    if (completed) {
      misses = Math.min(Math.max(0, lives - 1), sampleCount(random, sequenceLength, targetErrorRate));
      livesLeft = lives - misses;
      correctHits = sequenceLength;
      playMs = Math.min(roundSeconds * 1000, Math.round(sequenceLength * reactionMs + (sequenceLength - 1) * 65 + random() * 450));
      outcome = 'Cleared';
    } else if (lives > 0 && random() < 0.64) {
      misses = lives;
      livesLeft = 0;
      correctHits = Math.floor(random() * sequenceLength);
      playMs = Math.min(roundSeconds * 1000 - 1,
        Math.round((correctHits + misses) * reactionMs + random() * 1600));
      outcome = 'Out of lives';
    } else {
      misses = Math.floor(random() * lives);
      livesLeft = lives - misses;
      correctHits = Math.floor(random() * sequenceLength);
      playMs = roundSeconds * 1000;
      outcome = 'Timed out';
    }

    const round = { sequenceLength, speed, source: cycle === 0 ? 'Warm-up' : 'Randomized pace',
      livesAtStart: lives, livesLeft, correctHits, misses, playMs, completed, outcome };
    rounds.push(round);
    if (!completed) break;
    lives = livesLeft;
    previous = round;
  }

  if (rounds.at(-1)?.completed) throw new Error('Synthetic run reached its simulation limit without a terminal outcome.');
  const score = rounds.reduce((total, round) => total + round.correctHits * 10 - round.misses * 5, 0);
  return { format: PROGRESSIVE_RUN, id: uuidFromSeed(`${seed}:session:${participant}`), input: 'esp32', participant,
    policy: 'collect', roundSeconds, score: Math.max(0, score), rounds, synthetic: true };
}

function csvCell(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

async function main() {
  const random = seededRandom(seed);
  const sessions = Array.from({ length: participantCount }, (_, index) => generateRun(index + 1, random));
  const trained = trainProgressive(sessions, true, 'esp32');
  if (trained.training !== 'trained') throw new Error(`Synthetic training did not complete: ${trained.training}`);

  const examples = progressiveExamples(sessions);
  const model = { ...trained.model, id: progressiveModelId(sessions, 'esp32'), seed,
    provenance, trainingExamples: examples.length,
    evaluation: trained.evaluation };
  const dataset = { format: PROGRESSIVE_ARCHIVE, synthetic: true, seed, input: 'esp32', policy: 'collect',
    provenance, assumptions: {
      participants: participantCount,
      roundSeconds,
      startingLives: 3,
      startingSequenceLength: 3,
      sequenceGrowthPerClear: 1,
      paceMilliseconds: SPEEDS.map(({ ms }) => ms),
      randomizedPace: 'Uniformly sampled among slow, medium, and fast after the medium warm-up cycle.',
      playerVariation: 'Each simulated participant receives a distinct latent accuracy and reaction-time profile.',
      outcomeFactors: ['Longer sequences and faster previews reduce simulated clear probability.',
        'Remaining lives, previous misses, reaction time, and prior pace also influence simulated outcomes.'],
      trainingSplit: 'The trainer holds out whole participant codes so rounds from the same simulated player do not appear in both training and evaluation.',
    },
    trainingSummary: { syntheticRuns: sessions.length,
      playersWithAtLeastTwoCycles: new Set(examples.map(({ participant }) => participant)).size,
      trainingExamples: examples.length, evaluation: trained.evaluation },
    sessions };

  const rows = [['synthetic', 'participant', 'session_id', 'cycle', 'sequence_length', 'speed_index', 'speed_label',
    'lives_at_start', 'previous_speed', 'previous_misses', 'previous_ms_per_hit', 'round_seconds',
    'correct_hits', 'misses', 'play_ms', 'completed', 'outcome']];
  for (const session of sessions) {
    for (let index = 1; index < session.rounds.length; index++) {
      const round = session.rounds[index];
      const features = progressiveFeatures(session.rounds[index - 1], { ...round, roundSeconds });
      rows.push([true, session.participant, session.id, index + 1, features.sequenceLength, features.speed,
        SPEEDS[features.speed].label, features.livesAtStart, features.previousSpeed, features.previousMisses,
        features.previousMsPerHit, features.roundSeconds, round.correctHits, round.misses, round.playMs,
        round.completed, round.outcome]);
    }
  }
  const csv = rows.map((row) => row.map(csvCell).join(',')).join('\n') + '\n';
  const dataPath = resolve(root, 'datasets', 'progressive-esp32-synthetic-playtests.json');
  const csvPath = resolve(root, 'datasets', 'progressive-esp32-synthetic-training.csv');
  const modelPath = resolve(root, 'src', 'systems', 'models', 'progressive-esp32-synthetic-demo.json');
  const seedPath = resolve(root, 'supabase', 'seed-progressive-esp32-synthetic.sql');
  const insertValues = sessions.map((session, index) => {
    const delimiter = `$seed_run_${String(index + 1).padStart(4, '0')}$`;
    return `  ('${session.id}', '${session.participant}', 'collect', 'synthetic_seed', ${delimiter}${JSON.stringify(session)}${delimiter}::jsonb)`;
  }).join(',\n');
  const seedSql = [
    '-- Generated synthetic seed records for HitDotClown AI Lab.',
    '-- Run after schema.sql. Rows are explicitly marked synthetic and do not count as real playtesters.',
    '-- Safe to rerun: duplicate run IDs are ignored.',
    'begin;',
    'insert into public.ai_progressive_esp32_runs (id, participant, policy, capture_source, run_data)',
    'values',
    insertValues,
    'on conflict (id) do nothing;',
    'commit;',
    '',
  ].join('\n');
  for (const path of [dataPath, csvPath, modelPath, seedPath]) await mkdir(dirname(path), { recursive: true });
  await Promise.all([
    writeFile(dataPath, JSON.stringify(dataset, null, 2) + '\n'),
    writeFile(csvPath, csv),
    writeFile(modelPath, JSON.stringify(model, null, 2) + '\n'),
    writeFile(seedPath, seedSql),
  ]);
  console.log(JSON.stringify({ dataset: 'datasets/progressive-esp32-synthetic-playtests.json',
    csv: 'datasets/progressive-esp32-synthetic-training.csv',
    model: 'src/systems/models/progressive-esp32-synthetic-demo.json',
    supabaseSeedSql: 'supabase/seed-progressive-esp32-synthetic.sql',
    syntheticParticipants: participantCount, syntheticRuns: sessions.length,
    trainingExamples: examples.length, modelId: model.id, evaluation: model.evaluation }, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
