import { db } from '@vercel/postgres';
import crypto from 'crypto';
import { resolveAdvancement } from '../lib/advance.js';

// One slug per database `sport`; badminton and table tennis have one per category
// (mirror of SPORT_CONFIG in live-shared.js and SPORTS in api/live.js).
const SLUGS = [
  'football', 'touch-rugby', 'volleyball', 'basketball', 'frisbee', 'tug-of-war',
  'badminton-ms', 'badminton-md', 'badminton-xd', 'badminton-wd', 'badminton-ws',
  'table-tennis-ms', 'table-tennis-ws', 'table-tennis-od',
];
const STAGES = ['group', 'quarter', 'semi', 'third', 'final'];

// ── constant-time key check ──────────────────────────
function keyValid(provided) {
  const expected = process.env.ADMIN_KEY;
  if (!expected) return null; // signal "not configured"
  const a = crypto.createHash('sha256').update(String(provided || '')).digest();
  const b = crypto.createHash('sha256').update(String(expected)).digest();
  return crypto.timingSafeEqual(a, b);
}

const str = (v, max) => {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};
const intOrNull = v => {
  if (v === undefined || v === null || v === '') return null;
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
};
const boolOr = (v, dflt) => {
  if (v === undefined || v === null) return dflt;
  if (v === true || v === 'true' || v === 1 || v === '1') return true;
  if (v === false || v === 'false' || v === 0 || v === '0') return false;
  return dflt;
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const valid = keyValid(req.headers['x-admin-key']);
  if (valid === null) return res.status(500).json({ error: 'ADMIN_KEY is not configured on the server' });
  if (!valid) return res.status(401).json({ error: 'Unauthorized' });

  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }

  const action = body.action;
  if (action === 'verify') return res.status(200).json({ ok: true });

  try {
    const result = await route(action, body);
    return res.status(result.status || 200).json(result.json || { ok: true });
  } catch (err) {
    console.error('scores-admin error', action, err);
    // 42703 = undefined_column: the schema migration in SETUP-LIVE-SCORES.md has not been run
    const msg = err.userMessage || (err.code === '42703'
      ? 'The database is missing a column — run the migration block in SETUP-LIVE-SCORES.md'
      : 'Operation failed');
    return res.status(err.statusCode || 500).json({ error: msg });
  }
}

function fail(statusCode, userMessage) {
  const e = new Error(userMessage);
  e.statusCode = statusCode;
  e.userMessage = userMessage;
  return e;
}

