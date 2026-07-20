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
    let { type, name, email, phone, university, sport, team, role, membership, food, people, category, memberNo } = body;

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
    const description = (food || '').toString().trim().slice(0, 200) || null;
    const member_no = (memberNo || '').toString().trim().slice(0, 60) || null;

    // Only insert optional columns that actually exist, so a missing column
    // (food / member_no) can never break a submission.
    const optRows = await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'registrations' AND column_name IN ('food', 'member_no')
    `;
    const has = new Set(optRows.map(r => r.column_name));
    const hasFood = has.has('food');
    const hasMember = has.has('member_no');

    if (hasFood && hasMember) {
      await sql`
        INSERT INTO registrations (type, name, email, phone, university, sport, team, role, membership, people, category, food, member_no)
        VALUES (${type}, ${name}, ${email}, ${phone}, ${university}, ${sport}, ${team}, ${role}, ${membership}, ${people}, ${category}, ${description}, ${member_no})
      `;
    } else if (hasFood) {
      await sql`
        INSERT INTO registrations (type, name, email, phone, university, sport, team, role, membership, people, category, food)
        VALUES (${type}, ${name}, ${email}, ${phone}, ${university}, ${sport}, ${team}, ${role}, ${membership}, ${people}, ${category}, ${description})
      `;
    } else if (hasMember) {
      await sql`
        INSERT INTO registrations (type, name, email, phone, university, sport, team, role, membership, people, category, member_no)
        VALUES (${type}, ${name}, ${email}, ${phone}, ${university}, ${sport}, ${team}, ${role}, ${membership}, ${people}, ${category}, ${member_no})
      `;
    } else {
      await sql`
        INSERT INTO registrations (type, name, email, phone, university, sport, team, role, membership, people, category)
        VALUES (${type}, ${name}, ${email}, ${phone}, ${university}, ${sport}, ${team}, ${role}, ${membership}, ${people}, ${category})
      `;
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('register error', err);
    return res.status(500).json({ error: 'Could not save registration.', detail: String(err && err.message || err) });
  }
}
