import { AUDIO_FILES, AUDIO_VOLUME } from './audioConfig.js';

const tones = { raceCountdown: [440, 440, 440, 880], roundComplete: [523, 659, 784, 1047], warning: [880], frenzy: [660, 880, 660, 1040], start: [220, 330, 440], hit: [520, 780], wrong: [180, 125],
  timeout: [260, 190, 110], gameover: [190, 110], victory: [440, 660, 880] };
export class AudioManager {
  constructor({ files = AUDIO_FILES, volume = AUDIO_VOLUME, createAudio = (src) => new Audio(src) } = {}) {
    this.files = files;
    this.volume = volume;
    this.createAudio = createAudio;
    this.enabled = true;
    this.unlocked = false;
    this.context = null;
    this.music = null;
    this.playing = false;
    this.effects = new Set();
    this.effectTimers = new Set();
    this.generation = 0;
  }
  setEnabled(enabled) {
    this.enabled = enabled;
    if (!enabled) {
      this.music?.pause();
      this.stopEffects();
    } else this.startMusic();
  }
  async unlock() {
    this.unlocked = true;
    // HTML media playback must start in the click handler, before awaiting
    // AudioContext.resume(), so browsers retain the user activation.
    this.startMusic();
    const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
    try {
      if (AudioContext) {
        this.context ??= new AudioContext();
        if (this.context.state === 'suspended') await this.context.resume();
      }
    } catch { /* Audio is optional; browser policy may require another click. */ }
  }
  setPlaying(playing) {
    this.playing = playing;
    if (playing) this.startMusic();
    else if (this.music) { this.music.pause(); this.music.currentTime = 0; }
  }
  startMusic() {
    if (!this.enabled || !this.unlocked || !this.playing || !this.files.background) return;
    if (!this.music) {
      this.music = this.createAudio(this.files.background);
      this.music.loop = true;
      this.music.volume = this.volume.background;
    }
    if (this.music.paused) this.music.play().catch(() => {});
  }
  playTimed(name, durationMs, offsetMs = 0) { this.play(name, { durationMs, offsetMs }); }
  play(name, { durationMs, offsetMs = 0 } = {}) {
    if (!this.enabled || !this.unlocked) return;
    if (durationMs !== undefined && offsetMs >= durationMs) return;
    const src = this.files[name];
    if (!src) { this.playTone(name); return; }
    const audio = this.createAudio(src);
    if (offsetMs > 0) audio.currentTime = offsetMs / 1000;
    const generation = this.generation;
    let failed = false;
    audio.volume = this.volume.effects;
    this.effects.add(audio);
    const fallback = () => {
      this.effects.delete(audio);
      if (!failed && generation === this.generation) {
        failed = true;
        this.playTone(name);
      }
    };
    audio.addEventListener('error', fallback, { once: true });
    audio.addEventListener('ended', () => this.effects.delete(audio), { once: true });
    audio.play().catch(fallback);
    if (durationMs !== undefined) {
      const timer = setTimeout(() => {
        this.effectTimers.delete(timer);
        audio.pause(); this.effects.delete(audio);
      }, Math.max(0, durationMs - offsetMs));
      this.effectTimers.add(timer);
    }
  }
  playTone(name) {
    if (!this.enabled || !this.context || this.context.state !== 'running') return;
    const now = this.context.currentTime;
    (tones[name] || tones.hit).forEach((frequency, index) => {
      const oscillator = this.context.createOscillator();
      const gain = this.context.createGain();
      const start = now + index * (name === 'raceCountdown' ? 1 : name === 'roundComplete' ? .7 : .11);
      const length = name === 'raceCountdown' ? index === 3 ? .85 : .2 : name === 'roundComplete' ? .75 : .16;
      oscillator.type = name === 'wrong' ? 'sawtooth' : 'square';
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.06, start + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
      oscillator.connect(gain).connect(this.context.destination);
      oscillator.start(start);
      oscillator.stop(start + length + .02);
    });
  }
  stopEffects() {
    for (const timer of this.effectTimers) clearTimeout(timer);
    this.effectTimers.clear();
    this.generation++;
    for (const audio of this.effects) { audio.pause(); audio.currentTime = 0; }
    this.effects.clear();
  }
  stop() { this.setPlaying(false); this.stopEffects(); }
}
export const audioManager = new AudioManager();
export default audioManager;
