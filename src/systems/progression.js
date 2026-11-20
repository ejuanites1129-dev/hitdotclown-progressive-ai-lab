export const FIRST_SEQUENCE_LENGTH = 3;
export const CYCLES_PER_LEVEL = 1;
export const FIRST_HARD_CYCLE = 5;

// Five physical targets can repeat in a sequence of any length.
export function progressionForCycle(cycle = 1, cyclesPerLevel = CYCLES_PER_LEVEL) {
  if (!Number.isSafeInteger(cycle) || cycle < 1) throw new RangeError('Cycle must be a positive integer.');
  if (![1, 2].includes(cyclesPerLevel)) throw new RangeError('Unsupported level progression.');
  const level = Math.floor((cycle - 1) / cyclesPerLevel) + 1;
  return {
    cycle, level, levelCycle: (cycle - 1) % cyclesPerLevel + 1,
    sequenceLength: FIRST_SEQUENCE_LENGTH + level - 1,
    hardMode: cycle >= FIRST_HARD_CYCLE,
  };
}
