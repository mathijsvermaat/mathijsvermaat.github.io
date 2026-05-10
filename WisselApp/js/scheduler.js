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

/**
 * Recommend a substitution interval that minimizes the spread (max - min)
 * of total minutes per player, given attendance, format, and keeper plan.
 *
 * Constraint: tries intervals between 3:20 (200s) and 10:00 (600s) in 10s
 * steps, never exceeding the quarter length. Prefers larger intervals on
 * ties (fewer interruptions).
 *
 * Returns { intervalSec, intervalMin, spreadSec, perPlayerSec, candidates }.
 */
export function recommendSubInterval(match, history) {
  const qSec = quarterSeconds(match.format);
  const MIN_SEC = 200;            // 3:20
  const MAX_SEC = 600;            // 10:00
  const STEP_SEC = 10;
  const lo = Math.min(MIN_SEC, qSec);
  const hi = Math.min(MAX_SEC, qSec);
  const candidates = [];

  for (let s = lo; s <= hi; s += STEP_SEC) {
    const trial = { ...match, subIntervalMin: s / 60 };
    let plan;
    try { plan = buildPlan(trial, history); } catch { continue; }
    const totals = match.attendingPlayerIds.map((id) => plan.plannedSecondsPerPlayer[id].totalSec);
    const max = Math.max(...totals);
    const min = Math.min(...totals);
    candidates.push({ intervalSec: s, spreadSec: max - min, perPlayerSec: totals });
  }
  if (!candidates.length) return null;
  // Prefer lowest spread; tiebreak: larger interval (fewer interruptions).
  candidates.sort((a, b) => a.spreadSec - b.spreadSec || b.intervalSec - a.intervalSec);
  const best = candidates[0];
  return {
    intervalSec: best.intervalSec,
    intervalMin: best.intervalSec / 60,
    spreadSec: best.spreadSec,
    perPlayerSec: best.perPlayerSec,
    candidates,
  };
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
 * Mark a player as injured at time `atSec`. Mutates plan in-place:
 * - Removes the injured player from all FUTURE slots, replacing with the
 *   active player who has played the least so far in this match.
 * - If the injured player is keeper for any future quarter, replaces them
 *   with the non-injured attending player who has the lowest keeper time.
 * - Recomputes subEvents and plannedSecondsPerPlayer.
 *
 * Past slots are left untouched (history is what it is).
 */
export function applyInjury(plan, match, atSec, injuredId) {
  const injured = new Set(match.injuredIds || []);
  injured.add(injuredId);
  const activeIds = match.attendingPlayerIds.filter((id) => !injured.has(id));
  if (!activeIds.length) return;

  // Replace keeper in any FUTURE quarter where the injured player keeps.
  // "Future" includes the current quarter only if the injury happens before that quarter ends
  // AND the keeper hasn't started yet — but practically the keeper has started, so skip current.
  for (const q of plan.quarters) {
    if (q.endSec <= atSec) continue;
    if (q.startSec < atSec && q.keeperId === injuredId) {
      // Injury during this quarter while injured player is keeper:
      // pick a replacement keeper from active players for the remainder of the quarter.
      q.keeperId = pickReplacementKeeper(plan, match, activeIds, q, atSec);
    } else if (q.startSec >= atSec && q.keeperId === injuredId) {
      q.keeperId = pickReplacementKeeper(plan, match, activeIds, q, atSec);
    }
  }

  // Replace injured player in all future slot.fieldIds.
  for (const q of plan.quarters) {
    for (const slot of q.slots) {
      if (slot.endSec <= atSec) continue;
      const idx = slot.fieldIds.indexOf(injuredId);
      if (idx === -1) continue;
      const replacement = pickReplacementForSlot(plan, match, activeIds, q, slot, atSec, injured);
      if (replacement) slot.fieldIds[idx] = replacement;
      else slot.fieldIds.splice(idx, 1); // not enough players: just play short
    }
    // Also: if keeper changed, ensure keeper isn't also in fieldIds
    for (const slot of q.slots) {
      if (slot.endSec <= atSec) continue;
      const ki = slot.fieldIds.indexOf(q.keeperId);
      if (ki !== -1) {
        const replacement = pickReplacementForSlot(plan, match, activeIds, q, slot, atSec, injured);
        if (replacement && replacement !== q.keeperId) slot.fieldIds[ki] = replacement;
        else slot.fieldIds.splice(ki, 1);
      }
    }
  }

  recomputePlanMeta(plan, match, atSec);
}

function pickReplacementKeeper(plan, match, activeIds, quarter, atSec) {
  // Sum already-planned keeper seconds per active player across all quarters.
  const keeperSec = Object.create(null);
  activeIds.forEach((id) => (keeperSec[id] = 0));
  for (const q of plan.quarters) {
    if (q === quarter) continue;
    if (keeperSec[q.keeperId] !== undefined) {
      keeperSec[q.keeperId] += (q.endSec - q.startSec);
    }
  }
  // Avoid picking someone who's keeper in adjacent quarter if possible.
  const adjacent = new Set();
  const idx = plan.quarters.indexOf(quarter);
  if (idx > 0) adjacent.add(plan.quarters[idx - 1].keeperId);
  if (idx < plan.quarters.length - 1) adjacent.add(plan.quarters[idx + 1].keeperId);
  return [...activeIds].sort((a, b) => {
    const aAdj = adjacent.has(a) ? 1 : 0;
    const bAdj = adjacent.has(b) ? 1 : 0;
    if (aAdj !== bAdj) return aAdj - bAdj;
    return keeperSec[a] - keeperSec[b];
  })[0];
}

function pickReplacementForSlot(plan, match, activeIds, quarter, slot, atSec, injured) {
  // Sum already-played seconds per active player up to atSec.
  const played = Object.create(null);
  activeIds.forEach((id) => (played[id] = 0));
  for (const q of plan.quarters) {
    // keeper time
    const ks = Math.max(q.startSec, 0);
    const ke = Math.min(q.endSec, atSec);
    if (ke > ks && played[q.keeperId] !== undefined) played[q.keeperId] += (ke - ks);
    for (const s of q.slots) {
      const ss = Math.max(s.startSec, 0);
      const se = Math.min(s.endSec, atSec);
      if (se <= ss) continue;
      for (const pid of s.fieldIds) {
        if (played[pid] !== undefined) played[pid] += (se - ss);
      }
    }
  }
  // Also count planned future field time so we don't keep stacking on the same person.
  for (const q of plan.quarters) {
    for (const s of q.slots) {
      if (s.endSec <= atSec) continue;
      const dur = s.endSec - Math.max(s.startSec, atSec);
      for (const pid of s.fieldIds) {
        if (played[pid] !== undefined) played[pid] += dur * 0.5; // half weight: future is mutable
      }
    }
  }
  // Eligible: active, not injured, not the quarter's keeper, not already in this slot.
  const eligible = activeIds.filter((id) =>
    id !== quarter.keeperId &&
    !slot.fieldIds.includes(id) &&
    !injured.has(id)
  );
  if (!eligible.length) return null;
  eligible.sort((a, b) => played[a] - played[b]);
  return eligible[0];
}

/**
 * Recompute subEvents from slots (so the timeline reflects reality after edits)
 * and recompute plannedSecondsPerPlayer based on the FULL plan (past slot
 * assignments + future slot assignments).
 */
export function recomputePlanMeta(plan, match, fromSec = 0) {
  // Rebuild subEvents per quarter from slot deltas.
  for (let qi = 0; qi < plan.quarters.length; qi++) {
    const q = plan.quarters[qi];
    const events = [];
    const prevQuarter = qi > 0 ? plan.quarters[qi - 1] : null;
    // Quarter / kickoff event
    const firstSlot = q.slots[0];
    const prevField = prevQuarter ? new Set(prevQuarter.slots[prevQuarter.slots.length - 1].fieldIds) : new Set();
    const startOff = [...prevField].filter((id) => !firstSlot.fieldIds.includes(id));
    const startOn = firstSlot.fieldIds.filter((id) => !prevField.has(id));
    const prevKeeper = prevQuarter ? prevQuarter.keeperId : null;
    const keeperOff = prevKeeper && prevKeeper !== q.keeperId ? [prevKeeper] : [];
    const keeperOn = !prevKeeper || prevKeeper !== q.keeperId ? [q.keeperId] : [];
    events.push({
      atSec: q.startSec,
      type: qi === 0 ? 'kickoff' : 'quarter',
      quarter: qi,
      off: [...startOff, ...keeperOff],
      on: [...startOn, ...keeperOn],
      keeperId: q.keeperId,
    });
    // Within-quarter slot transitions
    for (let si = 1; si < q.slots.length; si++) {
      const prev = q.slots[si - 1];
      const cur = q.slots[si];
      const off = prev.fieldIds.filter((id) => !cur.fieldIds.includes(id));
      const on = cur.fieldIds.filter((id) => !prev.fieldIds.includes(id));
      if (off.length || on.length) {
        events.push({ atSec: cur.startSec, type: 'sub', quarter: qi, off, on, keeperId: q.keeperId });
      }
    }
    q.subEvents = events;
  }

  // Recompute planned totals (whole match: past + future as planned in slots).
  const planned = {};
  match.attendingPlayerIds.forEach((id) => (planned[id] = { fieldSec: 0, keeperSec: 0 }));
  for (const q of plan.quarters) {
    if (planned[q.keeperId]) planned[q.keeperId].keeperSec += (q.endSec - q.startSec);
    for (const s of q.slots) {
      const dur = s.endSec - s.startSec;
      for (const pid of s.fieldIds) {
        if (planned[pid]) planned[pid].fieldSec += dur;
      }
    }
  }
  plan.plannedSecondsPerPlayer = {};
  for (const id of Object.keys(planned)) {
    plan.plannedSecondsPerPlayer[id] = {
      fieldSec: planned[id].fieldSec,
      keeperSec: planned[id].keeperSec,
      totalSec: planned[id].fieldSec + planned[id].keeperSec,
    };
  }
}

/**
 * Aggregate playtime history across all played matches.
 * Includes:
 *  - finished matches (using actualPlaytime, falling back to plan)
 *  - live matches that have an actualPlaytime snapshot (auto-saved during play)
 */
export function buildHistory(matches) {
  const h = {};
  for (const m of matches) {
    let src = null;
    if (m.status === 'finished') {
      src = m.actualPlaytime || (m.plan && m.plan.plannedSecondsPerPlayer) || null;
    } else if (m.status === 'live' && m.actualPlaytime) {
      src = m.actualPlaytime;
    }
    if (!src) continue;
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
