import { db } from '@vercel/postgres';
import crypto from 'crypto';

// ── allowlists ───────────────────────────────────────
const ANN_LEVELS = ['info', 'important', 'urgent'];
const STALL_CATS = ['food', 'drinks', 'carboot'];
const IMG_MIMES = ['image/jpeg', 'image/webp'];
const MAX_IMG_BYTES = 400000; // decoded

// ── constant-time key check (mirror scores-admin.js) ──
function keyValid(provided) {
    const expected = process.env.ADMIN_KEY;
    if (!expected) return null; // not configured
    const a = crypto.createHash('sha256').update(String(provided || '')).digest();
    const b = crypto.createHash('sha256').update(String(expected)).digest();
    return crypto.timingSafeEqual(a, b);
}

// ── validators ───────────────────────────────────────
const str = (v, max) => {
    if (v === undefined || v === null) return null;
    const s = String(v).trim();
    return s ? s.slice(0, max) : null;
};
const intOrNull = v => {
    if (v === undefined || v === null || v === '') return null;
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : null;
};
const boolOr = (v, dflt) => {
    if (v === undefined || v === null) return dflt;
    if (v === true || v === 'true' || v === 1 || v === '1') return true;
    if (v === false || v === 'false' || v === 0 || v === '0') return false;
    return dflt;
};
const isoOrNull = v => {
    if (v === undefined || v === null || v === '') return null;
    const d = new Date(v);
    return isNaN(d) ? null : d.toISOString();
};

function fail(statusCode, userMessage) {
    const e = new Error(userMessage);
    e.statusCode = statusCode;
    e.userMessage = userMessage;
    return e;
}

export default async function handler(req, res) {
    if (req.method === 'GET') return handleGet(req, res);
    if (req.method === 'POST') return handlePost(req, res);
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
}

// ══════════════════════ GET (public reads + image bytes) ═══════════════════
async function handleGet(req, res) {
    const sql = db;

    // ── image bytes ──
    const imageId = intOrNull(req.query.image);
    if (imageId != null) {
        try {
            const { rows } = await sql.sql`SELECT mime, data FROM images WHERE id = ${imageId}`;
            if (!rows.length) return res.status(404).json({ error: 'Image not found' });
            const row = rows[0];
            const buf = Buffer.from(row.data, 'base64');
            res.setHeader('Content-Type', row.mime);
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
            res.setHeader('Content-Length', buf.length);
            return res.status(200).end(buf);
        } catch (err) {
            console.error('content image error', err);
            return res.status(500).json({ error: 'Could not load image' });
        }
    }

    const type = (req.query.type || '').toString();
    // admin reads (?type=all) with a valid key see unpublished + expired rows
    const isAdmin = keyValid(req.headers['x-admin-key']) === true;

    // public JSON is edge-cacheable; admin JSON must not be cached
    if (isAdmin) res.setHeader('Cache-Control', 'no-store');
    else res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');

    try {
        if (type === 'announcements') {
            return res.status(200).json({ announcements: await getAnnouncements(sql, isAdmin) });
        }
        if (type === 'bazaar') {
            return res.status(200).json({ stalls: await getBazaar(sql, isAdmin) });
        }
        if (type === 'merch') {
            return res.status(200).json({ merch: await getMerch(sql) });
        }
        if (type === 'all') {
            const [announcements, stalls, merch] = await Promise.all([
                getAnnouncements(sql, isAdmin),
                getBazaar(sql, isAdmin),
                getMerch(sql),
            ]);
            return res.status(200).json({ announcements, stalls, merch });
        }
        return res.status(400).json({ error: 'Unknown content type' });
    } catch (err) {
        console.error('content get error', type, err);
        return res.status(500).json({ error: 'Could not load content' });
    }
}

async function getAnnouncements(sql, isAdmin) {
    if (isAdmin) {
        const { rows } = await sql.sql`
      SELECT id, title, body, level, pinned, published, created_at, updated_at, expires_at
      FROM announcements ORDER BY created_at DESC`;
        return rows;
    }
    const { rows } = await sql.sql`
    SELECT id, title, body, level, pinned, created_at
    FROM announcements
    WHERE published = true AND (expires_at IS NULL OR expires_at > now())
    ORDER BY created_at DESC`;
    return rows;
}

