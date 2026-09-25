import { sql } from '@vercel/postgres';
import { SLUGS } from '../lib/standings.js';
import { loadSports, loadRaceEvents } from './live.js';
import { analyse, listPeople } from '../lib/awards.js';
import { normName } from '../lib/names.js';
import { keyValid } from '../lib/admin-key.js';

// Best Athlete data for the admin page (awards-admin.html). Admin key required:
// the response carries every entrant's name and gender.
//   GET  → { generated_at, medals, competitions, people }
//   POST { athletes: [{ name, gender: 'M'|'F' }] } → upsert genders (seeding + inline edits)
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const valid = keyValid(req.headers['x-admin-key']);
  if (valid === null) return res.status(500).json({ error: 'ADMIN_KEY is not configured on the server' });
  if (!valid) return res.status(401).json({ error: 'Unauthorized' });

  try {
    if (req.method === 'GET') return await handleGet(res);
    if (req.method === 'POST') return await handlePost(req, res);
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('awards error', err);
    // 42P01 = undefined_table: the athletes migration in SETUP-LIVE-SCORES.md has not been run
    const msg = err.code === '42P01'
      ? 'The athletes table is missing — run the migration block in SETUP-LIVE-SCORES.md'
      : 'Could not load the awards data';
    return res.status(500).json({ error: msg });
  }
}

async function handleGet(res) {
  const [sports, events, athletes] = await Promise.all([
    loadSports(SLUGS),
    loadRaceEvents(),
    sql`SELECT name_key, name, gender FROM athletes`,
  ]);
  const live = { sports, track: { events } };
  const { medals, competitions } = analyse(live);
  const genderByKey = {};
  athletes.rows.forEach(r => { genderByKey[r.name_key] = r.gender; });
  const people = listPeople(live, genderByKey);
  return res.status(200).json({ generated_at: new Date().toISOString(), medals, competitions, people });
}

async function handlePost(req, res) {
  let body;
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
  } catch {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }
  const list = Array.isArray(body.athletes) ? body.athletes : null;
  if (!list || !list.length || list.length > 1000) return res.status(400).json({ error: 'Send 1–1000 athletes as { athletes: [{ name, gender }] }' });

  const byKey = new Map();   // last entry per normalised name wins
  for (const a of list) {
    const name = String((a && a.name) || '').trim().slice(0, 120);
    const gender = String((a && a.gender) || '').trim().toUpperCase();
    if (!name) return res.status(400).json({ error: 'Every athlete needs a name' });
    if (gender !== 'M' && gender !== 'F') return res.status(400).json({ error: `Gender must be M or F (${name})` });
    byKey.set(normName(name), { name, gender });
  }

  const rows = Array.from(byKey.entries());
  for (let i = 0; i < rows.length; i += 100) {
    const chunk = rows.slice(i, i + 100);
    const values = [];
    const tuples = chunk.map(([key, a], j) => {
      values.push(key, a.name, a.gender);
      return `($${j * 3 + 1}, $${j * 3 + 2}, $${j * 3 + 3}, now())`;
    });
    await sql.query(
      `INSERT INTO athletes (name_key, name, gender, updated_at) VALUES ${tuples.join(', ')}
       ON CONFLICT (name_key) DO UPDATE SET name = EXCLUDED.name, gender = EXCLUDED.gender, updated_at = now()`,
      values,
    );
  }
  return res.status(200).json({ ok: true, upserted: rows.length });
}
