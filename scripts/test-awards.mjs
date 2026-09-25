// Tests for lib/awards.js and lib/names.js — run with: node --test scripts/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyse, deriveMedals, competitionStatus, scoreAthletes, listPeople, COUNTED_FAMILIES } from '../lib/awards.js';
import { normName, splitEntryNames } from '../lib/names.js';

// ── tiny builders in the /api/live shape ──
let ids = 0;
const team = (sport, name, players, extra = {}) => ({
  id: ++ids, sport, name, group_name: null, code: null, color: null,
  players: (players || []).map(n => ({ id: ++ids, name: n, number: null, place: null })), ...extra,
});
const match = (sport, stage, a, b, status, sa, sb, extra = {}) => ({
  id: ++ids, sport, stage, group_name: null, team_a_id: a ? a.id : null, team_b_id: b ? b.id : null,
  status, score_a: sa, score_b: sb, sets: null, placeholder_a: null, placeholder_b: null, ...extra,
});
const sportData = (teams, matches) => ({ teams, matches, standings: {} });
const live = (sports, events = []) => ({ sports, track: { events } });
const event = (label, group, stage, entries, extra = {}) => ({ id: ++ids, label, event_group: group, stage, status: 'scheduled', sort: 0, entries: entries.map((e, i) => ({ id: ++ids, lane: i + 1, name: e.name, time_ms: e.time ?? null, placeholder: !!e.placeholder })), ...extra });
const medalOf = (medals, name) => medals.filter(m => m.people.some(p => p.key === normName(name))).map(m => m.medal);
const comp = (result, id) => result.competitions.find(c => c.id === id);

test('normName strips accents, case and spacing; splitEntryNames splits on slashes', () => {
  assert.equal(normName('  Rogün   FC '), 'rogun fc');
  assert.equal(normName('Ahmad Faris Bin Mohd Hazaini'), normName('ahmad faris bin mohd hazaini'));
  assert.deepEqual(splitEntryNames('A / B /  C/'), ['A', 'B', 'C']);
  assert.deepEqual(splitEntryNames(null), []);
});

test('knockout: final and 3rd-place decide gold, silver and bronze for whole squads', () => {
  const A = team('football', 'Alpha', ['a1', 'a2']), B = team('football', 'Beta', ['b1']), C = team('football', 'Gamma', ['c1']), D = team('football', 'Delta', ['d1']);
  const r = analyse(live({ football: sportData([A, B, C, D], [
    match('football', 'final', A, B, 'finished', 2, 1), match('football', 'third', C, D, 'finished', 1, 0)]) }));
  assert.deepEqual(medalOf(r.medals, 'a1'), ['gold']);
  assert.deepEqual(medalOf(r.medals, 'a2'), ['gold']);
  assert.deepEqual(medalOf(r.medals, 'b1'), ['silver']);
  assert.deepEqual(medalOf(r.medals, 'c1'), ['bronze']);
  assert.deepEqual(medalOf(r.medals, 'd1'), []);
  const gold = r.medals.find(m => m.medal === 'gold');
  assert.equal(gold.kind, 'team'); assert.equal(gold.size, 2); assert.equal(gold.entrants, 4);
  assert.equal(comp(r, 'football').state, 'decided');
});

test('knockout: a level final decides nothing and is flagged; a level 3rd-place match gives no bronze', () => {
  const A = team('badminton-ms', 'A', ['a']), B = team('badminton-ms', 'B', ['b']), C = team('badminton-ms', 'C', ['c']), D = team('badminton-ms', 'D', ['d']);
  const r = analyse(live({ 'badminton-ms': sportData([A, B, C, D], [
    match('badminton-ms', 'final', A, B, 'finished', 1, 1), match('badminton-ms', 'third', C, D, 'finished', 1, 0)]) }));
  assert.deepEqual(medalOf(r.medals, 'a'), []);
  assert.deepEqual(medalOf(r.medals, 'c'), ['bronze']);
  assert.equal(comp(r, 'badminton-ms').state, 'level');
  assert.match(comp(r, 'badminton-ms').note, /reopen/);
  const r2 = analyse(live({ 'badminton-ms': sportData([A, B, C, D], [
    match('badminton-ms', 'final', A, B, 'finished', 2, 0), match('badminton-ms', 'third', C, D, 'finished', 1, 1)]) }));
  assert.deepEqual(medalOf(r2.medals, 'c'), []);
  assert.equal(comp(r2, 'badminton-ms').state, 'level');
});

