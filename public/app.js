'use strict';

// ---------- State & helpers ----------
const state = {
  token: localStorage.getItem('lf_token'),
  user: JSON.parse(localStorage.getItem('lf_user') || 'null'),
  meta: null,
  pollTimer: null,
};

const $app = document.getElementById('app');
const $nav = document.getElementById('nav');
const $toast = document.getElementById('toast');

const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function fmtDate(value, withTime = false) {
  if (!value) return '';
  const d = new Date(/Z$|[+-]\d\d:\d\d$/.test(value) ? value : `${value.replace(' ', 'T')}Z`);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', dateStyle: 'medium', ...(withTime ? { timeStyle: 'short' } : {}) });
}

function timeAgo(value) {
  const d = new Date(`${String(value).replace(' ', 'T')}Z`);
  const s = Math.round((Date.now() - d.getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

class ApiError extends Error {
  constructor(message, status, fields) {
    super(message);
    this.status = status;
    this.fields = fields || {};
  }
}

async function api(path, { method = 'GET', body } = {}) {
  const headers = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  let res;
  try {
    res = await fetch(`/api${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch {
    throw new ApiError('Cannot reach the server. Check your connection and try again.', 0);
  }
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && state.token && !path.startsWith('/auth/login')) {
    setSession(null);
    toast('Your session expired. Please log in again.', 'error');
    location.hash = `#/login?next=${encodeURIComponent(location.hash.slice(1))}`;
  }
  if (!res.ok) throw new ApiError(data.error || `Request failed (${res.status}).`, res.status, data.fields);
  return data;
}

function setSession(session) {
  state.token = session?.token || null;
  state.user = session?.user || null;
  if (session) {
    localStorage.setItem('lf_token', session.token);
    localStorage.setItem('lf_user', JSON.stringify(session.user));
  } else {
    localStorage.removeItem('lf_token');
    localStorage.removeItem('lf_user');
  }
  renderNav();
}

let toastTimer;
function toast(message, kind = 'success') {
  $toast.textContent = message;
  $toast.className = `toast toast-${kind}`;
  $toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($toast.hidden = true), 3500);
}

const loadingView = (label = 'Loading…') =>
  `<div class="state state-loading"><span class="spinner" aria-hidden="true"></span><p>${esc(label)}</p></div>`;

const errorView = (message, retry = true) =>
  `<div class="state state-error"><p class="state-title">Something went wrong</p><p>${esc(message)}</p>${
    retry ? '<button class="btn" data-action="retry">Try again</button>' : ''
  }</div>`;

const emptyView = (title, text, cta = '') =>
  `<div class="state state-empty"><div class="state-icon" aria-hidden="true">∅</div><p class="state-title">${esc(title)}</p><p>${esc(
    text,
  )}</p>${cta}</div>`;

const badge = (status) => `<span class="badge badge-${esc(status)}">${esc(status)}</span>`;

async function getMeta() {
  if (!state.meta) state.meta = await api('/meta');
  return state.meta;
}

function venueOptions(selected = '', placeholder = 'Select a venue') {
  const groups = Object.entries(state.meta.venueGroups)
    .map(
      ([group, venues]) =>
        `<optgroup label="${esc(group)}">${venues
          .map((v) => `<option value="${esc(v)}" ${v === selected ? 'selected' : ''}>${esc(v)}</option>`)
          .join('')}</optgroup>`,
    )
    .join('');
  return `<option value="">${esc(placeholder)}</option>${groups}`;
}

function options(list, selected = '', placeholder) {
  return `<option value="">${esc(placeholder)}</option>${list
    .map((v) => `<option value="${esc(v)}" ${v === selected ? 'selected' : ''}>${esc(v)}</option>`)
    .join('')}`;
}

// Shows server or client field errors next to inputs and focuses the first one.
function showFieldErrors(form, fields) {
  form.querySelectorAll('.field-error').forEach((el) => (el.textContent = ''));
  form.querySelectorAll('.invalid').forEach((el) => el.classList.remove('invalid'));
  let first;
  for (const [name, msg] of Object.entries(fields || {})) {
    const input = form.elements[name];
    const slot = form.querySelector(`[data-error-for="${name}"]`);
    if (slot) slot.textContent = msg;
    if (input) {
      input.classList.add('invalid');
      input.setAttribute('aria-invalid', 'true');
      first = first || input;
    }
  }
  if (first) first.focus();
}

function formBanner(form, message) {
  const el = form.querySelector('.form-banner');
  if (!el) return;
  el.textContent = message || '';
  el.hidden = !message;
}

// Wraps a form submit with loading/disabled state and error rendering.
function handleSubmit(form, fn, { validate } = {}) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    const clientErrors = validate ? validate(data) : {};
    showFieldErrors(form, clientErrors);
    formBanner(form, '');
    if (Object.keys(clientErrors).length) {
      formBanner(form, 'Please fix the highlighted fields.');
      return;
    }
    const btn = form.querySelector('button[type="submit"]');
    const label = btn.textContent;
    btn.disabled = true;
    btn.classList.add('loading');
    btn.textContent = btn.dataset.loading || 'Submitting…';
    try {
      await fn(data);
    } catch (err) {
      showFieldErrors(form, err.fields);
      formBanner(form, err.message);
    } finally {
      if (form.isConnected) {
        btn.disabled = false;
        btn.classList.remove('loading');
        btn.textContent = label;
      }
    }
  });
}

