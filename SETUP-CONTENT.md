# Content Setup: Announcements, Bazaar & Merchandise (Vercel + Postgres)

This adds public announcements, a bazaar page (food and drink stalls with
photos and prices), and official merchandise to the RENTAP XVII site. Visitors
read everything through `/bazaar.html` and the announcements feed on
`/live.html`. Committee members ("super admins") manage content at
`/content-admin.html`.

## How it works

```
Visitor (bazaar.html, live.html)   →  GET  /api/content?type=bazaar|merch|announcements   →  reads published rows
Visitor (any page)                 →  GET  /api/content?image=<id>                         →  raw image bytes (cached forever)
Committee (content-admin.html)     →  POST /api/content (x-admin-key header)               →  writes announcements, stalls, items, merch, images
```

`api/content.js` is the sixth and final serverless function. It reuses the same
Postgres database and the same `ADMIN_KEY` as the score console. No new
dependencies, no image hosting service: photos are compressed in the browser and
stored as base64 text in Postgres.

---

## One-time setup

### 1. You already have the database and admin key
This reuses the Postgres database from `SETUP-DATABASE.md` and the `ADMIN_KEY`
environment variable from `SETUP-LIVE-SCORES.md`. Nothing new to configure. If
`ADMIN_KEY` is not set, the content console returns a clear 500 telling you so.

### 2. Create the tables
Open the database Query console (Vercel Storage, your DB, Query, or the Neon
dashboard) and run this whole block once. It is safe to run again; every
statement uses `IF NOT EXISTS`.

```sql
-- Public announcements written by super admins
CREATE TABLE IF NOT EXISTS announcements (
  id          SERIAL PRIMARY KEY,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  level       TEXT NOT NULL DEFAULT 'info',   -- 'info' | 'important' | 'urgent'
  pinned      BOOLEAN NOT NULL DEFAULT false, -- pinned = shown in the sitewide banner
  published   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now(),
  expires_at  TIMESTAMPTZ                      -- NULL = never expires
);

-- Uploaded images (compressed client side before upload)
CREATE TABLE IF NOT EXISTS images (
  id          SERIAL PRIMARY KEY,
  mime        TEXT NOT NULL,                   -- 'image/jpeg' | 'image/webp'
  data        TEXT NOT NULL,                   -- base64, no data: prefix
  bytes       INTEGER NOT NULL,                -- decoded size, for admin display
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Vendor stalls at the bazaar
CREATE TABLE IF NOT EXISTS stalls (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  category    TEXT NOT NULL DEFAULT 'food',    -- 'food' | 'drinks' | 'carboot'
  location    TEXT,                            -- free text: 'Stall 4, main field'
  image_id    INTEGER REFERENCES images(id) ON DELETE SET NULL,  -- stall banner photo
  published   BOOLEAN NOT NULL DEFAULT true,
  sort        INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

-- Items a stall sells (food, drinks) with photo and price
CREATE TABLE IF NOT EXISTS stall_items (
  id          SERIAL PRIMARY KEY,
  stall_id    INTEGER NOT NULL REFERENCES stalls(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  description TEXT,
  price_cents INTEGER,                         -- EUR cents; NULL = 'ask at the stall'
  image_id    INTEGER REFERENCES images(id) ON DELETE SET NULL,
  available   BOOLEAN NOT NULL DEFAULT true,
  sort        INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- Official RENTAP merchandise sold by the committee
CREATE TABLE IF NOT EXISTS merch (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT,
  price_cents INTEGER,
  sizes       TEXT,                            -- free text: 'S / M / L / XL'
  image_id    INTEGER REFERENCES images(id) ON DELETE SET NULL,
  available   BOOLEAN NOT NULL DEFAULT true,
  sort        INTEGER NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ann_pub ON announcements(published, pinned);
CREATE INDEX IF NOT EXISTS idx_items_stall ON stall_items(stall_id);
```

### 3. Deploy
Push the repo. Vercel builds the six functions in `api/`. Open
`/content-admin.html`, enter the same admin key you use for the score console,
and start adding content.

---

## Running the bazaar and announcements

Everything is managed at `/content-admin.html`. The key is held only for the
browser session and cleared with the Lock button. The page is marked
`noindex, nofollow`.

### Announcements
1. Write a title and body. Pick a level: **info** (quiet, gold outline),
   **important** (gold banner), **urgent** (red banner, and it leads the results
   marquee).
2. Tick **Pinned** to show it in the slim banner under the navbar on every
   public page. Only the newest pinned announcement shows there; visitors can
   dismiss it for their current page view.
3. Tick **Published** to make it live. Leave it unticked to draft.
4. Set an optional **expiry**; after that time it disappears from public view
   automatically. Unpublished and expired announcements stay in the console,
   flagged, so you can re-use them.

The full list appears at the top of the Results page, newest first, collapsed to
the three most recent with a "Show all" toggle.

### Stalls and items
1. Create a stall: name, category (Food / Drinks / Carboot), location and an
   optional banner photo.
2. Expand the stall to add items: name, an optional price in euros
   (`type=number`, step 0.01, converted to cents; leave blank for
   "Price at the stall"), an optional photo, and an availability toggle. Mark an
   item sold out and it renders dimmed on the bazaar page.
3. Unpublish a stall to hide it and all its items while you prepare it. Deleting
   a stall also deletes its items and their photos.

### Merchandise
Same pattern at the top level: name, price, sizes line, description, photo and an
availability toggle. Products appear on the Merchandise tab of `/bazaar.html`
(`/bazaar.html#merch` opens it directly).

### Photos
Photos are compressed in your browser before upload: the longest side is scaled
to at most 1200 px and the file is re-encoded (WebP where supported, otherwise
JPEG) until it fits under 400 KB. You see a preview and the final size before the
upload happens. If a photo cannot be squeezed under the cap you are asked to pick
a smaller one. Each stored image is served from `/api/content?image=<id>` and
cached in the browser and at the edge effectively forever, because image ids are
never re-pointed; replacing a photo creates a new row and deletes the old one.

---

## Fixture creation order (knockout brackets)

The public Results page draws each knockout round in the order the fixtures were
created (by id). Create the quarter-finals in the seeding order so the bracket
reads correctly. For the 8-team sports (football, volleyball, basketball):

```
QF1  A1 v B4
QF2  A2 v B3
QF3  A3 v B2
QF4  A4 v B1
```

For 16-pair doubles (badminton, table tennis):

```
QF1  A1 v B2
QF2  C1 v D2
QF3  B1 v A2
QF4  D1 v C2
```

The score console's Fixtures tab shows a "Format cheat sheet" per sport with
exactly these pairings, so you do not have to memorise them.

---

## Sport slug change (badminton and table tennis)

Phase 2 splits the old single `badminton` sport into three categories, each its
own slug: `badminton-ms`, `badminton-ws`, `badminton-doubles` (and likewise
`table-tennis-ms`, `table-tennis-ws`, `table-tennis-doubles`). The plain
`badminton` slug is gone. If you created any test teams or fixtures under the old
slug, delete them or move them. For example, to move old singles rows into the
men's singles category (optional, only if you had test data):

```sql
-- OPTIONAL: only if you have leftover rows under the retired 'badminton' slug
-- UPDATE teams   SET sport = 'badminton-ms' WHERE sport = 'badminton';
-- UPDATE matches SET sport = 'badminton-ms' WHERE sport = 'badminton';
```

The kiv sports (`tug-of-war`, `track`, `frisbee`) have no data entry yet; their
Results tabs show a "being finalised" placeholder and the write API rejects them.