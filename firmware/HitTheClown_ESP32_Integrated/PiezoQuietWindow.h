#pragma once
#include <stdint.h>

// A LOW snapshot alone cannot prove the signal was quiet between loop polls.
// The ISR generation changes for every rising edge, including ignored hits.
struct PiezoQuietWindow {
  bool tracking = false;
  uint32_t lowSinceMs = 0;
  uint32_t generation = 0;

  constexpr void reset() { tracking = false; }

  constexpr bool observe(uint32_t now, uint32_t edges, bool allLow, uint32_t stableMs) {
    if (!allLow) {
      reset();
      return false;
    }
    if (!tracking || generation != edges) {
      tracking = true;
      generation = edges;
      lowSinceMs = now;
    }
    return now - lowSinceMs >= stableMs;
  }
};
