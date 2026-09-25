// Best Athlete: derive gold / silver / bronze medals per person from the results
// and score them. Pure functions, no I/O — used by api/awards.js (server), the
// awards-admin.html page (browser ES module) and scripts/test-awards.mjs.
//
// Input shape is exactly what /api/live?family=all returns:
//   { sports: { <slug>: { teams, matches, standings } }, track: { events } }
//
// Medal rules (what a judge can check by hand):
//   knockout   gold / silver = winner / loser of the `final` once it is finished and not level;
//              bronze = winner of the `third` match; a level match decides nothing until it is reopened
//   league     1st / 2nd / 3rd of the table once every group match is finished
//   track      the final (or single race) of each event group, ranked by time; equal times share a
//              place; heats never award; every runner of a relay team gets the medal
//   basketball and frisbee rank players *within their own team*, which is not a competition
//              result, so they are never counted
import { computeStandings, familyOf } from './standings.js';
import { normName, splitEntryNames } from './names.js';

export const COUNTED_FAMILIES = ['football', 'volleyball', 'touch-rugby', 'badminton', 'table-tennis', 'track'];
export const NOT_MEDAL_BASED = ['basketball', 'frisbee'];
const TEAM_FAMILIES = new Set(['football', 'volleyball', 'touch-rugby', 'tug-of-war']);
const MEDAL_ORDER = ['gold', 'silver', 'bronze'];
const MEDAL_RANK = { gold: 0, silver: 1, bronze: 2 };
// the console types "Top 1", "Team 2" or "TBD" into a lane before the runner is known
const PLACEHOLDER_NAME = /^(?:top|team)\s*\d+$|^tbd$/i;

export const DEFAULT_PARAMS = {
  points: { gold: 3, silver: 2, bronze: 1 },
  sameSport: 0.5,       // weight of the 2nd, 3rd … medal in the same sport
  teamFactor: 1,        // weight of a team / relay medal
  doublesAsTeam: false, // treat doubles pairs as teams (subject to teamFactor)
  families: COUNTED_FAMILIES,
  gender: 'both',       // 'M' | 'F' | 'both'
};

const FAMILY_NAME = {
  football: 'Football', volleyball: 'Volleyball', 'touch-rugby': 'Touch Rugby', badminton: 'Badminton',
  'table-tennis': 'Table Tennis', track: 'Track', basketball: 'Basketball', frisbee: 'Frisbee', 'tug-of-war': 'Tug of War',
};
const FAMILY_SHORT = { football: 'FB', volleyball: 'VB', 'touch-rugby': 'RT', track: 'TR', basketball: 'BB', frisbee: 'FR', 'tug-of-war': 'TW' };
const CATEGORY_NAME = { ms: "Men's Singles", md: "Men's Doubles", xd: 'Mixed Doubles', wd: "Women's Doubles", ws: "Women's Singles", od: 'Open Doubles' };

export function familyName(family) { return FAMILY_NAME[family] || family; }
export function competitionLabel(slug) {
  const family = familyOf(slug);
  if (family === slug) return familyName(family);
  const cat = slug.slice(family.length + 1);
  return `${familyName(family)} · ${CATEGORY_NAME[cat] || cat.toUpperCase()}`;
}
export function shortCode(slug) {
  const family = familyOf(slug);
  return family === slug ? (FAMILY_SHORT[slug] || slug.slice(0, 2).toUpperCase()) : slug.slice(family.length + 1).toUpperCase();
}

// ── people on a medal ─────────────────────────────────────────
export function teamPeople(team) {
  const names = team.players && team.players.length ? team.players.map(p => p.name) : splitEntryNames(team.name);
  const seen = new Map();
  names.forEach(n => { const key = normName(n); if (key && !seen.has(key)) seen.set(key, { key, name: String(n).trim() }); });
  return Array.from(seen.values());
}
function kindOf(family, size) {
  if (TEAM_FAMILIES.has(family)) return 'team';
  return size <= 1 ? 'individual' : size === 2 ? 'pair' : 'team';
}
export function isPlaceholderEntry(en) {
  return en.placeholder === true || PLACEHOLDER_NAME.test(String(en.name || '').trim());
}

// ── analysis ──────────────────────────────────────────────────
// Returns { medals, competitions } for the whole tournament.
export function analyse(live) {
  const sports = live.sports || {};
  const track = live.track || sports.track || { events: [] };
  const competitions = [];
  const medals = [];
  for (const [slug, sp] of Object.entries(sports)) {
    if (slug === 'track') continue;
    const comp = analyseSlug(slug, sp || {});
    competitions.push(comp.competition);
    medals.push(...comp.medals);
  }
  for (const comp of analyseTrack(track.events || [])) {
    competitions.push(comp.competition);
    medals.push(...comp.medals);
  }
  return { medals, competitions };
}
export const deriveMedals = live => analyse(live).medals;
export const competitionStatus = live => analyse(live).competitions;

