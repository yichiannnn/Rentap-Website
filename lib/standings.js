// Sport slugs, points rules and standings computation shared by api/live.js
// and the local mock server (scripts/dev-server.mjs). Pure functions, no I/O.

// One entry per database `sport` slug. Badminton and table tennis have one
// slug per category so each category keeps its own groups, standings and
// bracket; `?family=badminton` returns all of them in one response.
export const SPORTS = {
  football:      { scoring: 'goals',  win: 3, draw: 1, loss: 0 },
  'touch-rugby': { scoring: 'points', win: 3, draw: 1, loss: 0 },
  volleyball:    { scoring: 'sets',   win: 3, draw: 1, loss: 0 },   // two sets to 25, so 1-1 is a draw
  basketball:    { scoring: 'points', win: 3, draw: 1, loss: 0 },
  frisbee:       { scoring: 'points', win: 3, draw: 1, loss: 0 },   // +1 bonus for scoring 11+
  'tug-of-war':  { scoring: 'points', win: 3, draw: 0, loss: 0 },   // pulls won
};
// badminton is best of three: 2-0 win 3, 2-1 win 2, 1-2 loss 1, 0-2 loss 0
for (const c of ['ms', 'md', 'xd', 'wd', 'ws']) SPORTS[`badminton-${c}`] = { scoring: 'sets', graded: true };
// table tennis group matches are two games to 11: 2-0 win 3, 1-1 draw 2, 0-2 loss 0
for (const c of ['ms', 'ws', 'od']) SPORTS[`table-tennis-${c}`] = { scoring: 'sets', win: 3, draw: 2, loss: 0 };

export const SLUGS = Object.keys(SPORTS);
export const familyOf = slug => slug.replace(/-(ms|md|xd|wd|ws|od)$/, '');

