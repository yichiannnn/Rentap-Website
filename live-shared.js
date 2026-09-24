/* RENTAP XVII — live-shared.js
   Shared, dependency-free helpers for fixtures.html, scores-admin.html and the
   content pages. Plain script (no modules): defines globals. */

/* ── Sport configuration ─────────────────────────────
   One entry per database `sport` slug. Badminton and table tennis have one
   slug per category so each category keeps its own groups, standings and
   bracket; `family` groups those slugs under one public tab. The points
   rules live server side in api/live.js — this only drives the UI.
     scoring  'goals' | 'points' | 'sets'
     clock    derived football minute (kick off / half time flow)
     events   goal / card timeline
     groups   group stage with a knockout after it (false = single league)
     advance  rows per group highlighted as qualifying
     sets     sets per group match (set sports), setTo: points per set */
window.SPORT_CONFIG = {
  football:      { name: 'Football',    short: 'FB', family: 'football',     scoring: 'goals',  clock: true,  events: true,  groups: true,  advance: 2, duration: 30,
                   note: 'Top two of each group go to the semi-finals.' },
  volleyball:    { name: 'Volleyball',  short: 'VB', family: 'volleyball',   scoring: 'sets',   clock: false, events: false, groups: false, advance: 0, duration: 60, sets: 2, setTo: 25,
                   note: 'Single league — champion by league table.' },
  'touch-rugby': { name: 'Touch Rugby', short: 'RT', family: 'touch-rugby',  scoring: 'points', clock: false, events: false, groups: false, advance: 0, duration: 45,
                   note: 'Double round robin — every pair plays twice; champion by league table.' },
  'badminton-ms': { name: "Men's Singles",   short: 'MS', family: 'badminton', scoring: 'sets', groups: true,  advance: 1, bestRunnerUp: true, duration: 30, sets: 3, setTo: 15,
                    note: 'Three groups — the group winners and the best runner-up go to the semi-finals.' },
  'badminton-md': { name: "Men's Doubles",   short: 'MD', family: 'badminton', scoring: 'sets', groups: true,  advance: 2, duration: 30, sets: 3, setTo: 15,
                    note: 'Four groups — top two of each go to the quarter-finals (Saturday evening).' },
  'badminton-xd': { name: 'Mixed Doubles',   short: 'XD', family: 'badminton', scoring: 'sets', groups: true,  advance: 2, duration: 30, sets: 3, setTo: 15,
                    note: 'Two groups — top two of each go to the semi-finals.' },
  'badminton-wd': { name: "Women's Doubles", short: 'WD', family: 'badminton', scoring: 'sets', groups: false, advance: 0, duration: 30, sets: 3, setTo: 15,
                    note: 'Single round robin — winner by ranking, no knockout stage.' },
  'badminton-ws': { name: "Women's Singles", short: 'WS', family: 'badminton', scoring: 'sets', groups: false, advance: 0, duration: 30, sets: 3, setTo: 15,
                    note: 'Single round robin — winner by ranking, no knockout stage.' },
  'table-tennis-ms': { name: "Men's Singles",   short: 'MS', family: 'table-tennis', scoring: 'sets', groups: true,  advance: 2, duration: 30, sets: 2, setTo: 11,
                       note: 'Two groups of four — top two of each go to the semi-finals.' },
  'table-tennis-ws': { name: "Women's Singles", short: 'WS', family: 'table-tennis', scoring: 'sets', groups: false, advance: 0, duration: 30, sets: 2, setTo: 11,
                       note: 'Round robin, then 1st v 2nd play the final and 3rd v 4th the 3rd-place match (Saturday).' },
  'table-tennis-od': { name: 'Open Doubles',    short: 'OD', family: 'table-tennis', scoring: 'sets', groups: true,  advance: 2, duration: 30, sets: 2, setTo: 11,
                       note: 'Two groups — top two of each go to the semi-finals.' },
  basketball:    { name: 'Basketball',  short: 'BB', family: 'basketball', scoring: 'points', clock: false, events: false, groups: false, advance: 0, duration: 30 },
  frisbee:       { name: 'Frisbee',     short: 'FR', family: 'frisbee',    scoring: 'points', clock: false, events: false, groups: false, advance: 0, duration: 10 },
  'tug-of-war':  { name: 'Tug of War',  short: 'TW', family: 'tug-of-war', scoring: 'points', clock: false, events: false, groups: false, advance: 0, duration: 15 },
};

