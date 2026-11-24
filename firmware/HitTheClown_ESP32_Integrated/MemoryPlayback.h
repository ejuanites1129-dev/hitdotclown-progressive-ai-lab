#pragma once
#include <stdint.h>

// One visibly flickering decoy is inserted before a non-first sequence step.
// Each advance emits at most one transition so a delayed loop cannot squeeze
// several flashes together and make them look like a steady light.
struct MemoryPlayback {
  static constexpr uint32_t SEQUENCE_ON_MS = 650;
  static constexpr uint32_t GAP_MS = 280;
  static constexpr uint32_t FLICKER_ON_MS = 180;
  static constexpr uint32_t FLICKER_OFF_MS = 180;
  static constexpr uint8_t FLICKERS = 3;

  enum class Kind : uint8_t { NONE, SEQUENCE_ON, SEQUENCE_OFF, DECOY_ON, DECOY_OFF };
  struct Cue { Kind kind; uint32_t position; bool finished; };

  uint32_t position = 0;
  uint32_t length = 0;
  uint32_t decoyBefore = 0;
  uint8_t flashes = 0;
  uint32_t nextAt = 0;
  uint32_t steadyMs = SEQUENCE_ON_MS;
  bool sequenceOn = false;
  bool decoyActive = false;
  bool decoyOn = false;
  bool decoyPlayed = false;

  constexpr void cancel() {
    length = 0;
    sequenceOn = false;
    decoyActive = false;
    decoyOn = false;
  }

  constexpr void begin(uint32_t now, uint32_t steps, uint32_t before, uint32_t durationMs = SEQUENCE_ON_MS) {
    steadyMs = durationMs;
    position = 0;
    length = steps;
    decoyBefore = before;
    flashes = 0;
    nextAt = now;
    sequenceOn = false;
    decoyActive = false;
    decoyOn = false;
    decoyPlayed = false;
  }

  constexpr Cue advance(uint32_t now) {
    if (position >= length || static_cast<int32_t>(now - nextAt) < 0) {
      return {Kind::NONE, position, false};
    }
    if (decoyActive) {
      if (decoyOn) {
        decoyOn = false;
        if (flashes == FLICKERS) {
          decoyActive = false;
          decoyPlayed = true;
          nextAt = now + GAP_MS;
        } else nextAt = now + FLICKER_OFF_MS;
        return {Kind::DECOY_OFF, position, false};
      }
      decoyOn = true;
      ++flashes;
      nextAt = now + FLICKER_ON_MS;
      return {Kind::DECOY_ON, position, false};
    }
    if (!sequenceOn) {
      if (!decoyPlayed && position == decoyBefore && position > 0) {
        decoyActive = true;
        decoyOn = true;
        flashes = 1;
        nextAt = now + FLICKER_ON_MS;
        return {Kind::DECOY_ON, position, false};
      }
      sequenceOn = true;
      nextAt = now + steadyMs;
      return {Kind::SEQUENCE_ON, position, false};
    }
    sequenceOn = false;
    const uint32_t completedPosition = position++;
    nextAt = now + GAP_MS;
    return {Kind::SEQUENCE_OFF, completedPosition, position >= length};
  }
};

// choice is an ordinal among targets other than the two neighboring real cues.
constexpr uint8_t decoyTargetForChoice(uint8_t previous, uint8_t next, uint8_t choice) {
  for (uint8_t target = 0; target < 5; ++target) {
    if (target == previous || target == next) continue;
    if (choice == 0) return target;
    --choice;
  }
  return 5; // Invalid choice; callers select from 3 or 4 eligible targets.
}
