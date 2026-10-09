const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../src/db');
const { createApp } = require('../src/app');
const { maskContactInfo } = require('../src/privacy');

let server;
let base;

before(async () => {
  const db = openDb(':memory:');
  server = createApp(db).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}/api`;
});
after(() => server.close());

async function call(path, { method = 'GET', body, token } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(base + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: res.status, body: await res.json() };
}

let n = 0;
async function register(name) {
  n += 1;
  const res = await call('/auth/register', {
    method: 'POST',
    body: {
      name,
      regNo: `22BCE${String(1000 + n)}`,
      email: `${name.toLowerCase()}${n}@vitstudent.ac.in`,
      phone: `98765${String(10000 + n).slice(-5)}`,
      password: 'Password123',
    },
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.token;
}

const today = new Date().toISOString().slice(0, 10);
const foundItem = {
  type: 'found',
  title: 'ID card near SJT',
  description: 'Blue lanyard ID card. Call me at 9876543210 or mail finder@vitstudent.ac.in, I am 21BCE0001',
  category: 'ID Cards',
  venue: 'SJT',
  eventDate: today,
  verificationQuestion: 'What name/branch is on the ID tag?',
};

test('registration validates VIT-specific fields', async () => {
  const res = await call('/auth/register', {
    method: 'POST',
    body: { name: 'A', regNo: 'abc', email: 'x@gmail.com', phone: '123', password: 'short' },
  });
  assert.equal(res.status, 400);
  assert.deepEqual(Object.keys(res.body.fields).sort(), ['email', 'name', 'password', 'phone', 'regNo']);
});

test('item creation rejects invalid venue, category and question', async () => {
  const token = await register('Val');
  const res = await call('/items', {
    method: 'POST',
    token,
    body: { ...foundItem, venue: 'Somewhere', category: 'Laptops', verificationQuestion: 'no question mark' },
  });
  assert.equal(res.status, 400);
  assert.ok(res.body.fields.venue && res.body.fields.category && res.body.fields.verificationQuestion);
  const unauth = await call('/items', { method: 'POST', body: foundItem });
  assert.equal(unauth.status, 401);
});

test('full workflow: post, mask, claim, approve, handoff, resolve', async () => {
  const finder = await register('Finder');
  const owner = await register('Owner');
  const stranger = await register('Stranger');

  const created = await call('/items', { method: 'POST', token: finder, body: foundItem });
  assert.equal(created.status, 201);
  const id = created.body.item.id;

  // Public listing hides identity and masks contact details.
  const feed = await call('/items?type=found');
  const listed = feed.body.items.find((i) => i.id === id);
  assert.ok(listed);
  const json = JSON.stringify(listed);
  assert.ok(!json.includes('9876543210') && !json.includes('finder@') && !json.includes('21BCE0001'));
  assert.match(listed.postedBy, /^Finder #/);
  assert.equal(listed.reporter_id, undefined);
  assert.equal((await call('/items?type=lost')).body.items.some((i) => i.id === id), false);

  // Finder cannot claim own item; claimant answers the challenge.
  assert.equal((await call(`/items/${id}/claims`, { method: 'POST', token: finder, body: { answer: 'mine' } })).status, 403);
  const claim = await call(`/items/${id}/claims`, { method: 'POST', token: owner, body: { answer: 'Owner, CSE' } });
  assert.equal(claim.status, 201);
  const claimId = claim.body.claim.id;
  assert.equal((await call(`/items/${id}/claims`, { method: 'POST', token: owner, body: { answer: 'again' } })).status, 409);
  await call(`/items/${id}/claims`, { method: 'POST', token: stranger, body: { answer: 'Guess, ECE' } });

  // Chat is closed until approval; only the finder may decide.
  assert.equal((await call(`/claims/${claimId}/thread`, { token: owner })).status, 403);
  assert.equal((await call(`/claims/${claimId}/decision`, { method: 'POST', token: owner, body: { decision: 'approve' } })).status, 403);

  const dash = await call('/dashboard', { token: finder });
  const post = dash.body.posts.find((p) => p.id === id);
  assert.equal(post.claims.length, 2);
  assert.ok(!JSON.stringify(post.claims).includes('Owner1'));
  assert.match(post.claims[0].claimant, /^Claimant #/);

  const ok = await call(`/claims/${claimId}/decision`, { method: 'POST', token: finder, body: { decision: 'approve' } });
  assert.equal(ok.status, 200);

  // Stranger cannot read the private thread.
  assert.equal((await call(`/claims/${claimId}/thread`, { token: stranger })).status, 404);

  const msg = await call(`/claims/${claimId}/messages`, { method: 'POST', token: owner, body: { body: 'Call me on 9123456789' } });
  assert.equal(msg.status, 201);
  const soon = new Date(Date.now() + 3600e3).toISOString();
  assert.equal(
    (await call(`/claims/${claimId}/meetup`, { method: 'POST', token: owner, body: { checkpoint: 'Random Cafe', time: soon } })).status,
    400,
  );
  assert.equal(
    (await call(`/claims/${claimId}/meetup`, { method: 'POST', token: owner, body: { checkpoint: 'SJT Ground Floor Reception', time: soon } }))
      .status,
    201,
  );
  assert.equal((await call(`/claims/${claimId}/meetup/confirm`, { method: 'POST', token: owner })).status, 409);
  assert.equal((await call(`/claims/${claimId}/meetup/confirm`, { method: 'POST', token: finder })).status, 200);

  const thread = (await call(`/claims/${claimId}/thread`, { token: finder })).body.thread;
  assert.equal(thread.meetup.confirmed, true);
  assert.ok(thread.messages.some((m) => m.body.includes('[phone hidden]')));
  assert.ok(!JSON.stringify(thread).includes('9123456789'));

  // Claimant marks it resolved; it leaves the board and stranger's pending claim is closed.
  assert.equal((await call(`/items/${id}/resolve`, { method: 'POST', token: stranger })).status, 403);
  assert.equal((await call(`/items/${id}/resolve`, { method: 'POST', token: owner })).status, 200);
  assert.equal((await call('/items?type=found')).body.items.some((i) => i.id === id), false);
  assert.equal((await call(`/items/${id}`)).status, 404);
  assert.equal((await call(`/items/${id}`, { token: finder })).status, 200);
  const strangerDash = await call('/dashboard', { token: stranger });
  assert.equal(strangerDash.body.claims[0].status, 'rejected');
  assert.equal((await call(`/claims/${claimId}/messages`, { method: 'POST', token: owner, body: { body: 'hi' } })).status, 409);
});

test('lost items flow the other way: finder responds, owner approves', async () => {
  const owner = await register('Loser');
  const finder = await register('Helper');
  const { body } = await call('/items', {
    method: 'POST',
    token: owner,
    body: { ...foundItem, type: 'lost', title: 'Lost wallet', category: 'Wallets', venue: 'Food Mall', verificationQuestion: 'Which bank card is inside?' },
  });
  const item = (await call(`/items/${body.item.id}`)).body.item;
  assert.match(item.postedBy, /^Owner #/);
  const claim = await call(`/items/${item.id}/claims`, { method: 'POST', token: finder, body: { answer: 'SBI debit card' } });
  const ok = await call(`/claims/${claim.body.claim.id}/decision`, { method: 'POST', token: owner, body: { decision: 'reject', note: 'Not mine' } });
  assert.equal(ok.body.claim.status, 'rejected');
});

test('malformed requests get clear errors', async () => {
  const res = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' });
  assert.equal(res.status, 400);
  assert.match((await res.json()).error, /not valid JSON/);
  assert.equal((await call('/items/abc')).status, 404);
  assert.equal((await call('/nope')).status, 404);
  const login = await call('/auth/login', { method: 'POST', body: { email: 'nobody@vitstudent.ac.in', password: 'x' } });
  assert.equal(login.status, 401);
});

test('maskContactInfo redacts phones, emails and reg numbers', () => {
  assert.equal(
    maskContactInfo('ping +91 98765 43210 / a.b@vit.ac.in / 22BCE1234 room 412'),
    'ping [phone hidden] / [email hidden] / [reg. no. hidden] room 412',
  );
});
