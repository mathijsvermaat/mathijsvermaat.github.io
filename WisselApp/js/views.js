// HTML templates and small render helpers. Vanilla strings — no framework.

export const FORMAT_PRESETS = [
  { id: 'jo8',  label: 'JO8/JO9 (6v6 met keeper)',   onField: 6,  totalMinutes: 40, halves: 2, quartersPerHalf: 2 },
  { id: 'jo10', label: 'JO10/JO11 (8v8)',            onField: 8,  totalMinutes: 50, halves: 2, quartersPerHalf: 2 },
  { id: 'jo12', label: 'JO12/JO13 (11v11)',          onField: 11, totalMinutes: 60, halves: 2, quartersPerHalf: 2 },
  { id: 'jo14', label: 'JO14+ (11v11)',              onField: 11, totalMinutes: 70, halves: 2, quartersPerHalf: 2 },
  { id: 'cust', label: 'Aangepast',                  onField: 6,  totalMinutes: 40, halves: 2, quartersPerHalf: 2 },
];

export const fmtTime = (sec) => {
  sec = Math.max(0, Math.round(sec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

export const fmtMin = (sec) => `${Math.round((sec || 0) / 60)} min`;

export const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function nameOf(players, id) {
  const p = players.find((x) => x.id === id);
  return p ? p.firstName : '?';
}

// ---------- Views ----------

export function viewMatches(matches, players) {
  if (!matches.length) {
    return `<div class="empty">
      <p>Nog geen wedstrijden.</p>
      <button class="primary big" id="new-match">+ Nieuwe wedstrijd</button>
    </div>`;
  }
  return `
    <div class="list">
      ${matches.map((m) => `
        <div class="card match" data-id="${m.id}">
          <div class="row between">
            <div>
              <div class="title">${escapeHtml(m.opponent || 'Wedstrijd')}</div>
              <div class="sub">${escapeHtml(m.date || '')} · ${escapeHtml(m.format?.label || '')}</div>
            </div>
            <div class="status status-${m.status || 'draft'}">${statusLabel(m.status)}</div>
          </div>
        </div>`).join('')}
    </div>
    <button class="fab" id="new-match" aria-label="Nieuwe wedstrijd">+</button>
  `;
}

const statusLabel = (s) => ({
  draft: 'Concept',
  ready: 'Klaar',
  live: 'Loopt',
  finished: 'Klaar',
}[s] || 'Concept');

export function viewRoster(players) {
  return `
    <div class="card">
      <div class="row gap">
        <input id="new-player-name" placeholder="Voornaam" maxlength="40" />
        <button class="primary" id="add-player">Toevoegen</button>
      </div>
    </div>
    <div class="list">
      ${players.length ? players.map((p) => `
        <div class="card row between" data-id="${p.id}">
          <div>${escapeHtml(p.firstName)}</div>
          <button class="link danger" data-act="del" data-id="${p.id}">Verwijderen</button>
        </div>`).join('')
        : `<div class="empty"><p>Nog geen spelers.</p></div>`}
    </div>
  `;
}

export function viewSettings(teamName) {
  return `
    <div class="card">
      <label>Teamnaam<input id="team-name" value="${escapeHtml(teamName || '')}" maxlength="40" /></label>
      <button class="primary" id="save-team">Opslaan</button>
    </div>
    <div class="card">
      <h3>Backup</h3>
      <p class="sub">Alle data staat lokaal op dit toestel. Maak regelmatig een back-up.</p>
      <div class="row gap">
        <button id="export">Exporteren (.json)</button>
        <button id="import">Importeren</button>
        <input type="file" id="import-file" accept="application/json" hidden />
      </div>
    </div>
    <div class="card">
      <h3>App installeren</h3>
      <p class="sub">iPhone: open in Safari → Deel → <b>Zet op beginscherm</b>.<br/>
      Android: menu → <b>App installeren</b>.<br/>
      Daarna werkt de app offline en draait fullscreen.</p>
    </div>
    <div class="card">
      <h3>Alle data wissen</h3>
      <button class="danger" id="wipe">Wis alles</button>
    </div>
  `;
}

export function viewStats(players, history) {
  const rows = players.map((p) => {
    const h = history[p.id] || { totalSeconds: 0, fieldSeconds: 0, keeperSeconds: 0, games: 0, keeperGames: 0 };
    return `<tr>
      <td>${escapeHtml(p.firstName)}</td>
      <td>${h.games}</td>
      <td>${fmtMin(h.totalSeconds)}</td>
      <td>${fmtMin(h.keeperSeconds)}</td>
      <td>${h.keeperGames}</td>
    </tr>`;
  }).join('');
  return `
    <div class="card">
      <h3>Speeltijd over alle wedstrijden</h3>
      <table class="stats">
        <thead><tr><th>Speler</th><th>Wedstr.</th><th>Totaal</th><th>Keeper</th><th>Keeper×</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="5" class="empty-cell">Geen data</td></tr>'}</tbody>
      </table>
    </div>
  `;
}

// ---------- Match setup wizard ----------

export function viewMatchSetup(match, players, history, plan) {
  const fmt = match.format;
  const presetOptions = FORMAT_PRESETS.map((p) =>
    `<option value="${p.id}" ${match.presetId === p.id ? 'selected' : ''}>${p.label}</option>`).join('');
  const totalMin = fmt.totalMinutes;
  const qSec = Math.round((totalMin * 60) / ((fmt.halves || 2) * (fmt.quartersPerHalf || 2)));
  const qMin = (qSec / 60).toFixed(1).replace(/\.0$/, '');
  const totalQ = (fmt.halves || 2) * (fmt.quartersPerHalf || 2);

  const playerCheckboxes = players.map((p) => {
    const checked = match.attendingPlayerIds.includes(p.id) ? 'checked' : '';
    const h = history[p.id];
    const sub = h ? `<span class="sub">${fmtMin(h.totalSeconds)} totaal · keeper ${fmtMin(h.keeperSeconds)}</span>` : '';
    return `<label class="chk"><input type="checkbox" data-pid="${p.id}" ${checked}/> ${escapeHtml(p.firstName)} ${sub}</label>`;
  }).join('');

  const keeperRows = Array.from({ length: totalQ }, (_, i) => {
    const opts = match.attendingPlayerIds.map((id) => {
      const sel = match.keeperPerQuarter[i] === id ? 'selected' : '';
      return `<option value="${id}" ${sel}>${escapeHtml(nameOf(players, id))}</option>`;
    }).join('');
    return `<label class="row between">
      <span>Kwart ${i + 1}</span>
      <select data-keeper-quarter="${i}">${opts || '<option>(geen spelers)</option>'}</select>
    </label>`;
  }).join('');

  let planHtml = '';
  if (plan) {
    planHtml = `
      <div class="card">
        <h3>Wisselschema (voorbeeld)</h3>
        ${plan.quarters.map((q) => `
          <div class="quarter">
            <div class="qhead">
              <b>Kwart ${q.index + 1}</b>
              <span class="sub">${fmtTime(q.startSec)} – ${fmtTime(q.endSec)}</span>
              <span class="keeper">🧤 ${escapeHtml(nameOf(players, q.keeperId))}</span>
            </div>
            ${q.slots.map((s) => `
              <div class="slot">
                <span class="sub">${fmtTime(s.startSec)}</span>
                <span class="ids">${s.fieldIds.map((id) => escapeHtml(nameOf(players, id))).join(', ')}</span>
              </div>`).join('')}
          </div>
        `).join('')}
        <h4>Geplande speeltijd</h4>
        <table class="stats">
          <thead><tr><th>Speler</th><th>Veld</th><th>Keeper</th><th>Totaal</th></tr></thead>
          <tbody>
            ${match.attendingPlayerIds.map((id) => {
              const v = plan.plannedSecondsPerPlayer[id];
              return `<tr><td>${escapeHtml(nameOf(players, id))}</td><td>${fmtMin(v.fieldSec)}</td><td>${fmtMin(v.keeperSec)}</td><td>${fmtMin(v.totalSec)}</td></tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  return `
    <div class="card">
      <label>Datum<input type="date" id="m-date" value="${escapeHtml(match.date || '')}" /></label>
      <label>Tegenstander<input id="m-opp" value="${escapeHtml(match.opponent || '')}" /></label>
      <label>Speelvorm
        <select id="m-preset">${presetOptions}</select>
      </label>
      <div class="row gap">
        <label>Spelers in veld<input type="number" id="m-onfield" min="3" max="11" value="${fmt.onField}" /></label>
        <label>Totale tijd (min)<input type="number" id="m-total" min="10" max="120" value="${fmt.totalMinutes}" /></label>
      </div>
      <div class="row gap">
        <label>Helften<input type="number" id="m-halves" min="1" max="3" value="${fmt.halves || 2}" /></label>
        <label>Kwarten per helft<input type="number" id="m-qph" min="1" max="3" value="${fmt.quartersPerHalf || 2}" /></label>
      </div>
      <p class="sub">→ ${totalQ} kwarten van ${qMin} min · keeper wisselt aan elk kwart.</p>
      <label>Wisselinterval binnen kwart (min)
        <input type="number" id="m-int" min="1" max="20" step="1" value="${match.subIntervalMin || (qSec/60)}" />
      </label>
      <label>Wissels per rotatie (optioneel)
        <input type="number" id="m-spr" min="1" max="11" value="${match.subsPerRotation || ''}" placeholder="auto" />
      </label>
    </div>

    <div class="card">
      <h3>Aanwezige spelers</h3>
      <div class="checks">${playerCheckboxes || '<i>Voeg eerst spelers toe.</i>'}</div>
    </div>

    <div class="card">
      <h3>Keepers per kwart</h3>
      <button id="suggest-keepers" class="link">Voorstel op basis van geschiedenis</button>
      <div class="keepers">${keeperRows}</div>
    </div>

    ${planHtml}

    <div class="row gap stick-bottom">
      <button id="recompute">Herbereken schema</button>
      <button class="primary" id="save-match">Opslaan</button>
      <button class="primary big" id="start-match" ${plan ? '' : 'disabled'}>▶ Start wedstrijd</button>
    </div>
    <div class="row gap">
      <button class="danger" id="del-match">Wedstrijd verwijderen</button>
    </div>
  `;
}

// ---------- Live match ----------

export function viewLive(match, players, plan, elapsedSec) {
  const fmt = match.format;
  const totalSec = fmt.totalMinutes * 60;
  // Find current quarter & slot
  let curQ = plan.quarters.findIndex((q) => elapsedSec < q.endSec);
  if (curQ === -1) curQ = plan.quarters.length - 1;
  const q = plan.quarters[curQ];
  const curSlot = q.slots.findIndex((s) => elapsedSec < s.endSec);
  const slot = q.slots[curSlot === -1 ? q.slots.length - 1 : curSlot];
  const keeperId = q.keeperId;
  const fieldIds = slot.fieldIds;
  const benchIds = match.attendingPlayerIds.filter((id) => id !== keeperId && !fieldIds.includes(id));

  // Next event
  const allEvents = plan.quarters.flatMap((qq) => qq.subEvents);
  const next = allEvents.find((e) => e.atSec > elapsedSec + 0.5);
  const nextIn = next ? Math.max(0, next.atSec - elapsedSec) : 0;

  return `
    <div class="clock">
      <div class="big-time">${fmtTime(totalSec - elapsedSec)}</div>
      <div class="sub">Kwart ${curQ + 1} / ${plan.quarters.length} · gespeeld ${fmtTime(elapsedSec)}</div>
    </div>

    <div class="card next-sub ${nextIn < 30 ? 'soon' : ''}">
      <div class="sub">Volgende wissel over</div>
      <div class="big-time small">${fmtTime(nextIn)}</div>
      ${next ? renderNext(next, players) : '<div class="sub">Geen wissels meer</div>'}
    </div>

    <div class="card">
      <h3>🧤 Keeper</h3>
      <div class="bigname">${escapeHtml(nameOf(players, keeperId))}</div>
    </div>
    <div class="row two">
      <div class="card">
        <h3>In het veld</h3>
        ${fieldIds.map((id) => `<div class="pname">${escapeHtml(nameOf(players, id))}</div>`).join('')}
      </div>
      <div class="card">
        <h3>Op de bank</h3>
        ${benchIds.length ? benchIds.map((id) => `<div class="pname">${escapeHtml(nameOf(players, id))}</div>`).join('') : '<i class="sub">leeg</i>'}
      </div>
    </div>

    <div class="row gap stick-bottom">
      <button id="live-pause">⏸ Pauze</button>
      <button id="live-resume" class="primary">▶ Hervat</button>
      <button id="live-finish" class="danger">Beëindig</button>
    </div>
  `;
}

function renderNext(ev, players) {
  const off = ev.off?.length ? `<div><b>Eraf:</b> ${ev.off.map((id) => escapeHtml(nameOf(players, id))).join(', ')}</div>` : '';
  const on  = ev.on?.length  ? `<div><b>Erin:</b> ${ev.on.map((id) => escapeHtml(nameOf(players, id))).join(', ')}</div>` : '';
  const kind = ev.type === 'quarter' ? `<div class="sub">Kwartwissel — keeper: ${escapeHtml(nameOf(players, ev.keeperId))}</div>` : '';
  return kind + off + on;
}
