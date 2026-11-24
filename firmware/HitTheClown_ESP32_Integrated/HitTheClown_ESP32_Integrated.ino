/*
  HIT THE CLOWN - ESP32 game controller

  Hardware:
    - 5 LED targets
    - 5 piezo impact sensors
    - Red START button on GPIO13 and blue game RESET button on GPIO12

  The ESP32 is the source of truth for the sequence, score, lives, and timer.
  It also sends newline-delimited JSON over USB Serial for the web dashboard.

  IMPORTANT: A piezo can generate voltage spikes. Do not connect it directly
  to an ESP32 pin. Use the protection circuit described in the README.
*/

#include <Arduino.h>
#include <esp_system.h>
#include <vector>
#include "PiezoQuietWindow.h"
#include "MemoryPlayback.h"
#include "TargetingEffects.h"
#include "GameProgress.h"

// ---------------------------------------------------------------------------
// Pin assignment - change these values if your wiring is different.
// This map is intended for a classic ESP32 DevKit / ESP32-WROOM board.
// ---------------------------------------------------------------------------

constexpr uint8_t TARGET_COUNT = 5;

// 1 = current wiring: protected DIGITAL piezo pulses.
// This requires idle LOW and safe pulses reaching a valid 3.3 V logic HIGH.
// It does not measure piezo amplitude or use the analog threshold settings.
// 0 = previous analog layout, requiring the opposite physical pin directions.
#define PIEZO_DIGITAL_PULSE_MODE 1

// One-target sensitivity experiment: bit 0 = target 1 (white, GPIO21).
// This target uses the internal ~45k pull-down instead of an external pull-down.
// Remove ONLY target 1's GPIO-to-GND resistor; retain its series 10k and protection.
// Other targets still require their external pull-downs. Set 0 to restore all.
constexpr uint8_t PIEZO_INTERNAL_PULLDOWN_MASK = 0x01;

#if PIEZO_DIGITAL_PULSE_MODE
// Array indices pair each piezo input with its same-color LED output.
// Target order: 1 white, 2 blue, 3 green, 4 yellow, 5 red.
// Match each LED to the same-color piezo; RX2=GPIO16 and TX2=GPIO17.
const uint8_t LED_PINS[TARGET_COUNT] = {32, 33, 25, 26, 14};
const uint8_t PIEZO_PINS[TARGET_COUNT] = {21, 19, 18, 17, 16};
#else
// Previous analog profile. GPIO25/26 use ADC2: keep Wi-Fi off in this profile.
const uint8_t LED_PINS[TARGET_COUNT] = {16, 17, 18, 19, 21};
const uint8_t PIEZO_PINS[TARGET_COUNT] = {26, 25, 33, 32, 35};
#endif
// GPIO16/17 require a WROOM/SOLO board (not WROVER with reserved PSRAM pins).
// Both buttons connect their GPIO to GND when pressed (active LOW).
// GPIO12 is a boot strap: do not add an external pull-up to 3V3 there.
constexpr uint8_t START_BUTTON_PIN = 13;
constexpr uint8_t RESET_BUTTON_PIN = 12;

// ANALOG PROFILE ONLY: tune after viewing the values in Serial Monitor.
// These settings have no effect on digital pulse sensitivity.
// Range is normally 0-4095 on an ESP32 using 12-bit ADC resolution.
int PIEZO_HIT_THRESHOLD[TARGET_COUNT] = {800, 800, 800, 800, 800};
constexpr int PIEZO_RELEASE_THRESHOLD = 180;

// ---------------------------------------------------------------------------
// Game settings
// ---------------------------------------------------------------------------

constexpr int CORRECT_HIT_POINTS = 10;
constexpr int WRONG_HIT_PENALTY = 5;
constexpr int STARTING_LIVES = 3;
constexpr uint32_t SUCCESS_CELEBRATION_MS = 3000;
constexpr uint32_t RACE_COUNTDOWN_MS = 4000;
constexpr uint8_t FRENZY_CHANCE_DENOMINATOR = 5;
constexpr int DEFAULT_ROUND_TIME_SECONDS = 30;
constexpr int MIN_ROUND_TIME_SECONDS = 5;
constexpr int MAX_ROUND_TIME_SECONDS = 300;
int roundTimeSeconds = DEFAULT_ROUND_TIME_SECONDS;
uint32_t memoryLightOnMs = 650;
bool ledTesting = false;
uint32_t ledTestStartedAt = 0;

constexpr uint32_t FIRST_SEQUENCE_LENGTH = 3;

// Steady cues and three-flash decoys are timed in MemoryPlayback.h.
// The 3-second count-in already prepares the player; start the lights immediately.
constexpr uint32_t MEMORY_START_DELAY_MS = 0;
constexpr uint32_t HIT_FEEDBACK_MS = 450;
constexpr uint32_t HIT_FLASH_INTERVAL_MS = 90;
constexpr uint32_t SENSOR_COOLDOWN_MS = 180;
constexpr uint32_t DIGITAL_RELEASE_STABLE_MS = 20;
constexpr uint32_t BUTTON_DEBOUNCE_MS = 35;
constexpr uint32_t SENSOR_STATUS_INTERVAL_MS = 500;

// Set true while checking the piezos. Every 100 ms the digital profile reports
// levels + rising-edge counters; the analog profile reports ADC values.
constexpr bool DEBUG_PIEZO_VALUES = false;

