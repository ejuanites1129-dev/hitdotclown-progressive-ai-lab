'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { SPEEDS } from '../systems/aiPractice.js';
import { STATUS } from '../systems/gameLogic.js';
import { chooseProgressivePace, normalizeParticipantLabel, ProgressiveGame, PROGRESSIVE_CONSENT_VERSION,
  PROGRESSIVE_RUN, readProgressiveArchive, saveProgressiveRun } from '../systems/progressivePractice.js';
import { DEFAULT_ROUND_SECONDS } from '../systems/timerSettings.js';
import { Esp32ProgressiveConnection } from '../systems/esp32ProgressiveConnection.js';
import { exportDatabaseDataset, usePlaytestDatabase } from './usePlaytestDatabase.js';
import LeaderboardPanel from './LeaderboardPanel.jsx';
import { useLeaderboard } from './useLeaderboard.js';
import './ai-challenge.css';

const path = '/api/progressive-playtests';
const esp32Path = '/api/progressive-esp32-playtests';
const targets = [1, 2, 3, 4, 5];
const browserArchive = (storage) => readProgressiveArchive(storage);
const esp32Archive = (storage) => {
  const archive = readProgressiveArchive(storage);
  return { ...archive, sessions: archive.sessions.filter((run) => run.input === 'esp32') };
};

function download(data, filename) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function phase(state) {
  switch (state.status) {
    case STATUS.TEST: return 'Checking the lights';
    case STATUS.COUNTDOWN: return 'Get ready · ' + state.countdown;
    case STATUS.MEMORY: return 'Watch the lights';
    case STATUS.PLAYER: return 'Your turn';
    case STATUS.HIT: return 'Correct hit';
    case STATUS.WRONG: return 'Wrong target';
    case STATUS.BREAK: return state.breakPhase === 'success' ? 'Sequence cleared' : 'Next sequence · ' + state.countdown;
    case STATUS.FRENZY: return 'Frenzy · Hit any target';
    default: return state.time === 0 ? 'Time’s up' : 'Game over';
  }
}

