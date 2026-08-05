/* RENTAP XVII — live-shared.js
   Shared, dependency-free helpers for live.html and scores-admin.html.
   Plain script (no modules): defines globals.

   Phase 2: live mode retired. This page is now a RESULTS hub.
   Tournament formats encoded once here; every renderer branches on this
   config, never on hardcoded sport names (except the football scorer
   analytics, which is inherently football specific). */

/* ── Sport configuration ─────────────────────────────
   `tab`      groups slugs into one visible tab. Slugs sharing a tab render
              a category pill row (e.g. badminton: MS / WS / Doubles).
   `groups`   array of group letters, or null for a single-league sport.
   `advance`  how many per group advance (marks the standings rows).
   `knockout` 'qf8' (8-team cross seed) | 'qf16' (16-pair) | 'sf' (top-2)
              | 'none' (league only).
   `scoring`  'goals' | 'points' | 'sets'.
   `setTo`    admin input hint for set sports.
   `events`   football only: goal/card timeline.
   `kiv`      format not yet decided; placeholder tab, no data entry.
   `format`   human string for the admin cheat sheet.

   Add a sport later by adding an entry and creating its rows. */
window.SPORT_CONFIG = {
  football: {
    name: 'Football', tab: 'football', scoring: 'goals',
    groups: ['A', 'B'], advance: 4, knockout: 'qf8', events: true,
    format: '8 teams · Groups A & B · all 4 advance · QF: A1vB4 A2vB3 A3vB2 A4vB1'
  },
  volleyball: {
    name: 'Volleyball', tab: 'volleyball', scoring: 'sets', setTo: [20, 25],
    groups: ['A', 'B'], advance: 4, knockout: 'qf8', events: false,
    format: '8 teams · Groups A & B · all 4 advance · QF: A1vB4 A2vB3 A3vB2 A4vB1'
  },
  basketball: {
    name: 'Basketball', tab: 'basketball', scoring: 'points',
    groups: ['A', 'B'], advance: 4, knockout: 'qf8', events: false,
    format: '8 teams · Groups A & B · all 4 advance · QF: A1vB4 A2vB3 A3vB2 A4vB1'
  },
  'touch-rugby': {
    name: 'Rugby Touch', tab: 'touch-rugby', scoring: 'points',
    groups: null, advance: 0, knockout: 'none', events: false,
    format: '4 teams · single league · table winner is champion'
  },
  'badminton-ms': { name: "Men's Singles", tab: 'badminton', tabName: 'Badminton', catShort: 'MS', scoring: 'sets', setTo: [21], groups: ['A', 'B'], advance: 2, knockout: 'sf', events: false, format: '8 players · Groups A & B · top 2 · SF: A1vB2 B1vA2' },
  'badminton-ws': { name: "Women's Singles", tab: 'badminton', tabName: 'Badminton', catShort: 'WS', scoring: 'sets', setTo: [21], groups: ['A', 'B'], advance: 2, knockout: 'sf', events: false, format: '8 players · Groups A & B · top 2 · SF: A1vB2 B1vA2' },
  'badminton-doubles': { name: 'Doubles', tab: 'badminton', tabName: 'Badminton', catShort: 'XD', scoring: 'sets', setTo: [21], groups: ['A', 'B', 'C', 'D'], advance: 2, knockout: 'qf16', events: false, format: '16 pairs · Groups A–D · top 2 · QF: A1vB2 C1vD2 B1vA2 D1vC2' },
  'table-tennis-ms': { name: "Men's Singles", tab: 'table-tennis', tabName: 'Table Tennis', catShort: 'MS', scoring: 'sets', setTo: [11], groups: ['A', 'B'], advance: 2, knockout: 'sf', events: false, format: '8 players · Groups A & B · top 2 · SF: A1vB2 B1vA2' },
  'table-tennis-ws': { name: "Women's Singles", tab: 'table-tennis', tabName: 'Table Tennis', catShort: 'WS', scoring: 'sets', setTo: [11], groups: ['A', 'B'], advance: 2, knockout: 'sf', events: false, format: '8 players · Groups A & B · top 2 · SF: A1vB2 B1vA2' },
  'table-tennis-doubles': { name: 'Doubles', tab: 'table-tennis', tabName: 'Table Tennis', catShort: 'XD', scoring: 'sets', setTo: [11], groups: ['A', 'B', 'C', 'D'], advance: 2, knockout: 'qf16', events: false, format: '16 pairs · Groups A–D · top 2 · QF: A1vB2 C1vD2 B1vA2 D1vC2' },
  'tug-of-war': { name: 'Tug of War', tab: 'tug-of-war', kiv: true },
  track: { name: 'Track', tab: 'track', kiv: true },
  frisbee: { name: 'Frisbee', tab: 'frisbee', kiv: true },
};

/* Tab display order (deduplicated by `tab` when building the tab bar). */
window.SPORT_ORDER = [
  'football', 'volleyball', 'basketball',
  'badminton-ms', 'table-tennis-ms',
  'touch-rugby', 'tug-of-war', 'track', 'frisbee',
];