test('knockout: bronze before the final is partial; a final without a line-up is pending', () => {
  const A = team('table-tennis-ms', 'A', ['a']), B = team('table-tennis-ms', 'B', ['b']), C = team('table-tennis-ms', 'C', ['c']), D = team('table-tennis-ms', 'D', ['d']);
  const r = analyse(live({ 'table-tennis-ms': sportData([A, B, C, D], [
    match('table-tennis-ms', 'final', A, B, 'scheduled', 0, 0), match('table-tennis-ms', 'third', C, D, 'finished', 3, 1)]) }));
  assert.equal(comp(r, 'table-tennis-ms').state, 'partial');
  assert.deepEqual(medalOf(r.medals, 'c'), ['bronze']);
  const r2 = analyse(live({ 'table-tennis-ms': sportData([A, B], [match('table-tennis-ms', 'final', A, null, 'scheduled', 0, 0, { placeholder_b: 'Winner SF2' })]) }));
  assert.equal(comp(r2, 'table-tennis-ms').state, 'pending');
  assert.match(comp(r2, 'table-tennis-ms').note, /line-up/);
  assert.equal(r2.medals.length, 0);
});

test('league: medals follow the table only once every match is played; three teams = small field', () => {
  const A = team('touch-rugby', 'A', ['a']), B = team('touch-rugby', 'B', ['b']), C = team('touch-rugby', 'C', ['c']);
  const done = [
    match('touch-rugby', 'group', A, B, 'finished', 3, 1), match('touch-rugby', 'group', A, C, 'finished', 2, 0),
    match('touch-rugby', 'group', B, C, 'finished', 1, 0), match('touch-rugby', 'group', B, A, 'finished', 0, 1),
    match('touch-rugby', 'group', C, A, 'finished', 1, 2), match('touch-rugby', 'group', C, B, 'finished', 0, 2)];
  const r = analyse(live({ 'touch-rugby': sportData([A, B, C], done) }));
  assert.deepEqual(medalOf(r.medals, 'a'), ['gold']);
  assert.deepEqual(medalOf(r.medals, 'b'), ['silver']);
  assert.deepEqual(medalOf(r.medals, 'c'), ['bronze']);
  assert.ok(comp(r, 'touch-rugby').flags.includes('smallField'));
  assert.equal(comp(r, 'touch-rugby').state, 'decided');
  const pending = done.map(m => ({ ...m }));
  pending[5].status = 'scheduled';
  const r2 = analyse(live({ 'touch-rugby': sportData([A, B, C], pending) }));
  assert.equal(r2.medals.length, 0);
  assert.equal(comp(r2, 'touch-rugby').note, '5 of 6 played');
});

test('league: a pair level on the table is flagged unless head-to-head decided it', () => {
  const mk = (drawAB) => {
    const A = team('football', 'A', ['a']), B = team('football', 'B', ['b']), C = team('football', 'C', ['c']), D = team('football', 'D', ['d']);
    const ms = [
      match('football', 'group', A, B, 'finished', drawAB ? 0 : 1, 0),
      match('football', 'group', A, C, 'finished', drawAB ? 1 : 0, drawAB ? 0 : 1),
      match('football', 'group', A, D, 'finished', 1, 0),
      match('football', 'group', B, C, 'finished', 1, 0),
      match('football', 'group', B, D, 'finished', 1, 0),
      match('football', 'group', C, D, 'finished', 0, 0)];
    return analyse(live({ football: sportData([A, B, C, D], ms) }));
  };
  const decisive = mk(false);   // A and B level on points, goals for and against; A beat B
  assert.ok(!comp(decisive, 'football').flags.includes('tieByName'));
  assert.deepEqual(medalOf(decisive.medals, 'a'), ['gold']);
  const drawn = mk(true);       // identical records and a 0–0 between them
  assert.ok(comp(drawn, 'football').flags.includes('tieByName'));
  assert.match(comp(drawn, 'football').note, /alphabetical/);
});

