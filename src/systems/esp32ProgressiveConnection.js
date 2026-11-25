const statuses = new Set([
  'READY', 'LED TEST', 'COUNTDOWN', 'MEMORY PHASE', 'PLAYER TURN', 'HIT!', 'WRONG TARGET',
  'ROUND BREAK', 'FRENZY', 'GAME OVER', 'VICTORY',
]);

function getPulseRates(previous, current) {
  if (!previous || !current || !Number.isInteger(previous.uptimeMs) || !Number.isInteger(current.uptimeMs)
    || !Array.isArray(previous.pins) || !Array.isArray(current.pins)
    || previous.pins.some((pin, index) => pin !== current.pins[index])) return null;
  const elapsed = (current.uptimeMs - previous.uptimeMs) >>> 0;
  if (elapsed === 0 || elapsed > 10000 || current.pulses.some((count, index) =>
    count < previous.pulses[index] && previous.pulses[index] < 0xffff0000)) return null;
  return current.pulses.map((count, index) => Math.round(((count - previous.pulses[index]) >>> 0) * 1000 / elapsed));
}

function parseSensorStatus(event) {
  const five = (values, min, max) => Array.isArray(values) && values.length === 5
    && values.every((value) => Number.isInteger(value) && value >= min && value <= max);
  const button = (value) => value && typeof value === 'object' && !Array.isArray(value)
    && Number.isInteger(value.pin) && value.pin >= 0 && value.pin <= 39
    && Number.isInteger(value.level) && (value.level === 0 || value.level === 1);
  if (event.mode !== 'digital-pulse' || !five(event.pins, 0, 39) || new Set(event.pins).size !== 5
    || !five(event.levels, 0, 1) || !five(event.pulses, 0, 0xffffffff)
    || typeof event.armed !== 'boolean' || typeof event.capturing !== 'boolean'
    || !Number.isInteger(event.uptimeMs) || event.uptimeMs < 0 || event.uptimeMs > 0xffffffff
    || typeof event.armState !== 'string' || !button(event.start) || !button(event.reset)) return null;
  return { type: 'sensor-status', mode: event.mode, pins: [...event.pins], levels: [...event.levels],
    pulses: [...event.pulses], armed: event.armed, capturing: event.capturing, uptimeMs: event.uptimeMs,
    armState: event.armState, start: { ...event.start }, reset: { ...event.reset } };
}

export function parseEsp32Event(line) {
  let event;
  try { event = JSON.parse(line); } catch { return null; }
  if (!event || typeof event !== 'object' || Array.isArray(event)) return null;
  if (event.type === 'hello' && event.device === 'HIT THE CLOWN' && event.targets === 5) {
    return { type: 'hello', version: String(event.version ?? ''), configurableLight: event.configurableLight === true,
      configurableTimer: event.configurableTimer === true, adaptivePace: event.adaptivePace === true,
      ...(['analog', 'digital-pulse'].includes(event.sensorMode) ? { sensorMode: event.sensorMode } : {}) };
  }
  if (event.type === 'sensor-status') return parseSensorStatus(event);
  if (event.type === 'state' && statuses.has(event.status) && Number.isInteger(event.sequenceLength)
    && Number.isInteger(event.lives) && Number.isInteger(event.playerPosition)) {
    return { ...event };
  }
  if (event.type === 'target-active' && Number.isInteger(event.target) && event.target >= 1 && event.target <= 5) {
    return { type: event.type, target: event.target, active: event.active !== false };
  }
  if (event.type === 'sensor-hit' && Number.isInteger(event.target) && event.target >= 1 && event.target <= 5) {
    return { type: event.type, target: event.target, correct: event.correct === true };
  }
  if (event.type === 'settings' && Number.isInteger(event.roundSeconds) && Number.isFinite(event.lightSeconds)) {
    return { type: 'settings', roundSeconds: event.roundSeconds, lightSeconds: event.lightSeconds };
  }
  if (event.type === 'error' && typeof event.message === 'string') return { type: 'error', message: event.message };
  if (['game-start', 'game-over', 'victory', 'sequence-review'].includes(event.type)) return event;
  return null;
}

export class Esp32ProgressiveConnection {
  constructor({ onEvent = () => {}, onConnection = () => {}, onError = () => {}, onLog = () => {}, onDiagnostics = () => {} } = {}) {
    this.onEvent = onEvent;
    this.onConnection = onConnection;
    this.onError = onError;
    this.onLog = onLog;
    this.onDiagnostics = onDiagnostics;
    this.diagnostics = { bytesReceived: 0, bytesSent: 0, linesReceived: 0, stateMessages: 0, hitMessages: 0,
      firmware: '', sensorMode: '', sensorStatus: null, pulseRates: null };
    this.port = null;
    this.reader = null;
    this.readTask = null;
    this.writeQueue = Promise.resolve();
    this.stopping = false;
    this.disposed = false;
    this.pendingSettings = new Map();
  }

  async connect(serial = globalThis.navigator?.serial) {
    if (this.port) throw new Error('The ESP32 is already connected.');
    if (!serial || !globalThis.isSecureContext) throw new Error('Connect with Chrome or Edge over HTTPS or localhost.');
    const port = await serial.requestPort();
    try {
      await port.open({ baudRate: 115200 });
      if (this.disposed) { await port.close(); return; }
      this.port = port;
      this.stopping = false;
      this.diagnostics = { bytesReceived: 0, bytesSent: 0, linesReceived: 0, stateMessages: 0, hitMessages: 0,
        firmware: '', sensorMode: '', sensorStatus: null, pulseRates: null };
      this.onDiagnostics({ ...this.diagnostics });
      this.onConnection(true);
      this.readTask = this.readLoop(port);
      setTimeout(() => {
        if (this.port === port && !this.stopping) this.sendCommand('PING').catch((error) => this.onError(error.message));
      }, 1200);
    } catch (error) {
      if (port.readable || port.writable) await port.close().catch(() => {});
      throw error;
    }
  }