function matchResult(m) {
  if (!m) return { state: 'none' };
  if (!m.team_a_id || !m.team_b_id) return { state: 'pending', reason: 'line-up not yet known' };
  if (m.status !== 'finished') return { state: 'pending', reason: 'not yet played' };
  if (m.score_a === m.score_b) return { state: 'level' };
  const aWon = m.score_a > m.score_b;
  return { state: 'decided', winner: aWon ? m.team_a_id : m.team_b_id, loser: aWon ? m.team_b_id : m.team_a_id };
}

function analyseSlug(slug, sp) {
  const family = familyOf(slug);
  const teams = sp.teams || [];
  const matches = sp.matches || [];
  const byId = new Map(teams.map(t => [t.id, t]));
  const competition = {
    id: slug, slug, family, label: competitionLabel(slug), short: shortCode(slug),
    state: 'pending', note: '', flags: [], entrants: teams.length, awarded: [],
  };
  const medals = [];
  const award = (medal, teamId) => {
    const team = byId.get(teamId);
    if (!team) return;
    const people = teamPeople(team);
    const rec = {
      competition: competition.id, label: competition.label, family, slug, short: competition.short,
      medal, kind: kindOf(family, people.length), size: people.length, entrants: competition.entrants,
      entry: team.name, people, flags: competition.flags,
    };
    medals.push(rec);
    competition.awarded.push({ medal, entry: team.name });
  };

  if (NOT_MEDAL_BASED.includes(family)) {
    competition.state = 'excluded';
    competition.note = 'Placings are ranked within each team — not a medal competition';
    return { competition, medals };
  }

  const finals = matches.filter(m => m.stage === 'final').sort((a, b) => b.id - a.id);
  const thirds = matches.filter(m => m.stage === 'third').sort((a, b) => b.id - a.id);
  const groupMatches = matches.filter(m => m.stage === 'group');
  const notes = [];

  if (finals.length) {                                     // ── knockout ──
    if (finals.length > 1) { competition.flags.push('multipleFinals'); notes.push(`${finals.length} finals exist — using the newest`); }
    const fr = matchResult(finals[0]);
    const tr = matchResult(thirds[0]);
    if (fr.state === 'decided') { award('gold', fr.winner); award('silver', fr.loser); }
    else if (fr.state === 'level') notes.push('Final finished level — reopen it in the console and enter the deciding score');
    else notes.push(`Final ${fr.reason}`);
    if (tr.state === 'decided') award('bronze', tr.winner);
    else if (tr.state === 'level') notes.push('3rd-place match finished level — reopen it and enter the deciding score');
    else if (tr.state === 'pending') notes.push(`3rd-place match ${tr.reason}`);
    else notes.push('No 3rd-place match — no bronze');
    const anyLevel = fr.state === 'level' || tr.state === 'level';
    const allDone = fr.state === 'decided' && (tr.state === 'decided' || tr.state === 'none');
    competition.state = anyLevel ? 'level' : allDone ? 'decided' : medals.length ? 'partial' : 'pending';
  } else if (!groupMatches.length) {                       // ── nothing to rank ──
    notes.push('No matches yet');
  } else {                                                 // ── league ──
    const played = groupMatches.filter(m => m.status === 'finished').length;
    if (played < groupMatches.length) {
      notes.push(`${played} of ${groupMatches.length} played`);
    } else {
      const standings = sp.standings && Object.keys(sp.standings).length ? sp.standings : computeStandings(slug, teams, matches);
      const rows = standings[''] || [];
      if (!rows.length) {
        notes.push('League has groups but no final — cannot rank it');
      } else {
        rows.slice(0, 3).forEach((r, i) => award(MEDAL_ORDER[i], r.team_id));
        for (let i = 0; i < Math.min(3, rows.length - 1); i++) {
          if (levelOnTable(slug, rows[i], rows[i + 1]) && !decidedByHeadToHead(slug, rows, i, byId, groupMatches)) {
            competition.flags.push('tieByName');
            notes.push(`${rows[i].team} and ${rows[i + 1].team} are level on the table — order is alphabetical, committee decides`);
          }
        }
        competition.state = 'decided';
      }
    }
  }
  if (competition.entrants > 0 && competition.entrants <= 3) competition.flags.push('smallField');
  competition.note = notes.join(' · ');
  return { competition, medals };
}

