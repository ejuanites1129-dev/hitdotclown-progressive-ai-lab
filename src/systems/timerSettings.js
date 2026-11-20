export const TIMER_KEY = 'hit-the-clown-round-seconds';
export const DEFAULT_ROUND_SECONDS = 30;
export const MIN_ROUND_SECONDS = 5;
export const MAX_ROUND_SECONDS = 300;
export const validRoundSeconds = (seconds) => Number.isInteger(seconds) && seconds >= MIN_ROUND_SECONDS && seconds <= MAX_ROUND_SECONDS;
export function requireRoundSeconds(seconds) {
  if (!validRoundSeconds(seconds)) throw new RangeError('Choose a whole number from 5 to 300 seconds.');
  return seconds;
}