enum class GameState : uint8_t {
  READY,
  LED_TEST,
  COUNTDOWN,
  MEMORY_PHASE,
  PLAYER_TURN,
  FEEDBACK,
  ROUND_BREAK,
  FRENZY,
  GAME_OVER,
  VICTORY
};

GameState gameState = GameState::READY;
enum class BreakPhase : uint8_t { SUCCESS, COUNTDOWN };
BreakPhase breakPhase = BreakPhase::SUCCESS;
bool celebrationOn = false;
TargetingFlicker targetingFlicker;
FrenzyFlicker frenzyFlicker;
GameState ledTestReturnState = GameState::READY;
uint32_t countdownStartedAt = 0;
int countdownRemaining = 0;
uint32_t frenzyStartedAt = 0;
int frenzyHits = 0;
uint32_t breakStartedAt = 0;
bool pendingFrenzy = false;

std::vector<uint8_t> sequenceData;
uint32_t sequenceLength = FIRST_SEQUENCE_LENGTH;
std::vector<uint8_t> performedTargets;
std::vector<uint32_t> performedPositions;
uint32_t playerPosition = 0;
uint32_t cycle = 1;

int score = 0;
int lives = STARTING_LIVES;
uint32_t level = 1;
int timeRemaining = roundTimeSeconds;

MemoryPlayback memoryPlayback;

uint32_t roundStartedAt = 0;
int lastReportedTime = -1;

bool feedbackWasCorrect = false;
uint8_t feedbackTarget = 0;
uint32_t feedbackEndsAt = 0;
uint32_t nextFeedbackFlashAt = 0;
bool feedbackLedIsOn = false;

bool sensorsArmed = false;
uint32_t lastSensorHitAt = 0;

#if PIEZO_DIGITAL_PULSE_MODE
portMUX_TYPE piezoMux = portMUX_INITIALIZER_UNLOCKED;
volatile bool piezoCaptureEnabled = false;
volatile int pendingPiezoTarget = -1;
volatile uint32_t piezoPulseCounts[TARGET_COUNT] = {};
volatile uint32_t piezoEdgeGeneration = 0;
uint8_t piezoInterruptTargets[TARGET_COUNT] = {0, 1, 2, 3, 4};
PiezoQuietWindow digitalQuietWindow;

void ARDUINO_ISR_ATTR onPiezoPulse(void *argument) {
  const uint8_t target = *static_cast<uint8_t *>(argument);
  portENTER_CRITICAL_ISR(&piezoMux);
  piezoPulseCounts[target] = piezoPulseCounts[target] + 1;
  piezoEdgeGeneration = piezoEdgeGeneration + 1;
  // First edge wins. No Serial, scoring, LEDs, or allocation in the ISR.
  if (piezoCaptureEnabled && pendingPiezoTarget < 0) {
    pendingPiezoTarget = target;
    piezoCaptureEnabled = false;
  }
  portEXIT_CRITICAL_ISR(&piezoMux);
}

void setPiezoCapture(bool enabled) {
  portENTER_CRITICAL(&piezoMux);
  pendingPiezoTarget = -1;
  piezoCaptureEnabled = enabled;
  portEXIT_CRITICAL(&piezoMux);
}
#endif

void disarmPiezoInputs() {
  sensorsArmed = false;
#if PIEZO_DIGITAL_PULSE_MODE
  digitalQuietWindow.reset();
  setPiezoCapture(false);
#endif
}

bool lastRawButtonState = HIGH;
bool stableButtonState = HIGH;
uint32_t buttonChangedAt = 0;
bool lastRawResetButtonState = HIGH;
bool stableResetButtonState = HIGH;
uint32_t resetButtonChangedAt = 0;
uint32_t lastSensorStatusAt = 0;

String serialLine;
uint32_t lastDebugAt = 0;

bool timeReached(uint32_t now, uint32_t deadline) {
  return static_cast<int32_t>(now - deadline) >= 0;
}

const char *currentStatusText() {
  switch (gameState) {
    case GameState::READY:
      return "READY";
    case GameState::LED_TEST:
      return "LED TEST";
    case GameState::COUNTDOWN:
      return "COUNTDOWN";
    case GameState::MEMORY_PHASE:
      return "MEMORY PHASE";
    case GameState::PLAYER_TURN:
      return "PLAYER TURN";
    case GameState::FEEDBACK:
      return feedbackWasCorrect ? "HIT!" : "WRONG TARGET";
    case GameState::FRENZY:
      return "FRENZY";
    case GameState::ROUND_BREAK:
      return "ROUND BREAK";
    case GameState::GAME_OVER:
      return "GAME OVER";
    case GameState::VICTORY:
      return "VICTORY";
  }
  return "READY";
}

