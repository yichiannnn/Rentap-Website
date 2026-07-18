import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  // Safe diagnostic: reveals only whether the env vars exist, never their values.
  if (req.query.debug === '1') {
    return res.status(200).json({
      adminKeyConfigured: !!process.env.ADMIN_KEY,
      databaseUrlConfigured: !!process.env.DATABASE_URL
    });
  }

  const key = (req.query.key || req.headers['x-admin-key'] || '').toString().trim();
  const expected = (process.env.ADMIN_KEY || '').toString().trim();

  if (!expected || key !== expected) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const sql = neon(process.env.DATABASE_URL);
    const rows = await sql`
      SELECT id, type, name, email, phone, university, sport, team, role, membership, created_at
      FROM registrations
      ORDER BY created_at DESC
    `;
    return res.status(200).json({ count: rows.length, registrations: rows });
  } catch (err) {
    console.error('list error', err);
    return res.status(500).json({ error: 'Could not load registrations' });
  }
}
