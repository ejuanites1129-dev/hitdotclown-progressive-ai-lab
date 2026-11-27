'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { SPEEDS } from '../systems/aiPractice.js';
import { STATUS } from '../systems/gameLogic.js';
import { chooseProgressivePace, normalizeParticipantLabel, ProgressiveGame, PROGRESSIVE_CONSENT_VERSION,
  PROGRESSIVE_RUN, readProgressiveArchive, saveProgressiveRun } from '../systems/progressivePractice.js';
import { DEFAULT_ROUND_SECONDS, TIMER_KEY, validRoundSeconds, requireRoundSeconds } from '../systems/timerSettings.js';
import { RACE_COUNTDOWN_MS, SUCCESS_MS } from '../systems/targetingEffects.js';
import { createReplayCoach } from '../systems/replayCoach.js';
import { Esp32ProgressiveConnection } from '../systems/esp32ProgressiveConnection.js';
import audioManager from '../systems/soundtrackManager.js';
import { exportDatabaseDataset, usePlaytestDatabase } from './usePlaytestDatabase.js';
import LeaderboardPanel from './LeaderboardPanel.jsx';
import { useLeaderboard } from './useLeaderboard.js';
import './ai-challenge.css';

const path = '/api/progressive-playtests';
const esp32Path = '/api/progressive-esp32-playtests';
const targets = [1, 2, 3, 4, 5];
const sensorArmHelp = {
  inactive: 'Hits are disabled in this game phase.',
  'waiting-low': 'Waiting for every input to return LOW.',
  settling: 'Waiting for stable LOW inputs before re-arming.',
  cooldown: 'Waiting for the short interval between hits.',
  armed: 'Ready to capture the next hit.',
  'hit-pending': 'A captured hit is waiting to be processed.',
};
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

