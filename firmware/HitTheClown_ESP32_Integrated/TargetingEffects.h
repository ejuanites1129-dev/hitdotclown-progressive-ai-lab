#pragma once
#include <stdint.h>

constexpr uint32_t FRENZY_DURATION_MS = 10000;
constexpr uint32_t FRENZY_FLASH_MS = 150;
struct FrenzyFlicker {
  bool enabled = false;
  bool on = false;
  uint32_t nextAt = 0;
  constexpr void cancel() { enabled = false; on = false; nextAt = 0; }
  constexpr void begin(uint32_t now) { enabled = true; on = true; nextAt = now + FRENZY_FLASH_MS; }
  constexpr bool advance(uint32_t now) {
    if (!enabled || static_cast<int32_t>(now - nextAt) < 0) return false;
    on = !on; nextAt = now + FRENZY_FLASH_MS;
    return true;
  }
};

constexpr bool successLightsOn(uint32_t elapsed) {
  return elapsed < 3000 && elapsed % 1000 < 500;
}

// Scheduling is independent of the memorized answer. All five target indices
// are eligible, including the active/expected target and the preceding target.
struct TargetingFlicker {
  enum class Event : uint8_t { NONE, START, ON, OFF, END };
  bool enabled = false;
  bool active = false;
  bool on = false;
  uint8_t target = 0;
  uint8_t flashes = 0;
  uint32_t nextAt = 0;
  constexpr void cancel() { enabled = false; active = false; on = false; }
  constexpr void wait(uint32_t now, uint32_t delayMs) {
    enabled = true; active = false; on = false; flashes = 0; nextAt = now + delayMs;
  }
  constexpr void begin(uint32_t now, uint8_t anyTarget) {
    enabled = true; active = true; on = true; target = anyTarget; flashes = 1; nextAt = now + 180;
  }
  constexpr Event advance(uint32_t now) {
    if (!enabled || static_cast<int32_t>(now - nextAt) < 0) return Event::NONE;
    if (!active) return Event::START;
    on = !on;
    nextAt = now + 180;
    if (on) { ++flashes; return Event::ON; }
    if (flashes >= 6) { active = false; return Event::END; }
    return Event::OFF;
  }
};
