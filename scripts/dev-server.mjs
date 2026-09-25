#!/usr/bin/env node
/* Local preview without a database: serves the site's static files and answers
   /api/live and /api/awards from data/fixtures-seed.json in the same shape as
   the real functions.

   Usage:
     node scripts/dev-server.mjs [--port 3400] [--demo]

     --demo   pretend the tournament has been played: every group match gets a
              result, knockouts are filled and played through the real
              auto-advance logic (one badminton final is left level and one
              league unfinished so the awards page shows its warnings), heats
              are timed and finals filled, with a tie and a DNF.

   The admin consoles need the real API (`vercel dev`); this server only exists
   for working on fixtures.html and awards-admin.html (its gate accepts any key). */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SLUGS, familyOf, codeNumber, computeStandings } from '../lib/standings.js';
import { resolveAdvancement, resolveTrackAdvancement } from '../lib/advance.js';
import { analyse, listPeople } from '../lib/awards.js';
import { normName } from '../lib/names.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const PORT = Number(args[args.indexOf('--port') + 1]) || 3400;
const DEMO = args.includes('--demo');

const seed = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'fixtures-seed.json'), 'utf8'));
const generated = new Date().toISOString();

// ── build the "database" once, ids in creation order like the seeder ──
const db = {};
let nextId = 0;
for (const [slug, sp] of Object.entries(seed.sports)) {
  const teams = sp.teams.map(t => {
    const id = ++nextId;
    return {
      id, sport: slug, name: t.name, group_name: t.group, color: t.color, code: t.code, scheduled_at: null,
      players: t.players.map(name => ({ id: ++nextId, team_id: id, name, number: null, place: null })),
    };
  });
  const key = {};
  teams.forEach(t => { key[t.code || t.name] = t; });
  const matches = sp.matches.map(m => ({
    id: ++nextId, sport: slug, stage: m.stage, group_name: m.group, label: m.venue,
    team_a_id: m.a ? key[m.a].id : null, team_b_id: m.b ? key[m.b].id : null,
    status: 'scheduled', score_a: 0, score_b: 0, sets: null,
    scheduled_at: `${seed.meta.days[m.day]}T${m.time}:00${seed.meta.tz}`,
    duration_min: m.duration, referee: m.referee, placeholder_a: m.placeholder_a, placeholder_b: m.placeholder_b,
    updated_at: generated,
  }));
  db[slug] = { teams, matches };
}

// ── track: the same event groups production has, runners drawn from the seed ──
const men = [...new Set(db.football.teams.flatMap(t => t.players.slice(0, 2).map(p => p.name)))];
const women = [...new Set([...db['badminton-ws'].teams, ...db['badminton-wd'].teams].flatMap(t => t.players.map(p => p.name)))];
const raceEvents = [];
function addEvent(label, group, stage, names, opts = {}) {
  const ev = { id: ++nextId, label, event_group: group, stage, scheduled_at: `2026-09-26T${opts.at || '12:00'}:00+02:00`, status: 'scheduled', sort: raceEvents.length, updated_at: generated, entries: [] };
  names.forEach((name, i) => ev.entries.push({ id: ++nextId, event_id: ev.id, lane: i + 1, name, time_ms: null, placeholder: !!opts.placeholders }));
  raceEvents.push(ev);
  return ev;
}
const relay = (pool, i) => pool.slice(i * 4, i * 4 + 4).join(' / ');
addEvent('100m Men Heat 1', '100m Men', 'heat', men.slice(0, 4), { at: '12:00' });
addEvent('100m Men Heat 2', '100m Men', 'heat', men.slice(4, 7), { at: '12:10' });
addEvent('100m Men Final (top 4)', '100m Men', 'final', ['Top 1', 'Top 2', 'Top 3', 'Top 4'], { at: '13:20', placeholders: true });
addEvent('100m Women Heat 1', '100m Women', 'heat', women.slice(0, 3), { at: '12:20' });
addEvent('100m Women Heat 2', '100m Women', 'heat', women.slice(3, 5), { at: '12:30' });
addEvent('100m Women Final (top 4)', '100m Women', 'final', ['Top 1', 'Top 2', 'Top 3', 'Top 4'], { at: '13:30', placeholders: true });
addEvent('200m Men', '200m Men', 'final', men.slice(7, 11), { at: '12:40' });
addEvent('200m Women', '200m Women', 'final', women.slice(5, 8), { at: '12:50' });
addEvent('400m Men', '400m Men', 'final', men.slice(11, 15), { at: '13:00' });
addEvent('400m Women', '400m Women', 'final', women.slice(6, 10), { at: '13:10' });
addEvent('4x100m Relay Men', '4x100m Relay Men', 'relay', [relay(men, 0), relay(men, 1), relay(men, 2)], { at: '13:40' });
addEvent('4x100m Relay Women', '4x100m Relay Women', 'relay', [relay(women, 0), relay(women, 1)], { at: '13:50' });