void sendState() {
  Serial.print(F("{\"type\":\"state\",\"status\":\""));
  Serial.print(currentStatusText());
  Serial.print(F("\",\"score\":"));
  Serial.print(score);
  Serial.print(F(",\"time\":"));
  Serial.print(timeRemaining);
  Serial.print(F(",\"roundSeconds\":"));
  Serial.print(roundTimeSeconds);
  Serial.print(F(",\"lightSeconds\":"));
  Serial.print(memoryLightOnMs / 1000.0f, 3);
  Serial.print(F(",\"ledTesting\":"));
  Serial.print(ledTesting ? F("true") : F("false"));
  Serial.print(F(",\"breakPhase\":\""));
  if (gameState == GameState::ROUND_BREAK) Serial.print(breakPhase == BreakPhase::SUCCESS ? F("success") : F("countdown"));
  Serial.print(F("\",\"phaseMs\":"));
  const uint32_t phaseDuration = breakPhase == BreakPhase::SUCCESS ? SUCCESS_CELEBRATION_MS : RACE_COUNTDOWN_MS;
  Serial.print(gameState == GameState::ROUND_BREAK ? min(millis() - breakStartedAt, phaseDuration) : 0);
  Serial.print(F(",\"allTargetsOn\":"));
  Serial.print(celebrationOn ? F("true") : F("false"));
  Serial.print(F(",\"countdown\":"));
  Serial.print(countdownRemaining);
  Serial.print(F(",\"frenzyHits\":"));
  Serial.print(frenzyHits);
  Serial.print(F(",\"level\":"));
  Serial.print(level);
  Serial.print(F(",\"cycle\":"));
  Serial.print(cycle);
  Serial.print(F(",\"levelCycle\":"));
  Serial.print(progressForCycle(cycle).levelCycle);
  Serial.print(F(",\"hardMode\":"));
  Serial.print(progressForCycle(cycle).hardMode ? F("true") : F("false"));
  Serial.print(F(",\"lives\":"));
  Serial.print(lives);
  Serial.print(F(",\"sequenceLength\":"));
  Serial.print(sequenceLength);
  Serial.print(F(",\"playerPosition\":"));
  Serial.print(playerPosition);
  Serial.println(F("}"));
}

void sendGameStart(const char *source) {
  Serial.print(F("{\"type\":\"game-start\",\"source\":\""));
  Serial.print(source);
  Serial.println(F("\"}"));
}

void sendTargetEvent(uint8_t targetIndex, bool active) {
  Serial.print(F("{\"type\":\"target-active\",\"target\":"));
  Serial.print(targetIndex + 1);
  Serial.print(F(",\"active\":"));
  Serial.print(active ? F("true") : F("false"));
  Serial.println(F("}"));
}

void sendSensorHit(uint8_t targetIndex, int value, bool correct) {
  Serial.print(F("{\"type\":\"sensor-hit\",\"target\":"));
  Serial.print(targetIndex + 1);
  Serial.print(F(",\"value\":"));
  Serial.print(value);
  Serial.print(F(",\"correct\":"));
  Serial.print(correct ? F("true") : F("false"));
  Serial.println(F("}"));
}

void sendScoreChange(int change) {
  Serial.print(F("{\"type\":\"score\",\"score\":"));
  Serial.print(score);
  Serial.print(F(",\"change\":"));
  Serial.print(change);
  Serial.println(F("}"));
}

void sendHello() {
  Serial.print(F("{\"type\":\"hello\",\"device\":\"HIT THE CLOWN\",\"version\":\"1.13.0\",\"targets\":5,\"configurableTimer\":true,\"configurableLight\":true,\"adaptivePace\":true,\"sensorMode\":\""));
  Serial.print(PIEZO_DIGITAL_PULSE_MODE ? F("digital-pulse") : F("analog"));
  Serial.println(F("\"}"));
}

void setTargetLed(uint8_t targetIndex, bool active, bool report = true) {
  if (targetIndex >= TARGET_COUNT) {
    return;
  }

  digitalWrite(LED_PINS[targetIndex], active ? HIGH : LOW);
  if (report) {
    sendTargetEvent(targetIndex, active);
  }
}

void turnAllTargetsOff(bool report = true) {
  targetingFlicker.cancel();
  frenzyFlicker.cancel();
  celebrationOn = false;
  ledTesting = false;
  memoryPlayback.cancel();
  for (uint8_t i = 0; i < TARGET_COUNT; i++) {
    setTargetLed(i, false, report);
  }
}

void generateSequence(uint32_t previousLength) {
  bool repeatedPrefix = previousLength > 0;
  sequenceData.resize(sequenceLength);
  for (uint32_t i = 0; i < sequenceLength; i++) {
    const uint8_t previousTarget = sequenceData[i];
    sequenceData[i] = static_cast<uint8_t>(random(TARGET_COUNT));
    if (i < previousLength && sequenceData[i] != previousTarget) repeatedPrefix = false;
  }
  // Even a coincidental random match must not replay the previous round.
  if (repeatedPrefix) {
    const uint8_t offset = 1 + static_cast<uint8_t>(random(TARGET_COUNT - 1));
    sequenceData[0] = (sequenceData[0] + offset) % TARGET_COUNT;
  }
}

void resetGame() {
  performedTargets.clear();
  performedPositions.clear();
  disarmPiezoInputs();
  pendingFrenzy = false;
  breakStartedAt = 0;
  frenzyHits = 0;
  countdownRemaining = 0;
  turnAllTargetsOff(false);
  gameState = GameState::READY;
  sequenceLength = FIRST_SEQUENCE_LENGTH;
  playerPosition = 0;
  score = 0;
  lives = STARTING_LIVES;
  level = 1;
  cycle = 1;
  timeRemaining = roundTimeSeconds;
  sensorsArmed = false;
  lastSensorHitAt = millis();
  sendState();
}

void beginPlayerTurn() {
  disarmPiezoInputs();
  turnAllTargetsOff();
  gameState = GameState::PLAYER_TURN;
  if (progressForCycle(cycle).hardMode) targetingFlicker.wait(millis(), 900 + static_cast<uint32_t>(random(1701)));
  playerPosition = 0;
  sensorsArmed = false;
  lastSensorHitAt = millis();
  sendState();
}

