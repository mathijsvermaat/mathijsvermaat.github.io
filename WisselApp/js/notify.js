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

export function beep({ duration = 0.18, freq = 880, gain = 0.4, count = 3, gap = 0.12 } = {}) {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    let t = audioCtx.currentTime;
    for (let i = 0; i < count; i++) {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = 'sine';
      o.frequency.value = freq;
      g.gain.value = 0;
      g.gain.linearRampToValueAtTime(gain, t + 0.01);
      g.gain.linearRampToValueAtTime(0, t + duration);
      o.connect(g); g.connect(audioCtx.destination);
      o.start(t); o.stop(t + duration + 0.02);
      t += duration + gap;
    }
  } catch {}
}

export function vibrate(pattern = [200, 100, 200, 100, 400]) {
  try { navigator.vibrate && navigator.vibrate(pattern); } catch {}
}

export function showAlert(title, bodyHtml, { sound = true, vib = true } = {}) {
  if (sound) beep();
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
