export const MEMORY_TIMING = Object.freeze({ steady: 650, gap: 280, flickerOn: 180, flickerOff: 180, flashes: 3 });

export function createDistraction(sequence, random = Math.random) {
  if (sequence.length < 2) throw new RangeError('A distraction needs at least two sequence steps.');
  const pick = (count) => Math.min(count - 1, Math.max(0, Math.floor(random() * count)));
  const beforeStep = 1 + pick(sequence.length - 1);
  const neighbors = [sequence[beforeStep - 1], sequence[beforeStep]];
  const candidates = [1, 2, 3, 4, 5].filter((target) => !neighbors.includes(target));
  return { beforeStep, target: candidates[pick(candidates.length)] };
}

// Keep the transitions in sync with the two firmware MemoryPlayback.h copies.
export class MemoryPlayback {
  constructor() { this.cancel(); }
  cancel() { this.position = 0; this.length = 0; this.sequenceOn = false; this.decoyActive = false; this.decoyOn = false; }
  begin(now, length, decoyBefore, steadyMs = MEMORY_TIMING.steady) {
    Object.assign(this, { position: 0, length, decoyBefore, flashes: 0, nextAt: now,
      steadyMs, sequenceOn: false, decoyActive: false, decoyOn: false, decoyPlayed: false });
  }
  advance(now) {
    if (this.position >= this.length || now < this.nextAt) return null;
    if (this.decoyActive) {
      if (this.decoyOn) {
        this.decoyOn = false;
        if (this.flashes === MEMORY_TIMING.flashes) {
          this.decoyActive = false;
          this.decoyPlayed = true;
          this.nextAt = now + MEMORY_TIMING.gap;
        } else this.nextAt = now + MEMORY_TIMING.flickerOff;
        return { kind: 'decoy-off', position: this.position, finished: false };
      }
      this.decoyOn = true;
      this.flashes++;
      this.nextAt = now + MEMORY_TIMING.flickerOn;
      return { kind: 'decoy-on', position: this.position, finished: false };
    }
    if (!this.sequenceOn) {
      if (!this.decoyPlayed && this.position === this.decoyBefore && this.position > 0) {
        this.decoyActive = true;
        this.decoyOn = true;
        this.flashes = 1;
        this.nextAt = now + MEMORY_TIMING.flickerOn;
        return { kind: 'decoy-on', position: this.position, finished: false };
      }
      this.sequenceOn = true;
      this.nextAt = now + this.steadyMs;
      return { kind: 'sequence-on', position: this.position, finished: false };
    }
    this.sequenceOn = false;
    const position = this.position++;
    this.nextAt = now + MEMORY_TIMING.gap;
    return { kind: 'sequence-off', position, finished: this.position >= this.length };
  }
}