void beginMemoryPhase() {
  performedTargets.clear();
  performedPositions.clear();
  disarmPiezoInputs();
  frenzyHits = 0;
  countdownRemaining = 0;
  turnAllTargetsOff();
  gameState = GameState::MEMORY_PHASE;
  timeRemaining = roundTimeSeconds;
  lastReportedTime = timeRemaining;
  roundStartedAt = millis();
  // Memory playback contains genuine cues only. Distractions run in PLAYER_TURN.
  memoryPlayback.begin(roundStartedAt + MEMORY_START_DELAY_MS, sequenceLength, 0, memoryLightOnMs);
  sendState();
}

void startGame(const char *source) {
  if (gameState != GameState::READY &&
      gameState != GameState::GAME_OVER &&
      gameState != GameState::VICTORY) {
    return;
  }

  disarmPiezoInputs();
  score = 0;
  lives = STARTING_LIVES;
  level = 1;
  cycle = 1;
  sequenceLength = FIRST_SEQUENCE_LENGTH;
  playerPosition = 0;
  generateSequence(0);
  pendingFrenzy = false;
  frenzyHits = 0;
  sendGameStart(source);
  turnAllTargetsOff();
  timeRemaining = roundTimeSeconds;
  countdownRemaining = 3;
  countdownStartedAt = millis();
  gameState = GameState::COUNTDOWN;
  beginLedCheck(millis());
  sendState();
}

void sendSequenceReview() {
  Serial.print(F("{\"type\":\"sequence-review\",\"correct\":["));
  for (uint32_t i = 0; i < sequenceLength; ++i) {
    if (i) Serial.print(',');
    Serial.print(sequenceData[i] + 1);
  }
  Serial.print(F("],\"performed\":["));
  for (uint32_t i = 0; i < performedTargets.size(); ++i) {
    if (i) Serial.print(',');
    Serial.print(performedTargets[i] + 1);
  }
  Serial.print(F("],\"positions\":["));
  for (uint32_t i = 0; i < performedPositions.size(); ++i) {
    if (i) Serial.print(',');
    Serial.print(performedPositions[i]);
  }
  Serial.println(F("]}"));
}

void beginLedCheck(uint32_t now) {
  ledTestStartedAt = now;
  ledTesting = true;
  for (uint8_t i = 0; i < TARGET_COUNT; ++i) setTargetLed(i, true);
}

void updateLedCheck(uint32_t now) {
  if (ledTesting && now - ledTestStartedAt >= 800) {
    turnAllTargetsOff();
    sendState();
  }
  if (gameState == GameState::LED_TEST && now - ledTestStartedAt >= 1200) {
    gameState = ledTestReturnState;
    sendState();
    if (gameState == GameState::GAME_OVER || gameState == GameState::VICTORY) sendSequenceReview();
  }
}

void sendSettings() {
  Serial.print(F("{\"type\":\"settings\",\"roundSeconds\":"));
  Serial.print(roundTimeSeconds);
  Serial.print(F(",\"lightSeconds\":"));
  Serial.print(memoryLightOnMs / 1000.0f, 3);
  Serial.println(F("}"));
}

void finishGameOver(bool timerExpired) {
  disarmPiezoInputs();
  turnAllTargetsOff();
  if (timerExpired) {
    timeRemaining = 0;
  }
  gameState = GameState::GAME_OVER;
  sendState();
  sendSequenceReview();
  Serial.println(F("{\"type\":\"game-over\"}"));
}

void finishVictory() {
  disarmPiezoInputs();
  turnAllTargetsOff();
  gameState = GameState::VICTORY;
  sendState();
  sendSequenceReview();
  Serial.println(F("{\"type\":\"victory\"}"));
}

void finishCompletedSequence() {
  const uint32_t previousLength = sequenceLength;
  const GameProgress next = progressForCycle(++cycle);
  level = next.level;
  sequenceLength = next.sequenceLength;
  generateSequence(previousLength);
  beginMemoryPhase();
}

void beginFrenzy() {
  disarmPiezoInputs();
  countdownRemaining = 0;
  gameState = GameState::FRENZY;
  frenzyStartedAt = millis();
  frenzyFlicker.begin(frenzyStartedAt);
  celebrationOn = true;
  frenzyHits = 0;
  timeRemaining = static_cast<int>(FRENZY_DURATION_MS / 1000UL);
  lastReportedTime = timeRemaining;
  sensorsArmed = false;
  lastSensorHitAt = millis();
  for (uint8_t i = 0; i < TARGET_COUNT; i++) setTargetLed(i, true);
  sendState();
}

void beginRoundBreak() {
  disarmPiezoInputs();
  turnAllTargetsOff();
  gameState = GameState::ROUND_BREAK;
  sensorsArmed = false;
  breakPhase = BreakPhase::SUCCESS;
  countdownRemaining = 3;
  breakStartedAt = millis();
  celebrationOn = true;
  for (uint8_t i = 0; i < TARGET_COUNT; ++i) setTargetLed(i, true);
  sendState();
}

void beginRaceCountdown() {
  turnAllTargetsOff();
  gameState = GameState::ROUND_BREAK;
  breakPhase = BreakPhase::COUNTDOWN;
  breakStartedAt = millis();
  countdownRemaining = 4;
  sendState();
}

