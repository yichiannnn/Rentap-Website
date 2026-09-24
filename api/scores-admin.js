import { db } from '@vercel/postgres';
import crypto from 'crypto';

// One slug per database `sport`; badminton and table tennis have one per category
// (mirror of SPORT_CONFIG in live-shared.js and SPORTS in api/live.js).
const SLUGS = [
  'football', 'touch-rugby', 'volleyball', 'basketball', 'frisbee', 'tug-of-war',
  'badminton-ms', 'badminton-md', 'badminton-xd', 'badminton-wd', 'badminton-ws',
  'table-tennis-ms', 'table-tennis-ws', 'table-tennis-od',
];
const EVENT_TYPES = ['goal', 'own_goal', 'penalty_goal', 'yellow', 'red', 'sub', 'note'];
const SCORING_EVENTS = ['goal', 'own_goal', 'penalty_goal'];
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
      try {
        const { rows } = await sql.sql`
          INSERT INTO teams (sport, name, group_name, color, code)
          VALUES (${sport}, ${name}, ${group_name}, ${color}, ${code})
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
      const name = str(b.name, 120);
      const group_name = str(b.group_name, 20);
      const color = str(b.color, 20);
      const code = str(b.code, 12);
      await sql.sql`
        UPDATE teams SET
          name = COALESCE(${name}, name),
          group_name = ${group_name},
          color = ${color},
          code = ${code}
        WHERE id = ${id}`;
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
      const { rows } = await sql.sql`
        INSERT INTO players (team_id, name, number)
        VALUES (${team_id}, ${name}, ${number})
        RETURNING id`;
      return { json: { ok: true, id: rows[0].id } };
    }
    case 'player.update': {
      const id = intOrNull(b.id);
      if (!id) throw fail(400, 'Missing player id');
      const name = str(b.name, 120);
      const number = intOrNull(b.number);
      await sql.sql`
        UPDATE players SET
          name = COALESCE(${name}, name),
          number = ${number}
        WHERE id = ${id}`;
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
      const half_length = intOrNull(b.half_length) || 10;
      const duration_min = intOrNull(b.duration_min);
      const referee = str(b.referee, 120);
      const placeholder_a = str(b.placeholder_a, 60); // "Champion A", "Winner SF1" … until the team is known
      const placeholder_b = str(b.placeholder_b, 60);
      const { rows } = await sql.sql`
        INSERT INTO matches (sport, stage, group_name, label, team_a_id, team_b_id, scheduled_at, half_length,
                             duration_min, referee, placeholder_a, placeholder_b, updated_at)
        VALUES (${sport}, ${stage}, ${group_name}, ${label}, ${team_a_id}, ${team_b_id},
                ${scheduled_at}, ${half_length}, ${duration_min}, ${referee}, ${placeholder_a}, ${placeholder_b}, now())
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
      if ('half_length' in b)   push('half_length', intOrNull(b.half_length) || 10);
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
    case 'match.start':
      return setStatus(sql, b.id, `status='live', first_half_at=now()`);
    case 'match.halftime':
      return setStatus(sql, b.id, `status='halftime'`);
    case 'match.second_half':
      return setStatus(sql, b.id, `status='live', second_half_at=now()`);
    case 'match.finish':
      return setStatus(sql, b.id, `status='finished'`);
    case 'match.reopen':
      return setStatus(sql, b.id, `status='live'`);
    // Undo a mistaken kick-off or score: back to scheduled, 0–0, no sets, no events.
    case 'match.reset':
      return resetMatch(b);

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
      await sql.sql`UPDATE matches SET score_a=${sa}, score_b=${sb}, updated_at=now() WHERE id=${id}`;
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
      await sql.sql`
        UPDATE matches SET sets=${JSON.stringify(clean)}::jsonb, score_a=${won_a}, score_b=${won_b}, updated_at=now()
        WHERE id=${id}`;
      return { json: { ok: true, score_a: won_a, score_b: won_b } };
    }

    // ── EVENTS (football) ──────────────────────────
    case 'event.create':
      return createEvent(b);
    case 'event.delete':
      return deleteEvent(b);

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

    // ── PLACEMENTS (frisbee tally, basketball 1st/2nd/3rd) ──
    case 'placement.create': {
      const sport = str(b.sport, 40);
      if (!['frisbee', 'basketball'].includes(sport)) throw fail(400, 'Unknown placement sport');
      const name = str(b.name, 120);
      if (!name) throw fail(400, 'Entry name is required');
      const group_name = str(b.group_name, 20);
      const note = str(b.note, 500);
      const sort = intOrNull(b.sort) || 0;
      const { rows } = await sql.sql`
        INSERT INTO placements (sport, group_name, name, note, sort)
        VALUES (${sport}, ${group_name}, ${name}, ${note}, ${sort})
        RETURNING id`;
      return { json: { ok: true, id: rows[0].id } };
    }
    case 'placement.update': {
      const id = intOrNull(b.id);
      if (!id) throw fail(400, 'Missing placement id');
      const cols = [], vals = [];
      const push = (c, v) => { cols.push(`${c}=$${cols.length + 1}`); vals.push(v); };
      if ('name' in b)         push('name', str(b.name, 120));
      if ('group_name' in b)   push('group_name', str(b.group_name, 20));
      if ('note' in b)         push('note', str(b.note, 500));
      if ('gold_tries' in b)   push('gold_tries', intOrNull(b.gold_tries));
      if ('silver_tries' in b) push('silver_tries', intOrNull(b.silver_tries));
      if ('place' in b)        push('place', intOrNull(b.place));
      if ('sort' in b)         push('sort', intOrNull(b.sort) || 0);
      if (!cols.length) return { json: { ok: true } };
      vals.push(id);
      await sql.query(`UPDATE placements SET ${cols.join(', ')}, updated_at=now() WHERE id=$${vals.length}`, vals);
      return { json: { ok: true } };
    }
    case 'placement.delete': {
      const id = intOrNull(b.id);
      if (!id) throw fail(400, 'Missing placement id');
      await sql.sql`DELETE FROM placements WHERE id = ${id}`;
      return { json: { ok: true } };
    }

    default:
      throw fail(400, 'Unknown action');
  }
}