export function codeNumber(code) {
  const n = parseInt(String(code || '').replace(/\D/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
}

// ── Standings computation (finished group-stage matches only) ────
export function computeStandings(sport, teams, matches) {
  const finished = matches.filter(m =>
    m.status === 'finished' && m.stage === 'group' && m.team_a_id && m.team_b_id);

  // group_name may be null → single league keyed as ''
  const groups = {};
  teams.forEach(t => {
    const g = t.group_name || '';
    (groups[g] ||= {});
    groups[g][t.id] = baseRow(t);
  });
  if (Object.keys(groups).length === 0) return {};

  const h2h = {}; // `${a}-${b}` → points a earned vs b (for pairwise ties)

  finished.forEach(m => {
    const rowA = findRow(groups, m.team_a_id);
    const rowB = findRow(groups, m.team_b_id);
    if (!rowA || !rowB) return;
    // for set sports score_a/score_b already hold sets won
    applyResult(sport, rowA, rowB, m.score_a, m.score_b, h2h);
  });

  const out = {};
  Object.keys(groups).sort().forEach(g => {
    const rows = Object.values(groups[g]);
    sortGroup(sport, rows, h2h);
    rows.forEach(r => { r.form = r._form.slice(-5); delete r._form; });
    out[g] = rows;
  });
  return out;
}

function baseRow(t) {
  return {
    team_id: t.id, team: t.name, code: t.code || null, group_name: t.group_name || null,
    p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0,
    sw: 0, sl: 0,           // sets won / lost (set sports)
    pts: 0, _form: [],
  };
}

function findRow(groups, teamId) {
  for (const g of Object.keys(groups)) {
    if (groups[g][teamId]) return groups[g][teamId];
  }
  return null;
}

function applyResult(sport, rowA, rowB, a, b, h2h) {
  const cfg = SPORTS[sport];
  rowA.p++; rowB.p++;

  rowA.gf += a; rowA.ga += b;   // goals/points, or sets for set sports
  rowB.gf += b; rowB.ga += a;
  if (cfg.scoring === 'sets') {
    rowA.sw += a; rowA.sl += b;
    rowB.sw += b; rowB.sl += a;
  }

  let ptsA, ptsB, resA, resB;
  if (a > b) {
    rowA.w++; rowB.l++;
    resA = 'W'; resB = 'L';
    if (cfg.graded) { ptsA = (b === 0) ? 3 : 2; ptsB = (b === 0) ? 0 : 1; }
    else { ptsA = cfg.win; ptsB = cfg.loss; }
  } else if (b > a) {
    rowB.w++; rowA.l++;
    resA = 'L'; resB = 'W';
    if (cfg.graded) { ptsB = (a === 0) ? 3 : 2; ptsA = (a === 0) ? 0 : 1; }
    else { ptsB = cfg.win; ptsA = cfg.loss; }
  } else {
    rowA.d++; rowB.d++;
    resA = 'D'; resB = 'D';
    ptsA = cfg.draw || 0; ptsB = cfg.draw || 0;
  }

  if (sport === 'frisbee') {   // bonus point for scoring 11 or more
    if (a >= 11) ptsA += 1;
    if (b >= 11) ptsB += 1;
  }

  rowA.pts += ptsA; rowB.pts += ptsB;
  rowA._form.push(resA); rowB._form.push(resB);

  // head-to-head points ledger
  h2h[`${rowA.team_id}-${rowB.team_id}`] = (h2h[`${rowA.team_id}-${rowB.team_id}`] || 0) + ptsA;
  h2h[`${rowB.team_id}-${rowA.team_id}`] = (h2h[`${rowB.team_id}-${rowA.team_id}`] || 0) + ptsB;
}

// Sort one group. Head-to-head applies ONLY when exactly two teams are level
// on points; with three or more level teams it is skipped (rulebook). Volleyball
// does not use head-to-head at all.
function sortGroup(sport, rows, h2h) {
  rows.forEach(r => { r.gd = r.gf - r.ga; });

  // Base order: points, then sport-specific secondary keys (no head-to-head).
  rows.sort((a, b) => (b.pts - a.pts) || baseCompare(sport, a, b));

  if (sport === 'volleyball') return rows; // volleyball has no head-to-head step

  // Within each equal-points cluster of exactly two teams, apply head-to-head.
  let i = 0;
  while (i < rows.length) {
    let j = i + 1;
    while (j < rows.length && rows[j].pts === rows[i].pts) j++;
    if (j - i === 2) {
      const a = rows[i], b = rows[i + 1];
      const hA = h2h[`${a.team_id}-${b.team_id}`] || 0;
      const hB = h2h[`${b.team_id}-${a.team_id}`] || 0;
      if (hB > hA) { rows[i] = b; rows[i + 1] = a; } // h2h winner first
      // if h2h level, keep the base order already computed
    }
    i = j;
  }
  return rows;
}

// Secondary ordering, excluding head-to-head.
function baseCompare(sport, a, b) {
  if (sport === 'volleyball') {
    const rA = a.l === 0 ? (a.w > 0 ? Infinity : 0) : a.w / a.l;
    const rB = b.l === 0 ? (b.w > 0 ? Infinity : 0) : b.w / b.l;
    if (rB !== rA) return rB - rA;
    if (b.sw !== a.sw) return b.sw - a.sw;
    return a.team.localeCompare(b.team);
  }
  if (SPORTS[sport].scoring === 'sets') {   // badminton, table tennis: set difference
    const sdA = a.gf - a.ga, sdB = b.gf - b.ga;
    if (sdB !== sdA) return sdB - sdA;
    if (b.gf !== a.gf) return b.gf - a.gf;
    return a.team.localeCompare(b.team);
  }
  // football / basketball / touch-rugby: GD → GF → name
  if (b.gd !== a.gd) return b.gd - a.gd;
  if (b.gf !== a.gf) return b.gf - a.gf;
  return a.team.localeCompare(b.team);
}