const field = (name, label, control, hint = '') =>
  `<div class="field"><label for="f-${name}">${esc(label)}</label>${control}${
    hint ? `<p class="hint">${esc(hint)}</p>` : ''
  }<p class="field-error" data-error-for="${name}" role="alert"></p></div>`;

function requireLogin() {
  if (state.user) return true;
  location.hash = `#/login?next=${encodeURIComponent(location.hash.slice(1))}`;
  return false;
}

// ---------- Navigation ----------
function renderNav() {
  const route = location.hash.split('?')[0] || '#/found';
  const link = (href, text) => `<a href="${href}" class="${route === href ? 'active' : ''}">${text}</a>`;
  $nav.innerHTML = [
    link('#/found', 'Found'),
    link('#/lost', 'Lost'),
    link('#/report', '+ Report'),
    state.user ? link('#/dashboard', 'Dashboard') : '',
    state.user
      ? `<button class="linklike" data-action="logout">Log out</button>`
      : link('#/login', 'Log in'),
  ].join('');
}

$nav.addEventListener('click', (e) => {
  if (e.target.dataset.action === 'logout') {
    setSession(null);
    toast('You have been logged out.');
    location.hash = '#/found';
  }
});

// ---------- Views ----------
async function feedView(type, params) {
  await getMeta();
  const venue = params.get('venue') || '';
  const category = params.get('category') || '';
  const q = params.get('q') || '';
  const page = Number(params.get('page')) || 1;
  const other = type === 'found' ? 'lost' : 'found';

  $app.innerHTML = `
    <section class="hero">
      <div>
        <h1>${type === 'found' ? 'Found on campus' : 'Lost on campus'}</h1>
        <p>${
          type === 'found'
            ? 'Items students have picked up. Recognise yours? Answer the finder’s verification question to claim it.'
            : 'Items students are looking for. Found one? Respond privately so the owner can verify and arrange a return.'
        }</p>
      </div>
      <a class="btn btn-primary" href="#/report?type=${type}">Report a ${type} item</a>
    </section>
    <div class="tabs" role="tablist">
      <a role="tab" class="tab ${type === 'found' ? 'active' : ''}" href="#/found">Found items</a>
      <a role="tab" class="tab ${type === 'lost' ? 'active' : ''}" href="#/lost">Lost items</a>
    </div>
    <form class="filters" id="filters">
      <input type="search" name="q" placeholder="Search title or description" value="${esc(q)}" maxlength="60" aria-label="Search" />
      <select name="venue" aria-label="Venue">${venueOptions(venue, 'All venues')}</select>
      <select name="category" aria-label="Category">${options(state.meta.categories, category, 'All categories')}</select>
      <button class="btn" type="submit">Filter</button>
      ${venue || category || q ? `<a class="btn btn-ghost" href="#/${type}">Clear</a>` : ''}
    </form>
    <div id="results">${loadingView('Loading items…')}</div>`;

  document.getElementById('filters').addEventListener('submit', (e) => {
    e.preventDefault();
    const fd = new URLSearchParams();
    for (const [k, v] of new FormData(e.target)) if (v) fd.set(k, v);
    location.hash = `#/${type}${fd.toString() ? `?${fd}` : ''}`;
  });

  const qs = new URLSearchParams({ type, page: String(page) });
  if (venue) qs.set('venue', venue);
  if (category) qs.set('category', category);
  if (q) qs.set('q', q);
  const $results = document.getElementById('results');
  try {
    const data = await api(`/items?${qs}`);
    if (!data.items.length) {
      $results.innerHTML = emptyView(
        venue || category || q ? 'No matching items' : `No ${type} items right now`,
        venue || category || q
          ? 'Try a different venue, category or search term.'
          : `Nothing has been reported as ${type} yet. Check the ${other} board too.`,
        `<a class="btn" href="#/report?type=${type}">Report a ${type} item</a>`,
      );
      return;
    }
    const pager = (p) => {
      const n = new URLSearchParams(params);
      n.set('page', String(p));
      return `#/${type}?${n}`;
    };
    $results.innerHTML = `
      <p class="muted">${data.total} active ${type} item${data.total === 1 ? '' : 's'}</p>
      <div class="grid">${data.items.map(itemCard).join('')}</div>
      ${
        data.totalPages > 1
          ? `<nav class="pager">${data.page > 1 ? `<a class="btn" href="${pager(data.page - 1)}">← Newer</a>` : '<span></span>'}
             <span class="muted">Page ${data.page} of ${data.totalPages}</span>
             ${data.page < data.totalPages ? `<a class="btn" href="${pager(data.page + 1)}">Older →</a>` : '<span></span>'}</nav>`
          : ''
      }`;
  } catch (err) {
    $results.innerHTML = errorView(err.message);
  }
}