async function getBazaar(sql, isAdmin) {
    const stallsRes = isAdmin
        ? await sql.sql`SELECT id, name, description, category, location, image_id, published, sort, created_at FROM stalls ORDER BY sort ASC, name ASC`
        : await sql.sql`SELECT id, name, description, category, location, image_id, published, sort FROM stalls WHERE published = true ORDER BY sort ASC, name ASC`;
    const stalls = stallsRes.rows;
    const ids = stalls.map(s => s.id);
    let items = [];
    if (ids.length) {
        const itemsRes = await sql.sql`
      SELECT id, stall_id, name, description, price_cents, image_id, available, sort
      FROM stall_items WHERE stall_id = ANY(${ids})
      ORDER BY sort ASC, id ASC`;
        items = itemsRes.rows;
    }
    const byStall = {};
    items.forEach(it => (byStall[it.stall_id] ||= []).push(it));
    stalls.forEach(s => { s.items = byStall[s.id] || []; });
    return stalls;
}

async function getMerch(sql) {
    const { rows } = await sql.sql`
    SELECT id, name, description, price_cents, sizes, image_id, available, sort
    FROM merch ORDER BY sort ASC, id ASC`;
    return rows;
}

// ══════════════════════ POST (admin writes) ═══════════════════════════════
async function handlePost(req, res) {
    const valid = keyValid(req.headers['x-admin-key']);
    if (valid === null) return res.status(500).json({ error: 'ADMIN_KEY is not configured on the server' });
    if (!valid) return res.status(401).json({ error: 'Unauthorized' });

    let body;
    try {
        body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body || {});
    } catch {
        return res.status(400).json({ error: 'Invalid JSON body' });
    }

    const action = body.action;
    if (action === 'verify') return res.status(200).json({ ok: true });

    try {
        const result = await route(action, body);
        return res.status(result.status || 200).json(result.json || { ok: true });
    } catch (err) {
        console.error('content-admin error', action, err);
        const msg = err.userMessage || 'Operation failed';
        return res.status(err.statusCode || 500).json({ error: msg });
    }
}

