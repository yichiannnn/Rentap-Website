import { sql } from '@vercel/postgres';

// ── Sport config (server side mirror of the client SPORT_CONFIG) ──
const SPORTS = {
  football:      { scoring: 'goals',  win: 3, draw: 1, loss: 0 },
  'touch-rugby': { scoring: 'points', win: 3, draw: 1, loss: 0 },
  badminton:     { scoring: 'sets',   win: 2, draw: 0, loss: 0 },
  volleyball:    { scoring: 'sets' },   // custom 3/2/1/0 scheme
  basketball:    { scoring: 'points', win: 3, draw: 1, loss: 0 },
};
const SLUGS = Object.keys(SPORTS);

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sport = (req.query.sport || '').toString();
  const since = (req.query.since || '').toString();

  // CDN caching: brief edge cache, long stale-while-revalidate.
  res.setHeader('Cache-Control', 's-maxage=5, stale-while-revalidate=25');

  try {
    // ── All-sports overview (ticker) ──────────────────
    if (!sport) {
      const { rows } = await sql`
        SELECT m.id, m.sport, m.status, m.score_a, m.score_b, m.stage, m.label,
               m.scheduled_at, m.first_half_at, m.second_half_at, m.half_length,
               ta.name AS team_a_name, tb.name AS team_b_name
        FROM matches m
        LEFT JOIN teams ta ON ta.id = m.team_a_id
        LEFT JOIN teams tb ON tb.id = m.team_b_id
        WHERE m.status IN ('live','halftime') OR m.status = 'scheduled'
        ORDER BY m.status DESC, m.scheduled_at ASC NULLS LAST, m.id ASC
      `;
      return res.status(200).json({ generated_at: new Date().toISOString(), matches: rows });
    }

    if (!SLUGS.includes(sport)) {
      return res.status(400).json({ error: 'Unknown sport' });
    }

    // ── Change probe ──────────────────────────────────
    const stampRes = await sql`
      SELECT COALESCE(MAX(updated_at), TIMESTAMP 'epoch') AS stamp
      FROM matches WHERE sport = ${sport}
    `;
    const stamp = new Date(stampRes.rows[0].stamp).toISOString();
    if (since && since === stamp) {
      return res.status(200).json({ sport, unchanged: true, generated_at: stamp });
    }

    // ── Teams + rosters ───────────────────────────────
    const teamsRes = await sql`
      SELECT id, name, group_name, color FROM teams
      WHERE sport = ${sport} ORDER BY group_name NULLS LAST, name
    `;
    const teams = teamsRes.rows;
    const teamIds = teams.map(t => t.id);

    let players = [];
    if (teamIds.length) {
      const playersRes = await sql`
        SELECT id, team_id, name, number FROM players
        WHERE team_id = ANY(${teamIds})
        ORDER BY number NULLS LAST, name
      `;
      players = playersRes.rows;
    }
    const rosterByTeam = {};
    players.forEach(p => (rosterByTeam[p.team_id] ||= []).push(p));
    teams.forEach(t => { t.players = rosterByTeam[t.id] || []; });

    // ── Matches ───────────────────────────────────────
    const matchesRes = await sql`
      SELECT m.*, ta.name AS team_a_name, tb.name AS team_b_name
      FROM matches m
      LEFT JOIN teams ta ON ta.id = m.team_a_id
      LEFT JOIN teams tb ON tb.id = m.team_b_id
      WHERE m.sport = ${sport}
      ORDER BY
        CASE m.status WHEN 'live' THEN 0 WHEN 'halftime' THEN 1 WHEN 'scheduled' THEN 2 ELSE 3 END,
        m.scheduled_at ASC NULLS LAST, m.id ASC
    `;
    const matches = matchesRes.rows;

    // ── Events (live + finished football, so timelines stay viewable) ──
    const eventMatchIds = matches
      .filter(m => m.status === 'live' || m.status === 'halftime' ||
                   (sport === 'football' && m.status === 'finished'))
      .map(m => m.id);
    let events = [];
    if (eventMatchIds.length) {
      const evRes = await sql`
        SELECT id, match_id, team_id, player_id, player_name, type, minute, created_at
        FROM match_events
        WHERE match_id = ANY(${eventMatchIds})
        ORDER BY match_id, minute NULLS LAST, id
      `;
      events = evRes.rows;
    }
    const eventsByMatch = {};
    events.forEach(e => (eventsByMatch[e.match_id] ||= []).push(e));
    matches.forEach(m => { m.events = eventsByMatch[m.id] || []; });

    // ── Standings ─────────────────────────────────────
    const standings = computeStandings(sport, teams, matches);

    return res.status(200).json({
      sport,
      generated_at: stamp,
      teams,
      matches,
      standings,
    });
  } catch (err) {
    console.error('live error', err);
    return res.status(500).json({ error: 'Could not load live data' });
  }
}

