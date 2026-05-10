// Main app: routing, event wiring, glue.

import * as db from './db.js';
import * as V from './views.js';
import { buildPlan, suggestKeepers, buildHistory, totalQuarters, recommendSubInterval, applyInjury } from './scheduler.js';
import { MatchClock } from './timer.js';
import { unlockAudio, showAlert, showActionSheet, beep, vibrate } from './notify.js';

const DEFAULT_PREFS = { sound: true, vibrate: true, leadSeconds: 30 };

async function getPrefs() {
  return await db.getSetting('prefs', DEFAULT_PREFS) || DEFAULT_PREFS;
}

const view = document.getElementById('view');
const titleEl = document.getElementById('title');
const backBtn = document.getElementById('btn-back');

let route = { name: 'matches', params: {} };
let liveCtx = null; // { match, plan, players, clock }

// ------- Service worker -------
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').then((reg) => {
    // If there's already a waiting worker on first load, show the banner.
    if (reg.waiting) showUpdateBanner(reg);
    reg.addEventListener('updatefound', () => {
      const sw = reg.installing;
      if (!sw) return;
      sw.addEventListener('statechange', () => {
        if (sw.state === 'installed' && navigator.serviceWorker.controller) {
          showUpdateBanner(reg);
        }
      });
    });
  }).catch(() => {});
  // Reload when the new SW takes control.
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    location.reload();
  });
}

function showUpdateBanner(reg) {
  const banner = document.getElementById('update-banner');
  if (!banner) return;
  banner.hidden = false;
  document.getElementById('update-reload').onclick = () => {
    if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
  };
}

// ------- Router -------
function setRoute(name, params = {}) {
  route = { name, params };
  // Show back button when inside a match
  backBtn.hidden = !(name === 'matchSetup' || name === 'live');
  document.querySelectorAll('#tabbar .tab').forEach((b) => b.classList.toggle('active', b.dataset.route === name));
  render();
}

backBtn.addEventListener('click', () => {
  if (liveCtx) { liveCtx.clock.pause(); persistLiveOnLeave(); liveCtx = null; }
  setRoute('matches');
});

document.querySelectorAll('#tabbar .tab').forEach((b) => {
  b.addEventListener('click', () => {
    if (liveCtx) { liveCtx.clock.pause(); persistLiveOnLeave(); liveCtx = null; }
    setRoute(b.dataset.route);
  });
});

// Best-effort save when leaving an active live match (back / tab switch).
function persistLiveOnLeave() {
  try {
    const ctx = liveCtx;
    if (!ctx) return;
    const elapsed = ctx.clock.elapsedSec();
    ctx.match.actualPlaytime = computeActualPlaytime(ctx.plan, ctx.match, elapsed);
    ctx.match.elapsedSec = elapsed;
    db.saveMatch(ctx.match);
  } catch {}
}

// ------- Render dispatch -------
async function render() {
  const players = await db.listPlayers();
  switch (route.name) {
    case 'matches': return renderMatches(players);
    case 'roster': return renderRoster(players);
    case 'stats':  return renderStats(players);
    case 'settings': return renderSettings();
    case 'matchSetup': return renderMatchSetup(players, route.params.id);
    case 'live': return renderLive(players, route.params.id);
  }
}

// ------- Matches list -------
async function renderMatches(players) {
  titleEl.textContent = 'Wedstrijden';
  const matches = await db.listMatches();
  view.innerHTML = V.viewMatches(matches, players);
  document.getElementById('new-match')?.addEventListener('click', async () => {
    const preset = V.FORMAT_PRESETS[0];
    const m = await db.saveMatch({
      date: new Date().toISOString().slice(0, 10),
      opponent: '',
      presetId: preset.id,
      format: { label: preset.label, onField: preset.onField, totalMinutes: preset.totalMinutes, halves: preset.halves, quartersPerHalf: preset.quartersPerHalf },
      attendingPlayerIds: [],
      keeperPerQuarter: [],
      injuredIds: [],
      subIntervalMin: 5,
      status: 'draft',
    });
    setRoute('matchSetup', { id: m.id });
  });
  view.querySelectorAll('.match').forEach((el) => {
    el.addEventListener('click', () => {
      const m = matches.find((x) => x.id === el.dataset.id);
      if (m && m.status === 'live') setRoute('live', { id: m.id });
      else setRoute('matchSetup', { id: el.dataset.id });
    });
  });
}

