## Current game rules - firmware 1.12.0

Frenzy lasts ten seconds. All five LEDs repeat 150 ms ON / 150 ms OFF, and any
target scores in either light state. Each completed cycle adds one sequence
step: 3, 4, 5, 6 and onward, with no final level. Distractions still start on
cycle five, in PLAYER TURN only. Existing scoring, lives, timer, latest pin map
and white-only internal pull-down configuration are retained. Upload with all
four adjacent headers and reconnect; confirm 1.12.0.

See FINAL PROJECT/FEATURE_UPDATE_1_12.md for full timing and progression details.
The following earlier notes are historical where they describe older rules.

## White-target sensitivity experiment - firmware 1.11.2

Target 1 (white piezo GPIO21, LED GPIO32) now enables INPUT_PULLDOWN, nominally
45k internally. For this target only, remove the external GPIO-to-GND 10k
pull-down. Keep the series 10k, the piezo ground connection and appropriate
input voltage protection. The other four targets retain INPUT and need their
external pull-downs. No game rules or pin assignments change.

PIEZO_INTERNAL_PULLDOWN_MASK=0x01 selects white only; set it to 0 and restore
the external pull-down if returning to the previous configuration. The analog
profile is unaffected. Upload with all four adjacent headers and confirm 1.11.2.
This is a loading adjustment, not a programmable digital voltage threshold.

Wire with USB disconnected. Upper rail diode: anode at the GPIO junction,
cathode/band at ESP32 3V3. Lower diode: anode at GND, cathode/band at the junction.
Both are separate branches. The piezo signal reaches the junction through the
series 10k; the other piezo lead connects to ESP32 GND. A 1N4148 rail-clamp pair
does not guarantee staying within GPIO voltage limits, so appropriate protection
must be verified before powered impact tests. Internal pull-down is not protection.

## Current target wiring - firmware 1.11.1

| Target | Color | LED GPIO | Piezo GPIO |
| --- | --- | --- | --- |
| 1 | White | 32 | 21 |
| 2 | Blue | 23 | 19 |
| 3 | Green | 25 | 18 |
| 4 | Yellow | 26 | 17 (TX2) |
| 5 | Red | 14 | 16 (RX2) |

This pin map supersedes the older digital wiring below. Both arrays use the
same logical target order so a piezo matches its same-color LED. Upload this
sketch with the four adjacent headers, reconnect and confirm version 1.11.1.
This update changes pin assignments only; sensor input mode remains INPUT
with the existing external pull-down circuit.

## Current progression - firmware 1.11.0

Two cycles per level: Level 1 has three steps, Level 2 four, Level 3 five,
and each following pair adds one step without a fixed final level. Five LEDs
repeat as needed. No ten-step victory remains. Three lives last the whole game.
Memory is genuine cues only. Distraction flicker starts on overall cycle five,
only in PLAYER TURN; every target, including the expected one, stays eligible.
Success/racing timing and the optional frenzy remain seven/twelve seconds.

Upload with all FOUR adjacent headers: MemoryPlayback.h, PiezoQuietWindow.h,
TargetingEffects.h and GameProgress.h. Pins remain unchanged. Compilation and
firmware regression checks pass; the board has not been flashed by this update.
Refresh/reconnect the dashboard and confirm 1.11.0. Player name/email are now
required before physical START. Supabase setup is in web-app/SUPABASE_SETUP.md.
The following earlier notes are superseded where they describe older rules.

## Targeting effects and round transition - version 1.10.0

Memory playback is genuine cues only. Random six-flash bursts now run during
PLAYER TURN; all targets are eligible, including the active/expected target.
Only the stored sequence determines whether a hit is correct.

The last correct hit starts three seconds of success audio and synchronized
all-LED blinking (three ON/OFF cycles), then the retained optional five-second
frenzy, then four seconds of racing tones with all LEDs off. Next memory starts
after the final tone. Totals are seven seconds normally or twelve with frenzy.
The final completed level celebrates and optionally grants frenzy before
victory; no countdown is needed when there is no further sequence.