// ── Standings computation (finished matches only) ────
function computeStandings(sport, teams, matches) {
  const cfg = SPORTS[sport];
  const finished = matches.filter(m => m.status === 'finished' && m.team_a_id && m.team_b_id);

  // group_name may be null → single league keyed as ''
  const groups = {};
  teams.forEach(t => {
    const g = t.group_name || '';
    (groups[g] ||= {});
    groups[g][t.id] = baseRow(t);
  });
  // Ensure teams with no group still appear even if none created (defensive)
  if (Object.keys(groups).length === 0) return {};

  const h2h = {}; // `${a}-${b}` → points a earned vs b (for pairwise ties)

  finished.forEach(m => {
    const g = m.group_name || '';
    // team may belong to a group; find the group each team sits in
    const rowA = findRow(groups, m.team_a_id);
    const rowB = findRow(groups, m.team_b_id);
    if (!rowA || !rowB) return;

    if (cfg.scoring === 'sets') {
      const setsA = m.score_a, setsB = m.score_b; // sets won
      applyResult(sport, rowA, rowB, setsA, setsB, m, h2h);
    } else {
      applyResult(sport, rowA, rowB, m.score_a, m.score_b, m, h2h);
    }
  });

  // Sort each group
  const out = {};
  Object.keys(groups).sort().forEach(g => {
    const rows = Object.values(groups[g]);
    sortGroup(sport, rows, h2h);
    // form: last up to 5 results, chronological → we stored newest push; trim
    rows.forEach(r => { r.form = r._form.slice(-5); delete r._form; });
    out[g] = rows;
  });
  return out;
}

function baseRow(t) {
  return {
    team_id: t.id, team: t.name, group_name: t.group_name || null,
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

function applyResult(sport, rowA, rowB, a, b, m, h2h) {
  const cfg = SPORTS[sport];
  rowA.p++; rowB.p++;

  if (cfg.scoring === 'sets') {
    rowA.sw += a; rowA.sl += b;
    rowB.sw += b; rowB.sl += a;
    rowA.gf += a; rowA.ga += b;   // reuse gf/ga as sets for/against
    rowB.gf += b; rowB.ga += a;
  } else {
    rowA.gf += a; rowA.ga += b;
    rowB.gf += b; rowB.ga += a;
  }

  let ptsA, ptsB, resA, resB;
  if (a > b) {
    rowA.w++; rowB.l++;
    resA = 'W'; resB = 'L';
    if (sport === 'volleyball') {
      // 2-0 = 3, 2-1 = 2 for winner; loser 1-2 = 1, 0-2 = 0
      ptsA = (b === 0) ? 3 : 2;
      ptsB = (b === 1) ? 1 : 0;
    } else {
      ptsA = cfg.win; ptsB = cfg.loss;
    }
  } else if (b > a) {
    rowB.w++; rowA.l++;
    resA = 'L'; resB = 'W';
    if (sport === 'volleyball') {
      ptsB = (a === 0) ? 3 : 2;
      ptsA = (a === 1) ? 1 : 0;
    } else {
      ptsB = cfg.win; ptsA = cfg.loss;
    }
  } else {
    rowA.d++; rowB.d++;
    resA = 'D'; resB = 'D';
    ptsA = cfg.draw; ptsB = cfg.draw;
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
  if (sport === 'badminton') {
    const sdA = a.gf - a.ga, sdB = b.gf - b.ga;
    if (sdB !== sdA) return sdB - sdA;
    return a.team.localeCompare(b.team);
  }
  // football / basketball / touch-rugby: GD → GF → name
  if (b.gd !== a.gd) return b.gd - a.gd;
  if (b.gf !== a.gf) return b.gf - a.gf;
  return a.team.localeCompare(b.team);
}
