import { sql } from '@vercel/postgres';
import { SLUGS, familyOf, codeNumber, computeStandings } from '../lib/standings.js';

const PLACEMENT_SPORTS = ['frisbee', 'basketball'];

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const sport = (req.query.sport || '').toString();
  const family = (req.query.family || '').toString();
  const since = (req.query.since || '').toString();

  // CDN caching: brief edge cache, long stale-while-revalidate.
  res.setHeader('Cache-Control', 's-maxage=5, stale-while-revalidate=25');

  try {
    // ── All-sports overview (ticker) ──────────────────
    if (!sport && !family) {
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

    // ── Track: races, not team-vs-team matches, so it's a separate shape ──
    if (sport === 'track') {
      const events = await loadRaceEvents();
      return res.status(200).json({ sport: 'track', generated_at: new Date().toISOString(), events });
    }

    // ── Which slugs to load ───────────────────────────
    // ?sport=<slug> for one sport, ?family=badminton for every badminton
    // category, ?family=all for everything (used by the name search).
    let slugs;
    if (family) {
      slugs = family === 'all' ? SLUGS : SLUGS.filter(s => familyOf(s) === family);
      if (!slugs.length) return res.status(400).json({ error: 'Unknown family' });
    } else {
      if (!SLUGS.includes(sport)) return res.status(400).json({ error: 'Unknown sport' });
      slugs = [sport];
    }

    // ── Change probe ──────────────────────────────────
    const stampRes = await sql`
      SELECT COALESCE(MAX(updated_at), TIMESTAMP 'epoch') AS stamp
      FROM matches WHERE sport = ANY(${slugs})
    `;
    const stamp = new Date(stampRes.rows[0].stamp).toISOString();
    if (since && since === stamp) {
      return res.status(200).json(family
        ? { family, unchanged: true, generated_at: stamp }
        : { sport, unchanged: true, generated_at: stamp });
    }

    const bySlug = await loadSports(slugs);
    if (family) {
      // family=all also carries track's races, so the initial bulk load
      // (used by "Find my matches") doesn't need a second round trip.
      if (family === 'all') bySlug.track = { events: await loadRaceEvents() };
      return res.status(200).json({ family, generated_at: stamp, sports: bySlug });
    }
    return res.status(200).json({ sport, generated_at: stamp, ...bySlug[sport] });
  } catch (err) {
    console.error('live error', err);
    return res.status(500).json({ error: 'Could not load live data' });
  }
}

// Load teams, rosters, matches, events and standings for several slugs with
// four queries in total, then split the rows per slug.
async function loadSports(slugs) {
  const out = {};
  slugs.forEach(s => { out[s] = { teams: [], matches: [], standings: {} }; });

  // ── Teams + rosters ───────────────────────────────
  const teamsRes = await sql`
    SELECT * FROM teams WHERE sport = ANY(${slugs}) ORDER BY group_name NULLS LAST, name
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
  teams.forEach(t => {
    t.players = rosterByTeam[t.id] || [];
    delete t.created_at;
    out[t.sport].teams.push(t);
  });

  // ── Matches ───────────────────────────────────────
  const matchesRes = await sql`
    SELECT m.*, ta.name AS team_a_name, tb.name AS team_b_name
    FROM matches m
    LEFT JOIN teams ta ON ta.id = m.team_a_id
    LEFT JOIN teams tb ON tb.id = m.team_b_id
    WHERE m.sport = ANY(${slugs})
    ORDER BY
      CASE m.status WHEN 'live' THEN 0 WHEN 'halftime' THEN 1 WHEN 'scheduled' THEN 2 ELSE 3 END,
      m.scheduled_at ASC NULLS LAST, m.id ASC
  `;
  const matches = matchesRes.rows;

  // ── Events (live + finished football, so timelines stay viewable) ──
  const eventMatchIds = matches
    .filter(m => m.status === 'live' || m.status === 'halftime' ||
                 (m.sport === 'football' && m.status === 'finished'))
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
  matches.forEach(m => {
    m.events = eventsByMatch[m.id] || [];
    out[m.sport].matches.push(m);
  });

  // ── Per-slug ordering + standings ─────────────────
  for (const slug of slugs) {
    // entry codes sort naturally (MS2 before MS10) within their group
    out[slug].teams.sort((a, b) =>
      (a.group_name || '~').localeCompare(b.group_name || '~') ||
      codeNumber(a.code) - codeNumber(b.code) ||
      a.name.localeCompare(b.name));
    out[slug].standings = computeStandings(slug, out[slug].teams, out[slug].matches);
  }

  // ── Placements (frisbee tally, basketball 1st/2nd/3rd) ───────────────
  const placementSlugs = slugs.filter(s => PLACEMENT_SPORTS.includes(s));
  if (placementSlugs.length) {
    const { rows } = await sql`
      SELECT * FROM placements WHERE sport = ANY(${placementSlugs})
      ORDER BY sport, group_name NULLS FIRST, sort, name
    `;
    rows.forEach(p => (out[p.sport].placements ||= []).push(p));
  }
  placementSlugs.forEach(s => { out[s].placements ||= []; });

  return out;
}

// ── Track: events with their lane entries, ranked by time ────────────
async function loadRaceEvents() {
  const evRes = await sql`SELECT * FROM race_events ORDER BY sort, scheduled_at NULLS LAST, id`;
  const events = evRes.rows;
  const ids = events.map(e => e.id);
  let entries = [];
  if (ids.length) {
    const enRes = await sql`
      SELECT * FROM race_entries WHERE event_id = ANY(${ids})
      ORDER BY (time_ms IS NULL), time_ms, lane NULLS LAST, id
    `;
    entries = enRes.rows;
  }
  const byEvent = {};
  entries.forEach(e => (byEvent[e.event_id] ||= []).push(e));
  events.forEach(e => { e.entries = byEvent[e.id] || []; });
  return events;
}
