#!/usr/bin/env node
/* Load teams, squads and fixtures from data/fixtures-seed.json into the database
   through the deployed /api/scores-admin (so the schema and key checks stay in one place).

   Usage:
     node --env-file=.env scripts/seed-fixtures.mjs [--base URL] [--wipe] [--only slug,slug] [--dry-run]

     --base URL   site to post to (default: https://rentap-vxii.vercel.app; use a Vercel preview URL first)
     --wipe       delete the existing teams and matches of each seeded sport first (also clears the
                  old test data under basketball / badminton / table-tennis)
     --only       comma-separated slugs, e.g. --only football,badminton-md
     --dry-run    print what would be created without posting anything

   Needs ADMIN_KEY (from .env) and data/fixtures-seed.json (from scripts/build-fixtures.py).
   Matches are created strictly in file order: the public bracket labels knockout
   rounds by creation order (QF1..4, SF1..2). */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const flag = name => args.includes(name);
const opt = (name, dflt) => { const i = args.indexOf(name); return i >= 0 && args[i + 1] ? args[i + 1] : dflt; };

const BASE = opt('--base', 'https://rentap-vxii.vercel.app').replace(/\/$/, '');
const WIPE = flag('--wipe');
const DRY = flag('--dry-run');
const ONLY = opt('--only', '') ? opt('--only', '').split(',').map(s => s.trim()) : null;
const KEY = process.env.ADMIN_KEY;
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SEED = path.join(ROOT, 'data', 'fixtures-seed.json');
const LEGACY_SLUGS = ['basketball', 'badminton', 'table-tennis']; // old test data lives here

function die(msg) { console.error('seed-fixtures: ' + msg); process.exit(1); }
if (!KEY && !DRY) die('ADMIN_KEY is not set (run with: node --env-file=.env scripts/seed-fixtures.mjs …)');
if (!fs.existsSync(SEED)) die('data/fixtures-seed.json not found — run: python3 scripts/build-fixtures.py');

const seed = JSON.parse(fs.readFileSync(SEED, 'utf8'));
const slugs = Object.keys(seed.sports).filter(s => !ONLY || ONLY.includes(s));
if (!slugs.length) die('no sports selected');
if (ONLY) for (const s of ONLY) if (!seed.sports[s]) die(`unknown slug in --only: ${s}`);

let posted = 0;
async function api(action, payload) {
  posted++;
  if (DRY) return { ok: true, id: -posted };
  const res = await fetch(BASE + '/api/scores-admin', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-key': KEY },
    body: JSON.stringify({ action, ...payload }),
  });
  let json = {};
  try { json = await res.json(); } catch {}
  if (!res.ok) throw new Error(`${action} → HTTP ${res.status} ${json.error || ''}`.trim());
  return json;
}
async function current(slug) {
  // the query string busts Vercel's edge cache so the read is fresh
  const res = await fetch(`${BASE}/api/live?sport=${encodeURIComponent(slug)}&_=${Date.now()}`);
  if (!res.ok) throw new Error(`GET /api/live?sport=${slug} → HTTP ${res.status}`);
  return res.json();
}
const sideKey = t => t.code || t.name;
const when = m => `${seed.meta.days[m.day]}T${m.time}:00${seed.meta.tz}`;

async function seedSport(slug) {
  const sp = seed.sports[slug];
  const before = DRY ? { teams: [], matches: [] } : await current(slug);
  if (before.teams.length || before.matches.length) {
    if (!WIPE) die(`${slug} already has ${before.teams.length} teams / ${before.matches.length} matches — rerun with --wipe to replace them`);
    const w = await api('sport.wipe', { sport: slug, confirm: slug });
    console.log(`  ${slug}: wiped ${w.teams} teams, ${w.matches} matches`);
  }

  const ids = {};
  for (const t of sp.teams) {
    const r = await api('team.create', { sport: slug, name: t.name, group_name: t.group, color: t.color, code: t.code });
    ids[sideKey(t)] = r.id;
    // squads: a few requests in flight at a time
    for (let i = 0; i < t.players.length; i += 6) {
      await Promise.all(t.players.slice(i, i + 6).map(name => api('player.create', { team_id: r.id, name })));
    }
  }
  for (const m of sp.matches) {  // sequential on purpose: creation order = bracket order
    await api('match.create', {
      sport: slug, stage: m.stage, group_name: m.group, label: m.venue,
      team_a_id: m.a ? ids[m.a] : null, team_b_id: m.b ? ids[m.b] : null,
      scheduled_at: when(m), half_length: m.half, duration_min: m.duration,
      referee: m.referee, placeholder_a: m.placeholder_a, placeholder_b: m.placeholder_b,
    });
  }

  const players = sp.teams.reduce((n, t) => n + t.players.length, 0);
  if (DRY) { console.log(`  ${slug}: would create ${sp.teams.length} teams, ${players} players, ${sp.matches.length} matches`); return; }
  const after = await current(slug);
  const gotPlayers = after.teams.reduce((n, t) => n + t.players.length, 0);
  const ok = after.teams.length === sp.teams.length && gotPlayers === players && after.matches.length === sp.matches.length;
  console.log(`  ${slug}: ${after.teams.length} teams, ${gotPlayers} players, ${after.matches.length} matches ${ok ? 'OK' : '!! MISMATCH'}`);
  if (!ok) die(`${slug}: database counts differ from the seed file`);
}

(async () => {
  console.log(`${DRY ? 'DRY RUN — ' : ''}seeding ${slugs.length} sport(s) from ${seed.meta.source} into ${BASE}`);
  try {
    if (WIPE && !ONLY) {
      for (const slug of LEGACY_SLUGS) {
        const w = await api('sport.wipe', { sport: slug, confirm: slug });
        if (w.teams || w.matches) console.log(`  ${slug} (old data): wiped ${w.teams} teams, ${w.matches} matches`);
      }
    }
    for (const slug of slugs) await seedSport(slug);
  } catch (e) {
    die(e.message);
  }
  console.log(`done — ${posted} request(s)${DRY ? ' would have been sent' : ''}`);
})();
