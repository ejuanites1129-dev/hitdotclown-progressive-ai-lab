#pragma once
#include <stdint.h>

struct GameProgress {
  uint32_t level;
  uint32_t levelCycle;
  uint32_t sequenceLength;
  bool hardMode;
};

// No final level: add one remembered step after every completed cycle.
constexpr GameProgress progressForCycle(uint32_t cycle) {
  return {cycle, 1, cycle + 2, cycle >= 5};
}
