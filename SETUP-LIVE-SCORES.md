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

**Volleyball / Badminton:** enter each set's score (e.g. `15–10`, `12–15`,
`15–13`). Sets won and the match result are computed for you. Volleyball uses the
rulebook 3/2/1/0 points; badminton uses 2 points per win.

---

## Notes

- The `/api` functions only run once deployed on Vercel. A plain local file server
  will not execute them. Use `vercel dev` to test locally with the database.
- `scores-admin.html` is `noindex` and gated by the admin key. Keep the key secret.
- The live page keeps the last data on screen if the network drops and shows an
  "Updated HH:MM:SS" stamp so viewers know how fresh it is.
- Free tier easily covers a weekend tournament.
