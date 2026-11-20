export const SUCCESS_MS = 3000;
export const RACE_COUNTDOWN_MS = 4000;
export const FRENZY_DURATION_MS = 10000;
export const FRENZY_FLASH_MS = 150;
// Advance once per visible edge. A delayed frame cannot compress several
// ON/OFF intervals into one apparent steady light.
export class FrenzyFlicker {
  constructor() { this.cancel(); }
  cancel() { this.enabled = false; this.on = false; this.nextAt = 0; }
  begin(now) { this.enabled = true; this.on = true; this.nextAt = now + FRENZY_FLASH_MS; }
  advance(now) {
    if (!this.enabled || now < this.nextAt) return false;
    this.on = !this.on; this.nextAt = now + FRENZY_FLASH_MS;
    return true;
  }
}
export const successLightsOn = (elapsed) => elapsed >= 0 && elapsed < SUCCESS_MS && elapsed % 1000 < 500;
export const randomFlickerDelay = (random = Math.random) => 900 + Math.min(1700, Math.max(0, Math.floor(random() * 1701)));
export class TargetingFlicker {
  constructor() { this.cancel(); }
  cancel() { this.enabled = false; this.active = false; this.on = false; }
  wait(now, delayMs) { Object.assign(this, { enabled: true, active: false, on: false, flashes: 0, nextAt: now + delayMs }); }
  begin(now, anyTarget) { Object.assign(this, { enabled: true, active: true, on: true, target: anyTarget, flashes: 1, nextAt: now + 180 }); }
  advance(now) {
    if (!this.enabled || now < this.nextAt) return null;
    if (!this.active) return 'start';
    this.on = !this.on;
    this.nextAt = now + 180;
    if (this.on) { this.flashes++; return 'on'; }
    if (this.flashes >= 6) { this.active = false; return 'end'; }
    return 'off';
  }
}
