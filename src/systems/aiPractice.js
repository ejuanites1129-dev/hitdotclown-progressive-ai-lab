import { STATUS } from './gameLogic.js';

export const ROUND_COUNT = 5;
export const PRACTICE_SECONDS = 20;
export const SPEEDS = Object.freeze([
  { label: 'Slow', ms: 1000 },
  { label: 'Medium', ms: 650 },
  { label: 'Fast', ms: 350 },
]);
export const TREE_FEATURES = ['speed', 'previousSpeed', 'correctHits', 'misses', 'playMs', 'meanGapMs'];
export const PARTICIPANT_CODE = /^P(?:[0-9]{3,5}|-[0-9A-F]{8})$/;

export function createParticipantCode(uuid = crypto.randomUUID()) {
  return 'P-' + uuid.slice(0, 8).toUpperCase();
}

export function randomSpeedOrder(random = Math.random) {
  const order = [0, 1, 2];
  for (let index = order.length - 1; index > 0; index--) {
    const pick = Math.floor(random() * (index + 1));
    [order[index], order[pick]] = [order[pick], order[index]];
  }
  return order;
}

export function predictionFeatures(previous, speed) {
  return { speed, previousSpeed: previous.speed, correctHits: previous.correctHits,
    misses: previous.misses, playMs: previous.playMs, meanGapMs: previous.meanGapMs ?? PRACTICE_SECONDS * 1000 };
}

export function validatePracticeModel(model, input) {
  function validNode(node, depth) {
    if (!node || typeof node !== 'object' || depth > 4) return false;
    if ('probability' in node) return Number.isFinite(node.probability) && node.probability >= 0 && node.probability <= 1;
    return TREE_FEATURES.includes(node.feature) && Number.isFinite(node.threshold)
      && validNode(node.left, depth + 1) && validNode(node.right, depth + 1);
  }
  return model?.format === 'hit-dot-clown-tree-v1' && model.input === input && validNode(model.tree, 0);
}

export function predictCompletion(tree, features) {
  while (!Object.hasOwn(tree, 'probability')) tree = features[tree.feature] <= tree.threshold ? tree.left : tree.right;
  return tree.probability;
}

export function selectChallenge(history, { policy, model, order }) {
  if (history.length < 2) return { speed: 1, source: 'Warm-up', reason: 'Everyone starts with two medium rounds.' };
  if (policy === 'fixed') return { speed: 1, source: 'Fixed comparison', reason: 'Flash speed stays the same in this run.' };
  if (policy === 'collect') return { speed: order[history.length - 2], source: 'Playtest assignment', reason: 'This run tests all three speeds in a random order.' };
  const previous = history.at(-1);
  if (model) {
    const estimates = SPEEDS.map((_, speed) => ({
      speed, probability: predictCompletion(model.tree, predictionFeatures(previous, speed)),
    }));
    const [choice] = estimates.filter(({ speed }) => Math.abs(speed - previous.speed) <= 1)
      .sort((first, second) => Math.abs(first.probability - 0.7) - Math.abs(second.probability - 0.7)
        || Math.abs(first.speed - previous.speed) - Math.abs(second.speed - previous.speed));
    return { ...choice, source: 'Trained decision tree', reason: 'Selected a nearby pace with an estimated clear chance closest to 70%.' };
  }
  const ease = !previous.completed || previous.misses >= 2;
  const challenge = previous.completed && previous.misses === 0 && previous.playMs <= 6000;
  const speed = Math.max(0, Math.min(2, previous.speed + (ease ? -1 : challenge ? 1 : 0)));
  const reason = ease ? 'The last round was unfinished or had multiple misses.'
    : challenge ? 'You cleared the last sequence quickly without a miss.' : 'Your last result was steady at this pace.';
  return { speed, reason, source: 'Rule-based baseline' };
}

export class PracticeRound {
  constructor(challenge) {
    this.challenge = challenge;
    this.turnStarted = null;
    this.hits = [];
    this.result = null;
  }
  hit(correct, now) {
    if (!this.result && this.turnStarted !== null && typeof correct === 'boolean') this.hits.push({ correct, now });
  }
  observe(state, now) {
    if (this.result) return null;
    if (state.status === STATUS.PLAYER && this.turnStarted === null) this.turnStarted = now;
    if (state.status !== STATUS.BREAK && state.status !== STATUS.OVER) return null;
    const correctHits = this.hits.filter(({ correct }) => correct).length;
    const last = this.hits.at(-1);
    const playEnd = state.status === STATUS.BREAK && last ? last.now : now;
    const meanGapMs = this.hits.length > 1 ? Math.round((last.now - this.hits[0].now) / (this.hits.length - 1)) : null;
    this.result = {
      ...this.challenge, completed: state.status === STATUS.BREAK, correctHits, misses: this.hits.length - correctHits,
      playMs: Math.max(0, Math.round(playEnd - (this.turnStarted ?? playEnd))), meanGapMs,
      outcome: state.status === STATUS.BREAK ? 'Cleared' : state.time === 0 ? 'Timed out' : 'Out of lives',
    };
    return this.result;
  }
}

export function replayTip(rounds) {
  if (rounds.every(({ correctHits, misses }) => !correctHits && !misses)) return 'Start at medium speed. Wait for “Your turn,” then tap each remembered target in order.';
  const speeds = SPEEDS.map(({ label }, speed) => ({
    label, speed, attempts: rounds.filter((round) => round.speed === speed).length,
    clears: rounds.filter((round) => round.speed === speed && round.completed).length,
  })).filter(({ attempts, clears }) => attempts && clears);
  const [strongest] = speeds.sort((first, second) => second.clears / second.attempts - first.clears / first.attempts
    || second.clears - first.clears || second.speed - first.speed);
  const misses = rounds.reduce((total, { misses }) => total + misses, 0);
  const timeouts = rounds.filter(({ outcome }) => outcome === 'Timed out').length;
  const focus = misses >= 3 ? 'Say the three numbers to yourself before hitting the first target.'
    : timeouts ? 'Once the preview ends, start with the first target as soon as you remember it.'
    : 'Try a faster preview once you can repeat that pace without misses.';
  return (strongest ? 'You cleared ' + strongest.clears + ' of ' + strongest.attempts + ' rounds at ' + strongest.label.toLowerCase() + ' speed. '
    : 'Try another run at slow speed. ') + focus;
}