void updateRoundBreak() {
  const uint32_t elapsed = millis() - breakStartedAt;
  const uint32_t duration = breakPhase == BreakPhase::SUCCESS ? SUCCESS_CELEBRATION_MS : RACE_COUNTDOWN_MS;
  if (elapsed >= duration) {
    countdownRemaining = 0;
    turnAllTargetsOff();
    if (breakPhase == BreakPhase::SUCCESS) {
      const bool frenzy = pendingFrenzy;
      pendingFrenzy = false;
      if (frenzy) beginFrenzy();
      else beginRaceCountdown();
    } else finishCompletedSequence();
    return;
  }
  const bool lightsOn = breakPhase == BreakPhase::SUCCESS && successLightsOn(elapsed);
  bool lightsChanged = lightsOn != celebrationOn;
  if (lightsChanged) {
    celebrationOn = lightsOn;
    for (uint8_t i = 0; i < TARGET_COUNT; ++i) setTargetLed(i, lightsOn);
  }
  const int updated = static_cast<int>((duration - elapsed + 999) / 1000UL);
  if (updated != countdownRemaining || lightsChanged) {
    countdownRemaining = updated;
    sendState();
  }
}

void updateFrenzy() {
  const uint32_t now = millis();
  const uint32_t elapsed = now - frenzyStartedAt;
  if (elapsed >= FRENZY_DURATION_MS) {
    turnAllTargetsOff();
    beginRaceCountdown();
    return;
  }
  timeRemaining = static_cast<int>((FRENZY_DURATION_MS - elapsed + 999) / 1000UL);
  const bool lightsChanged = frenzyFlicker.advance(now);
  if (lightsChanged) {
    celebrationOn = frenzyFlicker.on;
    for (uint8_t i = 0; i < TARGET_COUNT; ++i) setTargetLed(i, celebrationOn);
  }
  if (timeRemaining != lastReportedTime || lightsChanged) {
    lastReportedTime = timeRemaining;
    sendState();
  }
}

void beginHitFeedback(uint8_t targetIndex, bool correct) {
  if (targetingFlicker.on) setTargetLed(targetingFlicker.target, false);
  targetingFlicker.cancel();
  disarmPiezoInputs();
  gameState = GameState::FEEDBACK;
  feedbackWasCorrect = correct;
  feedbackTarget = targetIndex;
  feedbackEndsAt = millis() + HIT_FEEDBACK_MS;
  nextFeedbackFlashAt = millis() + HIT_FLASH_INTERVAL_MS;
  feedbackLedIsOn = true;
  setTargetLed(targetIndex, true);
  sendState();
}

void processTargetHit(uint8_t targetIndex, int sensorValue) {
  if (gameState == GameState::FRENZY) {
    score += CORRECT_HIT_POINTS;
    frenzyHits++;
    sendSensorHit(targetIndex, sensorValue, true);
    sendScoreChange(CORRECT_HIT_POINTS);
    sendState();
    return;
  }
  if (gameState != GameState::PLAYER_TURN) {
    return;
  }

  const uint8_t expectedTarget = sequenceData[playerPosition];
  performedTargets.push_back(targetIndex);
  performedPositions.push_back(playerPosition);
  const bool correct = targetIndex == expectedTarget;
  sendSensorHit(targetIndex, sensorValue, correct);

  if (correct) {
    score += CORRECT_HIT_POINTS;
    playerPosition++;
    sendScoreChange(CORRECT_HIT_POINTS);
  } else {
    score -= WRONG_HIT_PENALTY;
    if (score < 0) {
      score = 0;
    }
    lives--;
    sendScoreChange(-WRONG_HIT_PENALTY);
  }

  if (correct && playerPosition >= sequenceLength) {
    pendingFrenzy = random(FRENZY_CHANCE_DENOMINATOR) == 0;
    beginRoundBreak();
  } else beginHitFeedback(targetIndex, correct);
}

void updateStartCountdown() {
  const uint32_t elapsedSeconds = (millis() - countdownStartedAt) / 1000UL;
  const int updated = 3 - static_cast<int>(elapsedSeconds);
  if (updated <= 0) {
    beginMemoryPhase();
  } else if (updated != countdownRemaining) {
    countdownRemaining = updated;
    sendState();
  }
}

void updateMemoryPhase(uint32_t now) {
  const MemoryPlayback::Cue cue = memoryPlayback.advance(now);
  switch (cue.kind) {
    case MemoryPlayback::Kind::SEQUENCE_ON:
      setTargetLed(sequenceData[cue.position], true);
      break;
    case MemoryPlayback::Kind::SEQUENCE_OFF:
      setTargetLed(sequenceData[cue.position], false);
      break;
    case MemoryPlayback::Kind::DECOY_ON:
    case MemoryPlayback::Kind::DECOY_OFF:
      return; // Disabled: memory playback is started with decoyBefore=0.
    case MemoryPlayback::Kind::NONE:
      return;
  }
  if (cue.finished) beginPlayerTurn();
}

void updateFeedback(uint32_t now) {
  if (timeReached(now, nextFeedbackFlashAt) && !timeReached(now, feedbackEndsAt)) {
    feedbackLedIsOn = !feedbackLedIsOn;
    setTargetLed(feedbackTarget, feedbackLedIsOn);
    nextFeedbackFlashAt = now + HIT_FLASH_INTERVAL_MS;
  }

  if (!timeReached(now, feedbackEndsAt)) {
    return;
  }

  setTargetLed(feedbackTarget, false);

  if (!feedbackWasCorrect && lives <= 0) {
    finishGameOver(false);
    return;
  }

  gameState = GameState::PLAYER_TURN;
  if (progressForCycle(cycle).hardMode) targetingFlicker.wait(millis(), 900 + static_cast<uint32_t>(random(1701)));
  sendState();
}