// Same keys lib/standings.js baseCompare() uses before it falls back to the name.
function levelOnTable(slug, a, b) {
  if (a.pts !== b.pts) return false;
  if (slug === 'volleyball') return a.w === b.w && a.l === b.l && a.sw === b.sw;
  if (slug.startsWith('badminton-') || slug.startsWith('table-tennis-')) return (a.gf - a.ga) === (b.gf - b.ga) && a.gf === b.gf;
  return (a.gf - a.ga) === (b.gf - b.ga) && a.gf === b.gf;
}
// Head-to-head only decides a pair that is alone on its points (rulebook, and
// what sortGroup applies); volleyball never uses it.
function decidedByHeadToHead(slug, rows, i, byId, groupMatches) {
  if (slug === 'volleyball') return false;
  const cluster = rows.filter(r => r.pts === rows[i].pts).length;
  if (cluster !== 2) return false;
  const a = rows[i], b = rows[i + 1];
  const mutual = groupMatches.filter(m => m.status === 'finished' &&
    ((m.team_a_id === a.team_id && m.team_b_id === b.team_id) || (m.team_a_id === b.team_id && m.team_b_id === a.team_id)));
  if (!mutual.length) return false;
  const pair = computeStandings(slug, [byId.get(a.team_id), byId.get(b.team_id)].filter(Boolean), mutual)[''] || [];
  return pair.length === 2 && pair[0].pts !== pair[1].pts;
}

function analyseTrack(events) {
  const byGroup = new Map();
  events.forEach(e => { const g = e.event_group || e.label || ''; if (!byGroup.has(g)) byGroup.set(g, []); byGroup.get(g).push(e); });
  const out = [];
  for (const [group, evs] of byGroup) {
    const competition = {
      id: 'track:' + group, slug: 'track', family: 'track', label: 'Track · ' + group, short: 'TR',
      state: 'pending', note: '', flags: [], entrants: 0, awarded: [],
    };
    const medals = [];
    const notes = [];
    const nonHeat = evs.filter(e => e.stage !== 'heat').sort((a, b) => (a.sort || 0) - (b.sort || 0) || a.id - b.id);
    let race = null;
    if (evs.length === 1) race = evs[0];                   // a lone "heat" is the race itself
    else if (nonHeat.length >= 1) {
      race = nonHeat[nonHeat.length - 1];
      if (nonHeat.length > 1) { competition.flags.push('multipleFinals'); notes.push(`${nonHeat.length} finals exist — using the last`); }
    }
    if (!race) {
      notes.push('Heats only — no final yet');
    } else {
      const lanes = race.entries || [];
      const placeholders = lanes.filter(isPlaceholderEntry);
      const real = lanes.filter(en => !isPlaceholderEntry(en));
      competition.entrants = lanes.length;
      if (!lanes.length) notes.push('No lanes yet');
      else if (placeholders.length) notes.push(`${placeholders.length} lane${placeholders.length > 1 ? 's' : ''} still TBD (${placeholders.map(p => p.name).join(', ')})`);
      else {
        const timed = real.filter(en => en.time_ms != null && en.time_ms > 0);
        const done = timed.length === real.length || race.status === 'finished';
        if (!done) notes.push(`${timed.length} of ${real.length} times entered`);
        else {
          if (timed.length < real.length) { competition.flags.push('dnf'); notes.push(`${real.length - timed.length} lane${real.length - timed.length > 1 ? 's' : ''} without a time (DNF)`); }
          const sorted = timed.slice().sort((a, b) => a.time_ms - b.time_ms);
          let tie = false;
          sorted.forEach(en => {
            const place = 1 + sorted.filter(x => x.time_ms < en.time_ms).length;
            if (sorted.filter(x => x.time_ms === en.time_ms).length > 1) tie = true;
            if (place > 3) return;
            const people = splitEntryNames(en.name).map(n => ({ key: normName(n), name: n })).filter(p => p.key);
            const isRelay = race.stage === 'relay' || people.length > 1;
            medals.push({
              competition: competition.id, label: competition.label, family: 'track', slug: 'track', short: 'TR',
              medal: MEDAL_ORDER[place - 1], kind: isRelay ? 'team' : 'individual', size: people.length,
              entrants: competition.entrants, entry: en.name, people, flags: competition.flags,
              time_ms: en.time_ms, place,
            });
            competition.awarded.push({ medal: MEDAL_ORDER[place - 1], entry: en.name });
          });
          if (tie) { competition.flags.push('tie'); notes.push('Equal times — the place is shared'); }
          competition.state = 'decided';
        }
      }
    }
    if (competition.entrants > 0 && competition.entrants <= 3) competition.flags.push('smallField');
    competition.note = notes.join(' · ');
    out.push({ competition, medals });
  }
  return out;
}

