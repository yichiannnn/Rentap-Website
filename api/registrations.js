import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  // Safe diagnostic: reveals only whether the env vars exist, never their values.
  if (req.query.debug === '1') {
    return res.status(200).json({
      adminKeyConfigured: !!process.env.ADMIN_KEY,
      databaseUrlConfigured: !!process.env.DATABASE_URL
    });
  }

  // Temporary query-level diagnostic: runs the read and returns the real error text.
  if (req.query.debug === '2') {
    try {
      const sql = neon(process.env.DATABASE_URL);
      const rows = await sql`SELECT * FROM registrations ORDER BY created_at DESC LIMIT 1`;
      return res.status(200).json({ ok: true, sampleColumns: rows[0] ? Object.keys(rows[0]) : [], rowCount: rows.length });
    } catch (err) {
      return res.status(200).json({ ok: false, error: String(err && err.message || err) });
    }
  }

  const key = (req.query.key || req.headers['x-admin-key'] || '').toString().trim();
  const expected = (process.env.ADMIN_KEY || '').toString().trim();

  if (!expected || key !== expected) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const sql = neon(process.env.DATABASE_URL);
    const rows = await sql`
      SELECT * FROM registrations
      ORDER BY created_at DESC
    `;
    return res.status(200).json({ count: rows.length, registrations: rows });
  } catch (err) {
    console.error('list error', err);
    return res.status(500).json({ error: 'Could not load registrations' });
  }
}
