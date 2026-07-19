import { db } from '@vercel/postgres';
import crypto from 'crypto';

const SLUGS = ['football', 'touch-rugby', 'badminton', 'volleyball', 'basketball'];
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
    const msg = err.userMessage || 'Operation failed';
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
      try {
        const { rows } = await sql.sql`
          INSERT INTO teams (sport, name, group_name, color)
          VALUES (${sport}, ${name}, ${group_name}, ${color})
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
      await sql.sql`
        UPDATE teams SET
          name = COALESCE(${name}, name),
          group_name = ${group_name},
          color = ${color}
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
      const { rows } = await sql.sql`
        INSERT INTO matches (sport, stage, group_name, label, team_a_id, team_b_id, scheduled_at, half_length, updated_at)
        VALUES (${sport}, ${stage}, ${group_name}, ${label}, ${team_a_id}, ${team_b_id},
                ${scheduled_at}, ${half_length}, now())
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
      if ('stage' in b)        push('stage', STAGES.includes(b.stage) ? b.stage : 'group');
      if ('group_name' in b)   push('group_name', str(b.group_name, 20));
      if ('label' in b)        push('label', str(b.label, 80));
      if ('team_a_id' in b)    push('team_a_id', intOrNull(b.team_a_id));
      if ('team_b_id' in b)    push('team_b_id', intOrNull(b.team_b_id));
      if ('scheduled_at' in b) push('scheduled_at', str(b.scheduled_at, 40));
      if ('half_length' in b)  push('half_length', intOrNull(b.half_length) || 10);
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
