'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createParticipantCode, PARTICIPANT_CODE, SPEEDS } from '../systems/aiPractice.js';
import { STATUS } from '../systems/gameLogic.js';
import { ProgressiveGame, PROGRESSIVE_RUN, readProgressiveArchive, saveProgressiveRun } from '../systems/progressivePractice.js';
import { DEFAULT_ROUND_SECONDS } from '../systems/timerSettings.js';
import demo from '../systems/models/progressive-synthetic-demo.json';
import { exportDatabaseDataset, usePlaytestDatabase } from './usePlaytestDatabase.js';
import './ai-challenge.css';

const path = '/api/progressive-playtests';
const targets = [1, 2, 3, 4, 5];

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
  const [participant, setParticipant] = useState(null);
  const [code, setCode] = useState('');
  const [returning, setReturning] = useState(false);
  const [view, setView] = useState(null);
  const [result, setResult] = useState(null);
  const [notice, setNotice] = useState('');
  const [ready, setReady] = useState(false);
  const running = useRef(null);
  const database = usePlaytestDatabase(browserOnly ? 15000 : 4000, path, readProgressiveArchive);
  const saveToDatabase = database.save;
  const active = database.status?.browser?.active;
  const summary = database.status?.browser;
  const model = active?.model ?? demo;
  const ended = view?.status === STATUS.OVER;
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

  useEffect(() => {
    const frame = requestAnimationFrame(() => setReady(true));
    const timer = setInterval(() => {
      const current = running.current;
      if (current) show(current, current.engine.tick());
    }, 40);
    return () => { cancelAnimationFrame(frame); clearInterval(timer); running.current = null; };
  }, [show]);

  useEffect(() => {
    onControlsChange?.({ connected: false, ready: false, locked: playing });
  }, [onControlsChange, playing]);

  function applyCode(value) {
    const normalized = value.trim().toUpperCase();
    if (!PARTICIPANT_CODE.test(normalized)) { setNotice('Enter your full playtest code.'); return; }
    setParticipant(normalized);
    setReturning(false);
    setPolicy('collect');
    setNotice('');
  }

  function start() {
    if (running.current || (policy === 'collect' && !participant)) return;
    const engine = new ProgressiveGame({ policy, model: policy === 'adaptive' ? model : null, roundSeconds });
    const run = { format: PROGRESSIVE_RUN, id: crypto.randomUUID(), input: 'browser', participant, policy, roundSeconds,
      modelId: policy === 'adaptive' ? active?.id ?? demo.id : null, startedAt: new Date().toISOString() };
    running.current = { engine, run };
    setResult(null);
    setNotice('');
    setView(engine.start());
  }

  function hit(target) {
    const current = running.current;
    if (current) show(current, current.engine.hit(target));
  }

  function returnToSetup() {
    running.current = null;
    setView(null);
    setResult(null);
    setNotice('');
  }

  async function exportRuns() {
    try { download(await exportDatabaseDataset(path), 'hit-dot-clown-progressive-dataset.json'); }
    catch (error) { setNotice(error.message); }
  }

  const receipt = result?.id === database.receipt?.id ? database.receipt?.state : null;
  const cleared = result?.rounds.filter(({ completed }) => completed).length;
  const playable = view?.status === STATUS.PLAYER || view?.status === STATUS.FRENZY;
  return <section className="ai-carnival progressive-carnival" aria-label="Progressive AI Carnival Challenge">
    {!view && <section className="ai-panel" aria-label="Challenge setup">
      <div className="ai-intro">
        <span className="ai-pill">Unranked browser game</span>
        <p>Start with three flashes. Every clear adds one step. Your score and three lives carry across cycles.</p>
      </div>
      <label htmlFor="progressive-pace">Round settings</label>
      <select id="progressive-pace" value={policy} onChange={(event) => setPolicy(event.target.value)} disabled={!ready}>
        <option value="adaptive">Adaptive pace</option>
        <option value="fixed">Fixed medium pace</option>
        <option value="collect">Randomized pace</option>
      </select>
      {policy === 'adaptive' && <p className="ai-note">{active ? 'Decision tree trained on progressive playthroughs.'
        : 'Simulated-data model loaded. Adaptive pace uses sequence length and previous round performance.'}
        {active && ` Model ${active.id.slice(0, 8)}.`}</p>}
      <section className="ai-code" aria-label="Class playtest">
        <h3>Class playtest</h3>
        {participant ? <div className="ai-actions">
          <p>Playtest code <strong className="ai-participant-id">{participant}</strong></p>
          <button type="button" onClick={() => { setParticipant(null); setCode(''); if (policy === 'collect') setPolicy('adaptive'); }}>Switch to guest</button>
        </div> : returning ? <form onSubmit={(event) => { event.preventDefault(); applyCode(code); }}>
          <label htmlFor="progressive-code">Your playtest code</label>
          <input id="progressive-code" value={code} onChange={(event) => setCode(event.target.value)} maxLength={10} required autoComplete="off" />
          <div className="ai-actions">
            <button type="submit">Use my code</button>
            <button type="button" onClick={() => setReturning(false)}>Cancel</button>
          </div>
        </form> : <>
          <p className="ai-note">Join to try randomized pacing. Keep your code for repeat runs.</p>
          <div className="ai-actions"><button type="button" disabled={!ready} onClick={() => applyCode(createParticipantCode())}>Join playtest</button>
            <button type="button" disabled={!ready} onClick={() => setReturning(true)}>I have a code</button></div>
        </>}
      </section>
      <p className="ai-note">{roundSeconds} seconds per cycle, including the preview.</p>
      <button type="button" className="display-start-button" onClick={start}
        disabled={!ready || (policy === 'collect' && !participant) || (policy === 'adaptive' && database.available === null)}>Start challenge</button>
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
      {!ended && <>
        <div className="ai-targets" aria-label="Game targets">{targets.map((target) => {
          const lit = view.ledTesting || view.allTargetsOn || view.activeTarget === target;
          const feedback = view.feedbackTarget === target ? (view.correct ? ' is-correct' : ' is-wrong') : '';
          return <button type="button" key={target} aria-label={'Hit target ' + target} disabled={!playable}
            className={'ai-target' + (lit ? ' is-lit' : '') + feedback} onClick={() => hit(target)}>{target}</button>;
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
      <h3>Progressive playtest database</h3>
      {summary && <p>Saved runs <strong>{summary.runs}</strong> · Randomized players with two or more cycles <strong>{summary.randomizedPlayers}</strong></p>}
      {summary?.training === 'waiting-for-players' && <p>Training needs five coded randomized players who reached cycle 2.</p>}
      {summary?.training === 'waiting-for-outcomes' && <p>Training needs both clears and failures from the assigned players.</p>}
      {database.available === false && <p>The database is unavailable. Saved browser runs will retry when it reconnects.</p>}
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