/* ── Families: one public tab per family, one console optgroup ── */
window.FAMILIES = {
  football:      { name: 'Football',     slugs: ['football'],
                   format: ['Group stage and semi-finals: 10 min – 5 min break – 10 min (30-minute slot). 3rd place: 30-minute slot. Final: 60-minute slot.',
                            'Win 3 pts · Draw 1 pt · Loss 0. Tie-breakers: head-to-head, goal difference, goals scored.'] },
  volleyball:    { name: 'Volleyball',   slugs: ['volleyball'],
                   format: ['Single league in Hall 2 — every team plays every other team once. Two sets to 25 points, one hour per match.',
                            '2–0 win 3 pts · 1–1 draw 1 pt · 0–2 loss 0. The referee team provides three officials.'] },
  'touch-rugby': { name: 'Touch Rugby',  slugs: ['touch-rugby'],
                   format: ['Three teams, double round robin — each pair plays twice. 45-minute matches on the field.',
                            'Win 3 pts · Draw 1 pt · Loss 0. Champion by league table.'] },
  badminton:     { name: 'Badminton',    slugs: ['badminton-ms', 'badminton-md', 'badminton-xd', 'badminton-wd', 'badminton-ws'],
                   format: ['Group stage: best of three games to 15. Semi-finals, finals and 3rd place: best of three to 21.',
                            '2–0 win 3 pts · 2–1 win 2 pts · 1–2 loss 1 pt · 0–2 loss 0. Courts 1–3 in Hall 1, courts 4–6 in Hall 3.'] },
  'table-tennis': { name: 'Table Tennis', slugs: ['table-tennis-ms', 'table-tennis-ws', 'table-tennis-od'],
                   format: ['Group matches: two games to 11 (a 1–1 is a draw). Semi-finals: best of three. Final and 3rd place: best of five.',
                            '2–0 win 3 pts · 1–1 draw 2 pts · 0–2 loss 0. Saturday in Hall 4, Sunday in Hall 3.'] },
  basketball:    { name: 'Basketball',   slugs: ['basketball'] },
  frisbee:       { name: 'Frisbee',      slugs: ['frisbee'] },
  'tug-of-war':  { name: 'Tug of War',   slugs: ['tug-of-war'] },
};

/* public fixtures page tabs, and the console's sport list (family order) */
window.FIXTURE_ORDER = ['football', 'volleyball', 'touch-rugby', 'badminton', 'table-tennis'];
window.SPORT_ORDER = ['football', 'volleyball', 'touch-rugby', 'badminton', 'table-tennis', 'basketball', 'frisbee', 'tug-of-war']
  .flatMap(f => FAMILIES[f].slugs);

/* display name for a slug: "Badminton · Men's Doubles" or just "Football" */
window.sportLabel = function (slug) {
  const c = SPORT_CONFIG[slug];
  if (!c) return slug;
  return c.family === slug ? c.name : FAMILIES[c.family].name + ' · ' + c.name;
};
window.stageName = function (stage) {
  return { group: 'Group', quarter: 'Quarter-final', semi: 'Semi-final', third: '3rd Place', final: 'Final' }[stage] || stage;
};

