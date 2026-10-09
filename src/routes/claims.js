const express = require('express');
const { requireAuth } = require('../auth');
const { validateDecision, validateMessage, validateMeetup, HttpError, parseId } = require('../validation');
const { maskContactInfo, alias } = require('../privacy');
const { roles, publicItem } = require('./items');

function claimsRouter(db) {
  const router = express.Router();

  // Private dashboard: my posts with the requests they received, and the requests I sent.
  router.get('/dashboard', requireAuth, (req, res) => {
    const me = req.user.id;
    const myItems = db
      .prepare(
        `SELECT i.*, (SELECT COUNT(*) FROM claims c WHERE c.item_id = i.id AND c.status = 'approved') AS approved_count
         FROM items i WHERE i.reporter_id = ? ORDER BY i.status = 'resolved', i.created_at DESC, i.id DESC`,
      )
      .all(me);
    const claimsFor = db.prepare('SELECT * FROM claims WHERE item_id = ? ORDER BY created_at, id');
    const posts = myItems.map((item) => ({
      ...publicItem(item, me),
      verificationQuestion: item.verification_question,
      claims: claimsFor.all(item.id).map((c) => ({
        id: c.id,
        // Claimants are shown by pseudonym only; the reporter decides on the answer, not the person.
        claimant: alias(roles(item.type).claimant, c.claimant_id, item.id),
        answer: c.answer,
        details: maskContactInfo(c.details),
        status: c.status,
        decisionNote: c.decision_note,
        createdAt: c.created_at,
      })),
    }));
    const sent = db
      .prepare(
        `SELECT c.*, i.type, i.title, i.category, i.venue, i.status AS item_status, i.reporter_id, i.verification_question
         FROM claims c JOIN items i ON i.id = c.item_id
         WHERE c.claimant_id = ? ORDER BY c.created_at DESC, c.id DESC`,
      )
      .all(me)
      .map((c) => ({
        id: c.id,
        itemId: c.item_id,
        itemType: c.type,
        itemTitle: maskContactInfo(c.title),
        category: c.category,
        venue: c.venue,
        itemStatus: c.item_status,
        postedBy: alias(roles(c.type).reporter, c.reporter_id, c.item_id),
        verificationQuestion: c.verification_question,
        answer: c.answer,
        status: c.status,
        decisionNote: c.decision_note,
        createdAt: c.created_at,
      }));
    res.json({ posts, claims: sent });
  });

  router.post('/claims/:id/decision', requireAuth, (req, res) => {
    const claim = loadClaim(req.params.id);
    if (claim.reporter_id !== req.user.id) throw new HttpError(403, 'Only the person who posted this item can review its claims.');
    if (claim.item_status !== 'open') throw new HttpError(409, 'This item is already resolved.');
    if (claim.status !== 'pending') throw new HttpError(409, `This claim was already ${claim.status}.`);
    const { decision, note } = validateDecision(req.body);
    const status = decision === 'approve' ? 'approved' : 'rejected';
    db.prepare("UPDATE claims SET status = ?, decision_note = ?, decided_at = datetime('now') WHERE id = ?").run(
      status,
      note,
      claim.id,
    );
    if (status === 'approved') {
      db.prepare('INSERT INTO messages (claim_id, sender_id, body) VALUES (?, ?, ?)').run(
        claim.id,
        req.user.id,
        'Claim approved. Let’s agree on a campus checkpoint and time for the handoff.',
      );
    }
    res.json({ claim: { id: claim.id, status } });
  });

  router.get('/claims/:id/thread', requireAuth, (req, res) => {
    const claim = loadThreadClaim(req.params.id, req.user.id);
    const r = roles(claim.type);
    const nameOf = (userId) =>
      userId === claim.reporter_id ? alias(r.reporter, userId, claim.item_id) : alias(r.claimant, userId, claim.item_id);
    const messages = db
      .prepare('SELECT id, sender_id, body, created_at FROM messages WHERE claim_id = ? ORDER BY id')
      .all(claim.id)
      .map((m) => ({ id: m.id, from: nameOf(m.sender_id), mine: m.sender_id === req.user.id, body: m.body, createdAt: m.created_at }));
    res.json({
      thread: {
        claimId: claim.id,
        item: { id: claim.item_id, type: claim.type, title: maskContactInfo(claim.title), venue: claim.venue, status: claim.item_status },
        me: nameOf(req.user.id),
        other: nameOf(req.user.id === claim.reporter_id ? claim.claimant_id : claim.reporter_id),
        readOnly: claim.item_status === 'resolved',
        meetup: claim.meetup_checkpoint
          ? {
              checkpoint: claim.meetup_checkpoint,
              time: claim.meetup_time,
              proposedBy: nameOf(claim.meetup_proposed_by),
              proposedByMe: claim.meetup_proposed_by === req.user.id,
              confirmed: Boolean(claim.meetup_confirmed),
            }
          : null,
        messages,
      },
    });
  });

  router.post('/claims/:id/messages', requireAuth, (req, res) => {
    const claim = loadThreadClaim(req.params.id, req.user.id, { writable: true });
    const { body } = validateMessage(req.body);
    // Phone numbers and emails are masked so handoffs stay in-app and at public checkpoints.
    const { lastInsertRowid } = db
      .prepare('INSERT INTO messages (claim_id, sender_id, body) VALUES (?, ?, ?)')
      .run(claim.id, req.user.id, maskContactInfo(body));
    res.status(201).json({ message: { id: Number(lastInsertRowid) } });
  });

  router.post('/claims/:id/meetup', requireAuth, (req, res) => {
    const claim = loadThreadClaim(req.params.id, req.user.id, { writable: true });
    const { checkpoint, time } = validateMeetup(req.body);
    db.prepare(
      'UPDATE claims SET meetup_checkpoint = ?, meetup_time = ?, meetup_proposed_by = ?, meetup_confirmed = 0 WHERE id = ?',
    ).run(checkpoint, time, req.user.id, claim.id);
    const when = new Date(time).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', timeStyle: 'short' });
    db.prepare('INSERT INTO messages (claim_id, sender_id, body) VALUES (?, ?, ?)').run(
      claim.id,
      req.user.id,
      `Proposed handoff: ${checkpoint} on ${when} IST.`,
    );
    res.status(201).json({ ok: true });
  });

  router.post('/claims/:id/meetup/confirm', requireAuth, (req, res) => {
    const claim = loadThreadClaim(req.params.id, req.user.id, { writable: true });
    if (!claim.meetup_checkpoint) throw new HttpError(409, 'No meetup has been proposed yet.');
    if (claim.meetup_proposed_by === req.user.id) throw new HttpError(409, 'Wait for the other person to confirm your proposal.');
    if (claim.meetup_confirmed) throw new HttpError(409, 'This meetup is already confirmed.');
    db.prepare('UPDATE claims SET meetup_confirmed = 1 WHERE id = ?').run(claim.id);
    db.prepare('INSERT INTO messages (claim_id, sender_id, body) VALUES (?, ?, ?)').run(
      claim.id,
      req.user.id,
      `Confirmed the handoff at ${claim.meetup_checkpoint}. See you there!`,
    );
    res.json({ ok: true });
  });

  function loadClaim(rawId) {
    const id = parseId(rawId);
    const claim = db
      .prepare(
        `SELECT c.*, i.type, i.title, i.venue, i.status AS item_status, i.reporter_id
         FROM claims c JOIN items i ON i.id = c.item_id WHERE c.id = ?`,
      )
      .get(id);
    if (!claim) throw new HttpError(404, 'This claim does not exist.');
    return claim;
  }

  // Threads exist only for approved claims and only the two parties can open them.
  function loadThreadClaim(rawId, userId, { writable = false } = {}) {
    const claim = loadClaim(rawId);
    if (userId !== claim.reporter_id && userId !== claim.claimant_id) throw new HttpError(404, 'This claim does not exist.');
    if (claim.status !== 'approved') throw new HttpError(403, 'The handoff chat opens once the claim is approved.');
    if (writable && claim.item_status === 'resolved') throw new HttpError(409, 'This item is resolved; the handoff chat is closed.');
    return claim;
  }

  return router;
}

module.exports = { claimsRouter };
