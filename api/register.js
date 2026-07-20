import { neon } from '@neondatabase/serverless';

const TYPES = ['player', 'volunteer', 'spectator', 'vendor'];

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const sql = neon(process.env.DATABASE_URL);
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    let { type, name, email, phone, university, sport, team, role, membership, food, people, category } = body;

    if (!TYPES.includes(type)) {
      return res.status(400).json({ error: 'Invalid registration type' });
    }

    name = (name || '').toString().trim().slice(0, 120);
    email = (email || '').toString().trim().slice(0, 160);

    if (!name || !email || !email.includes('@')) {
      return res.status(400).json({ error: 'Name and a valid email are required' });
    }

    phone = (phone || '').toString().trim().slice(0, 40) || null;
    university = (university || '').toString().trim().slice(0, 120) || null;
    sport = (sport || '').toString().trim().slice(0, 60) || null;
    team = (team || '').toString().trim().slice(0, 120) || null;
    role = (role || '').toString().trim().slice(0, 80) || null;
    membership = (membership || '').toString().trim().slice(0, 80) || null;
    people = (people || '').toString().trim().slice(0, 20) || null;
    category = (category || '').toString().trim().slice(0, 80) || null;
    // Vendor description ("food") stored only if the column exists — added when vendor opens.
    const description = (food || '').toString().trim().slice(0, 200) || null;

    // Discover which optional columns actually exist, so a missing column can never break an insert.
    const colRows = await sql`
      SELECT column_name FROM information_schema.columns WHERE table_name = 'registrations'
    `;
    const cols = new Set(colRows.map(r => r.column_name));

    const optional = { people, category, food: description };
    const extraCols = [];
    const extraVals = [];
    for (const [col, val] of Object.entries(optional)) {
      if (cols.has(col)) { extraCols.push(col); extraVals.push(val); }
    }

    const allCols = ['type', 'name', 'email', 'phone', 'university', 'sport', 'team', 'role', 'membership', ...extraCols];
    const allVals = [type, name, email, phone, university, sport, team, role, membership, ...extraVals];
    const placeholders = allVals.map((_, i) => '$' + (i + 1)).join(', ');

    await sql.query(
      `INSERT INTO registrations (${allCols.join(', ')}) VALUES (${placeholders})`,
      allVals
    );

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('register error', err);
    return res.status(500).json({ error: 'Could not save registration. Please try again.' });
  }
}
