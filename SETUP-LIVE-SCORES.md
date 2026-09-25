# Live Scores & Analytics Setup (Vercel + Postgres)

This adds live scores, group standings, knockout brackets, team squads and
football analytics to the RENTAP XVII site. Spectators view everything at
`/live.html`. Score keepers ("super admins") enter results at `/scores-admin.html`.

## How it works

```
Spectator (live.html)   →  GET  /api/live?sport=football        →  reads matches, events, standings
Score keeper (scores-admin.html) → POST /api/scores-admin (x-admin-key header) → writes teams, fixtures, scores
```

Both endpoints use the same Vercel Postgres database as the registration system.
No new dependencies, no extra services. Live updates reach phones by polling
every 10 seconds during live matches (the response is cached at Vercel's edge, so
hundreds of spectators still produce only a handful of database reads).

---

## One-time setup

### 1. You already have the database
This reuses the Postgres database created in `SETUP-DATABASE.md`. If you have not
done that yet, follow it first (Storage → Create Database → Postgres/Neon →
Connect to the project).

### 2. Create the tables
Open the database's **Query** console (Vercel Storage → your DB → Query, or the
Neon dashboard) and run this whole block once:

```sql
CREATE TABLE IF NOT EXISTS teams (
  id          SERIAL PRIMARY KEY,
  sport       TEXT NOT NULL,
  name        TEXT NOT NULL,
  group_name  TEXT,
  color       TEXT,
  created_at  TIMESTAMPTZ DEFAULT now(),
  UNIQUE (sport, name)
);

CREATE TABLE IF NOT EXISTS players (
  id          SERIAL PRIMARY KEY,
  team_id     INTEGER NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  number      INTEGER,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS matches (
  id             SERIAL PRIMARY KEY,
  sport          TEXT NOT NULL,
  stage          TEXT NOT NULL DEFAULT 'group',
  group_name     TEXT,
  label          TEXT,
  team_a_id      INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  team_b_id      INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  status         TEXT NOT NULL DEFAULT 'scheduled',
  score_a        INTEGER NOT NULL DEFAULT 0,
  score_b        INTEGER NOT NULL DEFAULT 0,
  sets           JSONB,
  scheduled_at   TIMESTAMPTZ,
  first_half_at  TIMESTAMPTZ,
  second_half_at TIMESTAMPTZ,
  half_length    INTEGER DEFAULT 10,
  updated_at     TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS match_events (
  id          SERIAL PRIMARY KEY,
  match_id    INTEGER NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  team_id     INTEGER REFERENCES teams(id) ON DELETE SET NULL,
  player_id   INTEGER REFERENCES players(id) ON DELETE SET NULL,
  player_name TEXT,
  type        TEXT NOT NULL,
  minute      INTEGER,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_matches_sport ON matches(sport, status);
CREATE INDEX IF NOT EXISTS idx_events_match ON match_events(match_id);
```

### 3. Admin key
The score console reuses the **same `ADMIN_KEY`** environment variable as the
registrations admin page. If you set it while following `SETUP-DATABASE.md`, you
are done. If not: Project → **Settings → Environment Variables** → add `ADMIN_KEY`
(a long secret you pick) → **redeploy**.

Give this key only to the people entering scores. Anyone with it can change any
score.

### 4. Redeploy
Push the new files (`live.html`, `scores-admin.html`, `api/live.js`,
`api/scores-admin.js`) and redeploy. Vercel reuses the existing Postgres
connection variables automatically.

---

## Running the tournament

Everything below happens at `https://YOUR-SITE.vercel.app/scores-admin.html`.
Enter the admin key once; it stays for the browser tab (use **Lock** to clear it).

### Before the event
1. **Teams & Squads** tab → pick a sport → add each team, choose its group (A/B)
   for group-stage sports, optionally a colour → add player names (and jersey
   numbers) to each team.
2. **Fixtures** tab → create matches: stage (group/quarter/semi/third/final),
   group, the two teams, kickoff date/time, and pitch/court label. For football
   set the half length (10 min group, 15 min knockout).

The public `/live.html` shows fixtures and empty standings immediately.

### During a match

**Football** (Match Control tab → pick the match):
- **Kick Off** starts the clock. The minute is derived automatically; you never
  tick a timer.
- **+ Goal** (one big button per team) → pick the scorer from the squad (or type a
  name / mark an own goal) → confirm. The score updates for everyone within ~10
  seconds. Smaller buttons log yellow/red cards and substitutions.
- **Half Time** → **Second Half** → **Full Time** move the status along. Standings
  and the Golden Boot recompute automatically once the match is Full Time.
- Tap a logged event's delete to undo it; the score reverts too.
- **Reopen** on a finished match if you closed it by mistake.

**Basketball / Rugby Touch:** use the `+1` steppers or type the final score, then
Full Time.

**Volleyball / Badminton / Table tennis:** enter each set's score (e.g. `15–10`,
`12–15`, `15–13`). Sets won and the match result are computed for you. Points follow
the v6 schedule: volleyball two sets to 25 (2–0 = 3, 1–1 = 1, 0–2 = 0); badminton
best of three (2–0 = 3, 2–1 = 2, 1–2 = 1, 0–2 = 0); table tennis two games to 11
(2–0 = 3, 1–1 = 2, 0–2 = 0). Only group-stage matches count towards standings.

**Knockouts:** fixtures are created with placeholders ("Champion A", "Winner SF1").
Once a group is decided, open the Fixtures tab, press **Edit** on the knockout match
and pick the real teams — the public bracket switches from placeholders to names.