Open/upload with all three adjacent headers: MemoryPlayback.h,
PiezoQuietWindow.h and TargetingEffects.h. Close Serial Monitor and reconnect
the refreshed dashboard; confirm 1.10.0. See FINAL PROJECT/FEATURE_UPDATE_1_10.md.

## Game and operator update - version 1.9.0

Adds final-round attempted/correct sequence review, all-LED checks during the
first 800 ms of countdown and round break, and manual TEST_LEDS while idle or
finished. SET_LIGHT_MS accepts 200-5000 milliseconds for all steady memory cues;
the web operator enters seconds. Distraction timing and existing scoring/lives
are retained. State reports lightSeconds/ledTesting, hello configurableLight,
and finished games send sequence-review (correct, performed, positions).

Open the sketch from this folder with MemoryPlayback.h and PiezoQuietWindow.h
beside it. After uploading, close Serial Monitor, refresh/reconnect the web app
and confirm firmware 1.9.0. No board is flashed by editing these files.
See FINAL PROJECT/FEATURE_UPDATE_1_9.md for the complete update and checks.

## Random flickering distractions - version 1.8.0

Each memory preview now inserts one decoy burst in a randomly chosen gap between
real sequence steps, at every level. Real targets stay steadily ON for 650 ms.
The decoy flashes three times, with 180 ms ON and 180 ms OFF between flashes,
then goes dark. A 280 ms dark gap separates the burst from the next real step.
Its target differs from the real steps immediately before and after it.

Players remember only the steady lights. The decoy is not added to the sequence;
hits remain disabled throughout preview. No light remains on as a distraction
during player input. Positions and decoy targets are selected anew each round.
The existing round timer includes the entire preview, including the burst
(about 1.18 seconds added per preview). Reset, timeout and other phase exits turn
the lights off and cancel pending flashes. Frenzy and normal scoring are retained.

Verify/upload this sketch from its existing folder with BOTH adjacent headers:

- PiezoQuietWindow.h
- MemoryPlayback.h

Close Serial Monitor, refresh and reconnect the dashboard. Firmware must report
1.8.0 for the physical effect. The browser demo uses the same playback timings
and offers five demo target buttons. Remember steady lights; ignore the three
flashes. No firmware upload occurs just from editing these files.

Earlier version sections below are historical.

## Piezo debugging and re-arming fix - version 1.7.3

This maintained alternative has the same re-arming fix as Target_Game. Each
rising-edge interrupt now restarts the 20 ms quiet window, even when the pulse
finishes before the next GPIO read. Arming also verifies that no new edge arrived
between sampling and enabling capture. The pin assignments, INPUT mode,
thresholds, circuit configuration and game rules are preserved.

Keep `PiezoQuietWindow.h` beside this sketch when compiling/uploading. After
uploading, close Serial Monitor, refresh and reconnect the dashboard. Firmware
should identify as **1.7.3**. Operator controls shows recent **Pulses/s** for each
target and **Sensing status** explaining why capture is inactive or waiting.
The rates use the ESP32's clock and remain separate from scored hits. Old
firmware remains compatible, but cannot provide these added diagnostics.

Debug with targets still in READY for five seconds, tap each separately, then
repeat during PLAYER TURN. Capture all five rates and the sensing status.
Ongoing pulses prevent re-arming until the inputs are quiet. This fixes a
software re-arming defect; actual hit detection and the origin of simultaneous
input activity still require physical testing. No firmware is uploaded by
editing these files. See FINAL PROJECT's `tests/firmware` for regression checks.
Earlier version sections below are historical.

## Header-side digital pulse mode - version 1.7.2

The default PIEZO_DIGITAL_PULSE_MODE = 1 profile keeps piezo signal inputs on the photographed 3V3 header side and LED outputs on the VIN header side. Sensing uses rising-edge GPIO interrupts, not analogRead. These GPIOs have not become ADC inputs.