async function route(action, b) {
  const sql = db; // db.sql tagged template

  switch (action) {
    // ── TEAMS ──────────────────────────────────────
    case 'team.create': {
      const sport = str(b.sport, 40);
      const name = str(b.name, 120);
      if (!SLUGS.includes(sport)) throw fail(400, 'Unknown sport');
      if (!name) throw fail(400, 'Team name is required');
      const group_name = str(b.group_name, 20);
      const color = str(b.color, 20);
      const code = str(b.code, 12);        // entry code for racket categories (MS1, MD4 …)
      const scheduled_at = str(b.scheduled_at, 40); // basketball/frisbee: this team/slot's time
      try {
        const { rows } = await sql.sql`
          INSERT INTO teams (sport, name, group_name, color, code, scheduled_at)
          VALUES (${sport}, ${name}, ${group_name}, ${color}, ${code}, ${scheduled_at})
          RETURNING id`;
        return { json: { ok: true, id: rows[0].id } };
      } catch (e) {
        if (String(e.message).includes('duplicate') || e.code === '23505')
          throw fail(409, 'A team with that name already exists for this sport');
        throw e;
      }
    }
    case 'team.update': {
      const id = intOrNull(b.id);
      if (!id) throw fail(400, 'Missing team id');
      const cols = [], vals = [];
      const push = (c, v) => { cols.push(`${c}=$${cols.length + 1}`); vals.push(v); };
      if ('name' in b)         push('name', str(b.name, 120));
      if ('group_name' in b)   push('group_name', str(b.group_name, 20));
      if ('color' in b)        push('color', str(b.color, 20));
      if ('code' in b)         push('code', str(b.code, 12));
      if ('scheduled_at' in b) push('scheduled_at', str(b.scheduled_at, 40));
      if (!cols.length) return { json: { ok: true } };
      vals.push(id);
      await sql.query(`UPDATE teams SET ${cols.join(', ')} WHERE id=$${vals.length}`, vals);
      return { json: { ok: true } };
    }
    case 'team.delete': {
      const id = intOrNull(b.id);
      if (!id) throw fail(400, 'Missing team id');
      await sql.sql`DELETE FROM teams WHERE id = ${id}`;
      return { json: { ok: true } };
    }

    // ── PLAYERS ────────────────────────────────────
    case 'player.create': {
      const team_id = intOrNull(b.team_id);
      const name = str(b.name, 120);
      if (!team_id) throw fail(400, 'Missing team id');
      if (!name) throw fail(400, 'Player name is required');
      const number = intOrNull(b.number);
      const place = intOrNull(b.place);
      const { rows } = await sql.sql`
        INSERT INTO players (team_id, name, number, place)
        VALUES (${team_id}, ${name}, ${number}, ${place})
        RETURNING id`;
      return { json: { ok: true, id: rows[0].id } };
    }
    case 'player.update': {
      const id = intOrNull(b.id);
      if (!id) throw fail(400, 'Missing player id');
      const cols = [], vals = [];
      const push = (c, v) => { cols.push(`${c}=$${cols.length + 1}`); vals.push(v); };
      if ('name' in b)   push('name', str(b.name, 120));
      if ('number' in b) push('number', intOrNull(b.number));
      if ('place' in b)  push('place', intOrNull(b.place));
      if (!cols.length) return { json: { ok: true } };
      vals.push(id);
      await sql.query(`UPDATE players SET ${cols.join(', ')} WHERE id=$${vals.length}`, vals);
      return { json: { ok: true } };
    }
    case 'player.delete': {
      const id = intOrNull(b.id);
      if (!id) throw fail(400, 'Missing player id');
      await sql.sql`DELETE FROM players WHERE id = ${id}`;
      return { json: { ok: true } };
    }

    // ── MATCHES ────────────────────────────────────
    case 'match.create': {
      const sport = str(b.sport, 40);
      if (!SLUGS.includes(sport)) throw fail(400, 'Unknown sport');
      const stage = STAGES.includes(b.stage) ? b.stage : 'group';
      const group_name = str(b.group_name, 20);
      const label = str(b.label, 80);
      const team_a_id = intOrNull(b.team_a_id);
      const team_b_id = intOrNull(b.team_b_id);
      const scheduled_at = str(b.scheduled_at, 40); // ISO string or null
      const duration_min = intOrNull(b.duration_min);
      const referee = str(b.referee, 120);
      const placeholder_a = str(b.placeholder_a, 60); // "Champion A", "Winner SF1" … until the team is known
      const placeholder_b = str(b.placeholder_b, 60);
      const { rows } = await sql.sql`
        INSERT INTO matches (sport, stage, group_name, label, team_a_id, team_b_id, scheduled_at,
                             duration_min, referee, placeholder_a, placeholder_b, updated_at)
        VALUES (${sport}, ${stage}, ${group_name}, ${label}, ${team_a_id}, ${team_b_id},
                ${scheduled_at}, ${duration_min}, ${referee}, ${placeholder_a}, ${placeholder_b}, now())
        RETURNING id`;
      return { json: { ok: true, id: rows[0].id } };
    }
    case 'match.update': {
      const id = intOrNull(b.id);
      if (!id) throw fail(400, 'Missing match id');
      // Only touch columns explicitly present in the body. Column names are a
      // fixed allowlist (never user input); values go in as bound params.
      const cols = [];
      const vals = [];
      const push = (col, val) => { cols.push(`${col}=$${cols.length + 1}`); vals.push(val); };
      if ('stage' in b)         push('stage', STAGES.includes(b.stage) ? b.stage : 'group');
      if ('group_name' in b)    push('group_name', str(b.group_name, 20));
      if ('label' in b)         push('label', str(b.label, 80));
      if ('team_a_id' in b)     push('team_a_id', intOrNull(b.team_a_id));
      if ('team_b_id' in b)     push('team_b_id', intOrNull(b.team_b_id));
      if ('scheduled_at' in b)  push('scheduled_at', str(b.scheduled_at, 40));
      if ('duration_min' in b)  push('duration_min', intOrNull(b.duration_min));
      if ('referee' in b)       push('referee', str(b.referee, 120));
      if ('placeholder_a' in b) push('placeholder_a', str(b.placeholder_a, 60));
      if ('placeholder_b' in b) push('placeholder_b', str(b.placeholder_b, 60));
      if (!cols.length) return { json: { ok: true } };
      vals.push(id);
      await sql.query(
        `UPDATE matches SET ${cols.join(', ')}, updated_at=now() WHERE id=$${vals.length}`,
        vals
      );
      return { json: { ok: true } };
    }
    case 'match.delete': {
      const id = intOrNull(b.id);
      if (!id) throw fail(400, 'Missing match id');
      await sql.sql`DELETE FROM matches WHERE id = ${id}`;
      return { json: { ok: true } };
    }

    // ── STATUS FLOW ────────────────────────────────
    // Just two states: enter the score once the game is over, then Finish.
    case 'match.finish': {
      const id = intOrNull(b.id);
      if (!id) throw fail(400, 'Missing match id');
      const { rows } = await sql.sql`
        UPDATE matches SET status='finished', updated_at=now() WHERE id=${id} RETURNING sport`;
      if (rows.length) await autoAdvance(sql, rows[0].sport);
      return { json: { ok: true } };
    }
    case 'match.reopen':
      return setStatus(sql, b.id, `status='scheduled'`);
    // Undo a mistaken score entry: back to scheduled, 0–0, no sets.
    case 'match.reset':
      return resetMatch(sql, b);

    // ── BULK WIPE (seeding) ────────────────────────
    // Deletes every match and team (players and events cascade) of one sport.
    // Requires `confirm` to equal the slug so a stray call cannot clear a sport.
    case 'sport.wipe': {
      const sport = str(b.sport, 40);
      // the two retired single-category slugs may still hold old test data
      if (!SLUGS.includes(sport) && !['badminton', 'table-tennis'].includes(sport)) throw fail(400, 'Unknown sport');
      if (b.confirm !== sport) throw fail(400, 'Repeat the sport slug in `confirm` to wipe it');
      const m = await sql.sql`DELETE FROM matches WHERE sport = ${sport} RETURNING id`;
      const t = await sql.sql`DELETE FROM teams WHERE sport = ${sport} RETURNING id`;
      return { json: { ok: true, matches: m.rows.length, teams: t.rows.length } };
    }

    // ── DIRECT SCORE (points sports / corrections) ─
    case 'match.score': {
      const id = intOrNull(b.id);
      if (!id) throw fail(400, 'Missing match id');
      const sa = intOrNull(b.score_a) ?? 0;
      const sb = intOrNull(b.score_b) ?? 0;
      if (sa < 0 || sb < 0) throw fail(400, 'Scores cannot be negative');
      const { rows } = await sql.sql`
        UPDATE matches SET score_a=${sa}, score_b=${sb}, updated_at=now() WHERE id=${id} RETURNING sport`;
      if (rows.length) await autoAdvance(sql, rows[0].sport);
      return { json: { ok: true } };
    }

    // ── SET SCORES (volleyball / badminton) ────────
    case 'match.sets': {
      const id = intOrNull(b.id);
      if (!id) throw fail(400, 'Missing match id');
      const sets = Array.isArray(b.sets) ? b.sets : [];
      // validate each set is [intA, intB]
      const clean = [];
      let won_a = 0, won_b = 0;
      for (const s of sets) {
        if (!Array.isArray(s) || s.length !== 2) throw fail(400, 'Each set must be [scoreA, scoreB]');
        const a = parseInt(s[0], 10), c = parseInt(s[1], 10);
        if (!Number.isFinite(a) || !Number.isFinite(c) || a < 0 || c < 0)
          throw fail(400, 'Set scores must be non-negative numbers');
        clean.push([a, c]);
        if (a > c) won_a++; else if (c > a) won_b++;
      }
      const { rows } = await sql.sql`
        UPDATE matches SET sets=${JSON.stringify(clean)}::jsonb, score_a=${won_a}, score_b=${won_b}, updated_at=now()
        WHERE id=${id} RETURNING sport`;
      if (rows.length) await autoAdvance(sql, rows[0].sport);
      return { json: { ok: true, score_a: won_a, score_b: won_b } };
    }

    // ── TRACK: events + lane entries ────────────────
    case 'race.event.create': {
      const label = str(b.label, 120);
      const event_group = str(b.event_group, 80);
      if (!label) throw fail(400, 'Event label is required');
      if (!event_group) throw fail(400, 'Missing event group');
      const stage = ['heat', 'final', 'relay'].includes(b.stage) ? b.stage : 'heat';
      const scheduled_at = str(b.scheduled_at, 40);
      const sort = intOrNull(b.sort) || 0;
      const { rows } = await sql.sql`
        INSERT INTO race_events (label, event_group, stage, scheduled_at, sort)
        VALUES (${label}, ${event_group}, ${stage}, ${scheduled_at}, ${sort})
        RETURNING id`;
      return { json: { ok: true, id: rows[0].id } };
    }
    case 'race.event.update': {
      const id = intOrNull(b.id);
      if (!id) throw fail(400, 'Missing event id');
      const cols = [], vals = [];
      const push = (c, v) => { cols.push(`${c}=$${cols.length + 1}`); vals.push(v); };
      if ('label' in b)        push('label', str(b.label, 120));
      if ('event_group' in b)  push('event_group', str(b.event_group, 80));
      if ('stage' in b)        push('stage', ['heat', 'final', 'relay'].includes(b.stage) ? b.stage : 'heat');
      if ('scheduled_at' in b) push('scheduled_at', str(b.scheduled_at, 40));
      if ('status' in b)       push('status', ['scheduled', 'finished'].includes(b.status) ? b.status : 'scheduled');
      if ('sort' in b)         push('sort', intOrNull(b.sort) || 0);
      if (!cols.length) return { json: { ok: true } };
      vals.push(id);
      await sql.query(`UPDATE race_events SET ${cols.join(', ')}, updated_at=now() WHERE id=$${vals.length}`, vals);
      return { json: { ok: true } };
    }
    case 'race.event.delete': {
      const id = intOrNull(b.id);
      if (!id) throw fail(400, 'Missing event id');
      await sql.sql`DELETE FROM race_events WHERE id = ${id}`;
      return { json: { ok: true } };
    }
    case 'race.entry.create': {
      const event_id = intOrNull(b.event_id);
      const name = str(b.name, 120);
      if (!event_id) throw fail(400, 'Missing event id');
      if (!name) throw fail(400, 'Entry name is required');
      const lane = intOrNull(b.lane);
      const placeholder = boolOr(b.placeholder, false);
      const { rows } = await sql.sql`
        INSERT INTO race_entries (event_id, lane, name, placeholder)
        VALUES (${event_id}, ${lane}, ${name}, ${placeholder})
        RETURNING id`;
      return { json: { ok: true, id: rows[0].id } };
    }
    case 'race.entry.update': {
      const id = intOrNull(b.id);
      if (!id) throw fail(400, 'Missing entry id');
      const cols = [], vals = [];
      const push = (c, v) => { cols.push(`${c}=$${cols.length + 1}`); vals.push(v); };
      if ('name' in b)        push('name', str(b.name, 120));
      if ('lane' in b)        push('lane', intOrNull(b.lane));
      if ('time_ms' in b)     push('time_ms', intOrNull(b.time_ms));
      if ('placeholder' in b) push('placeholder', boolOr(b.placeholder, false));
      if (!cols.length) return { json: { ok: true } };
      vals.push(id);
      await sql.query(`UPDATE race_entries SET ${cols.join(', ')} WHERE id=$${vals.length}`, vals);
      // touch the parent event's updated_at so the change probe picks it up
      await sql.sql`UPDATE race_events SET updated_at=now() WHERE id=(SELECT event_id FROM race_entries WHERE id=${id})`;
      return { json: { ok: true } };
    }
    case 'race.entry.delete': {
      const id = intOrNull(b.id);
      if (!id) throw fail(400, 'Missing entry id');
      await sql.sql`DELETE FROM race_entries WHERE id = ${id}`;
      return { json: { ok: true } };
    }


    default:
      throw fail(400, 'Unknown action');
  }
}

