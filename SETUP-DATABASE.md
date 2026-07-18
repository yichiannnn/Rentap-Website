# Registration Database Setup (Vercel + Postgres)

This collects Player / Volunteer / Spectator registrations into a Postgres database
on Vercel. View and export them at `/admin.html`.

## How it works

```
Browser form  →  POST /api/register  →  serverless function  →  Postgres
Admin page    →  GET  /api/registrations?key=…  →  reads the data
```

---

## One-time setup

### 1. Deploy the site to Vercel
Push this folder to GitHub and import it as a Vercel project (or run `vercel`).
Vercel auto-installs the `@vercel/postgres` dependency from `package.json` — nothing to do manually.

### 2. Create the database
In your Vercel project dashboard:
1. Go to the **Storage** tab → **Create Database**
2. Choose **Postgres** (Neon) → pick the free plan → **Connect** it to this project
3. Vercel automatically adds the connection environment variables
   (`POSTGRES_URL`, `DATABASE_URL`, etc.) to the project.

> The backend uses the `@neondatabase/serverless` driver and reads the `DATABASE_URL`
> environment variable, which the Neon integration adds automatically. No extra config needed.

### 3. Create the table
Open the database's **Query** console (in Vercel Storage, or in the Neon dashboard)
and run:

```sql
CREATE TABLE IF NOT EXISTS registrations (
  id          SERIAL PRIMARY KEY,
  type        TEXT NOT NULL,
  name        TEXT NOT NULL,
  email       TEXT NOT NULL,
  phone       TEXT,
  university  TEXT,
  sport       TEXT,
  team        TEXT,
  role        TEXT,
  membership  TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);
```

> **Already created the table before the phone/university fields were added?**
> Run this once in the Neon SQL Editor to add the two new columns:
> ```sql
> ALTER TABLE registrations ADD COLUMN IF NOT EXISTS phone TEXT;
> ALTER TABLE registrations ADD COLUMN IF NOT EXISTS university TEXT;
> ```

### 4. Set the admin key
Project → **Settings → Environment Variables** → add:

| Name        | Value                          |
|-------------|--------------------------------|
| `ADMIN_KEY` | a long secret password you pick |

Then **redeploy** so the new variable takes effect.

---

## Using it

- **Registrations** come in automatically through the site's forms.
- **View / export:** go to `https://YOUR-SITE.vercel.app/admin.html`, enter the
  `ADMIN_KEY`, and you'll see every registration with a **Download CSV** button
  (CSV opens directly in Excel / Google Sheets).

---

## Notes

- The forms only save once deployed on Vercel — the local Python preview server
  does **not** run the `/api` functions, so submitting locally will show an error.
  To test locally with the database, run `vercel dev` instead.
- `admin.html` is marked `noindex` and is protected by the admin key, but the key
  is the only thing guarding it — keep it secret and long.
- Free tier easily covers 100s–1000s of registrations.
