import { neon } from '@neondatabase/serverless';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    const code = (body.code || '').toString().trim().toUpperCase().slice(0, 40);

    if (!code) {
      return res.status(400).json({ valid: false, error: 'Please enter your membership code.' });
    }

    const sql = neon(process.env.DATABASE_URL);
    const rows = await sql`SELECT 1 FROM members WHERE UPPER(code) = ${code} LIMIT 1`;

    if (rows.length > 0) {
      return res.status(200).json({ valid: true, code });
    }
    return res.status(200).json({ valid: false, error: 'That membership code was not found.' });
  } catch (err) {
    console.error('verify-member error', err);
    return res.status(500).json({ valid: false, error: 'Could not verify right now. Please try again.' });
  }
}