export default function ProgressiveChallenge({ onControlsChange, browserOnly = false, roundSeconds = DEFAULT_ROUND_SECONDS, pilotLink,
  settingsOpen = false, onSettingsOpenChange = () => {}, theme = 'dark', onThemeToggle = () => {},
  musicEnabled = true, musicStatus = { state: 'waiting', track: null, message: '' }, onToggleMusic = () => {} }) {
  const [policy, setPolicy] = useState('adaptive');
  const [targetInput, setTargetInput] = useState('browser');
  const [consentOpen, setConsentOpen] = useState(false);
  const [consentError, setConsentError] = useState('');
  const [playerName, setPlayerName] = useState('');
  const [playerEmail, setPlayerEmail] = useState('');
  const [shareLeaderboard, setShareLeaderboard] = useState(false);
  const [shareAiData, setShareAiData] = useState(false);
  const [sendLeaderboardEmail, setSendLeaderboardEmail] = useState(false);
  const [roundDuration, setRoundDuration] = useState(roundSeconds);
  const [roundDraft, setRoundDraft] = useState(String(roundSeconds));
  const [settingsMessage, setSettingsMessage] = useState('');
  const [timerSaving, setTimerSaving] = useState(false);
  const settingsDialog = useRef(null);
  const serialLogView = useRef(null);
  const lastLoggedState = useRef('');
  const previousAudioState = useRef({ status: null, breakPhase: null });
  const [leaderboardOpen, setLeaderboardOpen] = useState(true);
  const [view, setView] = useState(null);
  const [result, setResult] = useState(null);
  const [restarting, setRestarting] = useState(false);
  const [notice, setNotice] = useState('');
  const [ready, setReady] = useState(false);
  const [serialSupported, setSerialSupported] = useState(false);
  const [deviceConnected, setDeviceConnected] = useState(false);
  const [deviceHello, setDeviceHello] = useState(null);
  const [deviceState, setDeviceState] = useState(null);
  const [deviceMessage, setDeviceMessage] = useState('');
  const [serialInfo, setSerialInfo] = useState({ bytesReceived: 0, bytesSent: 0, linesReceived: 0, stateMessages: 0,
    hitMessages: 0, firmware: '', sensorMode: '', sensorStatus: null, pulseRates: null });
  const [serialLogs, setSerialLogs] = useState([]);
  const [memoryTarget, setMemoryTarget] = useState(null);
  const running = useRef(null);
  const playerSession = useRef(null);
  const pendingHardwareRestart = useRef(null);
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
  const startCountdown = view?.status === STATUS.COUNTDOWN || view?.status === STATUS.TEST;
  const interCycleBreak = view?.status === STATUS.BREAK;
  const clockLabel = interCycleBreak
    ? view.breakPhase === 'countdown' ? 'Race start' : 'Celebration'
    : view?.status === STATUS.FRENZY ? 'Frenzy time' : 'Time remaining';
  const clockValue = interCycleBreak ? view?.countdown ?? 0 : view?.time ?? 0;
  const replayCoach = result ? createReplayCoach(result.rounds) : null;

  function changeSettings(next) {
    onSettingsOpenChange(typeof next === 'function' ? next(settingsOpen) : next);
  }

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
    const playMs = Math.min(roundDuration * 1000, Math.max(0, Math.round(Date.now() - (cycle.turnStartedAt ?? Date.now()))));
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
      setRoundDuration(event.roundSeconds);
      setRoundDraft(String(event.roundSeconds));
      return;
    }
    if (event.type === 'error') { setDeviceMessage(event.message); return; }
    if (event.type === 'sequence-review') {
      setView((current) => current ? { ...current, review: { correct: event.correct, performed: event.performed } } : current);
      return;
    }
    if (event.type === 'sensor-status') return;
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
      audioManager.play(event.correct ? 'hit' : 'wrong');
      if (tracker?.currentCycle && state?.status === STATUS.PLAYER) {
        tracker.currentCycle.hits.push({ target: event.target, correct: event.correct, at: Date.now() });
      }
      setView((current) => current ? { ...current, feedbackTarget: event.target, correct: event.correct } : current);
      return;
    }
    if (event.type !== 'state') return;

    hardwareState.current = event;
    setDeviceState(event);
    if (event.status === STATUS.READY && pendingHardwareRestart.current) {
      const restart = pendingHardwareRestart.current;
      pendingHardwareRestart.current = null;
      void startHardware(restart.participant, restart.consentVersion);
      return;
    }
    if ([STATUS.COUNTDOWN, STATUS.TEST, STATUS.MEMORY, STATUS.PLAYER].includes(event.status)) setRestarting(false);
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
          livesAtStart: event.lives, roundSeconds: roundDuration, policy: tracker.policy,
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
    try {
      const saved = Number(localStorage.getItem(TIMER_KEY));
      if (validRoundSeconds(saved)) { setRoundDuration(saved); setRoundDraft(String(saved)); }
    } catch { /* Use the default cycle timer when storage is unavailable. */ }
    const frame = requestAnimationFrame(() => setReady(true));
    const timer = setInterval(() => {
      const current = running.current;
      if (current) show(current, current.engine.tick());
    }, 40);
    return () => { cancelAnimationFrame(frame); clearInterval(timer); running.current = null; };
  }, [show]);

  useEffect(() => {
    const dialog = settingsDialog.current;
    if (!dialog) return;
    if (settingsOpen && !dialog.open) dialog.showModal();
    else if (!settingsOpen && dialog.open) dialog.close();
  }, [settingsOpen]);

  useEffect(() => {
    const status = view?.status;
    const previous = previousAudioState.current;
    const breakPhase = view?.breakPhase ?? '';
    const scene = status === STATUS.FRENZY ? 'frenzy'
      : [STATUS.MEMORY, STATUS.PLAYER, STATUS.HIT, STATUS.WRONG, STATUS.BREAK].includes(status) ? 'gameplay'
        : status === STATUS.COUNTDOWN || status === STATUS.TEST || !status || ended ? 'idle' : 'silent';
    audioManager.setScene(scene);
    audioManager.updateWarning(view?.time, [STATUS.MEMORY, STATUS.PLAYER, STATUS.HIT, STATUS.WRONG].includes(status));
    const statusChanged = status !== previous.status;
    const breakPhaseChanged = status === STATUS.BREAK && breakPhase !== previous.breakPhase;
    if (status === STATUS.BREAK && (statusChanged || breakPhaseChanged)) {
      audioManager.stopEffects();
      const isCountdown = breakPhase === 'countdown';
      audioManager.playTimed(isCountdown ? 'raceCountdown' : 'roundComplete',
        isCountdown ? RACE_COUNTDOWN_MS : SUCCESS_MS, view?.phaseMs || 0);
    } else if (status && statusChanged) {
      if ([STATUS.READY, STATUS.COUNTDOWN, STATUS.MEMORY, STATUS.VICTORY, STATUS.OVER].includes(status)
        || previous.status === STATUS.BREAK) {
        audioManager.stopEffects();
      }
      if (status === STATUS.COUNTDOWN) audioManager.play('start');
      else if (status === STATUS.FRENZY) audioManager.play('frenzy');
      else if (status === STATUS.VICTORY) audioManager.play('victory');
      else if (status === STATUS.OVER) audioManager.play(view?.time === 0 ? 'timeout' : 'gameover');
    }
    previousAudioState.current = { status: status ?? null, breakPhase };
  }, [view?.status, view?.time, view?.breakPhase, ended]);

  useEffect(() => {
    if (settingsOpen && serialLogView.current) serialLogView.current.scrollTop = serialLogView.current.scrollHeight;
  }, [settingsOpen, serialLogs]);

  useEffect(() => {
    setSerialSupported(Boolean(navigator.serial && window.isSecureContext));
    const connection = new Esp32ProgressiveConnection({
      onEvent: (event) => deviceHandler.current(event),
      onDiagnostics: (diagnostics) => setSerialInfo(diagnostics),
      onLog: (direction, text) => {
        if (direction === 'RX') {
          try {
            const message = JSON.parse(text);
            if (message.type === 'state') {
              const key = [message.status, message.sequenceLength, message.playerPosition, message.lives, message.time, message.countdown].join(':');
              if (key === lastLoggedState.current) return;
              lastLoggedState.current = key;
            }
          } catch { /* Keep raw serial diagnostics, including non-JSON lines. */ }
        }
        setSerialLogs((entries) => [...entries, { direction, text, time: new Date().toISOString() }].slice(-1000));
      },
      onConnection: (connected) => {
        setDeviceConnected(connected);
        if (connected) setDeviceMessage('ESP32 connected. Checking its firmware…');
        else {
          setDeviceHello(null);
          setDeviceState(null);
          setSerialInfo({ bytesReceived: 0, bytesSent: 0, linesReceived: 0, stateMessages: 0,
            hitMessages: 0, firmware: '', sensorMode: '', sensorStatus: null, pulseRates: null });
          hardwareState.current = null;
          pendingHardwareRestart.current = null;
          setRestarting(false);
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

  async function testTargetLights() {
    if (!deviceConnected || playing || timerSaving) return;
    setDeviceMessage('Testing the five physical target lights…');
    try {
      await deviceRef.current?.sendCommand('TEST_LEDS');
      setDeviceMessage('LED test sent to the ESP32. Check that all five target lights respond.');
    } catch (error) { setDeviceMessage(error.message); }
  }

  async function saveRoundTimer(event) {
    event.preventDefault();
    if (playing || timerSaving) return;
    setTimerSaving(true);
    setSettingsMessage('');
    try {
      const seconds = requireRoundSeconds(Number(roundDraft));
      if (targetInput === 'esp32') {
        if (!deviceConnected || !deviceHello?.adaptivePace || deviceState?.status !== STATUS.READY) {
          throw new Error('Connect the AI-compatible ESP32 and wait for Ready before changing its cycle timer.');
        }
        await deviceRef.current?.setRoundSeconds(seconds);
      }
      setRoundDuration(seconds);
      setRoundDraft(String(seconds));
      try { localStorage.setItem(TIMER_KEY, String(seconds)); } catch { /* The setting stays active for this visit. */ }
      setSettingsMessage(`Cycle timer saved: ${seconds} seconds.`);
    } catch (error) { setSettingsMessage(error.message); }
    finally { setTimerSaving(false); }
  }

  async function startHardware(participant, consentVersion) {
    if (!deviceConnected || !deviceHello?.adaptivePace || (hardwareState.current?.status ?? deviceState?.status) !== STATUS.READY) {
      setDeviceMessage('Connect the ESP32 with the AI compatible firmware and wait for Ready.');
      setRestarting(false);
      return;
    }
    const tracker = {
      policy,
      model: policy === 'adaptive' ? active?.model ?? null : null,
      speed: 1,
      source: 'Warm-up',
      probability: undefined,
      currentCycle: null,
      run: { format: PROGRESSIVE_RUN, id: crypto.randomUUID(), input: 'esp32', participant, policy, roundSeconds: roundDuration,
        modelId: policy === 'adaptive' ? active?.id ?? null : null, startedAt: new Date().toISOString(), score: 0, rounds: [],
        ...(consentVersion ? { consentVersion } : {}) },
    };
    hardwareRun.current = tracker;
    activeTarget.current = null;
    setMemoryTarget(null);
    setResult(null);
    setView(null);
    setDeviceMessage('Setting the first medium preview…');
    try {
      await deviceRef.current.setRoundSeconds(roundDuration);
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
      setRestarting(false);
    }
  }

  function beginChallenge({ saveScore = false, trainModel = false, emailLink = false } = {}) {
    setConsentOpen(false);
    setConsentError('');
    const username = normalizeParticipantLabel(playerName);
    const email = playerEmail.trim().toLowerCase();
    const participant = trainModel ? username : null;
    const consentVersion = trainModel ? PROGRESSIVE_CONSENT_VERSION : null;
    playerSession.current = { username, email, shareLeaderboard: saveScore, emailLink, trainModel };
    pendingHardwareRestart.current = null;
    setRestarting(false);
    if (targetInput === 'esp32') { void startHardware(participant, consentVersion); return; }
    const engine = new ProgressiveGame({ policy, model: policy === 'adaptive' ? model : null, roundSeconds: roundDuration });
    const run = { format: PROGRESSIVE_RUN, id: crypto.randomUUID(), input: 'browser', participant, policy, roundSeconds: roundDuration,
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
    if (!current) return;
    const previousFrenzyHits = current.engine.state.frenzyHits;
    const next = current.engine.hit(target);
    if (next.status === STATUS.HIT) audioManager.play('hit');
    else if (next.status === STATUS.WRONG) audioManager.play('wrong');
    else if (next.status === STATUS.FRENZY && next.frenzyHits > previousFrenzyHits) audioManager.play('hit');
    show(current, next);
  }

  function returnToSetup() {
    if (hardwareRun.current) hardwareRun.current = null;
    pendingHardwareRestart.current = null;
    setRestarting(false);
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

  function restartSamePlayer() {
    const player = playerSession.current;
    if (!player) {
      returnToSetup();
      return;
    }
    setNotice('');
    if (targetInput === 'esp32') {
      if (!deviceConnected || !deviceHello?.adaptivePace) {
        setDeviceMessage('Reconnect the AI-compatible ESP32 before restarting this physical game.');
        return;
      }
      pendingHardwareRestart.current = {
        participant: player.trainModel ? player.username : null,
        consentVersion: player.trainModel ? PROGRESSIVE_CONSENT_VERSION : null,
      };
      setRestarting(true);
      setView(null);
      setResult(null);
      setDeviceMessage('Resetting the booth for the same player…');
      const connection = deviceRef.current;
      if (!connection) {
        pendingHardwareRestart.current = null;
        setRestarting(false);
        setDeviceMessage('Reconnect the ESP32 before restarting this physical game.');
        return;
      }
      void connection.sendCommand('RESET').catch((error) => {
        pendingHardwareRestart.current = null;
        setRestarting(false);
        setDeviceMessage(error.message);
      });
      return;
    }
    beginChallenge({ saveScore: player.shareLeaderboard, trainModel: player.trainModel, emailLink: player.emailLink });
  }

  function returnHome() {
    returnToSetup();
    setPlayerName('');
    setPlayerEmail('');
    setShareLeaderboard(false);
    setShareAiData(false);
    setSendLeaderboardEmail(false);
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
        <select id="progressive-pace" value={policy} onChange={(event) => setPolicy(event.target.value)} disabled={!ready || playing}>
          <option value="adaptive">Adaptive pace</option><option value="fixed">Fixed medium pace</option>
        </select>
      </label>
      <label htmlFor="progressive-input">Targets
        <select id="progressive-input" value={targetInput} onChange={(event) => { setTargetInput(event.target.value); setDeviceMessage(''); }} disabled={!ready || playing}>
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
        <button type="button" disabled={!deviceConnected || playing || timerSaving} onClick={() => void testTargetLights()}>Test all LEDs</button>
        <span className={'device-status ' + (deviceConnected ? 'connected' : 'disconnected')}><i />{deviceConnected ? deviceHello?.adaptivePace ? 'ESP32 connected' : 'Firmware update needed' : 'ESP32 disconnected'}</span>
      </div>
      {deviceMessage && <p className="ai-note" role="status">{deviceMessage}</p>}
      {deviceState && <p className="ai-note">Board status: {deviceState.status} · {deviceState.sequenceLength} lights · {deviceState.lives} lives</p>}
    </section>}
    {policy === 'adaptive' && <p className="ai-note">{active
      ? `Human-playtest decision tree active for Adaptive Pace on browser and ESP32. Model ${active.id.slice(0, 8)}.`
      : 'No human-trained model yet. Adaptive Pace uses the rule-based fallback while consenting human playthroughs are collected.'}</p>}
    <p className="ai-note">{roundDuration} seconds per cycle, including the preview. Adaptive Pace selects a flash speed from the previous cycle; the AI data option appears when Adaptive Pace is selected.</p>
  </section>;

  return <section className="ai-carnival progressive-carnival" aria-label="Hit Dot Clown">
    {!view && !restarting && <div className={'lobby-layout' + (leaderboardOpen ? ' has-leaderboard' : ' leaderboard-collapsed')}>
      <section className="ready-card" aria-labelledby="ready-title">
        <p className="lobby-eyebrow">Step right up</p>
        <h1 id="ready-title">Ready to play?</h1>
        <div className="ready-instructions">
          <p>Memorize the sequence, then hit the targets in order.</p>
          <p>Every completed cycle adds one step: 3, 4, 5, 6 and onward.</p>
          <p>From cycle 5, ignore the flickering distractions during your turn.</p>
        </div>
        <p className="ready-duration">{roundDuration} seconds per cycle</p>
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
          <button type="button" onClick={() => setLeaderboardOpen((open) => !open)} aria-expanded={leaderboardOpen}>{leaderboardOpen ? 'Hide leaderboard' : 'Show leaderboard'}</button>
        </div>
      </section>
      {leaderboardOpen && <LeaderboardPanel entries={leaderboard.entries} pending={leaderboard.pending} message={leaderboard.message}
        configured={leaderboard.configured} refresh={leaderboard.refresh} />}
    </div>}
    {!view && restarting && <section className="ai-panel progressive-restart-wait" role="status" aria-live="polite">
      <h2>Restarting your game</h2>
      <p>{targetInput === 'esp32' ? 'The booth is resetting. Your player name and selected sharing choices will carry over.' : 'Preparing another game for the same player…'}</p>
      {deviceMessage && targetInput === 'esp32' && <p className="ai-note">{deviceMessage}</p>}
      <button type="button" onClick={returnHome}>Return to home</button>
    </section>}
    {!view && !restarting && consentOpen && <div className="ai-consent-backdrop">
      <section className="ai-consent-dialog" role="dialog" aria-modal="true" aria-labelledby="ai-consent-title" aria-describedby="ai-consent-copy">
        <h2 id="ai-consent-title">Before your game</h2>
        <p id="ai-consent-copy">If you choose to save, your name, email, score, and game start/end times go to the Hit Dot Clown leaderboard database. The public board shows only the username, best score, and date played; your email remains private.</p>
        <p className="ai-note">You can play without saving. If a save cannot connect, the game result and entered contact details wait in this browser until they sync. Restarting reuses this player and these choices; return home to clear the details for the next player.</p>
        <form onSubmit={agreeAndStart}>
          <label className="consent-choice"><input type="checkbox" checked={shareLeaderboard} onChange={(event) => {
            setShareLeaderboard(event.target.checked);
            if (!event.target.checked) { setShareAiData(false); setSendLeaderboardEmail(false); }
          }} />
            Save this game and games I restart during this visit to the leaderboard using the name and email I entered.</label>
          <label className={'consent-choice' + (!shareLeaderboard || policy !== 'adaptive' ? ' disabled' : '')}>
            <input type="checkbox" checked={shareAiData} disabled={!shareLeaderboard || policy !== 'adaptive'} onChange={(event) => setShareAiData(event.target.checked)} />
            Also share round outcomes, pace, sequence lengths, and timing from this game and restarted games with the AI Lab to improve Adaptive Pace. This is optional and uses my leaderboard name, not my email.
          </label>
          <label className={'consent-choice' + (!shareLeaderboard ? ' disabled' : '')}>
            <input type="checkbox" checked={sendLeaderboardEmail} disabled={!shareLeaderboard} onChange={(event) => setSendLeaderboardEmail(event.target.checked)} />
            Email me a leaderboard link for this game and any game I restart during this visit.
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
    {view && <section className={'ai-panel ai-round progressive-game-screen' + (startCountdown ? ' is-countdown' : '')} aria-label="Progressive game">
      {startCountdown ? <div className="progressive-countdown" aria-label="Game starting countdown">
        <p className="progressive-game-status">{view.status === STATUS.TEST ? 'Checking the lights' : 'Get ready'}</p>
        <output className="progressive-countdown-number" aria-live="assertive">
          {view.status === STATUS.TEST ? 'LED test' : view.countdown || 3}
        </output>
        <div className="progressive-countdown-lights" aria-hidden="true">
          {targets.map((target) => <span key={target} className={view.ledTesting ? 'is-on' : ''}>{target}</span>)}
        </div>
        <p className="progressive-countdown-help">{view.status === STATUS.TEST
          ? 'Checking all five target lights.' : 'Eyes on the targets. The sequence starts next.'}</p>
      </div> : <>
        {!ended && <>
          <output className="progressive-game-status" aria-live="polite">
            {view.status === STATUS.MEMORY ? 'Watch the lights · Timer is running' : phase(view)}
          </output>
          <p className="progressive-cycle-caption">Cycle {view.cycle} · {view.sequenceLength} steps</p>
        </>}
        <div className="progressive-scoreboard" aria-label="Live game score and timer">
          <dl className="progressive-metric score">
            <dt>{ended ? 'Final score' : 'Score'}</dt>
            <dd>{String(view.score).padStart(3, '0')}</dd>
          </dl>
          <dl className={'progressive-metric time' + (!ended && !interCycleBreak && view.time <= 10 ? ' is-urgent' : '')}>
            <dt>{ended ? 'Time at end' : clockLabel}</dt>
            <dd>{String(clockValue).padStart(2, '0')}<small>s</small></dd>
          </dl>
        </div>
        {!ended && <div className="progressive-game-meta">
          <span>{view.lives} lives</span>
          {playable && <span>{view.playerPosition} / {view.sequenceLength} hits</span>}
          {view.pace && <span className={'progressive-pace-indicator pace-' + SPEEDS[view.pace.speed].label.toLowerCase()} aria-live="polite">
            <strong>{SPEEDS[view.pace.speed].label} preview</strong>
            <span>{SPEEDS[view.pace.speed].ms} ms per light</span>
            <small>{view.pace.source}{view.pace.probability !== undefined && ` · Estimated clear chance ${Math.round(view.pace.probability * 100)}%`}</small>
          </span>}
        </div>}
        {!ended && targetInput === 'esp32' && <p className="progressive-input-hint">Hit the connected physical targets on the booth.</p>}
        {!ended && targetInput === 'browser' && <div className="ai-targets progressive-browser-targets" aria-label="Game targets">{targets.map((target) => {
          const lit = view.ledTesting || view.allTargetsOn || view.activeTarget === target;
          const feedback = view.feedbackTarget === target ? (view.correct ? ' is-correct' : ' is-wrong') : '';
          return <button type="button" key={target} aria-label={'Hit target ' + target} disabled={!playable}
            className={'ai-target' + (lit ? ' is-lit' : '') + feedback}
            onClick={() => hit(target)}>{target}</button>;
        })}</div>}
        {!ended && <button type="button" className="progressive-end-button" onClick={returnToSetup}>End practice</button>}
      </>}
      {ended && result && <>
        <p><strong>{cleared} {cleared === 1 ? 'cycle' : 'cycles'} cleared.</strong></p>
        {playerSession.current?.shareLeaderboard && <p className="ai-note" role="status">{leaderboard.pending
          ? 'Your score is queued and will sync to the leaderboard.' : 'Your game result has been sent to the leaderboard.'}</p>}
        {playerSession.current?.shareLeaderboard && playerSession.current?.emailLink && <p className="ai-note">{notice || 'Your leaderboard-link email is being processed.'}</p>}
        {!result.consentVersion && <p className="ai-note">This playthrough was not sent to the AI Lab or saved in the browser playtest archive.</p>}
        {replayCoach && <section className="progressive-coach" aria-labelledby="progressive-coach-title">
          <div className="progressive-coach-heading">
            <span>Personalized game review</span>
            <h3 id="progressive-coach-title">Replay Coach</h3>
          </div>
          <p className="progressive-coach-summary">{replayCoach.summary}</p>
          <p className="progressive-coach-details">{replayCoach.details}</p>
          <p className="progressive-coach-tip"><strong>Next time:</strong> {replayCoach.recommendation}</p>
        </section>}
        {view.review && <div className="progressive-review">
          <p><strong>Correct sequence</strong> {view.review.correct.join(' · ')}</p>
          <p><strong>Your hits</strong> {view.review.performed.length ? view.review.performed.join(' · ') : 'None recorded'}</p>
        </div>}
        <p className="ai-note">Restart keeps this player and the choices made before the game. Return to home clears the name and email for the next player.</p>
        <div className="ai-actions progressive-result-actions">
          <button type="button" className="ai-primary" disabled={restarting} onClick={restartSamePlayer}>Restart game</button>
          <button type="button" onClick={returnHome}>Return to home</button>
          <button type="button" onClick={() => download(result, 'hit-dot-clown-progressive-run.json')}>Download this run</button>
        </div>
      </>}
    </section>}
    <dialog ref={settingsDialog} className="settings-dialog ai-settings-dialog" aria-labelledby="settings-title"
      onCancel={() => changeSettings(false)} onClose={() => changeSettings(false)}>
      <div className="settings-heading"><h2 id="settings-title">Settings &amp; operator controls</h2>
        <button type="button" className="icon-button" aria-label="Close settings" onClick={() => changeSettings(false)}>×</button></div>
      <div className="display-operator-panel ai-settings-body">
        <div className="display-operator-row settings-quick-actions">
          <button type="button" className="display-button" disabled={!view || playing || timerSaving} onClick={returnToSetup}>Reset</button>
          <button type="button" className="display-button" data-sound-control="true" aria-pressed={musicEnabled} onClick={() => void onToggleMusic()}>
            {musicEnabled ? 'Music on' : 'Music off'}
          </button>
          <button type="button" className="display-button" onClick={onThemeToggle}>{theme === 'dark' ? 'Light carnival mode' : 'Dark carnival mode'}</button>
        </div>
        <section className="operator-section ai-settings-section" aria-label="Round and target settings">
          <h3>Game and ESP32 settings</h3>
          {setupPanel}
          <form className="display-timer-form" onSubmit={saveRoundTimer}>
            <div className="display-operator-row">
              <label className="display-field" htmlFor="ai-round-timer">Round timer (seconds)
                <input id="ai-round-timer" type="number" min="5" max="300" step="1" required value={roundDraft}
                  disabled={!ready || playing || timerSaving} onChange={(event) => setRoundDraft(event.target.value)} />
              </label>
              <button type="submit" className="display-button primary" disabled={!ready || playing || timerSaving}>
                {timerSaving ? 'Saving…' : 'Save timer'}
              </button>
            </div>
            <p className="display-help">The timer covers each full cycle, including its sequence preview. Choose 5 to 300 seconds. Browser settings are remembered here; a connected ESP32 receives the same value.</p>
            {settingsMessage && <output className="display-settings-message" role="status">{settingsMessage}</output>}
          </form>
          <p className="display-help">{targetInput === 'esp32'
            ? 'For physical play, use Chrome or Edge over HTTPS or localhost and close Arduino Serial Monitor before connecting.'
            : 'Browser buttons work without the ESP32. Select ESP32 physical targets above when the board is available.'}</p>
          {deviceState && <p className="display-help">Board status: {deviceState.status} · {deviceState.sequenceLength} lights · {deviceState.lives} lives.</p>}
          {deviceMessage && <output className="display-settings-message" role="status">{deviceMessage}</output>}
        </section>
        <section className="operator-section ai-settings-section" aria-label="Adaptive Pace training data">
          <h3>Adaptive Pace play data</h3>
          {summary && <p>Human playthroughs <strong>{summary.codedRuns ?? 0}</strong> · Synthetic rows <strong>{summary.syntheticRuns ?? 0}</strong> · Players reaching Adaptive cycle 2 <strong>{summary.adaptivePlayers ?? 0}</strong></p>}
          <p className="ai-note">Browser and ESP32 consenting playthroughs share the training pool. Leaderboard contact data stays separate from AI training records.</p>
          {summary?.training === 'waiting-for-players' && <p>Training needs five distinct consenting usernames with an Adaptive run reaching cycle 2.</p>}
          {summary?.training === 'waiting-for-outcomes' && <p>Training needs both cleared and failed cycles from consenting Adaptive players.</p>}
          {database.available === false && <p>{targetInput === 'esp32' ? 'The ESP32 playtest table is not available yet. Run the updated AI Lab schema; queued runs will retry.' : 'The AI Lab database is unavailable. Saved consenting browser runs will retry.'}</p>}
          {receipt && <output role="status">{receipt === 'saved' ? 'This run was saved to the AI training database.'
            : receipt === 'rejected' ? 'The AI Lab rejected this run. Download it to keep a copy.' : 'This AI training run is waiting to sync.'}</output>}
          <div className="ai-actions">
            {!browserOnly && <button type="button" disabled={!database.available} onClick={exportRuns}>Export progressive dataset</button>}
            <button type="button" onClick={() => { try { download(readProgressiveArchive(localStorage), 'hit-dot-clown-progressive-browser-backup.json'); } catch { setNotice('Browser backup is unavailable.'); } }}>Export browser backup</button>
            {pilotLink}
          </div>
        </section>
        <section className="operator-section ai-settings-section" aria-label="ESP32 serial monitor">
          <h3>Serial monitor</h3>
          <p className="display-help">Firmware: <strong>{deviceConnected ? serialInfo.firmware || 'Checking…' : 'Not connected'}</strong> · Sensor input: {serialInfo.sensorMode || deviceHello?.sensorMode || 'Unknown'} · Game phase: {deviceState?.status || 'READY'} · RX: {serialInfo.bytesReceived} bytes · TX: {serialInfo.bytesSent} bytes · States: {serialInfo.stateMessages} · Scored hits: {serialInfo.hitMessages}</p>
          {serialInfo.sensorStatus ? <>
            <p className="display-help">START D{serialInfo.sensorStatus.start.pin}: <strong>{serialInfo.sensorStatus.start.level ? 'Released' : 'Pressed'}</strong> · RESET D{serialInfo.sensorStatus.reset.pin}: <strong>{serialInfo.sensorStatus.reset.level ? 'Released' : 'Pressed'}</strong></p>
            <p className="display-help">{sensorArmHelp[serialInfo.sensorStatus.armState] || 'Live piezo inputs'} Armed: {serialInfo.sensorStatus.armed ? 'Yes' : 'No'} · Capturing: {serialInfo.sensorStatus.capturing ? 'Yes' : 'No'}</p>
            <div className="table-scroll progressive-sensor-scroll"><table className="display-sensor-table"><caption>Live piezo inputs · totals include captured rising edges</caption>
              <thead><tr><th scope="col">Target</th><th scope="col">GPIO</th><th scope="col">Level</th><th scope="col">Raw pulses</th><th scope="col">Pulses/s</th></tr></thead>
              <tbody>{serialInfo.sensorStatus.pins.map((pin, index) => <tr key={pin}>
                <td>{index + 1}</td><td>D{pin}</td><td>{serialInfo.sensorStatus.levels[index] ? 'HIGH' : 'LOW'}</td>
                <td>{serialInfo.sensorStatus.pulses[index]}</td><td>{serialInfo.pulseRates?.[index] ?? '—'}</td>
              </tr>)}</tbody>
            </table></div>
            <p className="display-help">Tap one physical target at a time and watch its raw pulse total rise. One impact can create several electrical edges; scored hits above count only impacts the game accepted.</p>
          </> : <p className="display-help" role="status">{deviceConnected
            ? ((serialInfo.sensorMode || deviceHello?.sensorMode) === 'analog'
              ? 'This firmware reports analog sensor mode, so live digital pulse totals are not available.'
              : 'Waiting for live piezo status. If it stays this way, update the connected ESP32 to the AI Lab firmware.')
            : 'Connect the AI-compatible ESP32 to view live piezo pulses for each target.'}</p>}
          <div className="display-operator-row"><button type="button" className="display-button" onClick={() => { setSerialLogs([]); lastLoggedState.current = ''; }}>Clear log</button>
            <span className="display-help">Recent ESP32 messages, up to 1,000 lines</span></div>
          <textarea className="serial-log" ref={serialLogView} readOnly aria-label="ESP32 serial message log"
            value={serialLogs.length ? serialLogs.map((line) => `[${new Date(line.time).toLocaleTimeString('en-PH', { timeZone: 'Asia/Manila', hour12: false })}] ${line.direction} ${line.text}`).join('\n') : 'Connect the ESP32 to see serial messages here.'} />
        </section>
        <section className="operator-section ai-settings-section" aria-label="Carnival music">
          <h3>Carnival music</h3>
          <p className="display-help" role="status">{musicStatus.message || (musicStatus.state === 'playing' ? 'Carnival music is playing.'
            : musicStatus.state === 'muted' ? 'Music and sound effects are off.'
              : musicStatus.state === 'loading' ? 'Loading carnival music…' : 'Music starts after your first interaction with the page.')}</p>
          <p className="display-help">Music by Kevin MacLeod (incompetech.com), CC BY 4.0. <a href="/assets/audio/CREDITS.txt" target="_blank" rel="noreferrer">Audio credits and sources</a></p>
        </section>
      </div>
    </dialog>
    {notice && <output>{notice}</output>}
  </section>;
}
