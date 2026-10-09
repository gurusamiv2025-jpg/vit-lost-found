const express = require('express');
const { requireAuth } = require('../auth');
const { validateItem, validateClaim, HttpError, parseId } = require('../validation');
const { maskContactInfo, alias } = require('../privacy');
const { VENUE_GROUPS, CATEGORIES, CHECKPOINTS } = require('../constants');

const PAGE_SIZE = 12;

// Role names depend on the board: on "found" posts the reporter is the finder,
// on "lost" posts the reporter is the owner and responders are finders.
function roles(type) {
  return type === 'found'
    ? { reporter: 'Finder', claimant: 'Claimant' }
    : { reporter: 'Owner', claimant: 'Finder' };
}

// Public shape of an item. Reporter identity (name, reg. no., email, phone) is never included.
function publicItem(row, viewerId) {
  return {
    id: row.id,
    type: row.type,
    title: maskContactInfo(row.title),
    description: maskContactInfo(row.description),
    category: row.category,
    venue: row.venue,
    eventDate: row.event_date,
    status: row.status,
    createdAt: row.created_at,
    postedBy: alias(roles(row.type).reporter, row.reporter_id, row.id),
    isMine: viewerId != null && row.reporter_id === viewerId,
    claimCount: row.claim_count ?? undefined,
    handoffInProgress: Boolean(row.approved_count),
  };
}

function itemsRouter(db) {
  const router = express.Router();

  router.get('/meta', (_req, res) => {
    res.json({ venueGroups: VENUE_GROUPS, categories: CATEGORIES, checkpoints: CHECKPOINTS });
  });

  router.get('/items', (req, res) => {
    const type = req.query.type === 'lost' ? 'lost' : 'found';
    const where = ["i.status = 'open'", 'i.type = ?'];
    const params = [type];
    if (req.query.venue) {
      where.push('i.venue = ?');
      params.push(String(req.query.venue));
    }
    if (req.query.category) {
      where.push('i.category = ?');
      params.push(String(req.query.category));
    }
    const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 60) : '';
    if (q) {
      where.push("(i.title LIKE ? ESCAPE '\\' OR i.description LIKE ? ESCAPE '\\')");
      const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
      params.push(like, like);
    }
    const page = Math.max(1, Math.min(1000, Number.parseInt(req.query.page, 10) || 1));
    const total = db.prepare(`SELECT COUNT(*) AS n FROM items i WHERE ${where.join(' AND ')}`).get(...params).n;
    const rows = db
      .prepare(
        `SELECT i.*,
           (SELECT COUNT(*) FROM claims c WHERE c.item_id = i.id AND c.status = 'approved') AS approved_count
         FROM items i WHERE ${where.join(' AND ')}
         ORDER BY i.created_at DESC, i.id DESC LIMIT ? OFFSET ?`,
      )
      .all(...params, PAGE_SIZE, (page - 1) * PAGE_SIZE);
    res.json({
      items: rows.map((r) => publicItem(r, req.user?.id)),
      page,
      pageSize: PAGE_SIZE,
      total,
      totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
    });
  });

  router.get('/items/:id', (req, res) => {
    const id = parseId(req.params.id);
    const row = db
      .prepare(
        `SELECT i.*, (SELECT COUNT(*) FROM claims c WHERE c.item_id = i.id AND c.status = 'approved') AS approved_count
         FROM items i WHERE i.id = ?`,
      )
      .get(id);
    if (!row) throw new HttpError(404, 'This item does not exist.');
    const viewerId = req.user?.id;
    const myClaim = viewerId
      ? db.prepare('SELECT id, status, created_at FROM claims WHERE item_id = ? AND claimant_id = ?').get(id, viewerId)
      : undefined;
    const involved = viewerId === row.reporter_id || Boolean(myClaim);
    // Resolved items leave the public boards; only the people involved can still open them.
    if (row.status === 'resolved' && !involved) throw new HttpError(404, 'This item has been resolved and is no longer listed.');
    res.json({
      item: {
        ...publicItem(row, viewerId),
        verificationQuestion: row.verification_question,
        roles: roles(row.type),
      },
      myClaim: myClaim ? { id: myClaim.id, status: myClaim.status, createdAt: myClaim.created_at } : null,
    });
  });

  router.post('/items', requireAuth, (req, res) => {
    const d = validateItem(req.body);
    const { lastInsertRowid } = db
      .prepare(
        `INSERT INTO items (type, title, description, category, venue, event_date, verification_question, reporter_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(d.type, d.title, d.description, d.category, d.venue, d.eventDate, d.verificationQuestion, req.user.id);
    const row = db.prepare('SELECT * FROM items WHERE id = ?').get(lastInsertRowid);
    res.status(201).json({ item: publicItem(row, req.user.id) });
  });

  router.post('/items/:id/claims', requireAuth, (req, res) => {
    const id = parseId(req.params.id);
    const item = db.prepare('SELECT * FROM items WHERE id = ?').get(id);
    if (!item) throw new HttpError(404, 'This item does not exist.');
    if (item.status !== 'open') throw new HttpError(409, 'This item has already been resolved.');
    if (item.reporter_id === req.user.id) throw new HttpError(403, 'You cannot submit a claim on your own post.');
    const existing = db.prepare('SELECT status FROM claims WHERE item_id = ? AND claimant_id = ?').get(id, req.user.id);
    if (existing) throw new HttpError(409, `You have already submitted a request for this item (status: ${existing.status}).`);
    const d = validateClaim(req.body);
    const { lastInsertRowid } = db
      .prepare('INSERT INTO claims (item_id, claimant_id, answer, details) VALUES (?, ?, ?, ?)')
      .run(id, req.user.id, d.answer, d.details);
    res.status(201).json({ claim: { id: Number(lastInsertRowid), status: 'pending' } });
  });

  // Either the reporter or the approved claimant can close the loop once the item is returned.
  router.post('/items/:id/resolve', requireAuth, (req, res) => {
    const id = parseId(req.params.id);
    const item = db.prepare('SELECT * FROM items WHERE id = ?').get(id);
    if (!item) throw new HttpError(404, 'This item does not exist.');
    const approved = db
      .prepare("SELECT 1 FROM claims WHERE item_id = ? AND claimant_id = ? AND status = 'approved'")
      .get(id, req.user.id);
    if (item.reporter_id !== req.user.id && !approved) {
      throw new HttpError(403, 'Only the reporter or an approved claimant can mark this item as resolved.');
    }
    if (item.status === 'resolved') throw new HttpError(409, 'This item is already resolved.');
    db.transaction(() => {
      db.prepare("UPDATE items SET status = 'resolved', resolved_by = ?, resolved_at = datetime('now') WHERE id = ?").run(
        req.user.id,
        id,
      );
      db.prepare(
        "UPDATE claims SET status = 'rejected', decision_note = 'Item was resolved with another claimant.', decided_at = datetime('now') WHERE item_id = ? AND status = 'pending'",
      ).run(id);
    })();
    res.json({ ok: true, status: 'resolved' });
  });

  return router;
}

module.exports = { itemsRouter, roles, publicItem };
