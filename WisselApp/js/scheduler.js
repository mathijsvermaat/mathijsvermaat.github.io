// Substitution + keeper scheduling.
//
// Match model:
//   format.onField           e.g. 6 (includes keeper)
//   format.totalMinutes      e.g. 40
//   format.halves            2 (always)
//   format.quartersPerHalf   2 (always)  -> totalQuarters = 4
//   subIntervalMin           e.g. 5  (within a quarter, between rotations)
//   attendingPlayerIds       []
//   keeperPerQuarter         [pid, pid, pid, pid]
//
// Constraint: a keeper plays the FULL quarter (cannot be subbed mid-quarter).
// Field rotations happen every subIntervalMin within a quarter.
// Keeper changes happen at quarter breaks.
//
// Fairness: try to give every attending player roughly the same minutes
// THIS MATCH, but bias by historical deficit so players who got less in
// previous matches are favoured. Some drift is acceptable.

export function totalQuarters(format) {
  return (format.halves || 2) * (format.quartersPerHalf || 2);
}
export function quarterSeconds(format) {
  return Math.round((format.totalMinutes * 60) / totalQuarters(format));
}
export function matchSeconds(format) {
  return format.totalMinutes * 60;
}

/**
 * Given history (per-player aggregates) and attending players, suggest
 * a keeper for each quarter. Greedy: at each quarter slot, pick the
 * attending player with the lowest (historical keeper minutes + already
 * planned keeper minutes for this match). Tiebreak: lowest games-as-keeper.
 */
export function suggestKeepers(attendingIds, history, format) {
  const q = totalQuarters(format);
  const planned = Object.create(null); // pid -> seconds planned this match
  attendingIds.forEach((id) => (planned[id] = 0));
  const qSec = quarterSeconds(format);
  const result = [];
  for (let i = 0; i < q; i++) {
    let best = attendingIds[0];
    let bestScore = Infinity;
    for (const pid of attendingIds) {
      const h = history[pid] || { keeperSeconds: 0, keeperGames: 0 };
      // Don't pick same keeper twice in a row if avoidable
      const recentlyKeeper = result[result.length - 1] === pid ? 1 : 0;
      const score = h.keeperSeconds + planned[pid] + recentlyKeeper * qSec * 2;
      if (score < bestScore) { bestScore = score; best = pid; }
    }
    result.push(best);
    planned[best] += qSec;
  }
  return result;
}

/**
 * Build a full substitution plan for the match.
 * Returns:
 *   {
 *     quarters: [
 *       {
 *         index, startSec, endSec, keeperId,
 *         slots: [ { startSec, endSec, fieldIds: [...] } ],
 *         subEvents: [ { atSec, off:[ids], on:[ids] } ]   // includes keeper change at start
 *       }
 *     ],
 *     plannedSecondsPerPlayer: { pid: { fieldSec, keeperSec, totalSec } }
 *   }
 */