// After a result changes, fill any scheduled knockout slot whose placeholder
// ("Champion A", "Winner SF1", …) is now resolvable — but only slots that are
// still empty; a manually-set team is never overwritten. Called after every
// write that can change a finished result for a sport.
async function autoAdvance(sql, sport) {
  const [teamsRes, matchesRes] = await Promise.all([
    sql.sql`SELECT * FROM teams WHERE sport = ${sport}`,
    sql.sql`SELECT * FROM matches WHERE sport = ${sport}`,
  ]);
  const fills = resolveAdvancement(sport, teamsRes.rows, matchesRes.rows);
  for (const f of fills) {
    const col = f.side === 'a' ? 'team_a_id' : 'team_b_id';
    await sql.query(
      `UPDATE matches SET ${col}=$1, updated_at=now() WHERE id=$2 AND ${col} IS NULL`,
      [f.team_id, f.matchId]
    );
  }
}

async function setStatus(sql, rawId, setClause) {
  const id = intOrNull(rawId);
  if (!id) throw fail(400, 'Missing match id');
  // setClause is a fixed internal string, never user input
  await sql.query(`UPDATE matches SET ${setClause}, updated_at=now() WHERE id=$1`, [id]);
  return { json: { ok: true } };
}

async function resetMatch(sql, b) {
  const id = intOrNull(b.id);
  if (!id) throw fail(400, 'Missing match id');
  const upd = await sql.sql`
    UPDATE matches SET status='scheduled', score_a=0, score_b=0, sets=NULL, updated_at=now()
    WHERE id=${id} RETURNING id`;
  if (!upd.rows.length) throw fail(404, 'Match not found');
  return { json: { ok: true } };
}
