/* RENTAP XVII — live-shared.js
   Shared, dependency-free helpers for live.html and scores-admin.html.
   Plain script (no modules): defines globals. */

/* ── Sport configuration ─────────────────────────────
   Add a new sport by adding one entry here and creating its
   teams / matches in the database. No structural changes needed. */
window.SPORT_CONFIG = {
  football:      { name: 'Football',    scoring: 'goals',  live: true,  clock: true,  groups: true,  knockout: true,  events: true,  advance: 4 },
  'touch-rugby': { name: 'Rugby Touch', scoring: 'points', live: false, clock: false, groups: true,  knockout: true,  events: false, advance: 2 },
  badminton:     { name: 'Badminton',   scoring: 'sets',   live: false, clock: false, groups: true,  knockout: true,  events: false, advance: 2 },
  volleyball:    { name: 'Volleyball',  scoring: 'sets',   live: false, clock: false, groups: true,  knockout: true,  events: false, advance: 2 },
  basketball:    { name: 'Basketball',  scoring: 'points', live: false, clock: false, groups: true,  knockout: true,  events: false, advance: 2 },
};

window.SPORT_ORDER = ['football', 'volleyball', 'badminton', 'basketball', 'touch-rugby'];

/* ── Inline SVG icons (stroke style, matches index.html) ── */
window.SPORT_ICONS = {
  football: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9.5"/><polygon points="12,8 14.4,9.8 13.5,12.6 10.5,12.6 9.6,9.8"/><line x1="12" y1="8" x2="12" y2="2.5"/><line x1="14.4" y1="9.8" x2="19.5" y2="7.5"/><line x1="13.5" y1="12.6" x2="17.5" y2="17"/><line x1="10.5" y1="12.6" x2="6.5" y2="17"/><line x1="9.6" y1="9.8" x2="4.5" y2="7.5"/></svg>`,
  basketball: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><circle cx="12" cy="12" r="9.5"/><path d="M2.5 12h19"/><path d="M12 2.5v19"/><path d="M5.5 5.5 Q8 9 8 12 Q8 15 5.5 18.5"/><path d="M18.5 5.5 Q16 9 16 12 Q16 15 18.5 18.5"/></svg>`,
  volleyball: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9.5"/><path d="M12 12 C 11.1 8.9 11 5.7 12.9 2.7"/><path d="M12 12 C 11.1 8.9 11 5.7 12.9 2.7" transform="rotate(120 12 12)"/><path d="M12 12 C 11.1 8.9 11 5.7 12.9 2.7" transform="rotate(240 12 12)"/></svg>`,
  badminton: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="9" cy="9" rx="5" ry="6" transform="rotate(-40 9 9)"/><line x1="13" y1="13" x2="19" y2="21"/><circle cx="20" cy="4" r="1.5"/><path d="M18.5 4 L17 1.5 M20 4 L20 1.5 M21.5 4 L23 1.5"/></svg>`,
  'touch-rugby': `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path d="M1.8 12 Q5 6 12 6 Q19 6 22.2 12 Q19 18 12 18 Q5 18 1.8 12 Z"/><line x1="3.4" y1="12" x2="20.6" y2="12"/><line x1="12" y1="8.6" x2="12" y2="15.4"/></svg>`,
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

/* ── Set-sports helper: format a per-set breakdown ── */
window.formatSets = function (sets) {
  if (!Array.isArray(sets) || !sets.length) return '';
  return sets.map(s => `${s[0]}–${s[1]}`).join(' · ');
};