export default function ProgressiveChallenge({ onControlsChange, browserOnly = false, roundSeconds = DEFAULT_ROUND_SECONDS, pilotLink }) {
  const [policy, setPolicy] = useState('adaptive');
  const [targetInput, setTargetInput] = useState('browser');
  const [consentOpen, setConsentOpen] = useState(false);
  const [consentError, setConsentError] = useState('');
  const [playerName, setPlayerName] = useState('');
  const [playerEmail, setPlayerEmail] = useState('');
  const [shareLeaderboard, setShareLeaderboard] = useState(false);
  const [shareAiData, setShareAiData] = useState(false);
  const [sendLeaderboardEmail, setSendLeaderboardEmail] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [leaderboardOpen, setLeaderboardOpen] = useState(true);
  const [view, setView] = useState(null);
  const [result, setResult] = useState(null);
  const [notice, setNotice] = useState('');
  const [ready, setReady] = useState(false);
  const [serialSupported, setSerialSupported] = useState(false);
  const [deviceConnected, setDeviceConnected] = useState(false);
  const [deviceHello, setDeviceHello] = useState(null);
  const [deviceState, setDeviceState] = useState(null);
  const [deviceMessage, setDeviceMessage] = useState('');
  const [memoryTarget, setMemoryTarget] = useState(null);
  const running = useRef(null);
  const playerSession = useRef(null);
  const deviceRef = useRef(null);
  const deviceHandler = useRef(() => {});
  const hardwareRun = useRef(null);
  const hardwareState = useRef(null);
  const activeTarget = useRef(null);
  const databasePath = targetInput === 'esp32' ? esp32Path : path;
  const archiveReader = targetInput === 'esp32' ? esp32Archive : browserArchive;
  const database = usePlaytestDatabase(browserOnly ? 15000 : 4000, databasePath, archiveReader, targetInput);
  const leaderboard = useLeaderboard();
  const saveToDatabase = database.save;
  const active = database.status?.[targetInput]?.active;
  const summary = database.status?.[targetInput];
  const model = active?.model ?? null;
  const ended = view?.status === STATUS.OVER || view?.status === STATUS.VICTORY;
  const playing = Boolean(view && !ended);

  const recordLeaderboardResult = useCallback((completed) => {
    const player = playerSession.current;
    if (!player?.shareLeaderboard) return;
    leaderboard.save({ id: completed.id, username: player.username, email: player.email,
      score: completed.score, startedAt: completed.startedAt, endedAt: completed.finishedAt });
  }, [leaderboard.save]);

  const show = useCallback((current, state) => {
    setView(state);
    if (state.status !== STATUS.OVER) return;
    running.current = null;
    const completed = { ...current.run, score: state.score, rounds: [...current.engine.rounds], finishedAt: new Date().toISOString() };
    setResult(completed);
    recordLeaderboardResult(completed);
    if (completed.consentVersion) {
      saveToDatabase(completed);
      try { saveProgressiveRun(localStorage, completed); }
      catch { setNotice('Browser backup is unavailable. Download this playthrough to keep a copy.'); }
    }
  }, [saveToDatabase, recordLeaderboardResult]);

  function finishHardwareCycle(tracker, state, completed) {
    const cycle = tracker.currentCycle;
    if (!cycle) return null;
    const livesLeft = Math.max(0, Math.min(cycle.livesAtStart, state.lives));
    const correctHits = completed ? cycle.sequenceLength : Math.max(0, Math.min(cycle.sequenceLength, state.playerPosition));
    const playMs = Math.min(roundSeconds * 1000, Math.max(0, Math.round(Date.now() - (cycle.turnStartedAt ?? Date.now()))));
    const round = {
      sequenceLength: cycle.sequenceLength, speed: tracker.speed, source: tracker.source,
      livesAtStart: cycle.livesAtStart, livesLeft, correctHits, misses: cycle.livesAtStart - livesLeft,
      playMs, completed, outcome: completed ? 'Cleared' : state.time === 0 ? 'Timed out' : 'Out of lives',
      ...(tracker.probability === undefined ? {} : { probability: tracker.probability }),
    };
    tracker.run.rounds.push(round);
    tracker.currentCycle = null;
    return round;
  }

  function finishHardwareRun(tracker, state) {
    hardwareRun.current = null;
    running.current = null;
    if (!tracker.run.rounds.length) return;
    const completed = { ...tracker.run, score: state.score, finishedAt: new Date().toISOString() };
    setResult(completed);
    recordLeaderboardResult(completed);
    if (completed.consentVersion) {
      saveToDatabase(completed);
      try { saveProgressiveRun(localStorage, completed); }
      catch { setDeviceMessage('This physical run is saved to Supabase. The browser backup could not be updated.'); }
    }
  }

  function handleHardwareEvent(event) {
    if (event.type === 'hello') {
      setDeviceHello(event);
      setDeviceMessage(event.adaptivePace
        ? 'AI compatible ESP32 connected. You can start from this page.'
        : 'This firmware needs the AI Lab update before it can change pace between cycles.');
      return;
    }
    if (event.type === 'settings') {
      setDeviceState((current) => current ? { ...current, roundSeconds: event.roundSeconds, lightSeconds: event.lightSeconds } : current);
      return;
    }
    if (event.type === 'error') { setDeviceMessage(event.message); return; }
    if (event.type === 'sequence-review') {
      setView((current) => current ? { ...current, review: { correct: event.correct, performed: event.performed } } : current);
      return;
    }
    if (event.type === 'target-active') {
      const state = hardwareState.current;
      if (state?.status === STATUS.MEMORY && event.active && hardwareRun.current?.currentCycle) {
        hardwareRun.current.currentCycle.sequence.push(event.target);
      }
      activeTarget.current = event.active ? event.target : activeTarget.current === event.target ? null : activeTarget.current;
      setMemoryTarget(state?.status === STATUS.MEMORY ? activeTarget.current : null);
      setView((current) => current ? { ...current, activeTarget: activeTarget.current } : current);
      return;
    }
    if (event.type === 'sensor-hit') {
      const tracker = hardwareRun.current;
      const state = hardwareState.current;
      if (tracker?.currentCycle && state?.status === STATUS.PLAYER) {
        tracker.currentCycle.hits.push({ target: event.target, correct: event.correct, at: Date.now() });
      }
      setView((current) => current ? { ...current, feedbackTarget: event.target, correct: event.correct } : current);
      return;
    }
    if (event.type !== 'state') return;

    hardwareState.current = event;
    setDeviceState(event);
    setMemoryTarget(event.status === STATUS.MEMORY ? activeTarget.current : null);
    const tracker = hardwareRun.current;
    if (!tracker) return;

    if (event.status === STATUS.MEMORY && !tracker.currentCycle) {
      tracker.currentCycle = { sequenceLength: event.sequenceLength, livesAtStart: event.lives, turnStartedAt: null, sequence: [], hits: [] };
    }
    if (event.status === STATUS.PLAYER && tracker.currentCycle && tracker.currentCycle.turnStartedAt === null) {
      tracker.currentCycle.turnStartedAt = Date.now();
    }
    if (event.status === STATUS.BREAK && event.breakPhase === 'success' && tracker.currentCycle) {
      const round = finishHardwareCycle(tracker, event, true);
      if (round) {
        const pace = chooseProgressivePace({ previous: round, sequenceLength: event.sequenceLength + 1,
          livesAtStart: event.lives, roundSeconds, policy: tracker.policy,
          model: tracker.policy === 'adaptive' ? tracker.model : null, input: 'esp32' });
        tracker.speed = pace.speed;
        tracker.source = pace.source;
        tracker.probability = pace.probability;
        deviceRef.current?.setLightMilliseconds(SPEEDS[pace.speed].ms).catch((error) => setDeviceMessage(error.message));
        setDeviceMessage(`Next cycle set to ${SPEEDS[pace.speed].label.toLowerCase()} pace.`);
      }
    }
    if ([STATUS.OVER, STATUS.VICTORY].includes(event.status)) {
      if (tracker.currentCycle) finishHardwareCycle(tracker, event, false);
      finishHardwareRun(tracker, event);
    }
    setView({ ...event, activeTarget: activeTarget.current,
      pace: { speed: tracker.speed, source: tracker.source, ...(tracker.probability === undefined ? {} : { probability: tracker.probability }) } });
  }
  deviceHandler.current = handleHardwareEvent;

  useEffect(() => {
    const frame = requestAnimationFrame(() => setReady(true));
    const timer = setInterval(() => {
      const current = running.current;
      if (current) show(current, current.engine.tick());
    }, 40);
    return () => { cancelAnimationFrame(frame); clearInterval(timer); running.current = null; };
  }, [show]);

  useEffect(() => {
    setSerialSupported(Boolean(navigator.serial && window.isSecureContext));
    const connection = new Esp32ProgressiveConnection({
      onEvent: (event) => deviceHandler.current(event),
      onConnection: (connected) => {
        setDeviceConnected(connected);
        if (connected) setDeviceMessage('ESP32 connected. Checking its firmware…');
        else {
          setDeviceHello(null);
          setDeviceState(null);
          if (hardwareRun.current) {
            hardwareRun.current = null;
            running.current = null;
            setView(null);
            setDeviceMessage('ESP32 disconnected. The interrupted run was not saved.');
          }
        }
      },
      onError: (message) => setDeviceMessage(message),
    });
    deviceRef.current = connection;
    return () => { deviceRef.current = null; void connection.dispose(); };
  }, []);

  useEffect(() => {
    onControlsChange?.({ connected: targetInput === 'esp32' && deviceConnected,
      ready: targetInput === 'esp32' && deviceState?.status === STATUS.READY, locked: playing });
  }, [onControlsChange, playing, targetInput, deviceConnected, deviceState?.status]);

  async function connectEsp32() {
    setDeviceMessage('Choose the ESP32 USB port. Close Arduino Serial Monitor first.');
    try { await deviceRef.current?.connect(); }
    catch (error) { setDeviceMessage(error.message); }
  }

  async function startHardware(participant, consentVersion) {
    if (!deviceConnected || !deviceHello?.adaptivePace || deviceState?.status !== STATUS.READY) {
      setDeviceMessage('Connect the ESP32 with the AI compatible firmware and wait for Ready.');
      return;
    }
    const tracker = {
      policy,
      model: policy === 'adaptive' ? active?.model ?? null : null,
      speed: 1,
      source: 'Warm-up',
      probability: undefined,
      currentCycle: null,
      run: { format: PROGRESSIVE_RUN, id: crypto.randomUUID(), input: 'esp32', participant, policy, roundSeconds,
        modelId: policy === 'adaptive' ? active?.id ?? null : null, startedAt: new Date().toISOString(), score: 0, rounds: [],
        ...(consentVersion ? { consentVersion } : {}) },
    };
    hardwareRun.current = tracker;
    activeTarget.current = null;
    setMemoryTarget(null);
    setResult(null);
    setDeviceMessage('Setting the first medium preview…');
    try {
      await deviceRef.current.setRoundSeconds(roundSeconds);
      await deviceRef.current.setLightMilliseconds(SPEEDS[1].ms);
      await deviceRef.current.sendCommand('START');
      setDeviceMessage('ESP32 game started. Watch the lights, then hit the physical targets in order.');
      const player = playerSession.current;
      if (player?.shareLeaderboard && player.emailLink) {
        void leaderboard.invite({ id: tracker.run.id, username: player.username, email: player.email, startedAt: tracker.run.startedAt }).then(setNotice);
      }
    } catch (error) {
      hardwareRun.current = null;
      setDeviceMessage(error.message);
    }
  }

  function beginChallenge({ saveScore = false, trainModel = false, emailLink = false } = {}) {
    setConsentOpen(false);
    setConsentError('');
    const username = normalizeParticipantLabel(playerName);
    const email = playerEmail.trim().toLowerCase();
    const participant = trainModel ? username : null;
    const consentVersion = trainModel ? PROGRESSIVE_CONSENT_VERSION : null;
    playerSession.current = { username, email, shareLeaderboard: saveScore, emailLink };
    if (targetInput === 'esp32') { void startHardware(participant, consentVersion); return; }
    const engine = new ProgressiveGame({ policy, model: policy === 'adaptive' ? model : null, roundSeconds });
    const run = { format: PROGRESSIVE_RUN, id: crypto.randomUUID(), input: 'browser', participant, policy, roundSeconds,
      modelId: policy === 'adaptive' ? active?.id ?? null : null, startedAt: new Date().toISOString(),
      ...(consentVersion ? { consentVersion } : {}) };
    running.current = { engine, run };
    setResult(null);
    setNotice('');
    setView(engine.start());
    if (saveScore && emailLink) void leaderboard.invite({ id: run.id, username, email, startedAt: run.startedAt }).then(setNotice);
  }

  function start() {
    if (running.current || hardwareRun.current) return;
    const username = normalizeParticipantLabel(playerName);
    const email = playerEmail.trim();
    if (!username || username.length > 24) {
      setNotice('Enter a player name of 1 to 24 characters before starting.');
      return;
    }
    if (email.length > 254 || !/^[^\s@<>,;:"()[\]\\]+@[^\s@<>,;:"()[\]\\]+\.[^\s@<>,;:"()[\]\\]+$/.test(email)) {
      setNotice('Enter a valid email address before starting.');
      return;
    }
    setShareLeaderboard(false);
    setShareAiData(false);
    setSendLeaderboardEmail(false);
    setConsentError('');
    setConsentOpen(true);
  }

  function agreeAndStart(event) {
    event.preventDefault();
    if (!shareLeaderboard && !shareAiData && !sendLeaderboardEmail) {
      setConsentError('Choose a sharing option or use “Play without saving.”');
      return;
    }
    if ((shareAiData || sendLeaderboardEmail) && !shareLeaderboard) {
      setConsentError('To link training data or email a link, first agree to save this game to the leaderboard.');
      return;
    }
    beginChallenge({ saveScore: shareLeaderboard, trainModel: shareAiData && policy === 'adaptive', emailLink: sendLeaderboardEmail });
  }

  function playWithoutSaving() { beginChallenge(); }

  function hit(target) {
    if (targetInput === 'esp32') return;
    const current = running.current;
    if (current) show(current, current.engine.hit(target));
  }

  function returnToSetup() {
    if (hardwareRun.current) hardwareRun.current = null;
    if (targetInput === 'esp32' && deviceConnected && deviceState?.status !== STATUS.READY) {
      void deviceRef.current?.sendCommand('RESET').catch(() => {});
    }
    running.current = null;
    setView(null);
    setResult(null);
    setNotice('');
    setMemoryTarget(null);
    activeTarget.current = null;
    playerSession.current = null;
  }

  async function exportRuns() {
    try { download(await exportDatabaseDataset(databasePath), 'hit-dot-clown-progressive-dataset.json'); }
    catch (error) { setNotice(error.message); }
  }

  const receipt = result?.id === database.receipt?.id ? database.receipt?.state : null;
  const cleared = result?.rounds.filter(({ completed }) => completed).length;
  const playable = view?.status === STATUS.PLAYER || view?.status === STATUS.FRENZY;
  const hardwareReady = targetInput !== 'esp32' || (deviceConnected && deviceHello?.adaptivePace && deviceState?.status === STATUS.READY);
  const setupPanel = <section className="ai-panel setup-settings" aria-label="Game and ESP32 settings">
    <div className="ai-options">
      <label htmlFor="progressive-pace">Round settings
        <select id="progressive-pace" value={policy} onChange={(event) => setPolicy(event.target.value)} disabled={!ready}>
          <option value="adaptive">Adaptive pace</option><option value="fixed">Fixed medium pace</option>
        </select>
      </label>
      <label htmlFor="progressive-input">Targets
        <select id="progressive-input" value={targetInput} onChange={(event) => { setTargetInput(event.target.value); setDeviceMessage(''); }} disabled={!ready}>
          <option value="browser">Browser buttons</option><option value="esp32">ESP32 physical targets</option>
        </select>
      </label>
    </div>
    {targetInput === 'esp32' && <section className="ai-code" aria-label="ESP32 connection">
      <h3>ESP32 connection</h3>
      <p className="ai-note">Use Chrome or Edge on this HTTPS page. Close Arduino Serial Monitor before connecting.</p>
      {!serialSupported && <p className="ai-note">This browser does not support USB Serial. Use Chrome or Edge on the deployed site.</p>}
      <div className="ai-actions">
        {!deviceConnected ? <button type="button" disabled={!serialSupported || !ready} onClick={connectEsp32}>Connect ESP32</button>
          : <button type="button" disabled={playing} onClick={() => void deviceRef.current?.disconnect()}>Disconnect ESP32</button>}
        <span className={'device-status ' + (deviceConnected ? 'connected' : 'disconnected')}><i />{deviceConnected ? deviceHello?.adaptivePace ? 'ESP32 connected' : 'Firmware update needed' : 'ESP32 disconnected'}</span>
      </div>
      {deviceMessage && <p className="ai-note" role="status">{deviceMessage}</p>}
      {deviceState && <p className="ai-note">Board status: {deviceState.status} · {deviceState.sequenceLength} lights · {deviceState.lives} lives</p>}
    </section>}
    {policy === 'adaptive' && <p className="ai-note">{active
      ? `Human-playtest decision tree active for Adaptive Pace on browser and ESP32. Model ${active.id.slice(0, 8)}.`
      : 'No human-trained model yet. Adaptive Pace uses the rule-based fallback while consenting human playthroughs are collected.'}</p>}
    <p className="ai-note">{roundSeconds} seconds per cycle, including the preview. The AI data option appears when Adaptive Pace is selected.</p>
  </section>;

  return <section className="ai-carnival progressive-carnival" aria-label="Hit Dot Clown">
    {!view && <div className={'lobby-layout' + (leaderboardOpen ? ' has-leaderboard' : ' leaderboard-collapsed')}>
      <section className="ready-card" aria-labelledby="ready-title">
        <p className="lobby-eyebrow">Step right up</p>
        <h1 id="ready-title">Ready to play?</h1>
        <div className="ready-instructions">
          <p>Memorize the sequence, then hit the targets in order.</p>
          <p>Every completed cycle adds one step: 3, 4, 5, 6 and onward.</p>
          <p>From cycle 5, ignore the flickering distractions during your turn.</p>
        </div>
        <p className="ready-duration">{roundSeconds} seconds per cycle</p>
        <div className="player-fields">
          <label htmlFor="lobby-player-name">Player name
            <input id="lobby-player-name" value={playerName} onChange={(event) => setPlayerName(event.target.value)} maxLength={24} autoComplete="nickname" placeholder="Enter your name" />
          </label>
          <label htmlFor="lobby-player-email">Email / Gmail
            <input id="lobby-player-email" type="email" value={playerEmail} onChange={(event) => setPlayerEmail(event.target.value)} maxLength={254} autoComplete="email" placeholder="you@example.com" />
          </label>
        </div>
        <p className="privacy-copy">Your name, best score, and date played appear on the public leaderboard. Your email stays private and is used to connect your game history. You can choose whether to save this game before it starts.</p>
        <button type="button" className="display-start-button" onClick={start} disabled={!ready || !hardwareReady}>Start game</button>
        {!hardwareReady && <p className="ai-note">Connect the ESP32 and wait for Ready in Settings, or switch Targets to Browser buttons.</p>}
        <div className="lobby-buttons">
          <button type="button" onClick={() => setSettingsOpen((open) => !open)} aria-expanded={settingsOpen}>{settingsOpen ? 'Hide settings' : 'Settings & ESP32'}</button>
          <button type="button" onClick={() => setLeaderboardOpen((open) => !open)} aria-expanded={leaderboardOpen}>{leaderboardOpen ? 'Hide leaderboard' : 'Show leaderboard'}</button>
        </div>
      </section>
      {leaderboardOpen && <LeaderboardPanel entries={leaderboard.entries} pending={leaderboard.pending} message={leaderboard.message}
        configured={leaderboard.configured} refresh={leaderboard.refresh} />}
    </div>}
    {!view && settingsOpen && setupPanel}
    {!view && settingsOpen && <section className="ai-panel ai-archive" aria-label="Adaptive Pace play data">
      <h3>Adaptive Pace play data</h3>
      {summary && <p>Human coded playthroughs <strong>{summary.codedRuns ?? 0}</strong> · Synthetic rows <strong>{summary.syntheticRuns ?? 0}</strong> · Players reaching Adaptive cycle 2 <strong>{summary.adaptivePlayers ?? 0}</strong></p>}
      <p className="ai-note">Browser and ESP32 runs use the same training pool when players opt in. The leaderboard and AI training databases are separate.</p>
      {summary?.training === 'waiting-for-players' && <p>Training needs five distinct consenting usernames with an Adaptive run reaching cycle 2.</p>}
      {summary?.training === 'waiting-for-outcomes' && <p>Training needs both cleared and failed cycles from consenting Adaptive players.</p>}
      {database.available === false && <p>{targetInput === 'esp32' ? 'The ESP32 playtest table is not available yet. Run the updated AI Lab schema, then queued runs will retry.' : 'The AI Lab database is unavailable. Saved consenting browser runs will retry.'}</p>}
      {receipt && <output>{receipt === 'saved' ? 'This run was saved to the AI training database.'
        : receipt === 'rejected' ? 'The AI Lab rejected this run. Download it to keep a copy.' : 'This AI training run is waiting to sync.'}</output>}
      <div className="ai-actions">
        {!browserOnly && <button type="button" disabled={!database.available} onClick={exportRuns}>Export progressive dataset</button>}
        <button type="button" onClick={() => { try { download(readProgressiveArchive(localStorage), 'hit-dot-clown-progressive-browser-backup.json'); } catch { setNotice('Browser backup is unavailable.'); } }}>Export browser backup</button>
      </div>
    </section>}
    {!view && consentOpen && <div className="ai-consent-backdrop">
      <section className="ai-consent-dialog" role="dialog" aria-modal="true" aria-labelledby="ai-consent-title" aria-describedby="ai-consent-copy">
        <h2 id="ai-consent-title">Before your game</h2>
        <p id="ai-consent-copy">If you choose to save, your name, email, score, and game start/end times go to the Hit Dot Clown leaderboard database. The public board shows only the username, best score, and date played; your email remains private.</p>
        <p className="ai-note">You can play without saving. If a save cannot connect, the game result and entered contact details wait in this browser until they sync.</p>
        <form onSubmit={agreeAndStart}>
          <label className="consent-choice"><input type="checkbox" checked={shareLeaderboard} onChange={(event) => {
            setShareLeaderboard(event.target.checked);
            if (!event.target.checked) { setShareAiData(false); setSendLeaderboardEmail(false); }
          }} />
            Save this game to the leaderboard using the name and email I entered.</label>
          <label className={'consent-choice' + (!shareLeaderboard || policy !== 'adaptive' ? ' disabled' : '')}>
            <input type="checkbox" checked={shareAiData} disabled={!shareLeaderboard || policy !== 'adaptive'} onChange={(event) => setShareAiData(event.target.checked)} />
            Also share round outcomes, pace, sequence lengths, and timing with the AI Lab to improve Adaptive Pace. This is optional and uses my leaderboard name, not my email.
          </label>
          <label className={'consent-choice' + (!shareLeaderboard ? ' disabled' : '')}>
            <input type="checkbox" checked={sendLeaderboardEmail} disabled={!shareLeaderboard} onChange={(event) => setSendLeaderboardEmail(event.target.checked)} />
            Email me a link to the public leaderboard at the address I entered.
          </label>
          {consentError && <p className="ai-consent-error" role="alert">{consentError}</p>}
          <div className="ai-actions">
            <button type="submit" className="ai-primary" disabled={!shareLeaderboard}>Start and save my score</button>
            <button type="button" onClick={playWithoutSaving}>Play without saving</button>
            <button type="button" onClick={() => { setConsentOpen(false); setConsentError(''); }}>Cancel</button>
          </div>
        </form>
      </section>
    </div>}
    {view && <section className="ai-panel ai-round" aria-label="Progressive game">
      <div className="ai-round-head">
        <div><p className="ai-eyebrow">Cycle {view.cycle} · {view.sequenceLength} flashes</p><h2>{phase(view)}</h2></div>
        {view.pace && <span className="ai-pill">{SPEEDS[view.pace.speed].label} · {SPEEDS[view.pace.speed].ms} ms</span>}
      </div>
      <div className="ai-stats"><span>Score {view.score}</span><span>{view.time} s left</span><span>{view.lives} lives</span>
        {!ended && <span>{view.playerPosition} / {view.sequenceLength} hits</span>}</div>
      {!ended && view.pace && <p className="ai-note">{view.pace.source}
        {view.pace.probability !== undefined && ` · Estimated clear chance ${Math.round(view.pace.probability * 100)}%`}</p>}
      {!ended && targetInput === 'esp32' && <p className="ai-note">Hit the connected physical targets. The on-screen targets show the board lights.</p>}
      {!ended && <>
        <div className="ai-targets" aria-label="Game targets">{targets.map((target) => {
          const lit = view.ledTesting || view.allTargetsOn || view.activeTarget === target;
          const feedback = view.feedbackTarget === target ? (view.correct ? ' is-correct' : ' is-wrong') : '';
          return <button type="button" key={target} aria-label={'Hit target ' + target} disabled={!playable || targetInput === 'esp32'}
            className={'ai-target' + (lit ? ' is-lit' : '') + feedback}
            onClick={() => hit(target)}>{target}</button>;
        })}</div>
        <button type="button" onClick={returnToSetup}>End practice</button>
      </>}
      {ended && result && <>
        <p><strong>{cleared} {cleared === 1 ? 'cycle' : 'cycles'} cleared.</strong></p>
        {playerSession.current?.shareLeaderboard && <p className="ai-note" role="status">{leaderboard.pending
          ? 'Your score is queued and will sync to the leaderboard.' : 'Your game result has been sent to the leaderboard.'}</p>}
        {playerSession.current?.shareLeaderboard && playerSession.current?.emailLink && <p className="ai-note">{notice || 'Your leaderboard-link email is being processed.'}</p>}
        {!result.consentVersion && <p className="ai-note">This playthrough was not sent to the AI Lab or saved in the browser playtest archive.</p>}
        {view.review && <div className="progressive-review">
          <p><strong>Correct sequence</strong> {view.review.correct.join(' · ')}</p>
          <p><strong>Your hits</strong> {view.review.performed.length ? view.review.performed.join(' · ') : 'None recorded'}</p>
        </div>}
        <div className="ai-actions"><button type="button" className="ai-primary" onClick={returnToSetup}>Play again</button>
          <button type="button" onClick={() => download(result, 'hit-dot-clown-progressive-run.json')}>Download this run</button></div>
      </>}
    </section>}
    {ended && settingsOpen && <section className="ai-panel ai-archive" aria-label="Adaptive Pace play data">
      <h3>Adaptive Pace play data</h3>
      {summary && <p>Human coded playthroughs <strong>{summary.codedRuns ?? 0}</strong> · Synthetic rows <strong>{summary.syntheticRuns ?? 0}</strong> · Players reaching Adaptive cycle 2 <strong>{summary.adaptivePlayers ?? 0}</strong></p>}
      <p className="ai-note">Browser and ESP32 runs use the same training pool when players opt in. The leaderboard and AI training databases are separate.</p>
      {summary?.training === 'waiting-for-players' && <p>Training needs five distinct consenting usernames with an Adaptive run reaching cycle 2.</p>}
      {summary?.training === 'waiting-for-outcomes' && <p>Training needs both cleared and failed cycles from consenting Adaptive players.</p>}
      {database.available === false && <p>The AI Lab database is unavailable. Saved consenting runs will retry.</p>}
      {receipt && <output>{receipt === 'saved' ? 'This run was saved to the AI training database.'
        : receipt === 'rejected' ? 'The AI Lab rejected this run. Download it to keep a copy.' : 'This AI training run is waiting to sync.'}</output>}
      <div className="ai-actions">
        {!browserOnly && <button type="button" disabled={!database.available} onClick={exportRuns}>Export progressive dataset</button>}
        <button type="button" onClick={() => { try { download(readProgressiveArchive(localStorage), 'hit-dot-clown-progressive-browser-backup.json'); } catch { setNotice('Browser backup is unavailable.'); } }}>Export browser backup</button>
        {pilotLink}
      </div>
    </section>}
    {notice && <output>{notice}</output>}
  </section>;
}
