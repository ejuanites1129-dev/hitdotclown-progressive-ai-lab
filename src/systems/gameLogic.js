// Recreated source. Rules follow the integrated ESP32 controller.
import { DEFAULT_ROUND_SECONDS, requireRoundSeconds } from './timerSettings.js';
import { MemoryPlayback } from './memoryPlayback.js';
import { SUCCESS_MS, RACE_COUNTDOWN_MS, FRENZY_DURATION_MS, FrenzyFlicker, successLightsOn, TargetingFlicker, randomFlickerDelay } from './targetingEffects.js';
import { DEFAULT_LIGHT_SECONDS, requireLightSeconds } from './lightSettings.js';
import { progressionForCycle } from './progression.js';
export const STATUS = Object.freeze({
  READY: 'READY', TEST: 'LED TEST', COUNTDOWN: 'COUNTDOWN', MEMORY: 'MEMORY PHASE', PLAYER: 'PLAYER TURN',
  HIT: 'HIT!', WRONG: 'WRONG TARGET', BREAK: 'ROUND BREAK', FRENZY: 'FRENZY', OVER: 'GAME OVER', VICTORY: 'VICTORY',
});
export const ROUND_BREAK_MS = SUCCESS_MS + RACE_COUNTDOWN_MS;
export const FRENZY_SECONDS = FRENZY_DURATION_MS / 1000;
export const FRENZY_HIT_COOLDOWN_MS = 180;
export const shouldTriggerFrenzy = (random = Math.random) => random() < 1 / 5;
export const canStart = (status) => [STATUS.READY, STATUS.OVER, STATUS.VICTORY].includes(status);
export const initialState = (roundSeconds = DEFAULT_ROUND_SECONDS) => ({
  status: STATUS.READY, score: 0, time: roundSeconds, roundSeconds, lives: 3, ...progressionForCycle(),
  playerPosition: 0, countdown: 0, frenzyHits: 0, activeTarget: null,
  feedbackTarget: null, correct: null,
});
export function generateSequence(random = Math.random, previous = [], length = 3) {
  const sequence = Array.from({ length }, () => Math.min(4, Math.max(0, Math.floor(random() * 5))) + 1);
  // Draw a new pattern, and prevent an accidental replay of the old prefix.
  if (previous.length && previous.every((target, index) => sequence[index] === target)) {
    const offset = 1 + Math.min(3, Math.max(0, Math.floor(random() * 4)));
    sequence[0] = (sequence[0] - 1 + offset) % 5 + 1;
  }
  return sequence;
}
export function applyDeviceEvent(state, event) {
  if (event.type === 'sequence-review') return { ...state, review: { correct: event.correct, performed: event.performed, positions: event.positions } };
  if (event.type === 'state') {
    return { ...state, ...event, ...(event.status === STATUS.READY || event.status === STATUS.COUNTDOWN ? { review: null } : {}), activeTarget: [STATUS.MEMORY, STATUS.PLAYER].includes(event.status) ? state.activeTarget : null,
      feedbackTarget: [STATUS.HIT, STATUS.WRONG].includes(event.status) ? state.feedbackTarget : null };
  }
  if (event.type === 'target-active') {
    return { ...state, activeTarget: event.active === false
      ? (state.activeTarget === event.target ? null : state.activeTarget) : event.target };
  }
  if (event.type === 'sensor-hit') {
    return { ...state, feedbackTarget: event.target, correct: event.correct ?? null };
  }
  if (event.type === 'score') return { ...state, score: event.score ?? event.value };
  if (event.type === 'game-over' || event.type === 'victory') {
    return { ...state, status: event.type === 'victory' ? STATUS.VICTORY : STATUS.OVER, activeTarget: null };
  }
  return state;
}
export class DemoGame {
  constructor({ random = Math.random, frenzyRandom = Math.random, distractionRandom = Math.random, now = () => performance.now(), roundSeconds = DEFAULT_ROUND_SECONDS, lightSeconds = DEFAULT_LIGHT_SECONDS } = {}) {
    this.random = random;
    this.frenzyRandom = frenzyRandom;
    this.distractionRandom = distractionRandom;
    this.now = now;
    this.roundSeconds = requireRoundSeconds(roundSeconds);
    this.lightSeconds = requireLightSeconds(lightSeconds);
    this.reset();
  }
  reset() {
    this.state = initialState(this.roundSeconds);
    this.sequence = [];
    this.deadline = 0;
    this.nextEvent = 0;
    this.memoryPlayback = new MemoryPlayback();
    this.flicker = new TargetingFlicker();
    this.frenzyFlicker = new FrenzyFlicker();
    this.breakEndsAt = 0;
    this.pendingFrenzy = false;
    this.performed = [];
    this.positions = [];
    this.ledCheckEndsAt = 0;
    return this.snapshot();
  }
  snapshot() { return { ...this.state }; }
  setLightSeconds(seconds) {
    requireLightSeconds(seconds);
    if (!canStart(this.state.status)) throw new Error('Finish or reset the game before changing light duration.');
    this.lightSeconds = seconds;
    return this.snapshot();
  }
  testLeds() {
    if (!canStart(this.state.status)) throw new Error('Finish or reset the game before testing lights.');
    this.testReturnStatus = this.state.status;
    this.state.status = STATUS.TEST;
    this.startLedCheck(this.now());
    return this.snapshot();
  }
  startLedCheck(now) { this.ledCheckEndsAt = now + 800; this.state.ledTesting = true; }
  captureReview() { this.state.review = { correct: this.sequence.slice(0, this.state.sequenceLength), performed: [...this.performed], positions: [...this.positions] }; }
  setRoundSeconds(seconds) {
    requireRoundSeconds(seconds);
    if (!canStart(this.state.status)) throw new Error('Finish or reset the game before changing its timer.');
    this.roundSeconds = seconds;
    if (this.state.status === STATUS.READY) this.state = initialState(seconds);
    return this.snapshot();
  }
  start() {
    if (!canStart(this.state.status)) return this.snapshot();
    this.reset();
    this.sequence = generateSequence(this.random);
    this.state.status = STATUS.COUNTDOWN;
    this.state.countdown = 3;
    this.countdownEndsAt = this.now() + 3000;
    this.startLedCheck(this.now());
    return this.snapshot();
  }
  beginMemory(now, timerStartedAt = now) {
    Object.assign(this.state, { status: STATUS.MEMORY, breakPhase: '', phaseMs: 0, allTargetsOn: false, countdown: 0, frenzyHits: 0, time: this.roundSeconds, roundSeconds: this.roundSeconds, playerPosition: 0,
      activeTarget: null, feedbackTarget: null, correct: null });
    this.flicker.cancel();
    this.frenzyFlicker.cancel();
    this.memoryPlayback.begin(now, this.state.sequenceLength, 0, Math.round(this.lightSeconds * 1000));
    this.performed = [];
    this.positions = [];
    this.state.ledTesting = false;
    this.deadline = timerStartedAt + this.roundSeconds * 1000;
  }
  beginFrenzy(now) {
    this.flicker.cancel();
    this.frenzyFlicker.begin(now);
    Object.assign(this.state, { status: STATUS.FRENZY, breakPhase: '', phaseMs: 0, allTargetsOn: true, countdown: 0, time: FRENZY_SECONDS, frenzyHits: 0,
      activeTarget: null, feedbackTarget: null, correct: null });
    this.frenzyEndsAt = now + FRENZY_SECONDS * 1000;
    this.lastFrenzyHitAt = now - FRENZY_HIT_COOLDOWN_MS;
  }
  beginRoundBreak(now) {
    this.flicker.cancel();
    Object.assign(this.state, { status: STATUS.BREAK, breakPhase: 'success', phaseMs: 0, allTargetsOn: true, ledTesting: false, countdown: 3,
      activeTarget: null, feedbackTarget: null, correct: null });
    this.breakStartedAt = now;
    this.breakEndsAt = now + SUCCESS_MS;
  }
  beginRaceCountdown(now) {
    this.frenzyFlicker.cancel();
    Object.assign(this.state, { status: STATUS.BREAK, breakPhase: 'countdown', phaseMs: 0, allTargetsOn: false, countdown: 4,
      activeTarget: null, feedbackTarget: null, correct: null });
    this.breakStartedAt = now;
    this.breakEndsAt = now + RACE_COUNTDOWN_MS;
  }
  updateTargetingFlicker(now) {
    if (!this.state.hardMode) { this.flicker.cancel(); this.state.activeTarget = null; return; }
    const event = this.flicker.advance(now);
    if (event === 'start') {
      // No exclusions: the current/expected target is just as eligible as any other.
      this.flicker.begin(now, 1 + Math.min(4, Math.max(0, Math.floor(this.distractionRandom() * 5))));
      this.state.activeTarget = this.flicker.target;
    } else if (event === 'on') this.state.activeTarget = this.flicker.target;
    else if (event === 'off' || event === 'end') {
      this.state.activeTarget = null;
      if (event === 'end') this.flicker.wait(now, randomFlickerDelay(this.distractionRandom));
    }
  }
  finishCompletedSequence(now) {
    const s = this.state;
    Object.assign(s, progressionForCycle(s.cycle + 1));
    this.sequence = generateSequence(this.random, this.sequence, s.sequenceLength);
    this.beginMemory(now);
  }
  tick(now = this.now()) {
    const s = this.state;
    if (s.ledTesting && now >= this.ledCheckEndsAt) s.ledTesting = false;
    if (s.status === STATUS.TEST) {
      if (now >= this.ledCheckEndsAt + 400) s.status = this.testReturnStatus;
      return this.snapshot();
    }
    if (s.status === STATUS.BREAK) {
      s.phaseMs = Math.min(now - this.breakStartedAt, s.breakPhase === 'success' ? SUCCESS_MS : RACE_COUNTDOWN_MS);
      s.allTargetsOn = s.breakPhase === 'success' && successLightsOn(s.phaseMs);
      s.countdown = Math.max(0, Math.ceil((this.breakEndsAt - now) / 1000));
      if (s.countdown > 0) return this.snapshot();
      if (s.breakPhase === 'success') {
        const frenzy = this.pendingFrenzy;
        this.pendingFrenzy = false;
        if (frenzy) { this.beginFrenzy(now); return this.snapshot(); }
        this.beginRaceCountdown(this.breakEndsAt);
        return this.tick(now);
      }
      this.finishCompletedSequence(now);
    }
    if (s.status === STATUS.FRENZY) {
      s.time = Math.max(0, Math.ceil((this.frenzyEndsAt - now) / 1000));
      if (s.time === 0) {
        this.beginRaceCountdown(this.frenzyEndsAt); return this.tick(now);
      }
      this.frenzyFlicker.advance(now);
      s.allTargetsOn = this.frenzyFlicker.on;
      return this.snapshot();
    }
    if (s.status === STATUS.COUNTDOWN) {
      s.countdown = Math.max(0, Math.ceil((this.countdownEndsAt - now) / 1000));
      if (s.countdown === 0) this.beginMemory(now, this.countdownEndsAt);
      else return this.snapshot();
    }
    // A valid final hit has already completed this round. Its success feedback
    // must not consume the last fraction of time and turn completion into a loss.
    const completedFeedback = s.status === STATUS.HIT && s.playerPosition >= s.sequenceLength;
    if ([STATUS.MEMORY, STATUS.PLAYER, STATUS.HIT, STATUS.WRONG].includes(s.status) && !completedFeedback) {
      s.time = Math.max(0, Math.ceil((this.deadline - now) / 1000));
      if (s.time === 0) {
        this.captureReview();
        this.memoryPlayback.cancel();
        this.flicker.cancel();
        Object.assign(s, { status: STATUS.OVER, activeTarget: null, feedbackTarget: null });
        return this.snapshot();
      }
    }
    if (s.status === STATUS.MEMORY) {
      const cue = this.memoryPlayback.advance(now);
      if (cue) {
        s.activeTarget = cue.kind === 'sequence-on' ? this.sequence[cue.position] : null;
        if (cue.finished) {
          s.status = STATUS.PLAYER;
          if (s.hardMode) this.flicker.wait(now, randomFlickerDelay(this.distractionRandom));
        }
      }
    } else if ([STATUS.HIT, STATUS.WRONG].includes(s.status) && now >= this.nextEvent) {
      s.feedbackTarget = null;
      if (s.lives <= 0) { s.status = STATUS.OVER; this.captureReview(); }
      else {
        s.status = STATUS.PLAYER;
        if (s.hardMode) this.flicker.wait(now, randomFlickerDelay(this.distractionRandom));
      }
    }
    if (s.status === STATUS.PLAYER) this.updateTargetingFlicker(now);
    return this.snapshot();
  }
  hit(target) {
    const now = this.now();
    this.tick(now);
    const s = this.state;
    if (!Number.isInteger(target) || target < 1 || target > 5) return this.snapshot();
    if (s.status === STATUS.FRENZY) {
      if (now - this.lastFrenzyHitAt < FRENZY_HIT_COOLDOWN_MS) return this.snapshot();
      this.lastFrenzyHitAt = now;
      s.score += 10;
      s.frenzyHits++;
      return this.snapshot();
    }
    if (s.status !== STATUS.PLAYER) {
      return this.snapshot();
    }
    const correct = target === this.sequence[s.playerPosition];
    this.flicker.cancel();
    s.activeTarget = null;
    this.performed.push(target);
    this.positions.push(s.playerPosition);
    s.score = correct ? s.score + 10 : Math.max(0, s.score - 5);
    s.lives -= correct ? 0 : 1;
    s.playerPosition += correct ? 1 : 0;
    if (correct && s.playerPosition >= s.sequenceLength) {
      this.pendingFrenzy = shouldTriggerFrenzy(this.frenzyRandom);
      this.beginRoundBreak(now);
      return this.snapshot();
    }
    Object.assign(s, { status: correct ? STATUS.HIT : STATUS.WRONG, feedbackTarget: target, correct });
    this.nextEvent = now + 450;
    return this.snapshot();
  }
}