function itemCard(item) {
  return `
    <a class="card item-card" href="#/item/${item.id}">
      <div class="card-top">
        <span class="chip chip-${item.type}">${item.type === 'found' ? 'Found' : 'Lost'}</span>
        <span class="chip">${esc(item.category)}</span>
        ${item.handoffInProgress ? '<span class="chip chip-handoff">Handoff in progress</span>' : ''}
        ${item.isMine ? '<span class="chip chip-mine">Your post</span>' : ''}
      </div>
      <h3>${esc(item.title)}</h3>
      <p class="clamp">${esc(item.description)}</p>
      <div class="card-meta">
        <span>📍 ${esc(item.venue)}</span>
        <span>📅 ${esc(fmtDate(item.eventDate))}</span>
      </div>
      <div class="card-foot muted">Posted by ${esc(item.postedBy)} · ${esc(timeAgo(item.createdAt))}</div>
    </a>`;
}

async function itemView(id) {
  $app.innerHTML = loadingView('Loading item…');
  let data;
  try {
    data = await api(`/items/${encodeURIComponent(id)}`);
  } catch (err) {
    $app.innerHTML = err.status === 404 ? emptyView('Item not available', err.message, '<a class="btn" href="#/found">Back to boards</a>') : errorView(err.message);
    return;
  }
  const { item, myClaim } = data;
  const verb = item.type === 'found' ? 'Claim this item' : 'I found this item';

  let action;
  if (item.status === 'resolved') {
    action = `<div class="notice notice-success">This item has been marked <strong>resolved</strong> and is no longer on the public boards.</div>`;
  } else if (item.isMine) {
    action = `<div class="notice">This is your post. Review incoming requests from your <a href="#/dashboard">dashboard</a>.</div>
      <button class="btn btn-ghost" data-action="resolve">Mark as resolved</button>`;
  } else if (myClaim) {
    action = `<div class="notice ${myClaim.status === 'rejected' ? 'notice-error' : myClaim.status === 'approved' ? 'notice-success' : ''}">
      You submitted a request ${esc(timeAgo(myClaim.createdAt))}. Status: ${badge(myClaim.status)}
      ${myClaim.status === 'approved' ? `<p><a class="btn btn-primary" href="#/thread/${myClaim.id}">Open handoff chat</a></p>` : ''}
      ${myClaim.status === 'pending' ? `<p class="muted">The ${esc(item.roles.reporter.toLowerCase())} will review your answer privately.</p>` : ''}
    </div>`;
  } else if (!state.user) {
    action = `<div class="notice">To ${item.type === 'found' ? 'claim' : 'respond to'} this item, <a href="#/login?next=${encodeURIComponent(
      `/item/${item.id}`,
    )}">log in</a> or <a href="#/register">create an account</a>.</div>`;
  } else {
    action = `
      <form id="claim-form" class="panel" novalidate>
        <h3>${verb}</h3>
        <p class="muted">${
          item.type === 'found'
            ? 'Answer the finder’s verification challenge. Only the finder sees your answer, and neither of you sees the other’s contact details.'
            : 'Answer the owner’s question so they can confirm it is their item. Your identity stays private.'
        }</p>
        <div class="challenge"><span>Verification challenge</span><strong>${esc(item.verificationQuestion)}</strong></div>
        <div class="form-banner" role="alert" hidden></div>
        ${field('answer', 'Your answer', '<input id="f-answer" name="answer" maxlength="300" required />')}
        ${field(
          'details',
          'Anything else that helps (optional)',
          '<textarea id="f-details" name="details" rows="3" maxlength="500"></textarea>',
          'Do not share phone numbers or emails; they are hidden automatically.',
        )}
        <button class="btn btn-primary" type="submit" data-loading="Submitting request…">Submit verification request</button>
      </form>`;
  }

  $app.innerHTML = `
    <a class="back" href="#/${item.type}">← Back to ${item.type} items</a>
    <article class="detail">
      <div class="card-top">
        <span class="chip chip-${item.type}">${item.type === 'found' ? 'Found' : 'Lost'}</span>
        <span class="chip">${esc(item.category)}</span>
        ${item.status === 'resolved' ? badge('resolved') : ''}
        ${item.handoffInProgress && item.status !== 'resolved' ? '<span class="chip chip-handoff">Handoff in progress</span>' : ''}
      </div>
      <h1>${esc(item.title)}</h1>
      <dl class="facts">
        <div><dt>Venue</dt><dd>${esc(item.venue)}</dd></div>
        <div><dt>${item.type === 'found' ? 'Found on' : 'Lost on'}</dt><dd>${esc(fmtDate(item.eventDate))}</dd></div>
        <div><dt>Posted by</dt><dd>${esc(item.postedBy)} <span class="muted">(identity hidden)</span></dd></div>
      </dl>
      <p class="description">${esc(item.description)}</p>
    </article>
    <section class="action">${action}</section>`;

  const form = document.getElementById('claim-form');
  if (form) {
    handleSubmit(
      form,
      async (d) => {
        await api(`/items/${item.id}/claims`, { method: 'POST', body: d });
        form.outerHTML = `<div class="notice notice-success submitted"><strong>Request submitted.</strong> The ${esc(
          item.roles.reporter.toLowerCase(),
        )} will review it privately. Track its status on your <a href="#/dashboard">dashboard</a>.</div>`;
        toast('Verification request submitted.');
      },
      { validate: (d) => (d.answer.trim().length < 2 ? { answer: 'Answer must be at least 2 characters.' } : {}) },
    );
  }
  bindResolve(item.id, () => itemView(id));
}