**Reset:** a match kicked off or scored by mistake goes back to scheduled, 0–0 and no
events with the **Reset** button in Match Control (two taps).

---

## Fixtures & results page (September 2026)

The public page is `/fixtures.html` (`live.html` redirects there). It renders from the
same database: fixtures, squads, standings, brackets, court boards and a "Find my
matches" name search. Badminton and table tennis use **one sport slug per category**
so each keeps its own groups and bracket:

```
football · volleyball · touch-rugby
badminton-ms · badminton-md · badminton-xd · badminton-wd · badminton-ws
table-tennis-ms · table-tennis-ws · table-tennis-od
```

### One-time migration
Run this once in the Neon SQL editor **before** deploying the fixtures page. Every
column is optional, nothing existing changes:

```sql
ALTER TABLE teams   ADD COLUMN IF NOT EXISTS code TEXT;                 -- entry code: MS1, MD4, OD7
ALTER TABLE matches ADD COLUMN IF NOT EXISTS placeholder_a TEXT,        -- "Champion A", "Winner QF1" …
                    ADD COLUMN IF NOT EXISTS placeholder_b TEXT,
                    ADD COLUMN IF NOT EXISTS referee TEXT,              -- referee team from the schedule
                    ADD COLUMN IF NOT EXISTS duration_min INTEGER;      -- slot length in minutes
```

### Loading the organisers' schedule
The five sports are seeded straight from the schedule workbook (kept out of git under
`data/`, it holds full names):

```bash
python3 scripts/build-fixtures.py            # xlsx → data/fixtures-seed.json, with checks
node scripts/seed-fixtures.mjs --dry-run     # what would be created
node --env-file=.env scripts/seed-fixtures.mjs --base https://<deployment> --wipe
```

`--wipe` deletes the existing teams and matches of each seeded sport first (and the
old test data). Matches are created in the file's order because the public bracket
labels knockout rounds by creation order (QF1..4, SF1..2).

### Track tables (created with the track fixtures)
```sql
CREATE TABLE IF NOT EXISTS race_events (
  id           SERIAL PRIMARY KEY,
  label        TEXT NOT NULL,                  -- "100m Men Heat 1"
  event_group  TEXT NOT NULL,                  -- "100m Men" — one medal race per group
  stage        TEXT NOT NULL DEFAULT 'heat',   -- heat | final | relay
  scheduled_at TIMESTAMPTZ,
  status       TEXT NOT NULL DEFAULT 'scheduled',
  sort         INTEGER NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ DEFAULT now()
);
CREATE TABLE IF NOT EXISTS race_entries (
  id          SERIAL PRIMARY KEY,
  event_id    INTEGER NOT NULL REFERENCES race_events(id) ON DELETE CASCADE,
  lane        INTEGER,
  name        TEXT NOT NULL,                   -- runner, or "A / B / C / D" for a relay team
  time_ms     INTEGER,
  placeholder BOOLEAN NOT NULL DEFAULT false   -- "Top 3" lane filled once the heats are timed
);
```

### Working on the page without a database
`node scripts/dev-server.mjs --demo` serves the site on http://localhost:3400 and
answers `/api/live` (and `/api/awards`) from the seed file, with pretend results so
standings, brackets, track finals and the Best Athlete page are populated.

---

## Best Athlete (admin only)

`/awards-admin.html` (same admin key as the score console; not linked anywhere)
derives every gold, silver and bronze from the results and ranks the athletes per
gender so the committee can pick the best male and female athlete. Counted: football,
volleyball, touch rugby, badminton, table tennis and track (19 competitions). Frisbee
and basketball rank players inside their own team, so they are never counted.

### One-time migration
```sql
CREATE TABLE IF NOT EXISTS athletes (
  name_key   TEXT PRIMARY KEY,                 -- normalised name (lib/names.js normName)
  name       TEXT NOT NULL,
  gender     TEXT NOT NULL CHECK (gender IN ('M','F')),
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

### Loading the genders
The roster sheet is the only place gender exists. `build-fixtures.py` writes
`data/athletes-seed.json` (roster genders, plus the gender implied by the competition
for the few entrants the roster does not list); upload it once:

```bash
python3 scripts/build-fixtures.py
node --env-file=.env scripts/seed-fixtures.mjs --athletes --base https://<deployment>
```

Anyone still without a gender shows up on the page in a "needs gender" list with a
select box — fixing it there is the same upsert.

### How the score works
- A medal is gold 3 / silver 2 / bronze 1 points (editable on the page).
- Per sport, the best medal counts fully and every further medal in the same sport
  counts 50 % (slider) — three badminton golds are worth 2 golds, never 3. Medals in
  different sports always count fully.
- Team medals (football, volleyball, touch rugby, relays) count 100 % (slider);
  doubles pairs count as individual unless the toggle is on.
- Order: score → golds → number of sports → individual medals. A tie at the top is
  flagged; the judges decide.
- Only decided competitions award medals: a final that finished level, a league with
  unplayed matches or a race with an untimed lane is listed as pending with the
  reason. Fix a level final by reopening it in the score console and entering the
  deciding score; an untimed lane is a DNF once the race is marked finished.

## Notes

- The `/api` functions only run once deployed on Vercel. A plain local file server
  will not execute them. Use `vercel dev` to test locally with the database, or the
  mock server above for the fixtures page.
- `scores-admin.html` is `noindex` and gated by the admin key. Keep the key secret.
- The fixtures page keeps the last data on screen if the network drops and shows an
  "Updated HH:MM:SS" stamp so viewers know how fresh it is. Public reads are cached at
  the edge for a few seconds; the console bypasses that cache.
- Free tier easily covers a weekend tournament.
