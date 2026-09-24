#!/usr/bin/env node
/* Local preview without a database: serves the site's static files and answers
   /api/live from data/fixtures-seed.json in the same shape as api/live.js.

   Usage:
     node scripts/dev-server.mjs [--port 3400] [--demo]

     --demo   pretend some matches have been played: a few football results with
              goals and cards, one live match, volleyball / badminton / table-tennis
              scores — enough to see standings, brackets and timelines populated.

   Registration forms and the admin consoles need the real API (`vercel dev`);
   this server only exists for working on fixtures.html. */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SLUGS, familyOf, codeNumber, computeStandings } from '../lib/standings.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const PORT = Number(args[args.indexOf('--port') + 1]) || 3400;
const DEMO = args.includes('--demo');

const seed = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'fixtures-seed.json'), 'utf8'));
const generated = new Date().toISOString();

// ── build the "database" once, ids in creation order like the seeder ──
const db = {};
let teamId = 0, playerId = 0, matchId = 0, eventId = 0;
for (const [slug, sp] of Object.entries(seed.sports)) {
  const teams = sp.teams.map(t => ({
    id: ++teamId, sport: slug, name: t.name, group_name: t.group, color: t.color, code: t.code,
    players: t.players.map(name => ({ id: ++playerId, team_id: teamId, name, number: null })),
  }));
  const key = {};
  teams.forEach(t => { key[t.code || t.name] = t; });
  const matches = sp.matches.map(m => ({
    id: ++matchId, sport: slug, stage: m.stage, group_name: m.group, label: m.venue,
    team_a_id: m.a ? key[m.a].id : null, team_b_id: m.b ? key[m.b].id : null,
    status: 'scheduled', score_a: 0, score_b: 0, sets: null,
    scheduled_at: `${seed.meta.days[m.day]}T${m.time}:00${seed.meta.tz}`,
    first_half_at: null, second_half_at: null, half_length: m.half || 10,
    duration_min: m.duration, referee: m.referee, placeholder_a: m.placeholder_a, placeholder_b: m.placeholder_b,
    updated_at: generated, events: [],
  }));
  db[slug] = { teams, matches };
}

if (DEMO) {
  const fb = db.football.matches.filter(m => m.stage === 'group');
  const goal = (m, side, name, minute, type) => m.events.push({ id: ++eventId, match_id: m.id, team_id: m[`team_${side}_id`], player_id: null, player_name: name, type: type || 'goal', minute, created_at: generated });
  const finish = (m, a, b) => { m.status = 'finished'; m.score_a = a; m.score_b = b; };
  const pname = (m, side, i) => db.football.teams.find(t => t.id === m[`team_${side}_id`]).players[i].name;
  finish(fb[0], 2, 1); goal(fb[0], 'a', pname(fb[0], 'a', 0), 4); goal(fb[0], 'a', pname(fb[0], 'a', 3), 15, 'penalty_goal'); goal(fb[0], 'b', pname(fb[0], 'b', 1), 9);
  fb[0].events.push({ id: ++eventId, match_id: fb[0].id, team_id: fb[0].team_b_id, player_id: null, player_name: pname(fb[0], 'b', 5), type: 'yellow', minute: 17, created_at: generated });
  finish(fb[1], 0, 0);
  finish(fb[2], 3, 0); goal(fb[2], 'a', pname(fb[2], 'a', 0), 2); goal(fb[2], 'a', pname(fb[2], 'a', 0), 11); goal(fb[2], 'a', pname(fb[2], 'a', 2), 19);
  finish(fb[3], 1, 2); goal(fb[3], 'a', pname(fb[3], 'a', 4), 7); goal(fb[3], 'b', pname(fb[3], 'b', 0), 12); goal(fb[3], 'b', pname(fb[3], 'a', 1), 18, 'own_goal');
  const live = fb[4]; live.status = 'live'; live.score_a = 1; live.score_b = 0;
  live.first_half_at = new Date(Date.now() - 7 * 60000).toISOString(); goal(live, 'a', pname(live, 'a', 6), 5);
  const vb = db.volleyball.matches; finish(vb[0], 2, 0); vb[0].sets = [[25, 18], [25, 21]]; finish(vb[1], 1, 1); vb[1].sets = [[23, 25], [25, 19]];
  const rt = db['touch-rugby'].matches; finish(rt[0], 4, 2);
  const md = db['badminton-md'].matches.filter(m => m.stage === 'group'); finish(md[0], 2, 1); md[0].sets = [[15, 11], [12, 15], [15, 9]]; finish(md[1], 2, 0); md[1].sets = [[15, 7], [15, 10]];
  md[2].status = 'live'; md[2].sets = [[15, 13]]; md[2].score_a = 1;
  const tt = db['table-tennis-od'].matches.filter(m => m.stage === 'group'); finish(tt[0], 1, 1); tt[0].sets = [[11, 7], [9, 11]]; finish(tt[1], 2, 0); tt[1].sets = [[11, 4], [11, 8]];
}

function payload(slug) {
  const { teams, matches } = db[slug];
  const byId = {}; teams.forEach(t => { byId[t.id] = t; });
  const sortedTeams = teams.slice().sort((a, b) =>
    (a.group_name || '~').localeCompare(b.group_name || '~') || codeNumber(a.code) - codeNumber(b.code) || a.name.localeCompare(b.name));
  const rank = { live: 0, halftime: 1, scheduled: 2, finished: 3 };
  const sortedMatches = matches.slice().sort((a, b) => rank[a.status] - rank[b.status] || (new Date(a.scheduled_at) - new Date(b.scheduled_at)) || a.id - b.id)
    .map(m => ({ ...m, team_a_name: m.team_a_id ? byId[m.team_a_id].name : null, team_b_name: m.team_b_id ? byId[m.team_b_id].name : null }));
  return { teams: sortedTeams, matches: sortedMatches, standings: computeStandings(slug, sortedTeams, sortedMatches) };
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/api/live') {
    const sport = url.searchParams.get('sport') || '', family = url.searchParams.get('family') || '', since = url.searchParams.get('since') || '';
    let slugs;
    if (family) slugs = family === 'all' ? SLUGS : SLUGS.filter(s => familyOf(s) === family);
    else if (sport) slugs = SLUGS.includes(sport) ? [sport] : [];
    else slugs = SLUGS;
    if (!slugs.length) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'Unknown sport' })); }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (since && since === generated) return res.end(JSON.stringify(family ? { family, unchanged: true, generated_at: generated } : { sport, unchanged: true, generated_at: generated }));
    const sports = {};
    slugs.forEach(s => { sports[s] = db[s] ? payload(s) : { teams: [], matches: [], standings: {} }; });
    if (family) return res.end(JSON.stringify({ family, generated_at: generated, sports }));
    if (sport) return res.end(JSON.stringify({ sport, generated_at: generated, ...sports[sport] }));
    return res.end(JSON.stringify({ generated_at: generated, matches: Object.values(sports).flatMap(s => s.matches) }));
  }
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/_vercel/')) {
    res.writeHead(url.pathname.startsWith('/_vercel/') ? 204 : 501, { 'Content-Type': 'application/json' });
    return res.end(url.pathname.startsWith('/_vercel/') ? '' : JSON.stringify({ error: 'not available in the mock server — use vercel dev' }));
  }
  let file = path.normalize(path.join(ROOT, url.pathname === '/' ? 'index.html' : url.pathname));
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`mock server on http://localhost:${PORT}/fixtures.html${DEMO ? ' (demo results on)' : ''}`));
