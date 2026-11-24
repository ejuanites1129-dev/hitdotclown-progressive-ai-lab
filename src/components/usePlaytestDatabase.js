import { useCallback, useEffect, useRef, useState } from 'react';
import { readPlaytestArchive } from '../systems/playtestArchive.js';

const endpoint = '/api/ai-playtests';
const timeout = () => AbortSignal.timeout(4000);

export async function exportDatabaseDataset(path = endpoint) {
  const response = await fetch(path + '?export=dataset', { signal: timeout() });
  if (!response.ok) throw new Error('Could not export the database dataset.');
  return response.json();
}

export function usePlaytestDatabase(timeoutMs = 4000, path = endpoint, readArchive = readPlaytestArchive, expectedInput = null) {
  const queue = useRef(new Map());
  const syncing = useRef(false);
  const mounted = useRef(false);
  const [status, setStatus] = useState(null);
  const [available, setAvailable] = useState(null);
  const [receipt, setReceipt] = useState(null);

  const sync = useCallback(async () => {
    if (syncing.current) return;
    syncing.current = true;
    try {
      do {
        for (const [id, entry] of queue.current) {
          if (expectedInput && entry.run.input !== expectedInput) continue;
          const response = await fetch(path, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(entry), signal: AbortSignal.timeout(timeoutMs),
          });
          if (!response.ok && response.status !== 422) throw new Error('Save unavailable');
          queue.current.delete(id);
          if (mounted.current) {
            setReceipt((current) => current?.id === id ? { id, state: response.ok ? 'saved' : 'rejected' } : current);
          }
        }
        const response = await fetch(path, { signal: AbortSignal.timeout(timeoutMs) });
        if (!response.ok) throw new Error('Database unavailable');
        const nextStatus = await response.json();
        if (mounted.current) {
          setStatus(nextStatus);
          setAvailable(true);
        }
      } while ([...queue.current.values()].some((entry) => !expectedInput || entry.run.input === expectedInput));
    } catch {
      if (mounted.current) setAvailable(false);
    } finally {
      syncing.current = false;
    }
  }, [path, timeoutMs, expectedInput]);

  useEffect(() => {
    mounted.current = true;
    try {
      for (const run of readArchive(localStorage).sessions) {
        if (run.synthetic === undefined && !queue.current.has(run.id)) {
          queue.current.set(run.id, { run, source: 'browser_archive' });
        }
      }
    } catch {
      // New plays can still be saved directly to the database.
    }
    void sync();
    const timer = setInterval(sync, 20000);
    window.addEventListener('online', sync);
    return () => {
      mounted.current = false;
      clearInterval(timer);
      window.removeEventListener('online', sync);
    };
  }, [readArchive, sync]);

  const save = useCallback((run) => {
    queue.current.set(run.id, { run, source: 'playthrough' });
    setReceipt({ id: run.id, state: 'pending' });
    void sync();
  }, [sync]);

  return { status, available, receipt, save };
}
