import { createRoot } from 'react-dom/client';
import { useEffect, useState } from 'react';
import ProgressiveChallenge from './components/ProgressiveChallenge.jsx';
import audioManager from './systems/soundtrackManager.js';
import './online.css';

function Icon({ name }) {
  const shared = { width: 20, height: 20, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
    strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true };
  if (name === 'sun') return <svg {...shared}><circle cx="12" cy="12" r="4" />
    <path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" /></svg>;
  if (name === 'moon') return <svg {...shared}><path d="M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z" /></svg>;
  if (name === 'settings') return <svg {...shared}><path d="M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z" />
    <path d="m19.4 15 .1.1 1.1.9-1.2 2.1-1.4-.5a7.8 7.8 0 0 1-1.5.9l-.2 1.5h-2.4l-.3-1.5a7.8 7.8 0 0 1-1.6-.9l-1.4.5-1.2-2.1 1.1-.9a7.4 7.4 0 0 1 0-1.9l-1.1-.9 1.2-2.1 1.4.5a7.8 7.8 0 0 1 1.6-.9l.3-1.5h2.4l.2 1.5a7.8 7.8 0 0 1 1.5.9l1.4-.5 1.2 2.1-1.1.9a7.4 7.4 0 0 1-.1 1.8Z" transform="translate(-1 -1)" /></svg>;
  if (name === 'volume') return <svg {...shared}><path d="M11 5 6 9H3v6h3l5 4V5Z" /><path d="M15.5 8.5a5 5 0 0 1 0 7m3-10a9 9 0 0 1 0 13" /></svg>;
  return <svg {...shared}><path d="M11 5 6 9H3v6h3l5 4V5Z" /><path d="m16 9 5 6m0-6-5 6" /></svg>;
}

function readSetting(key, fallback) {
  try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; }
}

function App() {
  const [esp32Connected, setEsp32Connected] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [theme, setTheme] = useState(() => readSetting('hit-dot-clown-theme', 'dark') === 'light' ? 'light' : 'dark');
  const [musicEnabled, setMusicEnabled] = useState(() => readSetting('hit-dot-clown-music', 'on') !== 'off');
  const [musicStatus, setMusicStatus] = useState({ state: 'waiting', track: null, message: '' });

  useEffect(() => {
    const unsubscribe = audioManager.subscribe(setMusicStatus);
    audioManager.prepareMusic();
    audioManager.setEnabled(musicEnabled);
    audioManager.setScene('idle');
    function enableOnInteraction(event) {
      if (!event.isTrusted || event.repeat || !audioManager.enabled || event.target.closest?.('[data-sound-control]')) return;
      if (audioManager.unlocked && !['blocked', 'error'].includes(audioManager.status.state)) return;
      void audioManager.unlock();
    }
    window.addEventListener('click', enableOnInteraction);
    window.addEventListener('keydown', enableOnInteraction);
    return () => {
      unsubscribe();
      window.removeEventListener('click', enableOnInteraction);
      window.removeEventListener('keydown', enableOnInteraction);
    };
  }, []);

  useEffect(() => {
    try { localStorage.setItem('hit-dot-clown-theme', theme); } catch { /* Keep the selected theme for this visit. */ }
  }, [theme]);

  useEffect(() => {
    audioManager.setEnabled(musicEnabled);
    try { localStorage.setItem('hit-dot-clown-music', musicEnabled ? 'on' : 'off'); } catch { /* Music still works this visit. */ }
  }, [musicEnabled]);

  function toggleTheme() { setTheme((current) => current === 'dark' ? 'light' : 'dark'); }

  async function toggleMusic() {
    if (!musicEnabled || !audioManager.unlocked || ['blocked', 'error'].includes(musicStatus.state)) {
      setMusicEnabled(true);
      audioManager.setEnabled(true);
      await audioManager.unlock();
      return;
    }
    setMusicEnabled(false);
  }

  const musicLabel = musicStatus.state === 'error' ? 'Retry music'
    : !audioManager.unlocked || musicStatus.state === 'blocked' ? 'Enable music'
      : musicEnabled ? 'Turn music off' : 'Turn music on';

  return <main className="online-lab carnival-app" data-theme={theme}>
    <header className="online-header marquee-header">
      <div className={'header-device ' + (esp32Connected ? 'connected' : 'disconnected')} role="status">
        <i aria-hidden="true" />ESP32 {esp32Connected ? 'connected' : 'disconnected'}
      </div>
      <h1 className="display-brand">HIT <span>dot</span> CLOWN</h1>
      <div className="header-actions">
        <button type="button" className="icon-button" data-sound-control="true" aria-label={musicLabel} title={musicLabel}
          aria-pressed={musicEnabled && audioManager.unlocked} onClick={() => void toggleMusic()}>
          <Icon name={musicEnabled ? 'volume' : 'mute'} />
        </button>
        <button type="button" className="icon-button" aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          title={theme === 'dark' ? 'Light carnival mode' : 'Dark carnival mode'} onClick={toggleTheme}>
          <Icon name={theme === 'dark' ? 'sun' : 'moon'} />
        </button>
        <button type="button" className="icon-button" aria-label="Open settings" title="Settings & operator controls"
          onClick={() => setSettingsOpen(true)}><Icon name="settings" /></button>
      </div>
    </header>
    <ProgressiveChallenge
      onControlsChange={({ connected }) => setEsp32Connected(connected)}
      settingsOpen={settingsOpen}
      onSettingsOpenChange={setSettingsOpen}
      theme={theme}
      onThemeToggle={toggleTheme}
      musicEnabled={musicEnabled}
      musicStatus={musicStatus}
      onToggleMusic={toggleMusic}
    />
  </main>;
}

createRoot(document.getElementById('root')).render(<App />);