test('track: placeholders by name block the final; timed final ranks by time and shares equal places', () => {
  const heat = event('100m Men Heat 1', '100m Men', 'heat', [{ name: 'p', time: 12000 }, { name: 'q', time: 13000 }]);
  const finalTbd = event('100m Men Final', '100m Men', 'final', [{ name: 'Top 1' }, { name: 'Top 2' }, { name: 'r', time: 11000 }]);
  const r = analyse(live({}, [heat, finalTbd]));
  assert.equal(r.medals.length, 0);
  assert.match(comp(r, 'track:100m Men').note, /2 lanes still TBD/);
  const finalTimed = event('100m Men Final', '100m Men', 'final', [{ name: 'p', time: 12000 }, { name: 'q', time: 12000 }, { name: 'r', time: 11000 }, { name: 's', time: 14000 }]);
  const r2 = analyse(live({}, [heat, finalTimed]));
  assert.deepEqual(medalOf(r2.medals, 'r'), ['gold']);
  assert.deepEqual(medalOf(r2.medals, 'p'), ['silver']);
  assert.deepEqual(medalOf(r2.medals, 'q'), ['silver']);
  assert.deepEqual(medalOf(r2.medals, 's'), []);          // 1, 2, 2, 4 — no bronze
  assert.ok(comp(r2, 'track:100m Men').flags.includes('tie'));
  assert.equal(comp(r2, 'track:100m Men').state, 'decided');
  assert.equal(r2.medals.find(m => m.medal === 'gold').kind, 'individual');
});

test('track: a lone heat is the race; two heats without a final are pending; finished races may have DNF', () => {
  const lone = event('200m Women', '200m Women', 'heat', [{ name: 'a', time: 30000 }, { name: 'b', time: 31000 }]);
  const r = analyse(live({}, [lone]));
  assert.deepEqual(medalOf(r.medals, 'a'), ['gold']);
  assert.ok(comp(r, 'track:200m Women').flags.includes('smallField'));
  const h1 = event('H1', '400m Men', 'heat', [{ name: 'a', time: 1 }]), h2 = event('H2', '400m Men', 'heat', [{ name: 'b', time: 2 }]);
  assert.match(comp(analyse(live({}, [h1, h2])), 'track:400m Men').note, /no final/);
  const dnf = event('400m Women', '400m Women', 'final', [{ name: 'a', time: 60000 }, { name: 'b' }], { status: 'finished' });
  const r3 = analyse(live({}, [dnf]));
  assert.deepEqual(medalOf(r3.medals, 'a'), ['gold']);
  assert.deepEqual(medalOf(r3.medals, 'b'), []);
  assert.ok(comp(r3, 'track:400m Women').flags.includes('dnf'));
  const untimed = event('400m Women', '400m Women', 'final', [{ name: 'a', time: 60000 }, { name: 'b' }]);
  assert.equal(comp(analyse(live({}, [untimed])), 'track:400m Women').note, '1 of 2 times entered');
});

test('track: relay medals reach every runner; a two-team relay gives gold and silver only', () => {
  const relay = event('4x100m Relay Women', '4x100m Relay Women', 'relay', [{ name: 'a / b / c / d', time: 50000 }, { name: 'e / f / g / h', time: 52000 }]);
  const r = analyse(live({}, [relay]));
  ['a', 'b', 'c', 'd'].forEach(n => assert.deepEqual(medalOf(r.medals, n), ['gold']));
  ['e', 'h'].forEach(n => assert.deepEqual(medalOf(r.medals, n), ['silver']));
  assert.equal(r.medals.filter(m => m.medal === 'bronze').length, 0);
  assert.equal(r.medals[0].kind, 'team'); assert.equal(r.medals[0].size, 4);
});

test('basketball and frisbee are never medal competitions', () => {
  const T = team('basketball', 'Hoops', ['x', 'y']);
  T.players[0].place = 1;
  const r = analyse(live({ basketball: sportData([T], []) }));
  assert.equal(r.medals.length, 0);
  assert.equal(comp(r, 'basketball').state, 'excluded');
});