function bindResolve(itemId, after) {
  document.querySelectorAll('[data-action="resolve"]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      if (!confirm('Mark this item as resolved? It will be removed from the public boards.')) return;
      btn.disabled = true;
      btn.textContent = 'Resolving…';
      try {
        await api(`/items/${btn.dataset.item || itemId}/resolve`, { method: 'POST' });
        toast('Marked as resolved. It has been removed from the boards.');
        after();
      } catch (err) {
        toast(err.message, 'error');
        btn.disabled = false;
        btn.textContent = 'Mark as resolved';
      }
    }),
  );
}

async function reportView(params) {
  if (!requireLogin()) return;
  $app.innerHTML = loadingView();
  try {
    await getMeta();
  } catch (err) {
    $app.innerHTML = errorView(err.message);
    return;
  }
  const type = params.get('type') === 'lost' ? 'lost' : 'found';
  const today = new Date().toISOString().slice(0, 10);
  $app.innerHTML = `
    <form id="report-form" class="panel narrow" novalidate>
      <h1>Report an item</h1>
      <p class="muted">Your name, registration number, email and phone are never shown on the public boards.</p>
      <div class="form-banner" role="alert" hidden></div>
      <div class="segmented" role="radiogroup" aria-label="Report type">
        <label><input type="radio" name="type" value="found" ${type === 'found' ? 'checked' : ''}/> I found something</label>
        <label><input type="radio" name="type" value="lost" ${type === 'lost' ? 'checked' : ''}/> I lost something</label>
      </div>
      <p class="field-error" data-error-for="type"></p>
      ${field('title', 'Title', '<input id="f-title" name="title" maxlength="80" placeholder="e.g. VIT ID card with blue lanyard" required />')}
      <div class="row">
        ${field('category', 'Category', `<select id="f-category" name="category" required>${options(state.meta.categories, '', 'Select a category')}</select>`)}
        ${field('venue', 'Campus venue', `<select id="f-venue" name="venue" required>${venueOptions()}</select>`)}
      </div>
      ${field('eventDate', 'Date', `<input id="f-eventDate" type="date" name="eventDate" max="${today}" value="${today}" required />`)}
      ${field(
        'description',
        'Description',
        '<textarea id="f-description" name="description" rows="4" maxlength="1000" required placeholder="Where exactly, what it looks like, anything distinctive (but keep the secret detail for the question below)"></textarea>',
        'Contact details typed here are masked automatically.',
      )}
      ${field(
        'verificationQuestion',
        'Verification challenge',
        '<input id="f-verificationQuestion" name="verificationQuestion" maxlength="200" required placeholder="What name/branch is on the ID tag?" />',
        'Ask something only the real owner (or finder) would know. Do not reveal the answer in the description.',
      )}
      <button class="btn btn-primary" type="submit" data-loading="Posting…">Post to board</button>
    </form>`;

  const form = document.getElementById('report-form');
  handleSubmit(
    form,
    async (d) => {
      const { item } = await api('/items', { method: 'POST', body: d });
      toast(`Posted to the ${item.type} board.`);
      location.hash = `#/item/${item.id}`;
    },
    {
      validate: (d) => {
        const e = {};
        if (!d.type) e.type = 'Choose whether the item was lost or found.';
        if ((d.title || '').trim().length < 3) e.title = 'Title must be at least 3 characters.';
        if (!d.category) e.category = 'Pick a category.';
        if (!d.venue) e.venue = 'Pick a campus venue.';
        if (!d.eventDate) e.eventDate = 'Pick a date.';
        else if (d.eventDate > today) e.eventDate = 'The date cannot be in the future.';
        if ((d.description || '').trim().length < 10) e.description = 'Description must be at least 10 characters.';
        const vq = (d.verificationQuestion || '').trim();
        if (vq.length < 8) e.verificationQuestion = 'Verification question must be at least 8 characters.';
        else if (!vq.endsWith('?')) e.verificationQuestion = 'Phrase it as a question ending with "?".';
        return e;
      },
    },
  );
}

