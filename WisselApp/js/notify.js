// In-app notifications: visual banner + sound + vibration.
// No server, no Web Push — purely local, fires from the live match timer.

let audioCtx = null;

export function unlockAudio() {
  // Must be called from a user gesture so iOS allows playback later.
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    // tiny silent buffer to truly unlock
    const b = audioCtx.createBuffer(1, 1, 22050);
    const s = audioCtx.createBufferSource();
    s.buffer = b; s.connect(audioCtx.destination); s.start(0);
  } catch {}
}

// Tone library — each tone is a sequence of notes.
// User can pick any tone for any signal slot (sub / pre / quarter).
export const TONE_PRESETS = {
  tripleHigh:  { label: '3 hoge piepjes',         notes: [{f:880},{f:880},{f:880}], dur: 0.18, gap: 0.12, gain: 0.4 },
  doubleLow:   { label: '2 lage piepjes',         notes: [{f:660},{f:660}],         dur: 0.14, gap: 0.10, gain: 0.35 },
  doubleHigh:  { label: '2 hoge piepjes',         notes: [{f:1000},{f:1000}],       dur: 0.14, gap: 0.10, gain: 0.4 },
  singleShort: { label: '1 korte piep',           notes: [{f:880}],                 dur: 0.15, gap: 0,    gain: 0.4 },
  singleLong:  { label: '1 lange piep',           notes: [{f:700}],                 dur: 0.6,  gap: 0,    gain: 0.4 },
  sweepDown:   { label: 'Lange dalende toon',     notes: [{f:700, sweepTo:330}],    dur: 0.6,  gap: 0,    gain: 0.4 },
  sweepUp:     { label: 'Lange stijgende toon',   notes: [{f:330, sweepTo:880}],    dur: 0.6,  gap: 0,    gain: 0.4 },
  chimeUp:     { label: 'Klokje (3 noten omhoog)',notes: [{f:523},{f:659},{f:784}], dur: 0.18, gap: 0.04, gain: 0.35 },
  chimeDown:   { label: 'Klokje (3 noten omlaag)',notes: [{f:784},{f:659},{f:523}], dur: 0.18, gap: 0.04, gain: 0.35 },
  alarm:       { label: 'Alarm (afwisselend)',    notes: [{f:880},{f:660},{f:880},{f:660},{f:880}], dur: 0.12, gap: 0.05, gain: 0.4, type: 'square' },
  siren:       { label: 'Sirene',                 notes: [{f:440, sweepTo:880},{f:880, sweepTo:440}], dur: 0.35, gap: 0.0, gain: 0.35 },
  knock:       { label: 'Klop-klop (laag)',       notes: [{f:200},{f:200}],         dur: 0.08, gap: 0.10, gain: 0.5, type: 'square' },
  bell:        { label: 'Bel (uitstervend)',      notes: [{f:1320, sweepTo:880}],   dur: 0.9,  gap: 0,    gain: 0.4, type: 'triangle' },
  whistle:     { label: 'Fluit (hoge piep)',      notes: [{f:1500},{f:1500}],       dur: 0.10, gap: 0.06, gain: 0.35 },
  countdown:   { label: 'Aftellen (4 piepjes)',   notes: [{f:660},{f:660},{f:660},{f:880}], dur: 0.12, gap: 0.18, gain: 0.4 },
};

// Default tone per signal slot (used if user hasn't picked one).
export const DEFAULT_TONES = { sub: 'tripleHigh', pre: 'doubleLow', quarter: 'sweepDown' };

export function beep(opts = {}) {
  let cfg;
  if (typeof opts === 'string') {
    cfg = TONE_PRESETS[opts] || TONE_PRESETS[DEFAULT_TONES[opts]] || TONE_PRESETS.tripleHigh;
  } else {
    cfg = { ...TONE_PRESETS.tripleHigh, ...opts };
  }
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    let t = audioCtx.currentTime;
    const dur = cfg.dur ?? 0.18;
    const gap = cfg.gap ?? 0.12;
    const gain = cfg.gain ?? 0.4;
    const type = cfg.type || 'sine';
    const notes = cfg.notes || [{ f: cfg.freq || 880 }];
    for (const n of notes) {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(n.f, t);
      if (n.sweepTo) o.frequency.linearRampToValueAtTime(n.sweepTo, t + dur);
      g.gain.value = 0;
      g.gain.linearRampToValueAtTime(gain, t + 0.01);
      g.gain.linearRampToValueAtTime(0, t + dur);
      o.connect(g); g.connect(audioCtx.destination);
      o.start(t); o.stop(t + dur + 0.02);
      t += dur + gap;
    }
  } catch {}
}

export function vibrate(pattern = [200, 100, 200, 100, 400]) {
  try { navigator.vibrate && navigator.vibrate(pattern); } catch {}
}

export function showAlert(title, bodyHtml, { sound = true, vib = true, signal = 'sub', tone } = {}) {
  if (sound) beep(tone || signal);
  if (vib) vibrate();
  const overlay = document.getElementById('alert-overlay');
  const titleEl = document.getElementById('alert-title');
  const bodyEl = document.getElementById('alert-body');
  if (!overlay) return;
  titleEl.textContent = title;
  bodyEl.innerHTML = bodyHtml;
  overlay.hidden = false;
  return new Promise((resolve) => {
    const dismiss = () => {
      overlay.hidden = true;
      document.getElementById('alert-dismiss').removeEventListener('click', dismiss);
      resolve();
    };
    document.getElementById('alert-dismiss').addEventListener('click', dismiss);
  });
}

/**
 * Show a small action sheet. `actions` is [{id, label, danger?}].
 * Resolves to the chosen id (or 'cancel' if dismissed).
 */
export function showActionSheet(title, actions) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'sheet-overlay';
    overlay.innerHTML = `
      <div class="sheet">
        <div class="sheet-title">${title.replace(/[&<>]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))}</div>
        ${actions.map((a) => `<button data-id="${a.id}" class="${a.danger ? 'danger' : ''}">${a.label}</button>`).join('')}
      </div>`;
    document.body.appendChild(overlay);
    const cleanup = (id) => { overlay.remove(); resolve(id); };
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) return cleanup('cancel');
      const btn = e.target.closest('button[data-id]');
      if (btn) cleanup(btn.dataset.id);
    });
  });
}