/* Ordered list of tab keys, first slug encountered wins the tab. */
window.TAB_ORDER = ['football', 'volleyball', 'basketball', 'badminton', 'table-tennis', 'touch-rugby', 'tug-of-war', 'track', 'frisbee'];

/* All slugs that accept real data entry (excludes kiv tabs). */
window.ACTIVE_SLUGS = Object.keys(window.SPORT_CONFIG).filter(s => !window.SPORT_CONFIG[s].kiv);

/* slugs grouped by tab, in SPORT_ORDER-ish order */
window.slugsForTab = function (tab) {
  return Object.keys(window.SPORT_CONFIG).filter(s => (window.SPORT_CONFIG[s].tab || s) === tab);
};
window.tabLabel = function (tab) {
  const slug = window.slugsForTab(tab)[0];
  const c = window.SPORT_CONFIG[slug] || {};
  return c.tabName || c.name || tab;
};

/* ── Inline SVG icons (stroke style, matches index.html), keyed by TAB ── */
window.SPORT_ICONS = {
  football: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9.5"/><polygon points="12,8 14.4,9.8 13.5,12.6 10.5,12.6 9.6,9.8"/><line x1="12" y1="8" x2="12" y2="2.5"/><line x1="14.4" y1="9.8" x2="19.5" y2="7.5"/><line x1="13.5" y1="12.6" x2="17.5" y2="17"/><line x1="10.5" y1="12.6" x2="6.5" y2="17"/><line x1="9.6" y1="9.8" x2="4.5" y2="7.5"/></svg>`,
  basketball: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="12" cy="12" r="9.5"/><path d="M2.5 12h19"/><path d="M12 2.5v19"/><path d="M5.5 5.5 Q8 9 8 12 Q8 15 5.5 18.5"/><path d="M18.5 5.5 Q16 9 16 12 Q16 15 18.5 18.5"/></svg>`,
  volleyball: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9.5"/><path d="M12 12 C 11.1 8.9 11 5.7 12.9 2.7"/><path d="M12 12 C 11.1 8.9 11 5.7 12.9 2.7" transform="rotate(120 12 12)"/><path d="M12 12 C 11.1 8.9 11 5.7 12.9 2.7" transform="rotate(240 12 12)"/></svg>`,
  badminton: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="9" cy="9" rx="5" ry="6" transform="rotate(-40 9 9)"/><line x1="13" y1="13" x2="19" y2="21"/><circle cx="20" cy="4" r="1.5"/><path d="M18.5 4 L17 1.5 M20 4 L20 1.5 M21.5 4 L23 1.5"/></svg>`,
  'touch-rugby': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M1.8 12 Q5 6 12 6 Q19 6 22.2 12 Q19 18 12 18 Q5 18 1.8 12 Z"/><line x1="3.4" y1="12" x2="20.6" y2="12"/><line x1="12" y1="8.6" x2="12" y2="15.4"/></svg>`,
  'table-tennis': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="10" cy="10" r="6.5"/><line x1="8" y1="5" x2="8" y2="15"/><line x1="15" y1="15" x2="20" y2="21"/><circle cx="20" cy="5" r="2.5"/></svg>`,
  'tug-of-war': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12 Q2 9 5 9 L19 9 Q22 9 22 12 Q22 15 19 15 L5 15 Q2 15 2 12 Z"/><path d="M5 9 Q8 12 6.5 15"/><path d="M9 9 Q12 12 10.5 15"/><path d="M13 9 Q16 12 14.5 15"/><path d="M17 9 Q20 12 18.5 15"/></svg>`,
  track: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="1.5" y="5" width="21" height="14" rx="7"/><rect x="4" y="7.5" width="16" height="9" rx="4.5"/><rect x="6.5" y="9.5" width="11" height="5" rx="2.5"/><line x1="12" y1="14.5" x2="12" y2="19"/></svg>`,
  frisbee: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><ellipse cx="12" cy="12" rx="10" ry="5"/><ellipse cx="12" cy="12" rx="5" ry="2.3"/></svg>`,
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

/* Short relative-ish label for announcement timestamps. */
window.fmtWhen = function (iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return mins + ' min ago';
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return hrs + (hrs === 1 ? ' hour ago' : ' hours ago');
  return d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
};

/* ── Set-sports helper: format a per-set breakdown ── */
window.formatSets = function (sets) {
  if (!Array.isArray(sets) || !sets.length) return '';
  return sets.map(s => `${s[0]}–${s[1]}`).join(' · ');
};

/* ── EUR price formatter: cents → '3,50 €', null → 'Price at the stall' ── */
window.fmtPrice = function (cents) {
  if (cents == null || cents === '') return 'Price at the stall';
  const n = Number(cents);
  if (!Number.isFinite(n)) return 'Price at the stall';
  return (n / 100).toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
};

/* ── colour attribute sanitiser (mirror phase 1) ── */
window.escAttrColor = function (c) {
  return /^#?[0-9a-fA-F]{3,8}$/.test(c) ? (c[0] === '#' ? c : '#' + c) : 'var(--gold)';
};