async function dashboardView() {
  if (!requireLogin()) return;
  $app.innerHTML = `<h1>Your dashboard</h1>${loadingView('Loading your posts and requests…')}`;
  let data;
  try {
    data = await api('/dashboard');
  } catch (err) {
    $app.innerHTML = `<h1>Your dashboard</h1>${errorView(err.message)}`;
    return;
  }
  const pendingTotal = data.posts.reduce((n, p) => n + p.claims.filter((c) => c.status === 'pending').length, 0);

  const postsHtml = data.posts.length
    ? data.posts.map(postPanel).join('')
    : emptyView('No posts yet', 'Items you report will appear here with the requests they receive.', '<a class="btn" href="#/report">Report an item</a>');

  const claimsHtml = data.claims.length
    ? `<div class="list">${data.claims
        .map(
          (c) => `
        <div class="card claim-row">
          <div>
            <a href="#/item/${c.itemId}"><strong>${esc(c.itemTitle)}</strong></a>
            <div class="muted">${esc(c.venue)} · ${esc(c.category)} · posted by ${esc(c.postedBy)}</div>
            <div class="qa"><span>Q:</span> ${esc(c.verificationQuestion)}<br /><span>A:</span> ${esc(c.answer)}</div>
            ${c.decisionNote ? `<div class="muted">Note: ${esc(c.decisionNote)}</div>` : ''}
          </div>
          <div class="claim-actions">
            ${c.itemStatus === 'resolved' && c.status === 'approved' ? badge('resolved') : badge(c.status)}
            ${c.status === 'approved' ? `<a class="btn btn-primary" href="#/thread/${c.id}">${c.itemStatus === 'resolved' ? 'View chat' : 'Handoff chat'}</a>` : ''}
          </div>
        </div>`,
        )
        .join('')}</div>`
    : emptyView('No requests sent', 'When you claim a found item or respond to a lost item, it shows up here.', '<a class="btn" href="#/found">Browse found items</a>');

  $app.innerHTML = `
    <h1>Your dashboard</h1>
    <p class="muted">Only you can see this page. ${pendingTotal ? `<strong>${pendingTotal} request${pendingTotal === 1 ? '' : 's'} waiting for your review.</strong>` : ''}</p>
    <h2>My posts</h2>
    ${postsHtml}
    <h2>Requests I sent</h2>
    ${claimsHtml}`;

  $app.querySelectorAll('[data-decision]').forEach((btn) =>
    btn.addEventListener('click', async () => {
      const { decision, claim } = btn.dataset;
      const noteInput = $app.querySelector(`[data-note-for="${claim}"]`);
      const row = btn.closest('.claim');
      row.querySelectorAll('button').forEach((b) => (b.disabled = true));
      btn.textContent = decision === 'approve' ? 'Approving…' : 'Rejecting…';
      try {
        await api(`/claims/${claim}/decision`, { method: 'POST', body: { decision, note: noteInput?.value || '' } });
        toast(decision === 'approve' ? 'Claim approved. A private handoff chat is now open.' : 'Claim rejected.');
        dashboardView();
      } catch (err) {
        toast(err.message, 'error');
        dashboardView();
      }
    }),
  );
  bindResolve(null, dashboardView);
}