export function buildPlan(match, history) {
  const fmt = match.format;
  const qSec = quarterSeconds(fmt);
  const fieldSlotsCount = fmt.onField - 1; // excluding keeper
  const interval = Math.max(1, Math.round((match.subIntervalMin || qSec / 60) * 60));
  const slotsPerQuarter = Math.max(1, Math.round(qSec / interval));
  const slotSec = Math.round(qSec / slotsPerQuarter);

  // Track planned seconds per player across the whole match.
  const planned = {};
  match.attendingPlayerIds.forEach((id) => (planned[id] = { fieldSec: 0, keeperSec: 0 }));

  // For fairness, compute "deficit" from history: average minus this player's history.
  // Lower history => higher priority.
  const histTotal = (pid) => (history[pid]?.totalSeconds || 0);
  const avgHist = match.attendingPlayerIds.reduce((s, p) => s + histTotal(p), 0) / match.attendingPlayerIds.length;

  // Priority score (higher = wants more time): deficit + (-already planned this match).
  const priority = (pid) => (avgHist - histTotal(pid)) - (planned[pid].fieldSec + planned[pid].keeperSec) * 1.0;

  const quarters = [];
  let prevFieldSet = new Set();

  for (let q = 0; q < totalQuarters(fmt); q++) {
    const keeperId = match.keeperPerQuarter[q];
    planned[keeperId].keeperSec += qSec;

    const fieldCandidates = match.attendingPlayerIds.filter((id) => id !== keeperId);
    const slots = [];
    const subEvents = [];

    // First slot of the quarter: select fieldSlotsCount players with highest priority.
    // Subsequent slots: rotate by swapping out players who have played the most consecutively
    // for those who have rested the most, while respecting priority.

    // Track consecutive seconds on field within this quarter for stability.
    const consecOn = {};
    const consecOff = {};
    fieldCandidates.forEach((id) => { consecOn[id] = 0; consecOff[id] = 0; });

    let currentField = pickTop(fieldCandidates, fieldSlotsCount, priority);
    // Sub event at quarter start: who comes off (everyone from previous quarter not in new field, except old keeper which always changes), who comes on.
    const startOff = [...prevFieldSet].filter((id) => !currentField.includes(id));
    const startOn = currentField.filter((id) => !prevFieldSet.has(id));
    // Old keeper coming off (going to bench or becoming field is already handled above).
    const prevKeeper = q > 0 ? match.keeperPerQuarter[q - 1] : null;
    const keeperOff = prevKeeper && prevKeeper !== keeperId ? [prevKeeper] : [];
    const keeperOn = q === 0 || prevKeeper !== keeperId ? [keeperId] : [];
    subEvents.push({
      atSec: q * qSec,
      type: q === 0 ? 'kickoff' : 'quarter',
      quarter: q,
      off: [...startOff, ...keeperOff],
      on: [...startOn, ...keeperOn],
      keeperId,
    });

    for (let s = 0; s < slotsPerQuarter; s++) {
      const startSec = q * qSec + s * slotSec;
      const endSec = (s === slotsPerQuarter - 1) ? (q + 1) * qSec : startSec + slotSec;
      const dur = endSec - startSec;

      slots.push({ startSec, endSec, fieldIds: [...currentField] });
      currentField.forEach((id) => { planned[id].fieldSec += dur; consecOn[id] += dur; consecOff[id] = 0; });
      fieldCandidates.filter((id) => !currentField.includes(id))
        .forEach((id) => { consecOff[id] += dur; consecOn[id] = 0; });

      // Plan rotation for next slot
      if (s < slotsPerQuarter - 1) {
        // Determine how many to swap. Use match.subsPerRotation if set, else min(fieldSlotsCount, restCount).
        const restCount = fieldCandidates.length - fieldSlotsCount;
        const swap = Math.max(1, Math.min(match.subsPerRotation || restCount, fieldSlotsCount, restCount));
        // Off: from currentField pick those with lowest priority (i.e. most over-served).
        const offCandidates = [...currentField].sort((a, b) => priority(a) - priority(b));
        const off = offCandidates.slice(0, swap);
        // On: from bench pick highest priority.
        const benchNow = fieldCandidates.filter((id) => !currentField.includes(id));
        const on = [...benchNow].sort((a, b) => priority(b) - priority(a)).slice(0, swap);
        currentField = currentField.filter((id) => !off.includes(id)).concat(on);
        subEvents.push({
          atSec: endSec,
          type: 'sub',
          quarter: q,
          off, on, keeperId,
        });
      }
    }

    quarters.push({
      index: q,
      startSec: q * qSec,
      endSec: (q + 1) * qSec,
      keeperId,
      slots,
      subEvents,
    });
    prevFieldSet = new Set(currentField);
  }

  // Compose totals
  const plannedSecondsPerPlayer = {};
  match.attendingPlayerIds.forEach((id) => {
    const p = planned[id];
    plannedSecondsPerPlayer[id] = {
      fieldSec: p.fieldSec,
      keeperSec: p.keeperSec,
      totalSec: p.fieldSec + p.keeperSec,
    };
  });

  return { quarters, plannedSecondsPerPlayer, slotSec, slotsPerQuarter, qSec };
}

function pickTop(ids, n, scoreFn) {
  return [...ids].sort((a, b) => scoreFn(b) - scoreFn(a)).slice(0, n);
}

/**
 * Aggregate playtime history across all played matches.
 * Uses match.actualPlaytime if present (recorded during live match),
 * else falls back to plannedSecondsPerPlayer.
 */
export function buildHistory(matches) {
  const h = {};
  for (const m of matches) {
    if (m.status !== 'finished') continue;
    const src = m.actualPlaytime || (m.plan && m.plan.plannedSecondsPerPlayer) || {};
    for (const [pid, v] of Object.entries(src)) {
      if (!h[pid]) h[pid] = { fieldSeconds: 0, keeperSeconds: 0, totalSeconds: 0, keeperGames: 0, games: 0 };
      h[pid].fieldSeconds += v.fieldSec || 0;
      h[pid].keeperSeconds += v.keeperSec || 0;
      h[pid].totalSeconds += v.totalSec || ((v.fieldSec || 0) + (v.keeperSec || 0));
      h[pid].games += 1;
      if ((v.keeperSec || 0) > 0) h[pid].keeperGames += 1;
    }
  }
  return h;
}
