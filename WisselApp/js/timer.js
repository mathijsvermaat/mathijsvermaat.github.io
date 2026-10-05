// Lock-screen-proof match clock.
//
// State is stored as timestamps in localStorage so the clock keeps
// counting even if the iPhone is locked, the app is suspended, or the
// page is reloaded. We never rely on setInterval ticks for state — only
// for redrawing the UI.
//
// Anatomy of "elapsedSec":
//   If running:    (Date.now() - runningSinceMs)/1000 + accumulatedSec
//   If paused:     accumulatedSec
//
// We also persist totalSec (full match length) so we know when to stop,
// and the upcoming subEvent times so the alarm can fire at the right moment.

const KEY = 'wisselapp.activeMatchClock';

export class MatchClock {
  constructor(matchId, totalSec, onTick, onAlarm) {
    this.matchId = matchId;
    this.totalSec = totalSec;
    this.onTick = onTick;
    this.onAlarm = onAlarm;
    this.alarmsAtSec = []; // sorted ascending
    this.firedAlarms = new Set();
    this._tickHandle = null;
    this._wakeLock = null;
    this._load();
  }

  setAlarms(secs) {
    this.alarmsAtSec = [...secs].sort((a, b) => a - b);
    // Alarms added for a moment that already passed must not fire retroactively.
    const e = this.elapsedSec();
    this.alarmsAtSec.forEach((a) => { if (a <= e) this.firedAlarms.add(a); });
    this._persist();
  }

  start() {
    const s = this._state();
    if (!s.runningSinceMs) {
      s.runningSinceMs = Date.now();
      this._save(s);
    }
    this._loop();
    this._requestWakeLock();
  }

  pause() {
    const s = this._state();
    if (s.runningSinceMs) {
      s.accumulatedSec += (Date.now() - s.runningSinceMs) / 1000;
      s.runningSinceMs = null;
      this._save(s);
    }
    this._stopLoop();
    this._releaseWakeLock();
  }

  reset() {
    localStorage.removeItem(KEY);
    this._stopLoop();
    this._releaseWakeLock();
    this.firedAlarms = new Set();
  }

  /**
   * Skip forward (positive) or back (negative) by `deltaSec` seconds.
   * Re-arms previously-fired alarms when jumping back, so they fire again.
   */
  adjust(deltaSec) {
    if (!Number.isFinite(deltaSec)) return;
    const state = this._state();
    const now = Date.now();
    const elapsed = state.accumulatedSec + (state.runningSinceMs ? (now - state.runningSinceMs) / 1000 : 0);
    const adjusted = Math.min(this.totalSec, Math.max(0, elapsed + deltaSec));
    state.accumulatedSec = adjusted;
    if (state.runningSinceMs) state.runningSinceMs = now;
    if (deltaSec < 0) {
      this.firedAlarms = new Set([...this.firedAlarms].filter((alarm) => alarm <= adjusted));
    }
    this._save(state);
    if (adjusted >= this.totalSec) {
      state.runningSinceMs = null;
      this._save(state);
      this._stopLoop();
      this._releaseWakeLock();
    }
  }

  isRunning() { return !!this._state().runningSinceMs; }

  elapsedSec() {
    const s = this._state();
    return s.runningSinceMs
      ? s.accumulatedSec + (Date.now() - s.runningSinceMs) / 1000
      : s.accumulatedSec;
  }

  remainingSec() { return Math.max(0, this.totalSec - this.elapsedSec()); }

  // ----- internals -----
  _state() {
    if (!this._cache) this._load();
    return this._cache;
  }
  _load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const s = JSON.parse(raw);
        if (s.matchId === this.matchId) {
          this._cache = s;
          this.firedAlarms = new Set(s.firedAlarms || []);
          return;
        }
      }
    } catch {}
    this._cache = { matchId: this.matchId, accumulatedSec: 0, runningSinceMs: null, firedAlarms: [] };
    this._save(this._cache);
  }
  _save(s) {
    this._cache = s;
    s.firedAlarms = [...this.firedAlarms];
    localStorage.setItem(KEY, JSON.stringify(s));
  }
  _persist() { this._save(this._state()); }

  _loop() {
    this._stopLoop();
    const tick = () => {
      const e = this.elapsedSec();
      // Fire any alarms that are due.
      for (const a of this.alarmsAtSec) {
        if (e >= a && !this.firedAlarms.has(a)) {
          this.firedAlarms.add(a);
          this._persist();
          try { this.onAlarm && this.onAlarm(a); } catch {}
        }
      }
      try { this.onTick && this.onTick(e); } catch {}
      if (e >= this.totalSec) {
        this.pause();
      }
    };
    this._tickHandle = setInterval(tick, 250);
    tick();
  }
  _stopLoop() {
    if (this._tickHandle) { clearInterval(this._tickHandle); this._tickHandle = null; }
  }

  async _requestWakeLock() {
    try {
      if ('wakeLock' in navigator) {
        this._wakeLock = await navigator.wakeLock.request('screen');
        this._wakeLock.addEventListener('release', () => { this._wakeLock = null; });
        // Re-acquire on visibility change
        document.addEventListener('visibilitychange', this._visHandler = async () => {
          if (document.visibilityState === 'visible' && this.isRunning() && !this._wakeLock) {
            try { this._wakeLock = await navigator.wakeLock.request('screen'); } catch {}
          }
        });
      }
    } catch {}
  }
  _releaseWakeLock() {
    try { this._wakeLock && this._wakeLock.release(); } catch {}
    this._wakeLock = null;
    if (this._visHandler) {
      document.removeEventListener('visibilitychange', this._visHandler);
      this._visHandler = null;
    }
  }
}