// ------- Roster -------
async function renderRoster(players) {
  titleEl.textContent = 'Spelers';
  view.innerHTML = V.viewRoster(players);
  document.getElementById('add-player')?.addEventListener('click', async () => {
    const inp = document.getElementById('new-player-name');
    const name = inp.value.trim();
    if (!name) return;
    await db.savePlayer({ firstName: name, active: true });
    inp.value = '';
    render();
  });
  document.getElementById('new-player-name')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('add-player').click();
  });
  view.querySelectorAll('button[data-act="del"]').forEach((b) => {
    b.addEventListener('click', async () => {
      if (!confirm('Speler verwijderen? Speeltijd-historie blijft bestaan in oude wedstrijden.')) return;
      await db.deletePlayer(b.dataset.id);
      render();
    });
  });

  // Inline rename: show "Opslaan" button when value changes; commit on click or Enter or blur.
  view.querySelectorAll('input.player-name-input').forEach((inp) => {
    const id = inp.dataset.id;
    const original = inp.value;
    const saveBtn = view.querySelector(`button[data-act="save"][data-id="${id}"]`);
    const showSave = () => { if (saveBtn) saveBtn.hidden = inp.value.trim() === original || !inp.value.trim(); };
    const commit = async () => {
      const name = inp.value.trim();
      if (!name || name === original) { inp.value = original; if (saveBtn) saveBtn.hidden = true; return; }
      const player = (await db.listPlayers()).find((x) => x.id === id);
      if (!player) return;
      player.firstName = name;
      await db.savePlayer(player);
      render();
    };
    inp.addEventListener('input', showSave);
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); inp.blur(); commit(); } });
    inp.addEventListener('blur', () => { if (inp.value.trim() !== original && inp.value.trim()) commit(); });
    if (saveBtn) saveBtn.addEventListener('click', commit);
  });
}

// ------- Stats -------
async function renderStats(players) {
  titleEl.textContent = 'Speeltijd';
  const matches = await db.listMatches();
  const history = buildHistory(matches);
  view.innerHTML = V.viewStats(players, history);
}

