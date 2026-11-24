// Install the selected recordings with: npm.cmd run audio:download
// Missing effects use procedural tones. Missing music stays silent until installed.
export const AUDIO_FILES = {
  roundComplete: '/assets/audio/round-success.wav',
  raceCountdown: '/assets/audio/race-countdown.wav',
  idle: '/assets/audio/idle.mp3',
  background: '/assets/audio/background.mp3',
  frenzyMusic: '/assets/audio/frenzy.mp3',
  start: '/assets/audio/start.wav',
  hit: '/assets/audio/hit.wav',
  warning: '/assets/audio/warning.wav',
  wrong: '/assets/audio/pou-nya.wav',
  gameover: '/assets/audio/clown-laugh.wav',
  timeout: '/assets/audio/clown-laugh.wav',
  frenzy: null, // short procedural announcement over the frenzy music
};
export const AUDIO_VOLUME = { idle: 0.28, background: 0.35, frenzy: 0.4, warning: 0.45, effects: 0.7 };