void updateTargetingDistraction(uint32_t now) {
  if (gameState != GameState::PLAYER_TURN || !progressForCycle(cycle).hardMode) return;
  const TargetingFlicker::Event event = targetingFlicker.advance(now);
  if (event == TargetingFlicker::Event::START) {
    // No exclusion for the current active/expected target: every GPIO is eligible.
    targetingFlicker.begin(now, static_cast<uint8_t>(random(TARGET_COUNT)));
    setTargetLed(targetingFlicker.target, true);
  } else if (event == TargetingFlicker::Event::ON) setTargetLed(targetingFlicker.target, true);
  else if (event == TargetingFlicker::Event::OFF || event == TargetingFlicker::Event::END) {
    setTargetLed(targetingFlicker.target, false);
    if (event == TargetingFlicker::Event::END) targetingFlicker.wait(now, 900 + static_cast<uint32_t>(random(1701)));
  }
}

void updateRoundTimer() {
  // Completing the final valid hit wins the round even if its success flash
  // crosses the old deadline. The inter-round break never uses round time.
  if (gameState == GameState::FEEDBACK && feedbackWasCorrect && playerPosition >= sequenceLength) {
    return;
  }
  if (gameState != GameState::MEMORY_PHASE &&
      gameState != GameState::PLAYER_TURN && gameState != GameState::FEEDBACK) {
    return;
  }

  const uint32_t elapsedSeconds = (millis() - roundStartedAt) / 1000UL;
  int updatedTime = roundTimeSeconds - static_cast<int>(elapsedSeconds);
  if (updatedTime < 0) {
    updatedTime = 0;
  }

  timeRemaining = updatedTime;
  if (timeRemaining != lastReportedTime) {
    lastReportedTime = timeRemaining;
    sendState();
  }

  if (timeRemaining <= 0) {
    finishGameOver(true);
  }
}

int findHitTarget(int &peakValue) {
  const uint32_t now = millis();

#if PIEZO_DIGITAL_PULSE_MODE
  peakValue = 0;
  if (!sensorsArmed) {
    portENTER_CRITICAL(&piezoMux);
    const uint32_t generation = piezoEdgeGeneration;
    portEXIT_CRITICAL(&piezoMux);
    bool allReleased = true;
    for (uint8_t i = 0; i < TARGET_COUNT; i++) {
      if (digitalRead(PIEZO_PINS[i]) != LOW) allReleased = false;
    }
    if (digitalQuietWindow.observe(now, generation, allReleased, DIGITAL_RELEASE_STABLE_MS) &&
        now - lastSensorHitAt >= SENSOR_COOLDOWN_MS) {
      // Do not lose a pulse arriving between the LOW reads and arming.
      portENTER_CRITICAL(&piezoMux);
      if (piezoEdgeGeneration == generation) {
        pendingPiezoTarget = -1;
        piezoCaptureEnabled = true;
        sensorsArmed = true;
      }
      portEXIT_CRITICAL(&piezoMux);
    }
    return -1;
  }
  portENTER_CRITICAL(&piezoMux);
  const int target = pendingPiezoTarget;
  if (target >= 0) {
    pendingPiezoTarget = -1;
    piezoCaptureEnabled = false;
  }
  portEXIT_CRITICAL(&piezoMux);
  if (target >= 0) {
    sensorsArmed = false;
    digitalQuietWindow.reset();
    lastSensorHitAt = now;
    peakValue = 1; // Logic pulse, not an ADC/impact-strength measurement.
  }
  return target;
#else

  if (!sensorsArmed) {
    bool allReleased = true;
    for (uint8_t i = 0; i < TARGET_COUNT; i++) {
      if (analogRead(PIEZO_PINS[i]) > PIEZO_RELEASE_THRESHOLD) {
        allReleased = false;
      }
    }

    if (allReleased && now - lastSensorHitAt >= SENSOR_COOLDOWN_MS) {
      sensorsArmed = true;
    }
    return -1;
  }

  int bestTarget = -1;
  int bestMargin = -1;
  peakValue = 0;

  // Choose the sensor that exceeded its own threshold by the largest amount.
  // This helps reduce false target selection caused by vibration cross-talk.
  for (uint8_t i = 0; i < TARGET_COUNT; i++) {
    const int value = analogRead(PIEZO_PINS[i]);
    const int margin = value - PIEZO_HIT_THRESHOLD[i];
    if (margin >= 0 && margin > bestMargin) {
      bestMargin = margin;
      bestTarget = i;
      peakValue = value;
    }
  }

  if (bestTarget >= 0) {
    sensorsArmed = false;
    lastSensorHitAt = now;
  }

  return bestTarget;
#endif
}

void updatePiezoSensors() {
  if (gameState != GameState::PLAYER_TURN && gameState != GameState::FRENZY) {
    return;
  }

  int peakValue = 0;
  const int hitTarget = findHitTarget(peakValue);
  if (hitTarget >= 0) {
    processTargetHit(static_cast<uint8_t>(hitTarget), peakValue);
  }
}

bool updateButtonPress(uint8_t pin, bool &lastRaw, bool &stable, uint32_t &changedAt, uint32_t now) {
  const bool rawState = digitalRead(pin);
  if (rawState != lastRaw) {
    lastRaw = rawState;
    changedAt = now;
  }
  if (rawState != stable && now - changedAt >= BUTTON_DEBOUNCE_MS) {
    stable = rawState;
    return stable == LOW;
  }
  return false;
}

