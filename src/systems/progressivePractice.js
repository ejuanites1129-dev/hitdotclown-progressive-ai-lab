import { DemoGame, STATUS } from './gameLogic.js';
import { MEMORY_TIMING } from './memoryPlayback.js';
import { SPEEDS, predictCompletion } from './aiPractice.js';
import { readArchivedRuns, saveArchivedRun } from './playtestArchive.js';

export const PROGRESSIVE_RUN = 'hit-dot-clown-progressive-run-v1';
export const PROGRESSIVE_ARCHIVE = 'hit-dot-clown-progressive-archive-v1';
export const PROGRESSIVE_MODEL = 'hit-dot-clown-progressive-tree-v1';
export const PROGRESSIVE_FEATURES = Object.freeze([
  'sequenceLength', 'speed', 'livesAtStart', 'previousSpeed', 'previousMisses', 'previousMsPerHit', 'roundSeconds',
]);
const storagePrefix = 'hit-dot-clown-progressive-playtest:';
export const readProgressiveArchive = (storage) => readArchivedRuns(storage, storagePrefix, PROGRESSIVE_ARCHIVE,
  (run) => run?.format === PROGRESSIVE_RUN && Array.isArray(run.rounds) && run.rounds.length > 0);
export const saveProgressiveRun = (storage, run) => saveArchivedRun(storage, storagePrefix, run);

export function progressiveFeatures(previous, { sequenceLength, speed, livesAtStart, roundSeconds }) {
  return { sequenceLength, speed, livesAtStart, roundSeconds,
    previousSpeed: previous.speed, previousMisses: previous.misses,
    previousMsPerHit: Math.round(previous.playMs / Math.max(1, previous.correctHits) / 250) * 250,
  };
}

export function chooseProgressivePace({ previous, sequenceLength, livesAtStart, roundSeconds, policy, model, random, input = 'browser' }) {
  if (!previous) return { speed: 1, source: 'Warm-up' };
  if (policy === 'fixed') return { speed: 1, source: 'Fixed medium pace' };
  const possible = SPEEDS.flatMap(({ ms }, speed) => {
    const minimumMs = sequenceLength * ms + (sequenceLength - 1) * (MEMORY_TIMING.gap + 450);
    return minimumMs < roundSeconds * 1000 ? [speed] : [];
  });
  const available = possible.length ? possible : [2];
  if (policy === 'collect') return { speed: available[Math.floor(random() * available.length)], source: 'Randomized pace' };
  const nearby = available.filter((speed) => Math.abs(speed - previous.speed) <= 1);
  const choices = nearby.length ? nearby : available;
  const coverage = model?.coverage;
  if (model?.format === PROGRESSIVE_MODEL && model.input === input && sequenceLength >= coverage?.minSequenceLength
    && sequenceLength <= coverage?.maxSequenceLength && roundSeconds >= coverage?.minRoundSeconds && roundSeconds <= coverage?.maxRoundSeconds) {
    const [best] = choices.map((speed) => ({
      speed, probability: predictCompletion(model.tree, progressiveFeatures(previous, { sequenceLength, speed, livesAtStart, roundSeconds })),
    })).sort((a, b) => Math.abs(a.probability - 0.7) - Math.abs(b.probability - 0.7)
      || Math.abs(a.speed - previous.speed) - Math.abs(b.speed - previous.speed));
    return { ...best, source: model.synthetic ? 'Simulated-data model' : 'Playtest-trained model' };
  }
  const desired = previous.speed + (previous.misses || livesAtStart === 1 ? -1 : previous.playMs / previous.correctHits < 950 ? 1 : 0);
  const [speed] = choices.sort((a, b) => Math.abs(a - desired) - Math.abs(b - desired));
  return { speed, source: 'Rule-based pace' };
}

export class ProgressiveGame extends DemoGame {
  constructor({ policy = 'adaptive', model = null, paceRandom = Math.random, ...options } = {}) {
    super(options);
    this.policy = policy;
    this.model = model;
    this.paceRandom = paceRandom;
  }

  reset() {
    const state = super.reset();
    this.rounds = [];
    this.current = null;
    return state;
  }

  beginMemory(now, timerStartedAt = now) {
    const { sequenceLength, lives } = this.state;
    const pace = chooseProgressivePace({ previous: this.rounds.at(-1), sequenceLength, livesAtStart: lives,
      roundSeconds: this.roundSeconds, policy: this.policy, model: this.model, random: this.paceRandom });
    this.lightSeconds = SPEEDS[pace.speed].ms / 1000;
    this.current = { sequenceLength, livesAtStart: lives, turnStarted: null, ...pace };
    super.beginMemory(now, timerStartedAt);
    this.state.pace = pace;
  }

  tick(now = this.now()) {
    const state = super.tick(now);
    if (state.status === STATUS.PLAYER && this.current?.turnStarted === null) this.current.turnStarted = now;
    if (state.status === STATUS.OVER && this.current) this.finishCycle(false, now);
    return state;
  }

  hit(target) {
    const state = super.hit(target);
    if (state.status === STATUS.BREAK && this.current) this.finishCycle(true, this.now());
    return state;
  }

  finishCycle(completed, now) {
    const { turnStarted, ...round } = this.current;
    const { lives, time, playerPosition } = this.state;
    this.rounds.push({ ...round, completed, livesLeft: lives, correctHits: playerPosition,
      misses: round.livesAtStart - lives, playMs: Math.min(this.roundSeconds * 1000, Math.max(0, Math.round(now - (turnStarted ?? now)))),
      outcome: completed ? 'Cleared' : time === 0 ? 'Timed out' : 'Out of lives' });
    this.current = null;
  }
}