  async readLoop(port) {
    let buffer = '';
    const decoder = new TextDecoder();
    try {
      while (port.readable && !this.stopping) {
        this.reader = port.readable.getReader();
        try {
          while (!this.stopping) {
            const { value, done } = await this.reader.read();
            if (done) break;
            if (!value) continue;
            this.diagnostics.bytesReceived += value.byteLength;
            this.onDiagnostics({ ...this.diagnostics });
            for (const character of decoder.decode(value, { stream: true })) {
              if (character === '\n') {
                const line = buffer.trim();
                buffer = '';
                if (!line) continue;
                this.diagnostics.linesReceived++;
                this.onLog('RX', line);
                const event = parseEsp32Event(line);
                if (!event) continue;
                if (event.type === 'hello') {
                  this.diagnostics.firmware = event.version;
                  if (event.sensorMode) this.diagnostics.sensorMode = event.sensorMode;
                }
                if (event.type === 'state') this.diagnostics.stateMessages++;
                if (event.type === 'sensor-hit') this.diagnostics.hitMessages++;
                if (event.type === 'sensor-status') {
                  this.diagnostics.pulseRates = getPulseRates(this.diagnostics.sensorStatus, event);
                  this.diagnostics.sensorStatus = event;
                  this.diagnostics.sensorMode = event.mode;
                }
                this.onDiagnostics({ ...this.diagnostics });
                if (event.type === 'settings') this.resolveSetting(event);
                if (event.type === 'error') this.rejectSettings(new Error(event.message));
                this.onEvent(event);
              } else if (buffer.length < 8192) buffer += character;
              else buffer = '';
            }
          }
        } finally { this.reader.releaseLock(); this.reader = null; }
      }
    } catch (error) {
      if (!this.stopping) this.onError('ESP32 connection lost. ' + error.message);
    } finally {
      if (this.port === port) await this.closePort(port);
    }
  }

  sendCommand(command) {
    if (!['START', 'RESET', 'PING', 'TEST_LEDS'].includes(command) && !/^SET_(?:TIME \d{1,3}|LIGHT_MS \d{1,4})$/.test(command)) {
      return Promise.reject(new Error('Unsupported ESP32 command.'));
    }
    const port = this.port;
    if (!port || this.stopping) return Promise.reject(new Error('Connect the ESP32 first.'));
    const write = this.writeQueue.then(async () => {
      if (this.port !== port || this.stopping || !port.writable) throw new Error('ESP32 disconnected.');
      const writer = port.writable.getWriter();
      const encoded = new TextEncoder().encode(command + '\n');
      try { await writer.write(encoded); }
      finally { writer.releaseLock(); }
      this.diagnostics.bytesSent += encoded.byteLength;
      this.onLog('TX', command);
      this.onDiagnostics({ ...this.diagnostics });
    });
    this.writeQueue = write.catch(() => {});
    return write;
  }

  setRoundSeconds(seconds) {
    return this.setSetting('roundSeconds', seconds, 'SET_TIME ' + seconds);
  }

  setLightMilliseconds(milliseconds) {
    return this.setSetting('lightSeconds', milliseconds / 1000, 'SET_LIGHT_MS ' + milliseconds);
  }

  setSetting(key, value, command) {
    if (this.pendingSettings.has(key)) return Promise.reject(new Error('Wait for the previous ESP32 setting to finish.'));
    const result = new Promise((resolve, reject) => {
      const timer = setTimeout(() => this.rejectSetting(key, new Error('The ESP32 did not confirm the setting. Upload the AI compatible firmware and reconnect.')), 3500);
      this.pendingSettings.set(key, { value, resolve, reject, timer });
    });
    this.sendCommand(command).catch((error) => this.rejectSetting(key, error));
    return result;
  }

  resolveSetting(event) {
    for (const [key, pending] of this.pendingSettings) {
      if (Math.abs(event[key] - pending.value) < 0.001) {
        clearTimeout(pending.timer);
        this.pendingSettings.delete(key);
        pending.resolve(event[key]);
      }
    }
  }

  rejectSetting(key, error) {
    const pending = this.pendingSettings.get(key);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pendingSettings.delete(key);
    pending.reject(error);
  }

  rejectSettings(error) {
    for (const key of this.pendingSettings.keys()) this.rejectSetting(key, error);
  }

  async closePort(port) {
    this.rejectSettings(new Error('ESP32 disconnected before confirming the setting.'));
    clearTimeout(this.pingTimer);
    this.stopping = true;
    await this.writeQueue;
    await port.close().catch(() => {});
    if (this.port === port) {
      this.port = null;
      this.onConnection(false);
    }
  }

  async disconnect() {
    const port = this.port;
    if (!port) return;
    this.stopping = true;
    await this.reader?.cancel().catch(() => {});
    await this.readTask;
    if (this.port === port) await this.closePort(port);
  }

  dispose() {
    this.disposed = true;
    return this.disconnect();
  }
}
