// IndexedDB wrapper. All data stays on the device.

const DB_NAME = 'wisselapp';
const DB_VERSION = 1;

let _db = null;

function open() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('players')) {
        db.createObjectStore('players', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('matches')) {
        const ms = db.createObjectStore('matches', { keyPath: 'id' });
        ms.createIndex('date', 'date');
      }
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

function tx(store, mode = 'readonly') {
  return open().then((db) => db.transaction(store, mode).objectStore(store));
}

function reqP(r) {
  return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

// ----- Players -----
export async function listPlayers() {
  const s = await tx('players');
  return reqP(s.getAll()).then((a) => a.sort((x, y) => x.firstName.localeCompare(y.firstName, 'nl')));
}
export async function savePlayer(p) {
  const s = await tx('players', 'readwrite');
  if (!p.id) p.id = uid();
  await reqP(s.put(p));
  return p;
}
export async function deletePlayer(id) {
  const s = await tx('players', 'readwrite');
  await reqP(s.delete(id));
}

// ----- Matches -----
export async function listMatches() {
  const s = await tx('matches');
  const all = await reqP(s.getAll());
  return all.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}
export async function getMatch(id) {
  const s = await tx('matches');
  return reqP(s.get(id));
}
export async function saveMatch(m) {
  if (!m.id) m.id = uid();
  // Safeguard: never overwrite a non-zero actualPlaytime with an all-zero
  // one. This protects finished matches from being corrupted by stray
  // re-renders that compute playtime from a fresh (elapsed=0) clock.
  if (m.actualPlaytime && Object.values(m.actualPlaytime).every((v) => !v || ((v.totalSec || 0) === 0 && (v.fieldSec || 0) === 0 && (v.keeperSec || 0) === 0))) {
    try {
      const sRead = await tx('matches');
      const prev = await reqP(sRead.get(m.id));
      const prevAp = prev && prev.actualPlaytime;
      const prevHasData = prevAp && Object.values(prevAp).some((v) => v && ((v.totalSec || 0) > 0 || (v.fieldSec || 0) > 0 || (v.keeperSec || 0) > 0));
      if (prevHasData) {
        console.warn('saveMatch: blocked overwrite of actualPlaytime with all-zero values for match', m.id);
        m.actualPlaytime = prevAp;
      }
    } catch (err) { console.warn('saveMatch safeguard read failed', err); }
  }
  const s = await tx('matches', 'readwrite');
  await reqP(s.put(m));
  return m;
}
export async function deleteMatch(id) {
  const s = await tx('matches', 'readwrite');
  await reqP(s.delete(id));
}

// ----- Settings -----
export async function getSetting(key, fallback = null) {
  const s = await tx('settings');
  const v = await reqP(s.get(key));
  return v ? v.value : fallback;
}
export async function setSetting(key, value) {
  const s = await tx('settings', 'readwrite');
  await reqP(s.put({ key, value }));
}

// ----- Backup -----
export async function exportAll() {
  const [players, matches] = await Promise.all([listPlayers(), listMatches()]);
  const settings = {
    teamName: await getSetting('teamName', ''),
    defaults: await getSetting('defaults', null),
  };
  return { version: 1, exportedAt: new Date().toISOString(), players, matches, settings };
}
export async function importAll(data) {
  if (!data || data.version !== 1) throw new Error('Onbekend backup-formaat');
  if (data.type === 'wisselapp-matches') throw new Error('Dit is een wedstrijdexport. Gebruik "Wedstrijden importeren".');
  const db = await open();
  await new Promise((resolve, reject) => {
    const t = db.transaction(['players', 'matches', 'settings'], 'readwrite');
    t.oncomplete = resolve; t.onerror = () => reject(t.error);
    const ps = t.objectStore('players'); ps.clear();
    (data.players || []).forEach((p) => ps.put(p));
    const ms = t.objectStore('matches'); ms.clear();
    (data.matches || []).forEach((m) => ms.put(m));
    const ss = t.objectStore('settings'); ss.clear();
    if (data.settings) {
      Object.entries(data.settings).forEach(([k, v]) => v != null && ss.put({ key: k, value: v }));
    }
  });
}

// ----- Selected matches -----
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isId = (value) => typeof value === 'string' && /^[a-z0-9_-]+$/i.test(value)
  && !Object.hasOwn(Object.prototype, value);
const isSeconds = (value) => Number.isFinite(value) && value >= 0;
const isIds = (value) => Array.isArray(value) && value.every(isId);

function requireData(condition, message) {
  if (!condition) throw new Error(message);
}

function validateMatch(match) {
  const error = 'Ongeldige wedstrijdgegevens';
  requireData(isRecord(match) && isId(match.id), error);
  requireData(['draft', 'ready', 'live', 'finished'].includes(match.status), error);
  requireData((match.opponent == null || typeof match.opponent === 'string')
    && (match.date == null || typeof match.date === 'string'), error);
  requireData(isRecord(match.format), error);
  for (const key of ['onField', 'totalMinutes', 'halves', 'quartersPerHalf']) {
    requireData(Number.isFinite(match.format[key]) && match.format[key] > 0, error);
  }
  requireData(Number.isInteger(match.format.onField) && Number.isInteger(match.format.halves)
    && Number.isInteger(match.format.quartersPerHalf), error);
  requireData(isIds(match.attendingPlayerIds) && isIds(match.keeperPerQuarter), error);
  requireData(match.injuredIds == null || isIds(match.injuredIds), error);
  for (const key of ['elapsedSec', 'subIntervalMin', 'subsPerRotation']) {
    requireData(match[key] == null || isSeconds(match[key]), error);
  }
  const validateTotals = (totals) => {
    requireData(isRecord(totals), error);
    for (const [id, value] of Object.entries(totals)) {
      requireData(isId(id) && isRecord(value), error);
      for (const key of ['totalSec', 'fieldSec', 'keeperSec']) {
        requireData(value[key] == null || isSeconds(value[key]), error);
      }
    }
  };
  if (match.actualPlaytime != null) validateTotals(match.actualPlaytime);
  if (match.goals != null) {
    requireData(Array.isArray(match.goals), error);
    for (const goal of match.goals) {
      requireData(isRecord(goal) && isId(goal.id) && isSeconds(goal.atSec)
        && ['us', 'opp'].includes(goal.team) && (goal.scorerId == null || isId(goal.scorerId)), error);
    }
  }
  if (match.availabilityChanges != null) {
    requireData(Array.isArray(match.availabilityChanges), error);
    for (const change of match.availabilityChanges) {
      requireData(isRecord(change) && isSeconds(change.atSec) && isIds(change.playerIds), error);
    }
  }
  if (match.status === 'live' || match.status === 'finished') {
    requireData(isRecord(match.plan), 'Wisselschema ontbreekt bij een gespeelde wedstrijd');
  }
  if (match.plan != null) {
    const plan = match.plan;
    requireData(isRecord(plan) && Array.isArray(plan.quarters) && plan.quarters.length > 0, error);
    validateTotals(plan.plannedSecondsPerPlayer);
    for (const quarter of plan.quarters) {
      requireData(isRecord(quarter) && isId(quarter.keeperId)
        && isSeconds(quarter.index) && isSeconds(quarter.startSec) && isSeconds(quarter.endSec)
        && Array.isArray(quarter.slots) && quarter.slots.length > 0
        && Array.isArray(quarter.subEvents), error);
      for (const slot of quarter.slots) {
        requireData(isRecord(slot) && isSeconds(slot.startSec) && isSeconds(slot.endSec)
          && slot.endSec > slot.startSec && isIds(slot.fieldIds), error);
      }
      for (const event of quarter.subEvents) {
        requireData(isRecord(event) && isSeconds(event.atSec) && isIds(event.off)
          && isIds(event.on) && isId(event.keeperId), error);
      }
    }
    if (plan.fairness != null) {
      requireData(isRecord(plan.fairness) && isSeconds(plan.fairness.spreadSec)
        && isSeconds(plan.fairness.limitSec), error);
    }
  }
}

export function validateMatchImport(data) {
  requireData(isRecord(data) && data.version === 1
    && (data.type == null || data.type === 'wisselapp-matches'), 'Onbekend wedstrijd- of backup-formaat');
  requireData(Array.isArray(data.matches) && Array.isArray(data.players), 'Wedstrijden of spelers ontbreken in het bestand');
  const matchIds = new Set();
  for (const match of data.matches) {
    validateMatch(match);
    requireData(!matchIds.has(match.id), 'Dubbele wedstrijd-ID in het bestand');
    matchIds.add(match.id);
  }
  const playerIds = new Set();
  for (const player of data.players) {
    requireData(isRecord(player) && isId(player.id) && typeof player.firstName === 'string'
      && (player.active == null || typeof player.active === 'boolean'), 'Ongeldige spelergegevens');
    requireData(!playerIds.has(player.id), 'Dubbele speler-ID in het bestand');
    playerIds.add(player.id);
  }
  return data;
}

function selectMatches(matches, ids) {
  requireData(isIds(ids) && ids.length > 0, 'Selecteer minstens een wedstrijd');
  const selectedIds = new Set(ids);
  const selected = matches.filter((match) => selectedIds.has(match.id));
  requireData(selected.length === selectedIds.size, 'Een geselecteerde wedstrijd bestaat niet meer');
  return selected;
}

function matchPlayerIds(matches) {
  const ids = new Set();
  const add = (values) => values.forEach((id) => { if (id) ids.add(id); });
  for (const match of matches) {
    add(match.attendingPlayerIds || []);
    add(match.keeperPerQuarter || []);
    add(match.injuredIds || []);
    add(Object.keys(match.actualPlaytime || {}));
    add(Object.keys(match.plan?.plannedSecondsPerPlayer || {}));
    (match.goals || []).forEach((goal) => add([goal.scorerId]));
    (match.availabilityChanges || []).forEach((change) => add(change.playerIds));
    for (const quarter of match.plan?.quarters || []) {
      add([quarter.keeperId]);
      quarter.slots.forEach((slot) => add(slot.fieldIds));
      quarter.subEvents.forEach((event) => add([event.keeperId, ...event.off, ...event.on]));
    }
  }
  return ids;
}

export async function exportMatches(ids) {
  const [allMatches, allPlayers] = await Promise.all([listMatches(), listPlayers()]);
  const matches = selectMatches(allMatches, ids);
  const playerIds = matchPlayerIds(matches);
  return validateMatchImport({
    version: 1, type: 'wisselapp-matches', exportedAt: new Date().toISOString(),
    matches, players: allPlayers.filter((player) => playerIds.has(player.id)),
  });
}

export async function importMatches(data, ids, duplicates = 'skip') {
  validateMatchImport(data);
  requireData(['skip', 'replace'].includes(duplicates), 'Kies overslaan of vervangen voor bestaande wedstrijden');
  const selected = selectMatches(data.matches, ids);
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(['players', 'matches'], 'readwrite');
    const ps = t.objectStore('players');
    const ms = t.objectStore('matches');
    const playerKeys = ps.getAllKeys();
    const matchKeys = ms.getAllKeys();
    const result = { added: 0, replaced: 0, skipped: 0, playersAdded: 0, importedIds: [] };
    let failure;
    t.oncomplete = () => resolve(result);
    t.onabort = () => reject(failure || t.error || new Error('Importeren is afgebroken'));
    matchKeys.onsuccess = () => {
      try {
        // Requests in this transaction run in order; playerKeys is already complete.
        const existingPlayers = new Set(playerKeys.result);
        const existingMatches = new Set(matchKeys.result);
        const imported = selected.filter((match) => {
          if (duplicates === 'skip' && existingMatches.has(match.id)) {
            result.skipped++;
            return false;
          }
          return true;
        });
        const playerIds = matchPlayerIds(imported);
        for (const player of data.players) {
          if (playerIds.has(player.id) && !existingPlayers.has(player.id)) {
            ps.add(player);
            result.playersAdded++;
          }
        }
        for (const match of imported) {
          ms.put(match);
          if (existingMatches.has(match.id)) result.replaced++;
          else result.added++;
          result.importedIds.push(match.id);
        }
      } catch (err) {
        failure = err;
        t.abort();
      }
    };
  });
}