async function setStatus(sql, rawId, setClause) {
  const id = intOrNull(rawId);
  if (!id) throw fail(400, 'Missing match id');
  // setClause is a fixed internal string, never user input
  await sql.query(`UPDATE matches SET ${setClause}, updated_at=now() WHERE id=$1`, [id]);
  return { json: { ok: true } };
}

async function resetMatch(b) {
  const id = intOrNull(b.id);
  if (!id) throw fail(400, 'Missing match id');
  const client = await db.connect();
  try {
    await client.sql`BEGIN`;
    const upd = await client.sql`
      UPDATE matches SET status='scheduled', score_a=0, score_b=0, sets=NULL,
                         first_half_at=NULL, second_half_at=NULL, updated_at=now()
      WHERE id=${id} RETURNING id`;
    if (!upd.rows.length) { await client.sql`ROLLBACK`; throw fail(404, 'Match not found'); }
    await client.sql`DELETE FROM match_events WHERE match_id=${id}`;
    await client.sql`COMMIT`;
    return { json: { ok: true } };
  } catch (e) {
    try { await client.sql`ROLLBACK`; } catch {}
    throw e;
  } finally {
    client.release();
  }
}

// Derive current minute from the match clock fields (server side fallback)
function derivedMinute(m) {
  const half = m.half_length || 10;
  const now = Date.now();
  if (m.status === 'halftime') return half;
  if (m.status === 'finished') return 2 * half;
  if (m.second_half_at) {
    const mins = Math.floor((now - new Date(m.second_half_at).getTime()) / 60000);
    return Math.min(half + Math.max(0, mins), 2 * half);
  }
  if (m.first_half_at) {
    const mins = Math.floor((now - new Date(m.first_half_at).getTime()) / 60000);
    return Math.min(Math.max(0, mins), half);
  }
  return 0;
}

