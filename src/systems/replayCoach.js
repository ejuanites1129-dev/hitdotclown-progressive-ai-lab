import { SPEEDS } from './aiPractice.js';

function plural(value, singular, multiple = singular + 's') {
  return value === 1 ? singular : multiple;
}

export function createReplayCoach(rounds) {
  if (!Array.isArray(rounds) || rounds.length === 0) return null;

  const played = rounds.filter((round) => round && Number.isFinite(round.sequenceLength));
  if (!played.length) return null;

  const cleared = played.filter((round) => round.completed === true).length;
  const longest = Math.max(...played.map(({ sequenceLength }) => sequenceLength));
  const misses = played.reduce((total, round) => total + (Number.isFinite(round.misses) ? Math.max(0, round.misses) : 0), 0);
  const correctHits = played.reduce((total, round) => total + (Number.isFinite(round.correctHits) ? Math.max(0, round.correctHits) : 0), 0);
  const timeouts = played.filter(({ outcome }) => outcome === 'Timed out').length;
  const last = played.at(-1);
  const missSummary = misses === 0 ? 'no misses' : `${misses} ${plural(misses, 'miss', 'misses')}`;
  const summary = `${cleared} ${plural(cleared, 'cycle')} cleared · ${longest} lights reached · ${correctHits} correct ${plural(correctHits, 'hit')} · ${missSummary}`;
  const lastPace = SPEEDS[last.speed]?.label?.toLowerCase() ?? 'unknown';
  const lastPlayTime = Number.isFinite(last.playMs) ? `${(last.playMs / 1000).toFixed(1)}s` : 'not recorded';
  const details = `Last cycle: ${lastPace} preview · ${lastPlayTime}${timeouts ? ` · ${timeouts} ${plural(timeouts, 'timeout')}` : ''}`;
  const timedOut = last.outcome === 'Timed out';

  let recommendation;
  if (timedOut) {
    recommendation = 'The timer includes the light preview. Stay ready during the flashes, then start as soon as “Your turn” appears.';
  } else if (played.length >= 5 && last.misses > 0) {
    recommendation = 'From cycle 5 onward, flickers are distractions. Follow the sequence you memorized, even if another light flashes.';
  } else if (last.misses >= 2 || misses >= 3) {
    recommendation = 'Remember the pattern in small groups of two or three lights, then mentally replay the full order before tapping.';
  } else if (last.misses > 0 && lastPace === 'fast') {
    recommendation = 'The last preview was fast. Take a moment after it ends to replay the order in your head before tapping.';
  } else if (last.misses > 0) {
    recommendation = 'Before tapping, replay the sequence once in your head and focus on its order rather than the flashing lights.';
  } else if (last.completed) {
    recommendation = 'Nice clear. Keep a steady tapping rhythm as each completed cycle adds one light to the next sequence.';
  } else {
    recommendation = 'Watch the full preview, then begin promptly when “Your turn” appears. Keep the order you memorized.';
  }

  return { summary, details, recommendation };
}
