import { neon } from '@neondatabase/serverless';

const TYPES = ['player', 'volunteer', 'spectator'];

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const sql = neon(process.env.DATABASE_URL);
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    let { type, name, email, sport, team, role, membership } = body;

    if (!TYPES.includes(type)) {
      return res.status(400).json({ error: 'Invalid registration type' });
    }

    name = (name || '').toString().trim().slice(0, 120);
    email = (email || '').toString().trim().slice(0, 160);

    if (!name || !email || !email.includes('@')) {
      return res.status(400).json({ error: 'Name and a valid email are required' });
    }

    sport = (sport || '').toString().trim().slice(0, 60) || null;
    team = (team || '').toString().trim().slice(0, 120) || null;
    role = (role || '').toString().trim().slice(0, 80) || null;
    membership = (membership || '').toString().trim().slice(0, 80) || null;

    await sql`
      INSERT INTO registrations (type, name, email, sport, team, role, membership)
      VALUES (${type}, ${name}, ${email}, ${sport}, ${team}, ${role}, ${membership})
    `;

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('register error', err);
    return res.status(500).json({ error: 'Could not save registration. Please try again.' });
  }
}
