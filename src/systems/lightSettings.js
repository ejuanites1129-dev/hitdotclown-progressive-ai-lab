export const LIGHT_KEY = 'hit-dot-clown-light-seconds';
export const DEFAULT_LIGHT_SECONDS = 0.65;
export const validLightSeconds = (value) => typeof value === 'number' && Number.isFinite(value)
  && value >= 0.2 && value <= 5 && Math.abs(value * 1000 - Math.round(value * 1000)) < 0.00001;
export function requireLightSeconds(value) {
  if (!validLightSeconds(value)) throw new RangeError('Choose a light duration from 0.2 to 5 seconds (up to three decimal places).');
  return value;
}