| Target / wire | Protected piezo input | LED output |
| --- | --- | --- |
| 1 / purple | RX2 / GPIO16 | D14 / GPIO14 |
| 2 / blue | TX2 / GPIO17 | D26 / GPIO26 |
| 3 / green | D18 / GPIO18 | D25 / GPIO25 |
| 4 / yellow | D19 / GPIO19 | D33 / GPIO33 |
| 5 / orange | D21 / GPIO21 | D32 / GPIO32 |

These are the final user-confirmed pin assignments, in target order 1 through 5. All LED signals stay on the VIN-side header. GPIO34, GPIO35 and GPIO36 must not be used as LED outputs. Red START is GPIO13 to GND; blue game RESET is GPIO12 to GND (see button wiring below). Connect all breadboard grounds to ESP32 GND. GPIO16/17 require the WROOM-style board shown; WROVER modules may reserve these pins.

### Physical START and RESET buttons

| Button | GPIO | Connection |
| --- | --- | --- |
| Red START | D13 / GPIO13 | Button between GPIO13 and GND |
| Blue game RESET | D12 / GPIO12 | Button between GPIO12 and GND |

Both buttons use INPUT_PULLUP and are active LOW. A press is debounced for 35 ms and triggers once until released. START uses the same countdown as web START. RESET returns the game to READY and cancels countdown, feedback, rest or frenzy; it does not reboot the ESP32. RESET wins if both debounced presses occur together, and START is ignored while RESET is held.

GPIO12 is a boot-strapping pin: do not add an external pull-up to 3.3 V or wire this button to 3.3 V. Holding GPIO12 HIGH during chip reset selects a 1.8 V flash supply and can prevent a board with 3.3 V flash from booting. This sketch enables its internal pull-up after boot. Reference: https://docs.espressif.com/projects/esptool/en/latest/esp32/advanced-topics/boot-mode-selection.html

### Electrical requirements: bench test needed

The photos show bare piezo discs and passive resistor/diode circuits. A piezo can be detected digitally if its protected pulse reaches a valid HIGH level, but photos do not establish resistor values, diode orientation, clamp voltage or pulse amplitude. Source edits do not validate the actual circuit.

Each input must idle LOW near 0 V and produce a safe positive pulse reaching about 2.5 V for guaranteed HIGH at a 3.3 V supply, without exceeding the ESP32 input limits. A circuit clamped below that HIGH threshold will not reliably trigger this mode. Keep suitable protection against negative and excessive positive spikes. INPUT mode relies on an external bleed/pulldown resistor; it deliberately avoids the extra internal 45k pulldown changing pulse amplitude.

Analog PIEZO_HIT_THRESHOLD and PIEZO_RELEASE_THRESHOLD settings do NOT change digital sensitivity. Digital mode accepts the first captured edge and cannot compare impact amplitudes to reject cross-talk. Weak pulses need checking/conditioning or an ADC-based wiring change; lowering 500/800 has no effect in this profile.

### Pulse detection and checking

The ISR only captures an eligible edge and increments diagnostic counters; scoring, Serial and LEDs run in the main loop. Capture is disabled during ready, countdown, pattern display, feedback, two-second rest and finished states. The existing 180 ms cooldown is retained, with all inputs required LOW continuously for 20 ms before re-arming.

In firmware 1.7.2, leave DEBUG_PIEZO_VALUES false and use the web app's Operator controls. A sensor-status message is sent every 500 ms and on PING. The live table shows actual GPIOs, instantaneous LOW/HIGH levels, cumulative raw rising-edge counts since power-on, arming/capture status and both button levels. Tap each piezo separately even while READY: only its raw counter should increase. Several raw edges from ringing are not several scored hits. Diagnostic events never change score or game state.

If all counters stay zero during taps, check the signal wiring, common ground and protected pulse voltage/shape. If any input stays HIGH, the all-inputs-LOW re-arming condition blocks accepted hits. Brief pulses may be absent from the 500 ms level snapshots but still increase the interrupt counters. Hits during READY, countdown, preview, feedback or rest are deliberately not scored. Raw counters can reveal cross-talk even in these phases. Confirm safe voltage and reliable independent signals before relying on physical play.