function postPanel(p) {
  const claims = p.claims.length
    ? p.claims
        .map(
          (c) => `
      <div class="claim">
        <div class="claim-head"><strong>${esc(c.claimant)}</strong> ${badge(c.status)} <span class="muted">${esc(timeAgo(c.createdAt))}</span></div>
        <div class="qa"><span>A:</span> ${esc(c.answer)}${c.details ? `<br /><span>Note:</span> ${esc(c.details)}` : ''}</div>
        ${
          c.status === 'pending' && p.status === 'open'
            ? `<div class="decide">
                <input data-note-for="${c.id}" maxlength="300" placeholder="Optional note to the requester" aria-label="Decision note" />
                <button class="btn btn-success" data-decision="approve" data-claim="${c.id}">Approve</button>
                <button class="btn btn-danger" data-decision="reject" data-claim="${c.id}">Reject</button>
              </div>`
            : ''
        }
        ${c.status === 'approved' ? `<a class="btn btn-primary btn-sm" href="#/thread/${c.id}">${p.status === 'resolved' ? 'View chat' : 'Open handoff chat'}</a>` : ''}
      </div>`,
        )
        .join('')
    : '<p class="muted">No requests yet.</p>';
  return `
    <div class="card post">
      <div class="post-head">
        <div>
          <span class="chip chip-${p.type}">${p.type}</span>
          <a href="#/item/${p.id}"><strong>${esc(p.title)}</strong></a>
          <div class="muted">${esc(p.venue)} · ${esc(p.category)} · ${esc(fmtDate(p.eventDate))}</div>
        </div>
        <div>${p.status === 'resolved' ? badge('resolved') : `<button class="btn btn-ghost btn-sm" data-action="resolve" data-item="${p.id}">Mark resolved</button>`}</div>
      </div>
      <div class="qa"><span>Your challenge:</span> ${esc(p.verificationQuestion)}</div>
      <div class="claims">${claims}</div>
    </div>`;
}