// ── athletes (gender) for /api/awards: from the roster seed when it exists ──
const athletes = new Map();
const athletesFile = path.join(ROOT, 'data', 'athletes-seed.json');
if (fs.existsSync(athletesFile)) {
  JSON.parse(fs.readFileSync(athletesFile, 'utf8')).forEach(a => athletes.set(normName(a.name), { name: a.name, gender: a.gender }));
}

// ── demo results ──
if (DEMO) {
  let x = 20260926;
  const rnd = n => { x = (x * 1103515245 + 12345) % 2147483648; return x % n; };
  const finish = (m, a, b) => { m.status = 'finished'; m.score_a = a; m.score_b = b; m.updated_at = generated; };
  const setsFor = (a, b, to) => {   // plausible set scores for a sets-won result
    const out = [];
    for (let i = 0; i < a; i++) out.push([to, to - 3 - rnd(5)]);
    for (let i = 0; i < b; i++) out.push([to - 2 - rnd(6), to]);
    return out;
  };
  const groupResult = (slug, m) => {
    const fam = familyOf(slug);
    if (fam === 'badminton') { const [a, b] = [[2, 0], [2, 1], [1, 2], [0, 2]][rnd(4)]; m.sets = setsFor(a, b, 15); return [a, b]; }
    if (fam === 'table-tennis') { const [a, b] = [[2, 0], [1, 1], [0, 2]][rnd(3)]; m.sets = setsFor(a, b, 11); return [a, b]; }
    if (fam === 'volleyball') { const [a, b] = [[2, 0], [1, 1], [0, 2]][rnd(3)]; m.sets = setsFor(a, b, 25); return [a, b]; }
    if (fam === 'football') return [rnd(4), rnd(4)];
    if (fam === 'touch-rugby') return [rnd(6), rnd(6)];
    return [rnd(3), rnd(3)];
  };
  const koResult = (slug, m) => {          // never level
    const fam = familyOf(slug);
    const flip = rnd(2) === 1;
    let a, b;
    if (fam === 'badminton') { [a, b] = [2, rnd(2)]; m.sets = setsFor(a, b, 21); }
    else if (fam === 'table-tennis') { const best = m.stage === 'final' || m.stage === 'third' ? 3 : 2; [a, b] = [best, rnd(best)]; m.sets = setsFor(a, b, 11); }
    else if (fam === 'tug-of-war') [a, b] = [1, 0];
    else { a = rnd(4) + 1; b = rnd(a); }
    return flip ? [b, a] : [a, b];
  };
  const KO = ['quarter', 'semi', 'third', 'final'];
  for (const slug of Object.keys(db)) {
    const { teams, matches } = db[slug];
    const groups = matches.filter(m => m.stage === 'group');
    groups.forEach((m, i) => {
      if (slug === 'badminton-ws' && i === groups.length - 1) return;   // one league left unfinished
      finish(m, ...groupResult(slug, m));
    });
    for (let round = 0; round < 8; round++) {
      const fills = resolveAdvancement(slug, teams, matches);
      fills.forEach(f => { const m = matches.find(y => y.id === f.matchId); if (!m[`team_${f.side}_id`]) m[`team_${f.side}_id`] = f.team_id; });
      let progressed = fills.length > 0;
      matches.filter(m => KO.includes(m.stage) && m.status === 'scheduled' && m.team_a_id && m.team_b_id).forEach(m => {
        if (slug === 'badminton-xd' && m.stage === 'final') { m.sets = [[21, 15], [17, 21]]; finish(m, 1, 1); }   // deliberately level
        else finish(m, ...koResult(slug, m));
        progressed = true;
      });
      if (!progressed) break;
    }
  }
  // track: time the heats, let the real logic fill the finals, then time them
  const time = (en, base, spread) => { en.time_ms = base + rnd(spread); };
  raceEvents.filter(e => e.stage === 'heat').forEach(e => e.entries.forEach(en => time(en, 11000, 1800)));
  resolveTrackAdvancement(raceEvents).forEach(f => {
    const en = raceEvents.flatMap(e => e.entries).find(y => y.id === f.entryId);
    if (en) { en.name = f.name; en.placeholder = false; }
  });
  raceEvents.filter(e => e.stage !== 'heat').forEach(e => {
    const base = /400m/.test(e.event_group) ? 55000 : /200m/.test(e.event_group) ? 23000 : /Relay/.test(e.event_group) ? 46000 : 11000;
    e.entries.forEach(en => time(en, base, 2500));
    if (e.event_group === '200m Women') e.entries[1].time_ms = e.entries[0].time_ms;      // a shared place
    if (e.event_group === '400m Women') e.entries[e.entries.length - 1].time_ms = null;   // one time still missing → pending
    if (e.event_group === '400m Men') { e.entries[e.entries.length - 1].time_ms = null; e.status = 'finished'; }   // DNF
  });
}

