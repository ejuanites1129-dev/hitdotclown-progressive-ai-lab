import { AudioManager } from './audioManager.js';

// Music/loop ownership is separate from one-shot scoring effects.
export class SoundtrackManager extends AudioManager {
  constructor(options) {
    super(options);
    this.scene = 'silent';
    this.tracks = new Map();
    this.musicKey = null;
    this.listeners = new Set();
    this.status = { state: 'waiting', track: null, message: '' };
    this.warningWanted = false;
    this.warningSeconds = 0;
    this.warningTrack = null;
    this.warningRunning = false;
    this.warningFailed = false;
    this.warningInterval = null;
  }
  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.status);
    return () => this.listeners.delete(listener);
  }
  report(state, message = '') {
    const track = this.sceneKey();
    if (this.status.state === state && this.status.track === track && this.status.message === message) return;
    this.status = { state, track, message };
    for (const listener of this.listeners) listener(this.status);
  }
  prepareMusic() {
    for (const key of ['idle', 'background', 'frenzyMusic']) {
      if (!this.files[key] || this.tracks.has(key)) continue;
      const audio = this.createAudio(this.files[key]);
      audio.loop = true;
      audio.preload = 'auto';
      const track = { audio, failed: false, pending: false, attempt: 0 };
      audio.addEventListener('error', () => {
        track.failed = true;
        if (this.music === audio && this.enabled) this.report('error', 'Music could not load. Click Retry sound to try again.');
      });
      this.tracks.set(key, track);
      audio.load?.();
    }
  }
  async unlock() {
    this.prepareMusic();
    for (const track of this.tracks.values()) {
      if (!track.failed) continue;
      track.failed = false;
      track.audio.load?.();
    }
    await super.unlock();
  }
  setPlaying(playing) { this.setScene(playing ? 'gameplay' : 'silent'); }
  setScene(scene) {
    if (!['silent', 'idle', 'countdown', 'gameplay', 'frenzy'].includes(scene)) throw new Error('Unknown audio scene.');
    const previous = this.scene;
    this.scene = scene;
    this.playing = scene === 'gameplay' || scene === 'frenzy';
    if (scene !== 'gameplay') {
      this.warningWanted = false;
      this.stopWarning();
    }
    const nextKey = this.sceneKey();
    if (this.musicKey !== nextKey && this.music) {
      const previousTrack = this.tracks.get(this.musicKey);
      if (previousTrack) { previousTrack.attempt++; previousTrack.pending = false; }
      this.music.pause();
      // Resume the normal track after frenzy rather than restarting its intro.
      if (!(previous === 'gameplay' && scene === 'frenzy')) this.music.currentTime = 0;
      this.music = null;
    }
    this.musicKey = nextKey;
    this.startMusic();
  }
  sceneKey() {
    // Waiting music continues underneath 3-2-1; there is no silent phase.
    if (this.scene === 'idle' || this.scene === 'countdown') return 'idle';
    if (this.scene === 'gameplay') return 'background';
    if (this.scene === 'frenzy') return this.files.frenzyMusic ? 'frenzyMusic' : 'background';
    return null;
  }
  startMusic() {
    if (!this.enabled) { this.report('muted'); return; }
    if (!this.unlocked) { this.report('waiting'); return; }
    const key = this.sceneKey();
    const src = this.files[key];
    if (!key || !src) { this.report('stopped'); return; }
    this.prepareMusic();
    const track = this.tracks.get(key);
    this.music = track.audio;
    this.musicKey = key;
    if (track.failed) { this.report('error', 'Music could not load. Click Retry sound to try again.'); return; }
    const base = key === 'idle' ? this.volume.idle ?? 0.16
      : key === 'frenzyMusic' ? this.volume.frenzy ?? 0.32 : this.volume.background;
    this.music.volume = base * (this.warningWanted ? 0.65 : 1);
    if (!this.music.paused || track.pending) return;
    const attempt = ++track.attempt;
    track.pending = true;
    this.report('loading');
    this.music.play().then(() => {
      if (attempt === track.attempt && this.music === track.audio && this.enabled) this.report('playing');
    }).catch((error) => {
      if (attempt !== track.attempt || this.music !== track.audio || !this.enabled) return;
      // Pausing/changing a track aborts pending play(). That is not a corrupt
      // recording. Autoplay blocks must also remain retryable on the next click.
      if (error.name === 'AbortError') return;
      if (error.name === 'NotAllowedError') this.report('blocked', 'Click Enable music to allow browser audio.');
      else { track.failed = true; this.report('error', 'Music could not play. Click Retry sound to try again.'); }
    }).finally(() => {
      if (attempt === track.attempt) track.pending = false;
    });
  }
  setEnabled(enabled) {
    if (!enabled) {
      for (const track of this.tracks.values()) { track.attempt++; track.pending = false; }
    }
    super.setEnabled(enabled);
    if (!enabled) this.report('muted');
    if (enabled) this.updateWarning(this.warningSeconds, this.warningWanted);
  }
  updateWarning(seconds, normalRound) {
    this.warningSeconds = seconds;
    this.warningWanted = normalRound && Number.isFinite(seconds) && seconds > 0 && seconds <= 10;
    if (!this.warningWanted || !this.enabled || !this.unlocked) {
      this.stopWarning();
      this.startMusic();
      return;
    }
    this.startMusic(); // Duck the music while the warning is active.
    if (this.warningRunning) return;
    this.warningRunning = true;
    if (!this.files.warning || this.warningFailed) { this.startWarningFallback(); return; }
    if (!this.warningTrack) {
      this.warningTrack = this.createAudio(this.files.warning);
      this.warningTrack.loop = true;
      this.warningTrack.volume = this.volume.warning ?? 0.45;
      this.warningTrack.addEventListener('error', () => this.warningFallback(), { once: true });
    }
    this.warningTrack.play().catch(() => this.warningFallback());
  }
  warningFallback() {
    this.warningFailed = true;
    this.warningTrack?.pause();
    if (this.warningWanted && this.enabled && this.unlocked) this.startWarningFallback();
  }
  startWarningFallback() {
    if (this.warningInterval) return;
    this.playTone('warning');
    this.warningInterval = setInterval(() => {
      if (this.warningWanted && this.enabled && this.unlocked) this.playTone('warning');
      else this.stopWarning();
    }, 1000);
  }
  stopWarning() {
    clearInterval(this.warningInterval);
    this.warningInterval = null;
    this.warningRunning = false;
    if (this.warningTrack) {
      this.warningTrack.pause();
      this.warningTrack.currentTime = 0;
    }
  }
  stopEffects() { super.stopEffects(); this.stopWarning(); }
  stop() {
    this.warningWanted = false;
    this.setScene('silent');
    this.stopEffects();
    for (const track of this.tracks.values()) {
      track.attempt++;
      track.pending = false;
      const { audio } = track;
      audio.pause();
      audio.currentTime = 0;
    }
  }
}
export const audioManager = new SoundtrackManager();
export default audioManager;