// ------- Settings -------
async function renderSettings() {
  titleEl.textContent = 'Instellingen';
  const teamName = await db.getSetting('teamName', '');
  const prefs = await getPrefs();
  view.innerHTML = V.viewSettings(teamName, prefs);
  document.getElementById('save-team').addEventListener('click', async () => {
    await db.setSetting('teamName', document.getElementById('team-name').value.trim());
    showAlert('Opgeslagen', '');
  });
  const savePrefs = async () => {
    const p = {
      sound: document.getElementById('pref-sound').checked,
      vibrate: document.getElementById('pref-vibrate').checked,
      leadSeconds: Math.max(0, +document.getElementById('pref-lead').value || 0),
    };
    await db.setSetting('prefs', p);
  };
  document.getElementById('pref-sound').addEventListener('change', savePrefs);
  document.getElementById('pref-vibrate').addEventListener('change', savePrefs);
  document.getElementById('pref-lead').addEventListener('change', savePrefs);
  document.getElementById('test-signal').addEventListener('click', async () => {
    unlockAudio();
    await savePrefs();
    const p = await getPrefs();
    if (p.sound) beep();
    if (p.vibrate) vibrate();
  });
  document.getElementById('export').addEventListener('click', async () => {
    const data = await db.exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `wisselapp-backup-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  });
  document.getElementById('import').addEventListener('click', () => document.getElementById('import-file').click());
  document.getElementById('import-file').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const txt = await f.text();
    try {
      await db.importAll(JSON.parse(txt));
      showAlert('Geïmporteerd', 'Backup is geladen.');
      render();
    } catch (err) {
      showAlert('Fout', String(err.message || err));
    }
  });
  document.getElementById('wipe').addEventListener('click', async () => {
    if (!confirm('Weet je zeker dat je ALLE data wist? Dit kan niet ongedaan worden gemaakt.')) return;
    indexedDB.deleteDatabase('wisselapp');
    localStorage.clear();
    setTimeout(() => location.reload(), 300);
  });
}

// ------- Match setup -------
async function renderMatchSetup(players, id) {
  titleEl.textContent = 'Wedstrijd';
  const match = await db.getMatch(id);
  if (!match) { setRoute('matches'); return; }

  // Compute history from FINISHED matches only (excluding this one)
  const allMatches = await db.listMatches();
  const history = buildHistory(allMatches.filter((m) => m.id !== id));
  // Effective history used for planning: empty when the user wants to ignore history.
  const effHistory = match.ignoreHistory ? {} : history;

  // Try to build a plan if everything is set
  let plan = null;
  if (canPlan(match)) {
    try { plan = buildPlan(match, effHistory); match.plan = plan; await db.saveMatch({ ...match, status: 'ready' }); }
    catch (e) { console.warn(e); }
  }

  view.innerHTML = V.viewMatchSetup(match, players, history, plan);

  // Wire fields
  const $ = (id) => document.getElementById(id);
  const update = async (mut) => {
    Object.assign(match, mut);
    await db.saveMatch(match);
    renderMatchSetup(players, id);
  };

  $('m-date').addEventListener('change', (e) => update({ date: e.target.value }));
  $('m-opp').addEventListener('change', (e) => update({ opponent: e.target.value }));
  $('m-preset').addEventListener('change', (e) => {
    const p = V.FORMAT_PRESETS.find((x) => x.id === e.target.value);
    if (!p) return;
    update({
      presetId: p.id,
      format: { label: p.label, onField: p.onField, totalMinutes: p.totalMinutes, halves: p.halves, quartersPerHalf: p.quartersPerHalf },
    });
  });
  $('m-onfield').addEventListener('change', (e) => update({ format: { ...match.format, onField: +e.target.value } }));
  $('m-total').addEventListener('change', (e) => update({ format: { ...match.format, totalMinutes: +e.target.value } }));
  $('m-halves').addEventListener('change', (e) => update({ format: { ...match.format, halves: +e.target.value } }));
  $('m-qph').addEventListener('change', (e) => update({ format: { ...match.format, quartersPerHalf: +e.target.value } }));
  $('m-int').addEventListener('change', (e) => update({ subIntervalMin: +e.target.value }));
  $('m-spr').addEventListener('change', (e) => update({ subsPerRotation: e.target.value ? +e.target.value : null }));

  view.querySelectorAll('input[type=checkbox][data-pid]').forEach((c) => {
    c.addEventListener('change', () => {
      const pid = c.dataset.pid;
      let attending = [...match.attendingPlayerIds];
      if (c.checked && !attending.includes(pid)) attending.push(pid);
      if (!c.checked) attending = attending.filter((x) => x !== pid);
      // Reset keepers if lineup changed in a way that breaks them
      const keepers = match.keeperPerQuarter.filter((k) => attending.includes(k));
      while (keepers.length < totalQuarters(match.format)) keepers.push(attending[0] || null);
      update({ attendingPlayerIds: attending, keeperPerQuarter: keepers.slice(0, totalQuarters(match.format)) });
    });
  });

  view.querySelectorAll('select[data-keeper-quarter]').forEach((s) => {
    s.addEventListener('change', () => {
      const q = +s.dataset.keeperQuarter;
      const k = [...match.keeperPerQuarter];
      while (k.length <= q) k.push(null);
      k[q] = s.value;
      update({ keeperPerQuarter: k });
    });
  });

  $('m-ignore-hist')?.addEventListener('change', (e) => update({ ignoreHistory: !!e.target.checked }));

  $('suggest-keepers')?.addEventListener('click', () => {
    if (!match.attendingPlayerIds.length) return;
    const k = suggestKeepers(match.attendingPlayerIds, effHistory, match.format);
    update({ keeperPerQuarter: k });
  });

  $('suggest-interval')?.addEventListener('click', () => {
    if (!canPlan(match)) {
      showAlert('Nog niet mogelijk', 'Vul eerst de aanwezige spelers en de keepers per kwart in.');
      return;
    }
    const rec = recommendSubInterval(match, effHistory);
    if (!rec) { showAlert('Geen aanbeveling', 'Kon geen interval berekenen.'); return; }
    const fmt = (sec) => {
      const m = Math.floor(sec / 60);
      const s = Math.round(sec % 60);
      return s === 0 ? `${m} min` : `${m}:${String(s).padStart(2, '0')} min`;
    };
    const minP = Math.round(Math.min(...rec.perPlayerSec) / 60);
    const maxP = Math.round(Math.max(...rec.perPlayerSec) / 60);
    showAlert(
      `Aanbevolen: elke ${fmt(rec.intervalSec)}`,
      `<div>Verschil tussen meest en minst spelende speler: <b>${Math.round(rec.spreadSec/60)} min</b> (${minP}–${maxP} min).</div>
       <div class="sub">Bereik: 3:20 – 10:00, in stappen van 10 seconden.</div>`
    ).then(() => update({ subIntervalMin: rec.intervalMin }));
  });

  $('recompute')?.addEventListener('click', () => renderMatchSetup(players, id));
  $('save-match').addEventListener('click', async () => { await db.saveMatch(match); showAlert('Opgeslagen', ''); });
  $('start-match').addEventListener('click', async () => {
    if (!plan) { showAlert('Niet klaar', 'Vul eerst spelers en keepers in.'); return; }
    unlockAudio(); // user gesture — needed for iOS audio later
    match.status = 'live';
    match.startedAt = new Date().toISOString();
    await db.saveMatch(match);
    setRoute('live', { id: match.id });
  });
  $('del-match').addEventListener('click', async () => {
    if (!confirm('Wedstrijd verwijderen?')) return;
    await db.deleteMatch(id);
    setRoute('matches');
  });
}

function canPlan(m) {
  const tq = totalQuarters(m.format);
  return m.attendingPlayerIds.length >= m.format.onField
    && m.keeperPerQuarter.length === tq
    && m.keeperPerQuarter.every((k) => k && m.attendingPlayerIds.includes(k));
}

// ------- Live -------
async function renderLive(players, id) {
  const match = await db.getMatch(id);
  if (!match || !match.plan) { setRoute('matchSetup', { id }); return; }
  titleEl.textContent = match.opponent || 'Wedstrijd';

  const plan = match.plan;
  const totalSec = match.format.totalMinutes * 60;

  // Reuse existing clock if same match (prevents double timers across re-renders)
  if (!liveCtx || liveCtx.match.id !== id) {
    if (liveCtx) liveCtx.clock.pause();
    const prefs = await getPrefs();
    const clock = new MatchClock(id, totalSec, () => paint(), (atSec) => onAlarm(atSec));
    liveCtx = { match, plan, players, clock, prefs, quarterBreaks: new Set(), lastPersistMs: 0 };
    rearmAlarms();
    if (match.status === 'live' && !clock.isRunning() && clock.elapsedSec() === 0) clock.start();
  }

  // Persist live playtime to DB so history is preserved even if user
  // never taps "Beëindig". Throttled to once every ~10s while painting.
  async function persistLiveSnapshot(force = false) {
    if (!liveCtx || liveCtx.match.id !== id) return;
    const now = Date.now();
    if (!force && now - liveCtx.lastPersistMs < 10000) return;
    liveCtx.lastPersistMs = now;
    const elapsed = liveCtx.clock.elapsedSec();
    match.actualPlaytime = computeActualPlaytime(plan, match, elapsed);
    match.elapsedSec = elapsed;
    try { await db.saveMatch(match); } catch {}
  }

  function rearmAlarms() {
    const subTimes = plan.quarters.flatMap((q) => q.subEvents.map((e) => e.atSec)).filter((t) => t > 0);
    const leadTimes = subTimes.map((t) => Math.max(0, t - liveCtx.prefs.leadSeconds));
    // Quarter-end breaks: every quarter end EXCEPT the very last (which is end of match).
    const breaks = plan.quarters.slice(0, -1).map((q) => q.endSec);
    liveCtx.quarterBreaks = new Set(breaks);
    const alarms = [...new Set([...leadTimes, ...subTimes, ...breaks])].sort((a, b) => a - b);
    liveCtx.clock.setAlarms(alarms);
  }

  function paint() {
    const e = liveCtx.clock.elapsedSec();
    view.innerHTML = V.viewLive(match, players, plan, e);
    document.getElementById('live-pause').addEventListener('click', () => { liveCtx.clock.pause(); persistLiveSnapshot(true); });
    document.getElementById('live-resume').addEventListener('click', () => { unlockAudio(); liveCtx.clock.start(); });
    document.getElementById('live-finish').addEventListener('click', finishMatch);
    document.getElementById('jump-back').addEventListener('click', () => { liveCtx.clock.adjust(-10); paint(); });
    document.getElementById('jump-fwd').addEventListener('click', () => { liveCtx.clock.adjust(+10); paint(); });
    view.querySelectorAll('.tappable[data-pid]').forEach((el) => {
      el.addEventListener('click', () => onPlayerTap(el.dataset.pid, el.dataset.role));
    });
    persistLiveSnapshot();
  }

  async function onPlayerTap(pid, role) {
    const name = V.nameOf(players, pid);
    const at = liveCtx.clock.elapsedSec();
    const choice = await showActionSheet(`${name}`, [
      { id: 'injury', label: '🩹 Markeer als geblesseerd', danger: true },
      { id: 'cancel', label: 'Annuleren' },
    ]);
    if (choice !== 'injury') return;
    if (!confirm(`${name} markeren als geblesseerd? Deze speler wordt uit de rest van de wedstrijd gehaald en het wisselschema wordt bijgewerkt.`)) return;
    match.injuredIds = match.injuredIds || [];
    if (!match.injuredIds.includes(pid)) match.injuredIds.push(pid);
    applyInjury(plan, match, at, pid);
    match.plan = plan;
    await db.saveMatch(match);
    rearmAlarms();
    paint();
  }

  function onAlarm(atSec) {
    // Quarter-end break: pause and prompt user to resume manually.
    if (liveCtx.quarterBreaks.has(atSec)) {
      liveCtx.clock.pause();
      const finishedQ = plan.quarters.findIndex((q) => Math.abs(q.endSec - atSec) < 0.6);
      const nextQ = plan.quarters[finishedQ + 1];
      const isHalfTime = (finishedQ + 1) === (match.format.quartersPerHalf || 2);
      const title = isHalfTime ? 'Rust — timer gepauzeerd' : `Kwart ${finishedQ + 1} afgelopen — pauze`;
      const nextKeeperName = nextQ ? V.escapeHtml(V.nameOf(players, nextQ.keeperId)) : '';
      const body = `<div>De timer is automatisch gepauzeerd. Druk op <b>▶ Hervat</b> om kwart ${finishedQ + 2} te starten.</div>
                    ${nextQ ? `<div class="sub">Volgende keeper: <b>${nextKeeperName}</b></div>` : ''}`;
      showAlert(title, body, { sound: liveCtx.prefs.sound, vib: liveCtx.prefs.vibrate });
      paint();
      return;
    }
    const ev = plan.quarters.flatMap((q) => q.subEvents).find((x) => Math.abs(x.atSec - atSec) < 0.6);
    if (!ev) return;
    const elapsed = liveCtx.clock.elapsedSec();
    const lead = Math.max(0, atSec - elapsed);
    const off = (ev.off || []).map((id) => V.nameOf(players, id)).join(', ') || '—';
    const on = (ev.on || []).map((id) => V.nameOf(players, id)).join(', ') || '—';
    const keeperName = V.nameOf(players, ev.keeperId);
    const title = ev.type === 'quarter'
      ? (lead > 5 ? `Kwartwissel over ${Math.round(lead)}s` : 'Kwartwissel — nu!')
      : (lead > 5 ? `Wissel over ${Math.round(lead)}s` : 'Wisselen — nu!');
    const body = `<div><b>Eraf:</b> ${V.escapeHtml(off)}</div>
                  <div><b>Erin:</b> ${V.escapeHtml(on)}</div>
                  <div class="sub">Keeper: ${V.escapeHtml(keeperName)}</div>`;
    showAlert(title, body, { sound: liveCtx.prefs.sound, vib: liveCtx.prefs.vibrate });
  }

  async function finishMatch() {
    if (!confirm('Wedstrijd beëindigen?')) return;
    liveCtx.clock.pause();
    // Record actual playtime = planned playtime up to the elapsed time.
    const elapsed = liveCtx.clock.elapsedSec();
    const actual = computeActualPlaytime(plan, match, elapsed);
    match.status = 'finished';
    match.finishedAt = new Date().toISOString();
    match.actualPlaytime = actual;
    match.elapsedSec = elapsed;
    await db.saveMatch(match);
    liveCtx.clock.reset();
    liveCtx = null;
    setRoute('matches');
  }

  paint();
}

function computeActualPlaytime(plan, match, elapsed) {
  const out = {};
  match.attendingPlayerIds.forEach((id) => (out[id] = { fieldSec: 0, keeperSec: 0, totalSec: 0 }));
  for (const q of plan.quarters) {
    if (elapsed <= q.startSec) break;
    const qEnd = Math.min(elapsed, q.endSec);
    // Keeper played from q.startSec to qEnd
    out[q.keeperId].keeperSec += qEnd - q.startSec;
    for (const slot of q.slots) {
      if (elapsed <= slot.startSec) break;
      const sEnd = Math.min(elapsed, slot.endSec);
      const dur = sEnd - slot.startSec;
      slot.fieldIds.forEach((id) => { out[id].fieldSec += dur; });
    }
  }
  for (const id of Object.keys(out)) out[id].totalSec = out[id].fieldSec + out[id].keeperSec;
  return out;
}

// Pause clock if user navigates away to free wake lock
window.addEventListener('beforeunload', () => { liveCtx?.clock.pause(); persistLiveOnLeave(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) persistLiveOnLeave(); });

// Start
setRoute('matches');
