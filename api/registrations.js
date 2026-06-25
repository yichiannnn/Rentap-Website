import { sql } from '@vercel/postgres';

export default async function handler(req, res) {
  const key = req.query.key || req.headers['x-admin-key'];

  if (!process.env.ADMIN_KEY || key !== process.env.ADMIN_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { rows } = await sql`
      SELECT id, type, name, email, sport, team, role, membership, created_at
      FROM registrations
      ORDER BY created_at DESC
    `;
    return res.status(200).json({ count: rows.length, registrations: rows });
  } catch (err) {
    console.error('list error', err);
    return res.status(500).json({ error: 'Could not load registrations' });
  }
}