async function threadView(claimId) {
  if (!requireLogin()) return;
  $app.innerHTML = loadingView('Opening handoff chat…');
  await getMeta().catch(() => {});

  async function load(first) {
    let data;
    try {
      data = await api(`/claims/${encodeURIComponent(claimId)}/thread`);
    } catch (err) {
      if (first) $app.innerHTML = err.status === 403 || err.status === 404 ? emptyView('Chat not available', err.message, '<a class="btn" href="#/dashboard">Back to dashboard</a>') : errorView(err.message);
      return null;
    }
    return data.thread;
  }

  const t = await load(true);
  if (!t) return;
  const minTime = new Date(Date.now() + 15 * 60e3);
  const localIso = new Date(minTime.getTime() - minTime.getTimezoneOffset() * 60e3).toISOString().slice(0, 16);

  $app.innerHTML = `
    <a class="back" href="#/dashboard">← Dashboard</a>
    <div class="thread-head">
      <div>
        <h1>Handoff: ${esc(t.item.title)}</h1>
        <p class="muted">You are <strong>${esc(t.me)}</strong>, chatting with <strong>${esc(t.other)}</strong>. Real names and numbers stay hidden; meet only at an official checkpoint.</p>
      </div>
      <div id="resolve-slot"></div>
    </div>
    <div class="thread-layout">
      <section class="panel chat">
        <div id="messages" class="messages"></div>
        <form id="msg-form" class="msg-form" novalidate>
          <input name="body" maxlength="1000" placeholder="Write a message…" aria-label="Message" autocomplete="off" />
          <button class="btn btn-primary" type="submit" data-loading="Sending…">Send</button>
          <p class="field-error" data-error-for="body"></p>
          <div class="form-banner" role="alert" hidden></div>
        </form>
      </section>
      <aside class="panel">
        <h3>Meetup checkpoint</h3>
        <div id="meetup"></div>
        <form id="meetup-form" novalidate>
          <div class="form-banner" role="alert" hidden></div>
          ${field('checkpoint', 'Checkpoint', `<select id="f-checkpoint" name="checkpoint">${options(state.meta?.checkpoints || [], '', 'Choose a checkpoint')}</select>`)}
          ${field('time', 'Date & time', `<input id="f-time" type="datetime-local" name="time" min="${localIso}" />`)}
          <button class="btn" type="submit" data-loading="Proposing…">Propose meetup</button>
        </form>
      </aside>
    </div>`;

  let lastCount = -1;
  function paint(th) {
    const $m = document.getElementById('messages');
    if (!$m) return;
    if (th.messages.length !== lastCount) {
      const nearBottom = $m.scrollHeight - $m.scrollTop - $m.clientHeight < 80;
      $m.innerHTML = th.messages.length
        ? th.messages
            .map(
              (m) => `<div class="msg ${m.mine ? 'mine' : ''}"><div class="msg-meta">${esc(m.mine ? 'You' : m.from)} · ${esc(fmtDate(m.createdAt, true))}</div><div class="msg-body">${esc(m.body)}</div></div>`,
            )
            .join('')
        : emptyView('No messages yet', 'Say hello and agree on a checkpoint.');
      if (nearBottom || lastCount === -1) $m.scrollTop = $m.scrollHeight;
      lastCount = th.messages.length;
    }
    const mt = th.meetup;
    document.getElementById('meetup').innerHTML = mt
      ? `<div class="notice ${mt.confirmed ? 'notice-success' : ''}">
          <strong>${esc(mt.checkpoint)}</strong><br />${esc(fmtDate(mt.time, true))}<br />
          <span class="muted">Proposed by ${esc(mt.proposedByMe ? 'you' : mt.proposedBy)}</span> · ${mt.confirmed ? badge('confirmed') : badge('pending')}
          ${!mt.confirmed && !mt.proposedByMe && !th.readOnly ? '<p><button class="btn btn-success btn-sm" data-action="confirm">Confirm this meetup</button></p>' : ''}
        </div>`
      : '<p class="muted">No meetup proposed yet.</p>';
    document.getElementById('resolve-slot').innerHTML = th.readOnly
      ? badge('resolved')
      : `<button class="btn btn-success" data-action="resolve" data-item="${th.item.id}">Item returned — mark resolved</button>`;
    bindResolve(th.item.id, () => threadView(claimId));
    if (th.readOnly) {
      document.getElementById('msg-form').innerHTML = '<p class="muted">This item is resolved. The chat is closed.</p>';
      document.getElementById('meetup-form').hidden = true;
    }
  }
  paint(t);

  document.getElementById('meetup').addEventListener('click', async (e) => {
    if (e.target.dataset.action !== 'confirm') return;
    e.target.disabled = true;
    e.target.textContent = 'Confirming…';
    try {
      await api(`/claims/${claimId}/meetup/confirm`, { method: 'POST' });
      toast('Meetup confirmed.');
      refresh();
    } catch (err) {
      toast(err.message, 'error');
      refresh();
    }
  });

  const msgForm = document.getElementById('msg-form');
  if (!t.readOnly) {
    handleSubmit(
      msgForm,
      async (d) => {
        await api(`/claims/${claimId}/messages`, { method: 'POST', body: d });
        msgForm.reset();
        await refresh();
      },
      { validate: (d) => (!d.body?.trim() ? { body: 'Type a message first.' } : {}) },
    );
    handleSubmit(
      document.getElementById('meetup-form'),
      async (d) => {
        const body = { checkpoint: d.checkpoint, time: d.time ? new Date(d.time).toISOString() : '' };
        await api(`/claims/${claimId}/meetup`, { method: 'POST', body });
        document.getElementById('meetup-form').reset();
        toast('Meetup proposed. Waiting for the other person to confirm.');
        await refresh();
      },
      {
        validate: (d) => {
          const e = {};
          if (!d.checkpoint) e.checkpoint = 'Choose a checkpoint.';
          if (!d.time) e.time = 'Pick a date and time.';
          else if (new Date(d.time) < new Date()) e.time = 'Pick a time in the future.';
          return e;
        },
      },
    );
  }

  async function refresh() {
    const th = await load(false);
    if (th) paint(th);
  }
  state.pollTimer = setInterval(refresh, 5000);
}

