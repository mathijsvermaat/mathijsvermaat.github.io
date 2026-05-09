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
  const s = await tx('matches', 'readwrite');
  if (!m.id) m.id = uid();
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
