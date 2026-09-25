// Name helpers shared by the API, the pages and the scripts. A person has no id
// in the database — one `players` row per team or entry, free-text track names —
// so the normalised name is the identity used across sports. Same rule as the
// "Find my matches" search on fixtures.html.
export function normName(s) {
  return (s == null ? '' : String(s))
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // strip accents
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

// Doubles pairs and relay teams are stored as one name: "A / B / C / D".
export function splitEntryNames(s) {
  return String(s == null ? '' : s).split('/').map(x => x.trim()).filter(Boolean);
}