async function createEvent(b) {
  const match_id = intOrNull(b.match_id);
  const type = b.type;
  if (!match_id) throw fail(400, 'Missing match id');
  if (!EVENT_TYPES.includes(type)) throw fail(400, 'Invalid event type');

  const team_id = intOrNull(b.team_id);
  const player_id = intOrNull(b.player_id);
  const player_name = str(b.player_name, 120);
  let minute = intOrNull(b.minute);

  const client = await db.connect();
  try {
    await client.sql`BEGIN`;

    const mRes = await client.sql`SELECT * FROM matches WHERE id=${match_id} FOR UPDATE`;
    if (!mRes.rows.length) { await client.sql`ROLLBACK`; throw fail(404, 'Match not found'); }
    const m = mRes.rows[0];

    if (minute === null) minute = derivedMinute(m);

    const { rows } = await client.sql`
      INSERT INTO match_events (match_id, team_id, player_id, player_name, type, minute)
      VALUES (${match_id}, ${team_id}, ${player_id}, ${player_name}, ${type}, ${minute})
      RETURNING id`;

    // scoring events adjust the match score
    if (SCORING_EVENTS.includes(type)) {
      // own goal credits the OTHER team
      const creditA = (type === 'own_goal')
        ? (team_id === m.team_b_id)   // own goal by B → point to A
        : (team_id === m.team_a_id);
      if (creditA) {
        await client.sql`UPDATE matches SET score_a=score_a+1, updated_at=now() WHERE id=${match_id}`;
      } else {
        await client.sql`UPDATE matches SET score_b=score_b+1, updated_at=now() WHERE id=${match_id}`;
      }
    } else {
      await client.sql`UPDATE matches SET updated_at=now() WHERE id=${match_id}`;
    }

    await client.sql`COMMIT`;
    return { json: { ok: true, id: rows[0].id, minute } };
  } catch (e) {
    try { await client.sql`ROLLBACK`; } catch {}
    throw e;
  } finally {
    client.release();
  }
}

async function deleteEvent(b) {
  const id = intOrNull(b.id);
  if (!id) throw fail(400, 'Missing event id');

  const client = await db.connect();
  try {
    await client.sql`BEGIN`;
    // Delete conditionally; only revert score if a row actually existed.
    const del = await client.sql`
      DELETE FROM match_events WHERE id=${id}
      RETURNING match_id, team_id, type`;
    if (!del.rows.length) { await client.sql`COMMIT`; return { json: { ok: true, removed: false } }; }

    const ev = del.rows[0];
    if (SCORING_EVENTS.includes(ev.type)) {
      const mRes = await client.sql`SELECT team_a_id, team_b_id FROM matches WHERE id=${ev.match_id} FOR UPDATE`;
      if (mRes.rows.length) {
        const m = mRes.rows[0];
        const creditA = (ev.type === 'own_goal')
          ? (ev.team_id === m.team_b_id)
          : (ev.team_id === m.team_a_id);
        if (creditA) {
          await client.sql`UPDATE matches SET score_a=GREATEST(score_a-1,0), updated_at=now() WHERE id=${ev.match_id}`;
        } else {
          await client.sql`UPDATE matches SET score_b=GREATEST(score_b-1,0), updated_at=now() WHERE id=${ev.match_id}`;
        }
      }
    } else {
      await client.sql`UPDATE matches SET updated_at=now() WHERE id=${ev.match_id}`;
    }

    await client.sql`COMMIT`;
    return { json: { ok: true, removed: true } };
  } catch (e) {
    try { await client.sql`ROLLBACK`; } catch {}
    throw e;
  } finally {
    client.release();
  }
}