function authView(mode, params) {
  const next = params.get('next') || '/dashboard';
  const isLogin = mode === 'login';
  $app.innerHTML = `
    <form id="auth-form" class="panel narrow" novalidate>
      <h1>${isLogin ? 'Log in' : 'Create your account'}</h1>
      <p class="muted">${
        isLogin ? 'Use your VIT student email.' : 'Your registration number, email and phone are kept private and never shown to other students.'
      }</p>
      <div class="form-banner" role="alert" hidden></div>
      ${isLogin ? '' : field('name', 'Full name', '<input id="f-name" name="name" maxlength="60" autocomplete="name" required />')}
      ${isLogin ? '' : field('regNo', 'Registration number', '<input id="f-regNo" name="regNo" maxlength="9" placeholder="22BCE1234" autocomplete="off" required />')}
      ${field('email', 'VIT email', '<input id="f-email" type="email" name="email" placeholder="name@vitstudent.ac.in" autocomplete="email" required />')}
      ${isLogin ? '' : field('phone', 'Mobile number', '<input id="f-phone" type="tel" name="phone" maxlength="14" placeholder="98XXXXXXXX" autocomplete="tel" required />', 'Stored privately. Never displayed or shared.')}
      ${field('password', 'Password', `<input id="f-password" type="password" name="password" autocomplete="${isLogin ? 'current-password' : 'new-password'}" required />`, isLogin ? '' : 'At least 8 characters with a letter and a number.')}
      <button class="btn btn-primary" type="submit" data-loading="${isLogin ? 'Logging in…' : 'Creating account…'}">${isLogin ? 'Log in' : 'Create account'}</button>
      <p class="muted center">${
        isLogin
          ? `New here? <a href="#/register?next=${encodeURIComponent(next)}">Create an account</a>`
          : `Already registered? <a href="#/login?next=${encodeURIComponent(next)}">Log in</a>`
      }</p>
      ${isLogin ? '<p class="hint center">Demo: aarav.sharma2022@vitstudent.ac.in / Password123 (after <code>npm run db:seed</code>)</p>' : ''}
    </form>`;

  const form = document.getElementById('auth-form');
  handleSubmit(
    form,
    async (d) => {
      const session = await api(isLogin ? '/auth/login' : '/auth/register', { method: 'POST', body: d });
      setSession(session);
      toast(isLogin ? `Welcome back, ${session.user.name}.` : 'Account created. Welcome!');
      location.hash = `#${next}`;
    },
    {
      validate: (d) => {
        const e = {};
        if (!/^[^@\s]+@vitstudent\.ac\.in$/i.test((d.email || '').trim())) e.email = 'Use your @vitstudent.ac.in email.';
        if (!d.password) e.password = 'Password is required.';
        if (!isLogin) {
          if ((d.name || '').trim().length < 2) e.name = 'Name must be at least 2 characters.';
          if (!/^\d{2}[A-Za-z]{3}\d{4}$/.test((d.regNo || '').trim())) e.regNo = 'Registration number must look like 22BCE1234.';
          if (!/^(\+91)?[6-9]\d{9}$/.test((d.phone || '').replace(/[\s-]/g, ''))) e.phone = 'Enter a valid 10-digit mobile number.';
          if (d.password && (d.password.length < 8 || !/[A-Za-z]/.test(d.password) || !/\d/.test(d.password))) {
            e.password = 'At least 8 characters with a letter and a number.';
          }
        }
        return e;
      },
    },
  );
}

// ---------- Router ----------
async function route() {
  clearInterval(state.pollTimer);
  const raw = location.hash.slice(1) || '/found';
  const [path, query = ''] = raw.split('?');
  const params = new URLSearchParams(query);
  const parts = path.split('/').filter(Boolean);
  renderNav();
  window.scrollTo(0, 0);
  try {
    switch (parts[0]) {
      case 'found':
      case 'lost':
        return await feedView(parts[0], params);
      case 'item':
        return await itemView(parts[1]);
      case 'report':
        return await reportView(params);
      case 'dashboard':
        return await dashboardView();
      case 'thread':
        return await threadView(parts[1]);
      case 'login':
      case 'register':
        if (state.user) {
          location.hash = '#/dashboard';
          return;
        }
        return authView(parts[0], params);
      default:
        $app.innerHTML = emptyView('Page not found', 'That page does not exist.', '<a class="btn" href="#/found">Go to boards</a>');
    }
  } catch (err) {
    $app.innerHTML = errorView(err.message);
  }
}

$app.addEventListener('click', (e) => {
  if (e.target.dataset.action === 'retry') route();
});
window.addEventListener('hashchange', route);
route();
