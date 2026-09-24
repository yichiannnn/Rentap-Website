// Auto-advance: once the results a knockout slot depends on are known, resolve
// its placeholder text ("Champion A", "Runner-up B", "best Runner-up",
// "Winner SF1", "Loser QF2", "3rd") into a real team id. Pure functions, no
// I/O — api/scores-admin.js reads the current teams/matches and applies the
// result.
import { computeStandings, baseCompare } from './standings.js';

function parsePlaceholder(text) {
  if (!text) return null;
  let m;
  if ((m = /^Champion\s+(\S+)$/i.exec(text))) return { type: 'rank', group: m[1], rank: 1 };
  if ((m = /^Runner-up\s+(\S+)$/i.exec(text))) return { type: 'rank', group: m[1], rank: 2 };
  if (/^best\s+Runner-up$/i.test(text)) return { type: 'best-runner-up' };
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

  function resolveOne(spec) {
    if (spec.type === 'rank') {
      if (!groupDone[spec.group]) return null;
      const rows = standings[spec.group];
      return rows && rows.length >= spec.rank ? rows[spec.rank - 1].team_id : null;
    }
    if (spec.type === 'best-runner-up') return bestRunnerUp();
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