Verify/upload the sketch, close Serial Monitor, refresh and reconnect the web app. Operator controls should report firmware 1.7.2 and Sensor input: Digital pulses. If the raw counts rise but accepted Hit messages stay at zero, capture the table together with game phase and arming/capture status during PLAYER TURN. No board has been flashed by this update. Arduino compilation must be verified on the host because the review environment's compiler has a Windows DLL launch error.

### Analog fallback

PIEZO_DIGITAL_PULSE_MODE = 0 selects the previous analog pin map below and preserves the original per-sketch thresholds. Rewire to that map before using it. The default digital profile does not use ADC2 channels. Both profiles retain the existing game, five-second frenzy and two-second rest.

References:
- GPIO API/interrupts: https://docs.espressif.com/projects/arduino-esp32/en/latest/api/gpio.html
- GPIO/ADC restrictions: https://docs.espressif.com/projects/esp-idf/en/latest/esp32/api-reference/peripherals/gpio.html
- Logic voltages, Table 5-3: https://documentation.espressif.com/esp32_datasheet_en.html

## Previous reversed analog pin map - version 1.6.1 (inactive by default)

This is an analog-piezo map for the classic ESP32-WROOM DevKit using USB Serial. It uses the requested physical pin pairs with the input/output roles reversed. The originally requested inputs RX2/GPIO16, TX2/GPIO17, GPIO18, GPIO19 and GPIO21 have no ADC channels, so they cannot replace the current analogRead piezo inputs. GPIO35 is input-only and cannot drive an LED. Rewire to the table below before uploading; the originally proposed wiring is not the active map.

GPIO25 and GPIO26 use ADC2, so keep Wi-Fi off for this map. GPIO16/17 are available on WROOM/SOLO boards but reserved on WROVER modules with PSRAM. With the current firmware, red START is GPIO13 and blue RESET is GPIO12, each to GND. Connect all four breadboards' ground rails to ESP32 GND, including bridging any split rails that you use. Keep the existing piezo input-protection circuits and LED resistors. The threshold defaults and all game rules, including the two-second break, are preserved.

Official pin capabilities: https://docs.espressif.com/projects/esp-idf/en/latest/esp32/api-reference/peripherals/gpio.html
Module restrictions and headers: https://docs.espressif.com/projects/esp-dev-kits/en/latest/esp32/esp32-devkitc/user_guide.html

## Two-second sequence break - version 1.6.0

Completed sequences now enter a two-second ROUND BREAK after the success flash. All target LEDs turn off, sensor hits are ignored, the round timer is paused, and the dashboard shows a 2-1 rest countdown. The next pattern starts with a fresh configured timer. A selected frenzy waits until this break finishes, then runs for its existing five seconds. A final sequence with no frenzy goes directly to victory. Reset and USB commands remain responsive during the break; timer edits and new START commands remain locked until the game is reset or finished. State messages reuse countdown for the rest seconds. A valid final hit before the timer expires cannot lose the round while its success flash finishes. Upload this version, close Serial Monitor, refresh and reconnect the dashboard to enable the break on hardware.

## Frenzy bonus - version 1.5.0

Each completed sequence independently has a 1-in-5 chance of a five-second frenzy. All five target LEDs stay ON; any target hit earns +10 without costing lives. Existing sensor release/cooldown protection remains, with no sequence feedback delay during frenzy. When five seconds end, the LEDs turn off and the next fresh, longer sequence begins with a new round timer. Score/lives carry over. A final-sequence bonus ends in victory. Reset cancels the bonus. State messages use status FRENZY and include frenzyHits. Re-upload this sketch, close Serial Monitor and reconnect the dashboard to use this mode. Hardware compile/upload needs checking in Arduino IDE; it has not been flashed by these source edits.

## Current pattern behavior (version 1.4.0)