test('scoring: worked example under the default and alternative parameters', () => {
  const medals = [
    { competition: 'badminton-ms', family: 'badminton', medal: 'gold', kind: 'individual', people: [{ key: 'a', name: 'A' }, { key: 'c', name: 'C' }] },
    { competition: 'badminton-md', family: 'badminton', medal: 'gold', kind: 'pair', people: [{ key: 'a', name: 'A' }] },
    { competition: 'badminton-md', family: 'badminton', medal: 'silver', kind: 'pair', people: [{ key: 'c', name: 'C' }] },
    { competition: 'badminton-xd', family: 'badminton', medal: 'gold', kind: 'pair', people: [{ key: 'a', name: 'A' }] },
    { competition: 'badminton-xd', family: 'badminton', medal: 'bronze', kind: 'pair', people: [{ key: 'c', name: 'C' }] },
    { competition: 'football', family: 'football', medal: 'gold', kind: 'team', people: [{ key: 'b', name: 'B' }] },
    { competition: 'touch-rugby', family: 'touch-rugby', medal: 'gold', kind: 'team', people: [{ key: 'b', name: 'B' }] },
    { competition: 'volleyball', family: 'volleyball', medal: 'gold', kind: 'team', people: [{ key: 'b', name: 'B' }] },
    { competition: 'track:100m Men', family: 'track', medal: 'gold', kind: 'individual', people: [{ key: 'd', name: 'D' }] },
    { competition: 'track:4x100m Relay Men', family: 'track', medal: 'gold', kind: 'team', people: [{ key: 'd', name: 'D' }] },
  ].map(m => ({ label: m.competition, slug: m.competition, short: 'X', entry: '', size: m.people.length, entrants: 4, flags: [], ...m }));
  const gender = { a: 'M', b: 'M', c: 'M', d: 'M' };
  const { rows } = scoreAthletes(medals, gender, {});
  assert.deepEqual(rows.map(r => [r.name, r.score]), [['B', 9], ['A', 6], ['D', 4.5], ['C', 4.5]]);
  assert.equal(rows[2].golds, 2); assert.equal(rows[3].golds, 1);
  assert.equal(rows[1].lines.length, 3);
  assert.equal(rows[1].lines.reduce((s, l) => s + l.counted, 0), 6);
  const alt = scoreAthletes(medals, gender, { sameSport: 1, teamFactor: 0.5 });
  assert.deepEqual(alt.rows.map(r => [r.name, r.score]), [['A', 9], ['C', 6], ['B', 4.5], ['D', 4.5]]);
  const md = scoreAthletes(medals, gender, { doublesAsTeam: true, teamFactor: 0.5 }).rows.find(r => r.name === 'A');
  assert.equal(md.score, 3 + 1.5 * 0.5 + 1.5 * 0.5);
  const only = scoreAthletes(medals, gender, { families: ['football'] }).rows;
  assert.deepEqual(only.map(r => r.name), ['B']);
});

test('scoring: tie-break chain, tied top flag, gender filter and needs-gender list', () => {
  const m = (family, medal, key, kind = 'individual') => ({ competition: family, label: family, slug: family, short: 'X', family, medal, kind, entry: '', size: 1, entrants: 4, flags: [], people: [{ key, name: key.toUpperCase() }] });
  const medals = [
    m('football', 'gold', 'p', 'team'), m('volleyball', 'gold', 'p', 'team'),   // p: 6, 2 golds, 2 sports, 0 individual
    m('badminton', 'gold', 'q'), m('track', 'gold', 'q'),                        // q: 6, 2 golds, 2 sports, 2 individual → above p
    m('badminton', 'gold', 's'), m('track', 'gold', 's'),                        // s: identical to q → tied top
    m('table-tennis', 'silver', 't'),
  ];
  const res = scoreAthletes(medals, { p: 'M', q: 'M', s: 'M' }, { gender: 'M' });
  assert.deepEqual(res.rows.map(r => r.name), ['Q', 'S', 'P']);
  assert.equal(res.tiedTop, true);
  assert.deepEqual(res.needsGender.map(x => x.key), ['t']);
  assert.equal(scoreAthletes(medals, { p: 'M', q: 'M', s: 'M' }, { gender: 'both' }).rows.length, 4);
  assert.equal(scoreAthletes(medals, { p: 'M', q: 'M', s: 'M' }, { gender: 'F' }).rows.length, 0);
  assert.equal(COUNTED_FAMILIES.length, 6);
});

test('listPeople lists doubles and relay members once with their sports', () => {
  const pair = team('badminton-md', 'x / y', ['x', 'y'], { code: 'MD1' });
  const fb = team('football', 'FC', ['x', 'z']);
  const relay = event('Relay', '4x100m Relay Men', 'relay', [{ name: 'x / y / w / v' }, { name: 'Top 1', placeholder: true }]);
  const people = listPeople(live({ 'badminton-md': sportData([pair], []), football: sportData([fb], []) }, [relay]), { x: 'M' });
  const x = people.find(p => p.key === 'x');
  assert.deepEqual(x.families, ['badminton', 'football', 'track']);
  assert.equal(x.gender, 'M');
  assert.equal(people.find(p => p.key === 'y').gender, null);
  assert.ok(!people.some(p => p.name === 'Top 1'));
  assert.equal(people.length, 5);
  assert.equal(deriveMedals(live({})).length, 0);
  assert.equal(competitionStatus(live({})).length, 0);
});