async function route(action, b) {
    const sql = db;

    switch (action) {
        // ── ANNOUNCEMENTS ───────────────────────────────
        case 'announcement.create': {
            const title = str(b.title, 160);
            const bodyTxt = str(b.body, 4000);
            if (!title) throw fail(400, 'Title is required');
            if (!bodyTxt) throw fail(400, 'Body is required');
            const level = ANN_LEVELS.includes(b.level) ? b.level : 'info';
            const pinned = boolOr(b.pinned, false);
            const published = boolOr(b.published, true);
            const expires_at = isoOrNull(b.expires_at);
            const { rows } = await sql.sql`
        INSERT INTO announcements (title, body, level, pinned, published, expires_at, updated_at)
        VALUES (${title}, ${bodyTxt}, ${level}, ${pinned}, ${published}, ${expires_at}, now())
        RETURNING id`;
            return { json: { ok: true, id: rows[0].id } };
        }
        case 'announcement.update': {
            const id = intOrNull(b.id);
            if (!id) throw fail(400, 'Missing announcement id');
            const cols = [], vals = [];
            const push = (c, v) => { cols.push(`${c}=$${cols.length + 1}`); vals.push(v); };
            if ('title' in b) push('title', str(b.title, 160));
            if ('body' in b) push('body', str(b.body, 4000));
            if ('level' in b) push('level', ANN_LEVELS.includes(b.level) ? b.level : 'info');
            if ('pinned' in b) push('pinned', boolOr(b.pinned, false));
            if ('published' in b) push('published', boolOr(b.published, true));
            if ('expires_at' in b) push('expires_at', isoOrNull(b.expires_at));
            if (!cols.length) return { json: { ok: true } };
            vals.push(id);
            await sql.query(`UPDATE announcements SET ${cols.join(', ')}, updated_at=now() WHERE id=$${vals.length}`, vals);
            return { json: { ok: true } };
        }
        case 'announcement.delete': {
            const id = intOrNull(b.id);
            if (!id) throw fail(400, 'Missing announcement id');
            await sql.sql`DELETE FROM announcements WHERE id = ${id}`;
            return { json: { ok: true } };
        }

        // ── STALLS ──────────────────────────────────────
        case 'stall.create': {
            const name = str(b.name, 160);
            if (!name) throw fail(400, 'Stall name is required');
            const category = STALL_CATS.includes(b.category) ? b.category : 'food';
            const description = str(b.description, 2000);
            const location = str(b.location, 160);
            const image_id = intOrNull(b.image_id);
            const published = boolOr(b.published, true);
            const sort = intOrNull(b.sort) || 0;
            const { rows } = await sql.sql`
        INSERT INTO stalls (name, description, category, location, image_id, published, sort, updated_at)
        VALUES (${name}, ${description}, ${category}, ${location}, ${image_id}, ${published}, ${sort}, now())
        RETURNING id`;
            return { json: { ok: true, id: rows[0].id } };
        }
        case 'stall.update': {
            const id = intOrNull(b.id);
            if (!id) throw fail(400, 'Missing stall id');
            // if replacing the banner image, drop the old image row
            if ('image_id' in b) await maybeDropOldImage(sql, 'stalls', id, intOrNull(b.image_id));
            const cols = [], vals = [];
            const push = (c, v) => { cols.push(`${c}=$${cols.length + 1}`); vals.push(v); };
            if ('name' in b) push('name', str(b.name, 160));
            if ('description' in b) push('description', str(b.description, 2000));
            if ('category' in b) push('category', STALL_CATS.includes(b.category) ? b.category : 'food');
            if ('location' in b) push('location', str(b.location, 160));
            if ('image_id' in b) push('image_id', intOrNull(b.image_id));
            if ('published' in b) push('published', boolOr(b.published, true));
            if ('sort' in b) push('sort', intOrNull(b.sort) || 0);
            if (!cols.length) return { json: { ok: true } };
            vals.push(id);
            await sql.query(`UPDATE stalls SET ${cols.join(', ')}, updated_at=now() WHERE id=$${vals.length}`, vals);
            return { json: { ok: true } };
        }
        case 'stall.delete': {
            const id = intOrNull(b.id);
            if (!id) throw fail(400, 'Missing stall id');
            // collect images (stall banner + all item images) then delete
            const imgs = await sql.sql`
        SELECT image_id FROM stalls WHERE id=${id} AND image_id IS NOT NULL
        UNION ALL
        SELECT image_id FROM stall_items WHERE stall_id=${id} AND image_id IS NOT NULL`;
            await sql.sql`DELETE FROM stalls WHERE id = ${id}`; // cascades items
            await deleteImages(sql, imgs.rows.map(r => r.image_id));
            return { json: { ok: true } };
        }

        // ── STALL ITEMS ─────────────────────────────────
        case 'item.create': {
            const stall_id = intOrNull(b.stall_id);
            const name = str(b.name, 160);
            if (!stall_id) throw fail(400, 'Missing stall id');
            if (!name) throw fail(400, 'Item name is required');
            const description = str(b.description, 1000);
            const price_cents = priceOrNull(b.price_cents);
            const image_id = intOrNull(b.image_id);
            const available = boolOr(b.available, true);
            const sort = intOrNull(b.sort) || 0;
            const { rows } = await sql.sql`
        INSERT INTO stall_items (stall_id, name, description, price_cents, image_id, available, sort)
        VALUES (${stall_id}, ${name}, ${description}, ${price_cents}, ${image_id}, ${available}, ${sort})
        RETURNING id`;
            return { json: { ok: true, id: rows[0].id } };
        }
        case 'item.update': {
            const id = intOrNull(b.id);
            if (!id) throw fail(400, 'Missing item id');
            if ('image_id' in b) await maybeDropOldImage(sql, 'stall_items', id, intOrNull(b.image_id));
            const cols = [], vals = [];
            const push = (c, v) => { cols.push(`${c}=$${cols.length + 1}`); vals.push(v); };
            if ('name' in b) push('name', str(b.name, 160));
            if ('description' in b) push('description', str(b.description, 1000));
            if ('price_cents' in b) push('price_cents', priceOrNull(b.price_cents));
            if ('image_id' in b) push('image_id', intOrNull(b.image_id));
            if ('available' in b) push('available', boolOr(b.available, true));
            if ('sort' in b) push('sort', intOrNull(b.sort) || 0);
            if (!cols.length) return { json: { ok: true } };
            vals.push(id);
            await sql.query(`UPDATE stall_items SET ${cols.join(', ')} WHERE id=$${vals.length}`, vals);
            return { json: { ok: true } };
        }
        case 'item.delete': {
            const id = intOrNull(b.id);
            if (!id) throw fail(400, 'Missing item id');
            const imgs = await sql.sql`SELECT image_id FROM stall_items WHERE id=${id} AND image_id IS NOT NULL`;
            await sql.sql`DELETE FROM stall_items WHERE id = ${id}`;
            await deleteImages(sql, imgs.rows.map(r => r.image_id));
            return { json: { ok: true } };
        }

        // ── MERCH ───────────────────────────────────────
        case 'merch.create': {
            const name = str(b.name, 160);
            if (!name) throw fail(400, 'Merch name is required');
            const description = str(b.description, 2000);
            const price_cents = priceOrNull(b.price_cents);
            const sizes = str(b.sizes, 120);
            const image_id = intOrNull(b.image_id);
            const available = boolOr(b.available, true);
            const sort = intOrNull(b.sort) || 0;
            const { rows } = await sql.sql`
        INSERT INTO merch (name, description, price_cents, sizes, image_id, available, sort, updated_at)
        VALUES (${name}, ${description}, ${price_cents}, ${sizes}, ${image_id}, ${available}, ${sort}, now())
        RETURNING id`;
            return { json: { ok: true, id: rows[0].id } };
        }
        case 'merch.update': {
            const id = intOrNull(b.id);
            if (!id) throw fail(400, 'Missing merch id');
            if ('image_id' in b) await maybeDropOldImage(sql, 'merch', id, intOrNull(b.image_id));
            const cols = [], vals = [];
            const push = (c, v) => { cols.push(`${c}=$${cols.length + 1}`); vals.push(v); };
            if ('name' in b) push('name', str(b.name, 160));
            if ('description' in b) push('description', str(b.description, 2000));
            if ('price_cents' in b) push('price_cents', priceOrNull(b.price_cents));
            if ('sizes' in b) push('sizes', str(b.sizes, 120));
            if ('image_id' in b) push('image_id', intOrNull(b.image_id));
            if ('available' in b) push('available', boolOr(b.available, true));
            if ('sort' in b) push('sort', intOrNull(b.sort) || 0);
            if (!cols.length) return { json: { ok: true } };
            vals.push(id);
            await sql.query(`UPDATE merch SET ${cols.join(', ')}, updated_at=now() WHERE id=$${vals.length}`, vals);
            return { json: { ok: true } };
        }
        case 'merch.delete': {
            const id = intOrNull(b.id);
            if (!id) throw fail(400, 'Missing merch id');
            const imgs = await sql.sql`SELECT image_id FROM merch WHERE id=${id} AND image_id IS NOT NULL`;
            await sql.sql`DELETE FROM merch WHERE id = ${id}`;
            await deleteImages(sql, imgs.rows.map(r => r.image_id));
            return { json: { ok: true } };
        }

        // ── IMAGES ──────────────────────────────────────
        case 'image.upload': {
            const mime = str(b.mime, 40);
            if (!IMG_MIMES.includes(mime)) throw fail(400, 'Only JPEG or WebP images are allowed');
            const data = typeof b.data === 'string' ? b.data.trim() : '';
            if (!data || !/^[A-Za-z0-9+/]+={0,2}$/.test(data)) throw fail(400, 'Invalid image data');
            let buf;
            try { buf = Buffer.from(data, 'base64'); } catch { throw fail(400, 'Invalid image data'); }
            if (!buf.length) throw fail(400, 'Empty image');
            if (buf.length > MAX_IMG_BYTES) throw fail(413, 'Image too large (max 400 KB after compression)');
            const { rows } = await sql.sql`
        INSERT INTO images (mime, data, bytes) VALUES (${mime}, ${data}, ${buf.length})
        RETURNING id`;
            return { json: { ok: true, id: rows[0].id, bytes: buf.length } };
        }
        case 'image.delete': {
            const id = intOrNull(b.id);
            if (!id) throw fail(400, 'Missing image id');
            await sql.sql`DELETE FROM images WHERE id = ${id}`;
            return { json: { ok: true } };
        }

        default:
            throw fail(400, 'Unknown action');
    }
}

// price: EUR cents, must be >= 0 or null
function priceOrNull(v) {
    const n = intOrNull(v);
    if (n === null) return null;
    if (n < 0) throw fail(400, 'Price cannot be negative');
    return n;
}

// when a row's image is being replaced/cleared, delete the previously referenced image
async function maybeDropOldImage(sql, table, rowId, newImageId) {
    const q = table === 'stalls'
        ? await sql.sql`SELECT image_id FROM stalls WHERE id=${rowId}`
        : table === 'stall_items'
            ? await sql.sql`SELECT image_id FROM stall_items WHERE id=${rowId}`
            : await sql.sql`SELECT image_id FROM merch WHERE id=${rowId}`;
    const old = q.rows.length ? q.rows[0].image_id : null;
    if (old && old !== newImageId) {
        await sql.sql`DELETE FROM images WHERE id=${old}`;
    }
}

async function deleteImages(sql, ids) {
    const clean = (ids || []).filter(Boolean);
    if (!clean.length) return;
    await sql.sql`DELETE FROM images WHERE id = ANY(${clean})`;
}