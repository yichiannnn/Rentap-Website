// Auto-advance: once the results a knockout slot depends on are known, resolve
// its placeholder text ("Champion A", "Runner-up B", "best Runner-up",
// "Winner SF1", "Loser QF2", "3rd") into a real team id. Pure functions, no
// I/O — api/scores-admin.js reads the current teams/matches and applies the
// result.
import { computeStandings, baseCompare, applyResult, baseRow } from './standings.js';

function parsePlaceholder(text) {
  if (!text) return null;
  let m;
  if ((m = /^Champion\s+(\S+)$/i.exec(text))) return { type: 'rank', group: m[1], rank: 1 };
  if ((m = /^Runner-up\s+(\S+)$/i.exec(text))) return { type: 'rank', group: m[1], rank: 2 };
  if (/^best\s+Runner-up$/i.test(text)) return { type: 'best-runner-up' };
  // Fairer alternative to "best Runner-up" for uneven group sizes: the group
  // runners-up play an actual mini round-robin (tagged group_name "RU") and
  // the winner of THAT — not a cross-group standings comparison — advances.
  if (/^Best\s+Second\s+Place$/i.test(text)) return { type: 'runner-up-playoff' };
  if ((m = /^Winner\s+(SF|QF)(\d+)$/i.exec(text)))
    return { type: 'result', stage: m[1].toUpperCase() === 'SF' ? 'semi' : 'quarter', number: Number(m[2]), side: 'winner' };
  if ((m = /^Loser\s+(SF|QF)(\d+)$/i.exec(text)))
    return { type: 'result', stage: m[1].toUpperCase() === 'SF' ? 'semi' : 'quarter', number: Number(m[2]), side: 'loser' };
  // bare rank, for single-league formats with no groups (e.g. "1st", "2nd")
  if ((m = /^(\d+)(?:st|nd|rd|th)$/i.exec(text))) return { type: 'rank', group: '', rank: Number(m[1]) };
  return null;
}

// Given one sport's current teams + matches, return the slots that can be
// filled right now: [{ matchId, side: 'a' | 'b', team_id }]. Never proposes
// overwriting a slot that already has a team — callers should also apply
// with a `WHERE team_x_id IS NULL` guard.
export function resolveAdvancement(sport, teams, matches) {
  const groupMatches = matches.filter(m => m.stage === 'group');
  const groups = new Set(teams.map(t => t.group_name || ''));
  const groupDone = {};
  groups.forEach(g => {
    const ms = groupMatches.filter(m => (m.group_name || '') === g);
    groupDone[g] = ms.length > 0 && ms.every(m => m.status === 'finished');
  });
  const allGroupsDone = groupMatches.length > 0 && groupMatches.every(m => m.status === 'finished');
  const standings = computeStandings(sport, teams, matches);

  // number knockout matches SF1/SF2/QF1..4 by id (creation) order within
  // their stage — the same convention fixtures.html's koLabel() displays.
  const byStageNumber = {};
  ['quarter', 'semi'].forEach(stage => {
    matches.filter(m => m.stage === stage).sort((a, b) => a.id - b.id)
      .forEach((m, i) => { byStageNumber[`${stage}${i + 1}`] = m; });
  });

  function bestRunnerUp() {
    if (!allGroupsDone) return null;
    const contenders = Array.from(groups).map(g => (standings[g] || [])[1]).filter(Boolean);
    if (!contenders.length) return null;
    contenders.sort((a, b) => (b.pts - a.pts) || baseCompare(sport, a, b));
    return contenders[0].team_id;
  }

  // The 3 runner-up playoff matches are entered as regular finished group
  // matches tagged group_name "RU" (see resolveRunnerUpPlayoff below for why
  // they can't just feed the normal per-team standings). Ranks the 3
  // participants by the same win-then-tiebreak rules as a real group.
  function resolveRunnerUpPlayoff() {
    const playoff = groupMatches.filter(m => m.group_name === 'RU' && m.status === 'finished' && m.team_a_id && m.team_b_id);
    if (playoff.length < 3) return null; // wait until all 3 results are in
    const rows = {};
    const rowFor = id => (rows[id] ||= baseRow(teams.find(t => t.id === id) || { id, name: String(id) }));
    const h2h = {};
    playoff.forEach(m => applyResult(sport, rowFor(m.team_a_id), rowFor(m.team_b_id), m.score_a, m.score_b, h2h));
    const list = Object.values(rows);
    if (list.length !== 3) return null; // something's off (duplicate/mismatched pairing) - don't guess
    list.sort((a, b) => (b.pts - a.pts) || baseCompare(sport, a, b));
    return list[0].team_id;
  }

  function resolveOne(spec) {
    if (spec.type === 'rank') {
      if (!groupDone[spec.group]) return null;
      const rows = standings[spec.group];
      return rows && rows.length >= spec.rank ? rows[spec.rank - 1].team_id : null;
    }
    if (spec.type === 'best-runner-up') return bestRunnerUp();
    if (spec.type === 'runner-up-playoff') return resolveRunnerUpPlayoff();
    if (spec.type === 'result') {
      const src = byStageNumber[`${spec.stage}${spec.number}`];
      if (!src || src.status !== 'finished' || src.score_a === src.score_b) return null;
      const aWon = src.score_a > src.score_b;
      if (spec.side === 'winner') return aWon ? src.team_a_id : src.team_b_id;
      return aWon ? src.team_b_id : src.team_a_id;
    }
    return null;
  }

  const fills = [];
  matches.forEach(m => {
    if (m.status !== 'scheduled') return;
    ['a', 'b'].forEach(side => {
      if (m[`team_${side}_id`]) return; // already filled (auto or manual) — never overwrite
      const spec = parsePlaceholder(m[`placeholder_${side}`]);
      if (!spec) return;
      const team_id = resolveOne(spec);
      if (team_id) fills.push({ matchId: m.id, side, team_id });
    });
  });
  return fills;
}

// Track: once every real (non-placeholder) lane in every heat of an
// event_group has a recorded time, fill any "Top N" placeholder entry in
// that group's final/relay event(s) with the Nth-fastest heat time. `events`
// is one sport's race_events rows, each with its `.entries` (race_entries
// rows) attached — the shape api/live.js's loadRaceEvents() already builds.
// Returns [{ entryId, name }]; never proposes overwriting a non-placeholder
// entry.
export function resolveTrackAdvancement(events) {
  const byGroup = {};
  events.forEach(e => (byGroup[e.event_group] ||= []).push(e));

  const fills = [];
  Object.values(byGroup).forEach(group => {
    const heats = group.filter(e => e.stage === 'heat');
    if (!heats.length) return;
    const heatEntries = heats.flatMap(e => e.entries || []).filter(en => !en.placeholder);
    if (!heatEntries.length || !heatEntries.every(en => en.time_ms != null)) return;
    const ranked = heatEntries.slice().sort((a, b) => a.time_ms - b.time_ms);

    group.filter(e => e.stage !== 'heat').forEach(finalEvent => {
      (finalEvent.entries || []).forEach(en => {
        if (!en.placeholder) return;
        const m = /^top\s+(\d+)$/i.exec(en.name || '');
        if (!m) return;
        const qualifier = ranked[Number(m[1]) - 1];
        if (qualifier) fills.push({ entryId: en.id, name: qualifier.name });
      });
    });
  });
  return fills;
}