function payload(slug) {
  const { teams, matches } = db[slug];
  const byId = {}; teams.forEach(t => { byId[t.id] = t; });
  const sortedTeams = teams.slice().sort((a, b) =>
    (a.group_name || '~').localeCompare(b.group_name || '~') || codeNumber(a.code) - codeNumber(b.code) || a.name.localeCompare(b.name));
  const rank = { scheduled: 0, finished: 1 };
  const sortedMatches = matches.slice().sort((a, b) => rank[a.status] - rank[b.status] || (new Date(a.scheduled_at) - new Date(b.scheduled_at)) || a.id - b.id)
    .map(m => ({ ...m, team_a_name: m.team_a_id ? byId[m.team_a_id].name : null, team_b_name: m.team_b_id ? byId[m.team_b_id].name : null }));
  return { teams: sortedTeams, matches: sortedMatches, standings: computeStandings(slug, sortedTeams, sortedMatches) };
}
function trackPayload() {   // entries ranked by time like the real loader
  return raceEvents.map(e => ({ ...e, entries: e.entries.slice().sort((a, b) => (a.time_ms == null) - (b.time_ms == null) || (a.time_ms || 0) - (b.time_ms || 0) || (a.lane || 0) - (b.lane || 0) || a.id - b.id) }));
}
function allSports() {
  const sports = {};
  SLUGS.forEach(s => { sports[s] = db[s] ? payload(s) : { teams: [], matches: [], standings: {} }; });
  return sports;
}
function readBody(req) {
  return new Promise(resolve => {
    let data = '';
    req.on('data', c => { data += c; });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } });
  });
}
const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/live') {
    const sport = url.searchParams.get('sport') || '', family = url.searchParams.get('family') || '', since = url.searchParams.get('since') || '';
    if (sport === 'track') return json(res, 200, { sport: 'track', generated_at: generated, events: trackPayload() });
    let slugs;
    if (family) slugs = family === 'all' ? SLUGS : SLUGS.filter(s => familyOf(s) === family);
    else if (sport) slugs = SLUGS.includes(sport) ? [sport] : [];
    else slugs = SLUGS;
    if (!slugs.length) return json(res, 400, { error: 'Unknown sport' });
    if (since && since === generated) return json(res, 200, family ? { family, unchanged: true, generated_at: generated } : { sport, unchanged: true, generated_at: generated });
    const sports = {};
    slugs.forEach(s => { sports[s] = db[s] ? payload(s) : { teams: [], matches: [], standings: {} }; });
    if (family === 'all') sports.track = { events: trackPayload() };
    if (family) return json(res, 200, { family, generated_at: generated, sports });
    if (sport) return json(res, 200, { sport, generated_at: generated, ...sports[sport] });
    return json(res, 200, { generated_at: generated, matches: Object.values(sports).flatMap(s => s.matches || []) });
  }
  if (url.pathname === '/api/scores-admin' && req.method === 'POST') {   // just enough for the admin gates to unlock
    const body = await readBody(req);
    if (body.action === 'verify') return json(res, 200, { ok: true });
    return json(res, 501, { error: 'not available in the mock server — use vercel dev' });
  }
  if (url.pathname === '/api/awards') {
    if (req.method === 'POST') {
      const body = await readBody(req);
      const list = Array.isArray(body.athletes) ? body.athletes : [];
      list.forEach(a => { if (a && a.name && /^[MF]$/.test(a.gender || '')) athletes.set(normName(a.name), { name: String(a.name).trim(), gender: a.gender }); });
      return json(res, 200, { ok: true, upserted: list.length });
    }
    const live = { sports: allSports(), track: { events: trackPayload() } };
    const { medals, competitions } = analyse(live);
    const genderByKey = {};
    athletes.forEach((a, k) => { genderByKey[k] = a.gender; });
    return json(res, 200, { generated_at: new Date().toISOString(), medals, competitions, people: listPeople(live, genderByKey) });
  }
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/_vercel/')) {
    res.writeHead(url.pathname.startsWith('/_vercel/') ? 204 : 501, { 'Content-Type': 'application/json' });
    return res.end(url.pathname.startsWith('/_vercel/') ? '' : JSON.stringify({ error: 'not available in the mock server — use vercel dev' }));
  }
  let file = path.normalize(path.join(ROOT, url.pathname === '/' ? 'index.html' : url.pathname));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`mock server on http://localhost:${PORT}/fixtures.html${DEMO ? ' (demo results on)' : ''} — awards: /awards-admin.html`));