void updateControlButtons(uint32_t now) {
  // Update both debouncers even when RESET wins, so a held START is not queued.
  const bool resetPressed = updateButtonPress(RESET_BUTTON_PIN, lastRawResetButtonState,
    stableResetButtonState, resetButtonChangedAt, now);
  const bool startPressed = updateButtonPress(START_BUTTON_PIN, lastRawButtonState,
    stableButtonState, buttonChangedAt, now);
  if (resetPressed) {
    resetGame();
    return;
  }
  if (stableResetButtonState == LOW) return;
  if (startPressed) startGame("button");
}

void sendSensorStatus(uint32_t now, bool force) {
#if PIEZO_DIGITAL_PULSE_MODE
  if (!force && now - lastSensorStatusAt < SENSOR_STATUS_INTERVAL_MS) return;
  lastSensorStatusAt = now;
  uint32_t counts[TARGET_COUNT];
  uint8_t levels[TARGET_COUNT];
  bool anyHigh = false;
  for (uint8_t i = 0; i < TARGET_COUNT; i++) {
    levels[i] = digitalRead(PIEZO_PINS[i]);
    if (levels[i] != LOW) anyHigh = true;
  }
  bool capturing;
  int pending;
  portENTER_CRITICAL(&piezoMux);
  for (uint8_t i = 0; i < TARGET_COUNT; i++) counts[i] = piezoPulseCounts[i];
  capturing = piezoCaptureEnabled;
  pending = pendingPiezoTarget;
  portEXIT_CRITICAL(&piezoMux);
  const bool active = gameState == GameState::PLAYER_TURN || gameState == GameState::FRENZY;
  const char *armState = !active ? "inactive" : pending >= 0 ? "hit-pending"
    : capturing ? "armed" : anyHigh ? "waiting-low"
    : now - lastSensorHitAt < SENSOR_COOLDOWN_MS ? "cooldown" : "settling";
  Serial.print(F("{\"type\":\"sensor-status\",\"mode\":\"digital-pulse\",\"pins\":["));
  for (uint8_t i = 0; i < TARGET_COUNT; i++) {
    if (i > 0) Serial.print(',');
    Serial.print(PIEZO_PINS[i]);
  }
  Serial.print(F("],\"levels\":["));
  for (uint8_t i = 0; i < TARGET_COUNT; i++) {
    if (i > 0) Serial.print(',');
    Serial.print(levels[i]);
  }
  Serial.print(F("],\"pulses\":["));
  for (uint8_t i = 0; i < TARGET_COUNT; i++) {
    if (i > 0) Serial.print(',');
    Serial.print(counts[i]);
  }
  Serial.print(F("],\"armed\":"));
  Serial.print(sensorsArmed ? F("true") : F("false"));
  Serial.print(F(",\"capturing\":"));
  Serial.print(capturing ? F("true") : F("false"));
  Serial.print(F(",\"uptimeMs\":"));
  Serial.print(now);
  Serial.print(F(",\"armState\":\""));
  Serial.print(armState);
  Serial.print('"');
  Serial.print(F(",\"start\":{\"pin\":"));
  Serial.print(START_BUTTON_PIN);
  Serial.print(F(",\"level\":"));
  Serial.print(digitalRead(START_BUTTON_PIN));
  Serial.print(F("},\"reset\":{\"pin\":"));
  Serial.print(RESET_BUTTON_PIN);
  Serial.print(F(",\"level\":"));
  Serial.print(digitalRead(RESET_BUTTON_PIN));
  Serial.println(F("}}"));
#endif
}

void handleSerialCommand(String command) {
  command.trim();
  command.toUpperCase();

  if (command == "TEST_LEDS") {
    if (gameState != GameState::READY && gameState != GameState::GAME_OVER && gameState != GameState::VICTORY) {
      Serial.println(F("{\"type\":\"error\",\"message\":\"Finish or reset before testing LEDs.\"}"));
      return;
    }
    ledTestReturnState = gameState;
    gameState = GameState::LED_TEST;
    beginLedCheck(millis());
    sendState();
    return;
  }
  if (command.startsWith("SET_LIGHT_MS ")) {
    if (gameState != GameState::READY && gameState != GameState::GAME_OVER && gameState != GameState::VICTORY
        && gameState != GameState::ROUND_BREAK) {
      Serial.println(F("{\"type\":\"error\",\"message\":\"Change light duration before starting or during the cycle break.\"}"));
      return;
    }
    String value = command.substring(13);
    bool digits = value.length() > 0 && value.length() <= 4;
    for (unsigned int i = 0; i < value.length(); ++i) if (value[i] < '0' || value[i] > '9') digits = false;
    const long duration = value.toInt();
    if (!digits || duration < 200 || duration > 5000) {
      Serial.println(F("{\"type\":\"error\",\"message\":\"Light duration must be 0.2 to 5 seconds.\"}"));
      return;
    }
    memoryLightOnMs = static_cast<uint32_t>(duration);
    sendSettings();
    sendState();
    return;
  }

  // Settings affect future rounds only and cannot change during active play.
  if (command.startsWith("SET_TIME ")) {
    if (gameState != GameState::READY &&
        gameState != GameState::GAME_OVER &&
        gameState != GameState::VICTORY) {
      Serial.println(F("{\"type\":\"error\",\"message\":\"Finish or reset the game before changing its timer.\"}"));
      return;
    }
    String value = command.substring(9);
    value.trim();
    bool digitsOnly = value.length() > 0 && value.length() <= 3;
    for (unsigned int i = 0; i < value.length(); i++) {
      if (value[i] < '0' || value[i] > '9') digitsOnly = false;
    }
    const long seconds = value.toInt();
    if (!digitsOnly || seconds < MIN_ROUND_TIME_SECONDS || seconds > MAX_ROUND_TIME_SECONDS) {
      Serial.println(F("{\"type\":\"error\",\"message\":\"Choose a whole number from 5 to 300 seconds.\"}"));
      return;
    }
    roundTimeSeconds = static_cast<int>(seconds);
    if (gameState == GameState::READY) timeRemaining = roundTimeSeconds;
    sendSettings();
    sendState();
    return;
  }

  // Both plain commands and simple JSON commands are accepted:
  // START
  // {"command":"START"}
  if (command.indexOf("RESET") >= 0) {
    resetGame();
  } else if (command.indexOf("START") >= 0) {
    startGame("web");
  } else if (command.indexOf("PING") >= 0) {
    sendHello();
    sendState();
    sendSensorStatus(millis(), true);
    if (gameState == GameState::GAME_OVER || gameState == GameState::VICTORY) sendSequenceReview();
  }
}