// ── people ────────────────────────────────────────────────────
function genderGetter(genderByKey) {
  if (!genderByKey) return () => null;
  if (genderByKey instanceof Map) return k => genderByKey.get(k) ?? null;
  return k => (Object.prototype.hasOwnProperty.call(genderByKey, k) ? genderByKey[k] : null);
}
// Every entrant of every competition, once, with the sports they entered.
export function listPeople(live, genderByKey) {
  const g = genderGetter(genderByKey);
  const people = new Map();
  const add = (name, family, slug, entry) => {
    const key = normName(name);
    if (!key) return;
    let p = people.get(key);
    if (!p) { p = { key, name: String(name).trim(), gender: g(key), families: [], entries: [] }; people.set(key, p); }
    if (!p.families.includes(family)) p.families.push(family);
    p.entries.push({ slug, family, entry });
  };
  const sports = live.sports || {};
  for (const [slug, sp] of Object.entries(sports)) {
    if (slug === 'track') continue;
    const family = familyOf(slug);
    (sp.teams || []).forEach(t => teamPeople(t).forEach(pp => add(pp.name, family, slug, t.name)));
  }
  const track = live.track || sports.track || { events: [] };
  (track.events || []).forEach(e => (e.entries || []).forEach(en => {
    if (isPlaceholderEntry(en)) return;
    splitEntryNames(en.name).forEach(n => add(n, 'track', 'track', e.event_group || e.label));
  }));
  return Array.from(people.values()).sort((a, b) => a.name.localeCompare(b.name));
}

// ── scoring ───────────────────────────────────────────────────
// medals: from analyse(); genderByKey: {key: 'M'|'F'} or Map; params: see DEFAULT_PARAMS.
// Returns { rows (ranked, filtered by gender), tiedTop, needsGender }.
export function scoreAthletes(medals, genderByKey, params) {
  const p = { ...DEFAULT_PARAMS, ...(params || {}), points: { ...DEFAULT_PARAMS.points, ...((params && params.points) || {}) } };
  const families = new Set(p.families || COUNTED_FAMILIES);
  const g = genderGetter(genderByKey);
  const byPerson = new Map();
  for (const m of medals) {
    if (!families.has(m.family)) continue;
    const isTeam = m.kind === 'team' || (m.kind === 'pair' && p.doublesAsTeam);
    const base = Number(p.points[m.medal]) || 0;
    const factor = isTeam ? Number(p.teamFactor) : 1;
    for (const person of m.people || []) {
      if (!byPerson.has(person.key)) byPerson.set(person.key, { name: person.name, lines: [] });
      byPerson.get(person.key).lines.push({
        competition: m.competition, label: m.label, family: m.family, short: m.short, entry: m.entry,
        medal: m.medal, kind: m.kind, isTeam, base, factor, value: base * factor,
      });
    }
  }
  const all = [];
  for (const [key, c] of byPerson) {
    const byFamily = {};
    c.lines.forEach(l => (byFamily[l.family] ||= []).push(l));
    let score = 0;
    const lines = [];
    Object.values(byFamily).forEach(famLines => {
      famLines.sort((a, b) => (b.value - a.value) || (MEDAL_RANK[a.medal] - MEDAL_RANK[b.medal]));
      famLines.forEach((l, i) => {
        l.weight = i === 0 ? 1 : Number(p.sameSport);
        l.counted = l.value * l.weight;
        score += l.counted;
        lines.push(l);
      });
    });
    const count = medal => c.lines.filter(l => l.medal === medal).length;
    all.push({
      key, name: c.name, gender: g(key), score: Math.round(score * 1000) / 1000,
      golds: count('gold'), silvers: count('silver'), bronzes: count('bronze'),
      distinctSports: Object.keys(byFamily).length,
      individualMedals: c.lines.filter(l => !l.isTeam).length,
      lines,
    });
  }
  const rows = all.filter(r => p.gender === 'both' || r.gender === p.gender);
  rows.sort((a, b) => compareAthletes(a, b) || a.name.localeCompare(b.name));
  rows.forEach((r, i) => { r.rank = i + 1; });
  const tiedTop = rows.length >= 2 && compareAthletes(rows[0], rows[1]) === 0;
  return { rows, tiedTop, needsGender: all.filter(r => !r.gender).map(r => ({ key: r.key, name: r.name })) };
}
export function compareAthletes(a, b) {
  return (b.score - a.score) || (b.golds - a.golds) || (b.distinctSports - a.distinctSports) || (b.individualMedals - a.individualMedals);
}