/* ── Inline SVG icons (stroke style, matches index.html) ── */
window.SPORT_ICONS = {
  football: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9.5"/><polygon points="12,8 14.4,9.8 13.5,12.6 10.5,12.6 9.6,9.8"/><line x1="12" y1="8" x2="12" y2="2.5"/><line x1="14.4" y1="9.8" x2="19.5" y2="7.5"/><line x1="13.5" y1="12.6" x2="17.5" y2="17"/><line x1="10.5" y1="12.6" x2="6.5" y2="17"/><line x1="9.6" y1="9.8" x2="4.5" y2="7.5"/></svg>`,
  basketball: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="12" cy="12" r="9.5"/><path d="M2.5 12h19"/><path d="M12 2.5v19"/><path d="M5.5 5.5 Q8 9 8 12 Q8 15 5.5 18.5"/><path d="M18.5 5.5 Q16 9 16 12 Q16 15 18.5 18.5"/></svg>`,
  volleyball: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9.5"/><path d="M12 12 C 11.1 8.9 11 5.7 12.9 2.7"/><path d="M12 12 C 11.1 8.9 11 5.7 12.9 2.7" transform="rotate(120 12 12)"/><path d="M12 12 C 11.1 8.9 11 5.7 12.9 2.7" transform="rotate(240 12 12)"/></svg>`,
  badminton: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="9" cy="9" rx="5" ry="6" transform="rotate(-40 9 9)"/><line x1="13" y1="13" x2="19" y2="21"/><circle cx="20" cy="4" r="1.5"/><path d="M18.5 4 L17 1.5 M20 4 L20 1.5 M21.5 4 L23 1.5"/></svg>`,
  'touch-rugby': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M1.8 12 Q5 6 12 6 Q19 6 22.2 12 Q19 18 12 18 Q5 18 1.8 12 Z"/><line x1="3.4" y1="12" x2="20.6" y2="12"/><line x1="12" y1="8.6" x2="12" y2="15.4"/></svg>`,
  'table-tennis': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="10" cy="10" r="6.5"/><line x1="8" y1="5" x2="8" y2="15"/><line x1="15" y1="15" x2="20" y2="21"/><circle cx="20" cy="5" r="2.5"/></svg>`,
  frisbee: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><ellipse cx="12" cy="12" rx="10" ry="5"/><ellipse cx="12" cy="12" rx="5" ry="2.3"/></svg>`,
  'tug-of-war': `<svg viewBox="0 0 48 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12 Q3 8 7 8 L41 8 Q45 8 45 12 Q45 16 41 16 L7 16 Q3 16 3 12 Z"/><path d="M12 8 Q16 12 14 16"/><path d="M22 8 Q26 12 24 16"/><path d="M32 8 Q36 12 34 16"/></svg>`,
};
/* icon for any slug — category slugs use their family's icon */
window.sportIcon = function (slug) {
  const c = SPORT_CONFIG[slug];
  return SPORT_ICONS[c ? c.family : slug] || '';
};

/* ── HTML escaping (mirror admin.html) ── */
window.esc = function (s) {
  return (s == null ? '' : String(s)).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
};

/* ── Time formatting ── */
window.fmtTime = function (iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};
window.fmtDateTime = function (iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
};

/* ── Derived football clock label ──────────────────────
   Returns '07′', 'HT', 'FT', or '' — computed from timestamps,
   never a ticking server value. */
window.clockLabel = function (m) {
  const half = m.half_length || 10;
  if (m.status === 'finished') return 'FT';
  if (m.status === 'halftime') return 'HT';
  if (m.status !== 'live') return '';
  const now = Date.now();
  if (m.second_half_at) {
    const mins = Math.floor((now - new Date(m.second_half_at).getTime()) / 60000);
    const total = half + Math.max(0, mins);
    if (total >= 2 * half) return (2 * half) + '′+';
    return total + '′';
  }
  if (m.first_half_at) {
    const mins = Math.floor((now - new Date(m.first_half_at).getTime()) / 60000);
    if (mins >= half) return half + '′+';
    return Math.max(0, mins) + '′';
  }
  return '0′';
};

/* ── Price formatting: EUR cents → '€X.XX' ── */
window.fmtPrice = function (cents) {
  if (cents == null) return '';
  return '€' + (cents / 100).toFixed(2);
};

/* ── Set-sports helper: format a per-set breakdown ── */
window.formatSets = function (sets) {
  if (!Array.isArray(sets) || !sets.length) return '';
  return sets.map(s => `${s[0]}–${s[1]}`).join(' · ');
};
