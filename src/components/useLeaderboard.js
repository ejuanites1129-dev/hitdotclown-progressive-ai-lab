import { useCallback, useEffect, useRef, useState } from 'react';

const endpoint = '/api/leaderboard';
const queueKey = 'hit-dot-clown-ai-leaderboard-pending-v1';

function readQueue() {
  try {
    const value = JSON.parse(localStorage.getItem(queueKey) || '[]');
    return Array.isArray(value) ? value.filter((entry) => entry && typeof entry.id === 'string') : [];
  } catch { return []; }
}

function writeQueue(queue) {
  try { localStorage.setItem(queueKey, JSON.stringify(queue)); return true; }
  catch { return false; }
}

export function useLeaderboard() {
  const queue = useRef(readQueue());
  const syncing = useRef(false);
  const mounted = useRef(false);
  const [entries, setEntries] = useState([]);
  const [pending, setPending] = useState(queue.current.length);
  const [message, setMessage] = useState('');
  const [configured, setConfigured] = useState(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(endpoint, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'Leaderboard is temporarily unavailable.');
      if (mounted.current) {
        setEntries(body.entries || []);
        setConfigured(true);
        setMessage((current) => /temporarily unavailable|connecting|not configured/i.test(current) ? '' : current);
      }
      return true;
    } catch (error) {
      if (mounted.current) { setConfigured(false); setMessage(error.message); }
      return false;
    }
  }, []);

  const sync = useCallback(async () => {
    if (syncing.current || queue.current.length === 0) return;
    syncing.current = true;
    let saved = 0;
    try {
      const remaining = [];
      for (const entry of queue.current) {
        try {
          const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...entry, action: 'complete' }), signal: AbortSignal.timeout(10000) });
          if (!response.ok) throw new Error('Waiting to sync game results.');
          saved++;
        } catch { remaining.push(entry); }
      }
      queue.current = remaining;
      writeQueue(remaining);
      if (mounted.current) {
        setPending(remaining.length);
        if (saved) { setMessage('Game result saved to the leaderboard.'); await refresh(); }
        else if (remaining.length) setMessage('Game result is safely queued in this browser and will retry.');
      }
    } finally { syncing.current = false; }
  }, [refresh]);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    void sync();
    const timer = setInterval(() => { void refresh(); void sync(); }, 15000);
    window.addEventListener('online', sync);
    return () => { mounted.current = false; clearInterval(timer); window.removeEventListener('online', sync); };
  }, [refresh, sync]);

  const save = useCallback((attempt) => {
    if (!attempt || typeof attempt.id !== 'string') return;
    queue.current = [...queue.current.filter((entry) => entry.id !== attempt.id), attempt];
    const stored = writeQueue(queue.current);
    setPending(queue.current.length);
    setMessage(stored ? 'Saving game result to the leaderboard…' : 'This browser could not queue the result. Keep this page open while it saves.');
    void sync();
  }, [sync]);

  const invite = useCallback(async (details) => {
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...details, action: 'invite' }), signal: AbortSignal.timeout(10000) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || 'The leaderboard email could not be queued.');
      return body.emailReady ? 'Leaderboard link email queued.' : 'Email sending is not configured yet; your leaderboard score will still be saved.';
    } catch (error) { return error.message; }
  }, []);

  return { entries, pending, message, configured, refresh, save, invite };
}