Each completed round generates a fresh random sequence. Length still increases from four to ten, but the previous pattern is no longer reused as a prefix. An accidental repeat of that prefix is changed. Individual targets can repeat. Re-upload the updated sketch for physical play; the pin map, thresholds, score, lives and timing rules are unchanged.

## Current timing (version 1.3.0)

The round timer starts as soon as 3-2-1 finishes, while the LED sequence is being shown. It continues into player input without resetting. Re-upload the updated sketch for this behavior. Earlier timing descriptions below are historical.

# HIT THE CLOWN - ESP32 integrated sketch

## Version 1.2.0: timer settings and count-in

Both the physical START button and web START command now begin with a three-second countdown, followed by the memory sequence. The player-turn timer starts afterward. The default remains 30 seconds per round. While READY, GAME OVER or VICTORY, `SET_TIME 60` changes future rounds to 60 seconds; accepted values are whole seconds from 5 to 300. The sketch sends `{"type":"settings","roundSeconds":60}` to confirm the save. Settings reset to 30 seconds when the ESP32 restarts. Active-game changes are rejected. State events include `roundSeconds` and `countdown`; the new countdown status is `COUNTDOWN`. Re-upload this sketch to use the new features from the dashboard.

Open `HitTheClown_ESP32_Integrated.ino` in Arduino IDE and select your ESP32 board.

## Default digital pulse pins (version 1.7.2)

| Target | LED GPIO | Piezo digital input GPIO |
|---|---:|---:|
| 1 | 14 | 16 (RX2) |
| 2 | 26 | 17 (TX2) |
| 3 | 25 | 18 |
| 4 | 33 | 19 |
| 5 | 32 | 21 |

The red physical START button uses GPIO13 and the blue game RESET button uses GPIO12. Connect each button between its GPIO and GND. The sketch uses `INPUT_PULLUP`; do not add an external pull-up on GPIO12 because it affects boot configuration (see current button wiring above).

## LED wiring

For each ordinary low-current LED:

`ESP32 GPIO -> 220 to 330 ohm resistor -> LED anode (+)`

`LED cathode (-) -> GND`

Use a transistor or MOSFET driver if a target contains a lamp, LED strip, or any load needing more current than a GPIO can safely supply.

## Piezo protection (required)

A struck piezo can produce voltage spikes. Do not connect it directly to an ESP32 ADC pin. For each piezo, use:

- 1 megaohm resistor across the piezo terminals
- 10 kiloohm series resistor between the piezo signal and ADC pin
- Schottky clamp diodes to 3.3 V and GND, or an equivalent 0-3.3 V input protection circuit
- Piezo ground connected to ESP32 GND

The ESP32 ADC pins are 3.3 V maximum.

## Game behavior

- Press the physical button to start.
- The first round displays a random 4-target sequence.
- Hit the clowns in the same order.
- Correct hit: +10 points.
- Wrong hit: -5 points and one lost life.
- Each completed round adds one item to the sequence.
- The player has 30 seconds per player-turn round.
- Completing the 10-target sequence wins the game.
- Press START again after GAME OVER or VICTORY to play again.

## Sensor calibration (analog profile only)

1. Set `DEBUG_PIEZO_VALUES` to `true` near the top of the sketch.
2. Upload it and open Serial Monitor at 115200 baud.
3. Note the idle readings and the readings from real ball hits.
4. Set each value in `PIEZO_HIT_THRESHOLD` above vibration/noise but below a normal hit.
5. Set `DEBUG_PIEZO_VALUES` back to `false` and upload again.

If multiple sensors react to one strike, mechanically isolate the targets and raise the thresholds on the sensors receiving cross-talk.

## Web dashboard connection

The sketch already sends one JSON message per line at 115200 baud. It accepts these commands from a future Web Serial connection:

```text
START
RESET
PING
```

The physical START button and the web START command call the same game-start function. The ESP32 remains responsible for the real sequence, timer, score, lives, and hit detection.



