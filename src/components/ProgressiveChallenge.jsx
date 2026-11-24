'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createParticipantCode, PARTICIPANT_CODE, SPEEDS } from '../systems/aiPractice.js';
import { STATUS } from '../systems/gameLogic.js';
import { chooseProgressivePace, ProgressiveGame, PROGRESSIVE_RUN, readProgressiveArchive, saveProgressiveRun } from '../systems/progressivePractice.js';
import { DEFAULT_ROUND_SECONDS } from '../systems/timerSettings.js';
import { Esp32ProgressiveConnection } from '../systems/esp32ProgressiveConnection.js';
import { exportDatabaseDataset, usePlaytestDatabase } from './usePlaytestDatabase.js';
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
  const [participant, setParticipant] = useState(null);
  const [code, setCode] = useState('');
  const [returning, setReturning] = useState(false);
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
  const deviceRef = useRef(null);
  const deviceHandler = useRef(() => {});
  const hardwareRun = useRef(null);
  const hardwareState = useRef(null);
  const activeTarget = useRef(null);
  const databasePath = targetInput === 'esp32' ? esp32Path : path;
  const archiveReader = targetInput === 'esp32' ? esp32Archive : browserArchive;
  const database = usePlaytestDatabase(browserOnly ? 15000 : 4000, databasePath, archiveReader, targetInput);
  const saveToDatabase = database.save;
  const active = database.status?.[targetInput]?.active;
  const summary = database.status?.[targetInput];
  const model = active?.model ?? null;
  const ended = view?.status === STATUS.OVER || view?.status === STATUS.VICTORY;
  const playing = Boolean(view && !ended);

  const show = useCallback((current, state) => {
    setView(state);
    if (state.status !== STATUS.OVER) return;
    running.current = null;
    const completed = { ...current.run, score: state.score, rounds: [...current.engine.rounds], finishedAt: new Date().toISOString() };
    setResult(completed);
    saveToDatabase(completed);
    try { saveProgressiveRun(localStorage, completed); }
    catch { setNotice('Browser backup is unavailable. Download this playthrough to keep a copy.'); }
  }, [saveToDatabase]);

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
    saveToDatabase(completed);
    try { saveProgressiveRun(localStorage, completed); }
    catch { setDeviceMessage('This physical run is saved to Supabase. The browser backup could not be updated.'); }
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

  function applyCode(value) {
    const normalized = value.trim().toUpperCase();
    if (!PARTICIPANT_CODE.test(normalized)) { setNotice('Enter your full playtest code.'); return; }
    setParticipant(normalized);
    setReturning(false);
    setPolicy('adaptive');
    setNotice('');
  }

  async function connectEsp32() {
    setDeviceMessage('Choose the ESP32 USB port. Close Arduino Serial Monitor first.');
    try { await deviceRef.current?.connect(); }
    catch (error) { setDeviceMessage(error.message); }
  }

  async function startHardware() {
    if (!deviceConnected || !deviceHello?.adaptivePace || deviceState?.status !== STATUS.READY) {
      setDeviceMessage('Connect the ESP32 with the AI compatible firmware and wait for Ready.');
      return;
    }
    if (policy === 'collect' && !participant) return;
    const tracker = {
      policy,
      model: policy === 'adaptive' ? active?.model ?? null : null,
      speed: 1,
      source: 'Warm-up',
      probability: undefined,
      currentCycle: null,
      run: { format: PROGRESSIVE_RUN, id: crypto.randomUUID(), input: 'esp32', participant, policy, roundSeconds,
        modelId: policy === 'adaptive' ? active?.id ?? null : null, startedAt: new Date().toISOString(), score: 0, rounds: [] },
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
    } catch (error) {
      hardwareRun.current = null;
      setDeviceMessage(error.message);
    }
  }

  function start() {
    if (running.current || (policy === 'collect' && !participant)) return;
    if (targetInput === 'esp32') { void startHardware(); return; }
    const engine = new ProgressiveGame({ policy, model: policy === 'adaptive' ? model : null, roundSeconds });
    const run = { format: PROGRESSIVE_RUN, id: crypto.randomUUID(), input: 'browser', participant, policy, roundSeconds,
      modelId: policy === 'adaptive' ? active?.id ?? null : null, startedAt: new Date().toISOString() };
    running.current = { engine, run };
    setResult(null);
    setNotice('');
    setView(engine.start());
  }

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
  }

  async function exportRuns() {
    try { download(await exportDatabaseDataset(databasePath), 'hit-dot-clown-progressive-dataset.json'); }
    catch (error) { setNotice(error.message); }
  }

  const receipt = result?.id === database.receipt?.id ? database.receipt?.state : null;
  const cleared = result?.rounds.filter(({ completed }) => completed).length;
  const playable = view?.status === STATUS.PLAYER || view?.status === STATUS.FRENZY;
  return <section className="ai-carnival progressive-carnival" aria-label="Progressive AI Carnival Challenge">
    {!view && <section className="ai-panel" aria-label="Challenge setup">
      <div className="ai-intro">
        <span className="ai-pill">{targetInput === 'esp32' ? 'Unranked physical game' : 'Unranked browser game'}</span>
        <p>Start with three flashes. Every clear adds one step. Your score and three lives carry across cycles.</p>
      </div>
      <label htmlFor="progressive-pace">Pacing</label>
      <select id="progressive-pace" value={policy} onChange={(event) => setPolicy(event.target.value)} disabled={!ready}>
        <option value="adaptive">Adaptive pace</option>
        <option value="fixed">Fixed medium pace</option>
      </select>
      <label htmlFor="progressive-input">Targets</label>
      <select id="progressive-input" value={targetInput} onChange={(event) => { setTargetInput(event.target.value); setDeviceMessage(''); }} disabled={!ready}>
        <option value="browser">Browser buttons</option>
        <option value="esp32">ESP32 physical targets</option>
      </select>
      {targetInput === 'esp32' && <section className="ai-code" aria-label="ESP32 connection">
        <h3>ESP32 connection</h3>
        <p className="ai-note">Connect with Chrome or Edge over HTTPS. Close Arduino Serial Monitor before connecting.</p>
        {!serialSupported && <p className="ai-note">This browser does not support USB Serial. Use Chrome or Edge on the deployed HTTPS page.</p>}
        <div className="ai-actions">
          {!deviceConnected ? <button type="button" disabled={!serialSupported || !ready} onClick={connectEsp32}>Connect ESP32</button>
            : <button type="button" disabled={playing} onClick={() => void deviceRef.current?.disconnect()}>Disconnect ESP32</button>}
          <span className="ai-pill">{deviceConnected ? deviceHello?.adaptivePace ? 'Ready for AI pace' : 'Firmware update needed' : 'Disconnected'}</span>
        </div>
        {deviceMessage && <p className="ai-note" role="status">{deviceMessage}</p>}
        {deviceState && <p className="ai-note">Board status: {deviceState.status} · {deviceState.sequenceLength} lights · {deviceState.lives} lives</p>}
      </section>}
      {policy === 'adaptive' && <p className="ai-note">{active
        ? `Human-playtest decision tree active for Adaptive Pace on browser and ESP32. Model ${active.id.slice(0, 8)}.`
        : 'No human-trained model yet. Adaptive Pace uses the rule-based fallback while coded human playthroughs are collected.'}</p>}
      <section className="ai-code" aria-label="Class playtest">
        <h3>Class playtest</h3>
        {participant ? <div className="ai-actions">
          <p>Anonymous playtest code <strong className="ai-participant-id">{participant}</strong>. Coded Adaptive runs save automatically for training.</p>
          <button type="button" onClick={() => { setParticipant(null); setCode(''); if (policy === 'collect') setPolicy('adaptive'); }}>Switch to guest</button>
        </div> : returning ? <form onSubmit={(event) => { event.preventDefault(); applyCode(code); }}>
          <label htmlFor="progressive-code">Your playtest code</label>
          <input id="progressive-code" value={code} onChange={(event) => setCode(event.target.value)} maxLength={10} required autoComplete="off" />
          <div className="ai-actions">
            <button type="submit">Use my code</button>
            <button type="button" onClick={() => setReturning(false)}>Cancel</button>
          </div>
        </form> : <>
          <p className="ai-note">Play normally in Adaptive Pace. Join to link your Adaptive games under an anonymous code for model training. Keep the code for repeat visits. Guest and Fixed pace runs are not training examples; no name or email is collected.</p>
          <div className="ai-actions"><button type="button" disabled={!ready} onClick={() => applyCode(createParticipantCode())}>Join and contribute</button>
            <button type="button" disabled={!ready} onClick={() => setReturning(true)}>I have a code</button></div>
        </>}
      </section>
      <p className="ai-note">{roundSeconds} seconds per cycle, including the preview.</p>
      <button type="button" className="display-start-button" onClick={start}
        disabled={!ready || (policy === 'collect' && !participant) || (policy === 'adaptive' && database.available === null)
          || targetInput === 'esp32' && (!deviceConnected || !deviceHello?.adaptivePace || deviceState?.status !== STATUS.READY)}>Start challenge</button>
    </section>}
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
        {view.review && <div className="progressive-review">
          <p><strong>Correct sequence</strong> {view.review.correct.join(' · ')}</p>
          <p><strong>Your hits</strong> {view.review.performed.length ? view.review.performed.join(' · ') : 'None recorded'}</p>
        </div>}
        <div className="ai-actions"><button type="button" className="ai-primary" onClick={returnToSetup}>Play again</button>
          <button type="button" onClick={() => download(result, 'hit-dot-clown-progressive-run.json')}>Download this run</button></div>
      </>}
    </section>}
    {(!view || ended) && <section className="ai-panel ai-archive" aria-label="Progressive playtest database">
      <h3>Shared progressive playtest database</h3>
      {summary && <p>Human coded playthroughs <strong>{summary.codedRuns ?? 0}</strong> · Previous synthetic rows awaiting cleanup <strong>{summary.syntheticRuns ?? 0}</strong> · Participant codes with Adaptive cycle 2 <strong>{summary.adaptivePlayers ?? 0}</strong></p>}
      <p className="ai-note">Coded Adaptive runs from Browser and ESP32 share this pool. A participant who uses both modes counts once.</p>
      {summary?.training === 'waiting-for-players' && <p>Model training needs five distinct participant codes with an Adaptive run reaching cycle 2, from Browser buttons or ESP32 mode.</p>}
      {summary?.training === 'waiting-for-outcomes' && <p>Training needs both cleared and failed cycles from the coded Adaptive players.</p>}
      {database.available === false && <p>{targetInput === 'esp32'
        ? 'The ESP32 playtest table is not available yet. Run the updated Supabase schema. This run is kept in the browser backup and will retry later.'
        : 'The database is unavailable. Saved browser runs will retry when it reconnects.'}</p>}
      {receipt && <output>{receipt === 'saved' ? 'This run was saved to the progressive playtest database.'
        : receipt === 'rejected' ? 'The database rejected this run. Download this run to keep a copy.' : 'This run is waiting to sync.'}</output>}
      <div className="ai-actions">
        {!browserOnly && <button type="button" disabled={!database.available} onClick={exportRuns}>Export progressive dataset</button>}
        <button type="button" onClick={() => {
          try { download(readProgressiveArchive(localStorage), 'hit-dot-clown-progressive-browser-backup.json'); }
          catch { setNotice('Browser backup is unavailable.'); }
        }}>Export browser backup</button>
        {pilotLink}
      </div>
    </section>}
    {notice && <output>{notice}</output>}
  </section>;
}