void updateSerialInput() {
  while (Serial.available() > 0) {
    const char incoming = static_cast<char>(Serial.read());

    if (incoming == '\n') {
      if (serialLine.length() > 0) {
        handleSerialCommand(serialLine);
        serialLine = "";
      }
    } else if (incoming != '\r') {
      if (serialLine.length() < 120) {
        serialLine += incoming;
      } else {
        serialLine = "";
      }
    }
  }
}

void sendPiezoDebugValues(uint32_t now) {
  if (!DEBUG_PIEZO_VALUES || now - lastDebugAt < 100) {
    return;
  }

  lastDebugAt = now;
#if PIEZO_DIGITAL_PULSE_MODE
  uint32_t counts[TARGET_COUNT];
  portENTER_CRITICAL(&piezoMux);
  for (uint8_t i = 0; i < TARGET_COUNT; i++) counts[i] = piezoPulseCounts[i];
  portEXIT_CRITICAL(&piezoMux);
  Serial.print(F("{\"type\":\"piezo-debug\",\"mode\":\"digital-pulse\",\"values\":["));
#else
  Serial.print(F("{\"type\":\"piezo-debug\",\"values\":["));
#endif
  for (uint8_t i = 0; i < TARGET_COUNT; i++) {
    if (i > 0) {
      Serial.print(',');
    }
#if PIEZO_DIGITAL_PULSE_MODE
    Serial.print(digitalRead(PIEZO_PINS[i]));
#else
    Serial.print(analogRead(PIEZO_PINS[i]));
#endif
  }
#if PIEZO_DIGITAL_PULSE_MODE
  Serial.print(F("],\"pulses\":["));
  for (uint8_t i = 0; i < TARGET_COUNT; i++) {
    if (i > 0) Serial.print(',');
    Serial.print(counts[i]);
  }
#endif
  Serial.println(F("]}"));
}

void setup() {
  Serial.begin(115200);
  serialLine.reserve(128);

  for (uint8_t i = 0; i < TARGET_COUNT; i++) {
    pinMode(LED_PINS[i], OUTPUT);
    digitalWrite(LED_PINS[i], LOW);
#if PIEZO_DIGITAL_PULSE_MODE
    pinMode(PIEZO_PINS[i], (PIEZO_INTERNAL_PULLDOWN_MASK & (1u << i)) ? INPUT_PULLDOWN : INPUT);
#else
    pinMode(PIEZO_PINS[i], INPUT);
#endif
  }

  pinMode(START_BUTTON_PIN, INPUT_PULLUP);
  pinMode(RESET_BUTTON_PIN, INPUT_PULLUP);
#if PIEZO_DIGITAL_PULSE_MODE
  // Selected targets use the internal pull-down; others need an external bleed.
  // A pull-down sets idle LOW and does not replace input voltage protection.
  for (uint8_t i = 0; i < TARGET_COUNT; i++) {
    attachInterruptArg(PIEZO_PINS[i], onPiezoPulse, &piezoInterruptTargets[i], RISING);
  }
#else
  analogReadResolution(12);
#endif
  randomSeed(esp_random());

  delay(250);
  sendHello();
  resetGame();
}

void loop() {
  const uint32_t now = millis();

  updateSerialInput();
  updateControlButtons(now);
  updateLedCheck(millis());
  sendPiezoDebugValues(now);
  // Expire the round before processing LEDs or accepting another target hit.
  updateRoundTimer();

  switch (gameState) {
    case GameState::COUNTDOWN:
      updateStartCountdown();
      break;

    case GameState::ROUND_BREAK:
      updateRoundBreak();
      break;

    case GameState::MEMORY_PHASE:
      updateMemoryPhase(now);
      break;

    case GameState::PLAYER_TURN:
      updateTargetingDistraction(millis());
      updatePiezoSensors();
      break;

    case GameState::FEEDBACK:
      updateFeedback(now);
      break;

    case GameState::FRENZY:
      updateFrenzy();
      if (gameState == GameState::FRENZY) updatePiezoSensors();
      break;

    case GameState::READY:
    case GameState::LED_TEST:
    case GameState::GAME_OVER:
    case GameState::VICTORY:
      break;
  }
  sendSensorStatus(millis(), false);
}




