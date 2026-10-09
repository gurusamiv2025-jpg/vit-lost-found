const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { validateRegistration, validateLogin, ValidationError, HttpError } = require('./validation');

const SECRET = process.env.JWT_SECRET || 'dev-only-secret-change-me';
const TOKEN_TTL = '7d';

function sign(user) {
  return jwt.sign({ sub: user.id }, SECRET, { expiresIn: TOKEN_TTL });
}

// Attaches req.user when a valid bearer token is present; never rejects.
function optionalAuth(db) {
  const findUser = db.prepare('SELECT id, name FROM users WHERE id = ?');
  return (req, _res, next) => {
    const header = req.get('authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (token) {
      try {
        const { sub } = jwt.verify(token, SECRET);
        req.user = findUser.get(sub) || undefined;
      } catch {
        req.user = undefined;
      }
    }
    next();
  };
}

function requireAuth(req, _res, next) {
  if (!req.user) return next(new HttpError(401, 'Please log in to continue.'));
  next();
}

// Tiny fixed-window limiter to slow down password guessing.
function rateLimit({ windowMs, max }) {
  const hits = new Map();
  return (req, _res, next) => {
    const now = Date.now();
    const key = req.ip;
    const entry = hits.get(key);
    if (!entry || now - entry.start > windowMs) {
      hits.set(key, { start: now, count: 1 });
      return next();
    }
    entry.count += 1;
    if (entry.count > max) return next(new HttpError(429, 'Too many attempts. Please wait a few minutes and try again.'));
    next();
  };
}

function authRouter(db) {
  const router = express.Router();
  const limiter = rateLimit({ windowMs: 15 * 60e3, max: Number(process.env.AUTH_RATE_LIMIT) || 30 });

  router.post('/register', limiter, (req, res) => {
    const data = validateRegistration(req.body);
    const clash = db
      .prepare('SELECT email, reg_no FROM users WHERE email = ? OR reg_no = ?')
      .get(data.email, data.regNo);
    if (clash) {
      const fields = {};
      if (clash.email === data.email) fields.email = 'An account with this email already exists.';
      if (clash.reg_no === data.regNo) fields.regNo = 'This registration number is already registered.';
      throw new ValidationError(fields);
    }
    const hash = bcrypt.hashSync(data.password, 10);
    const { lastInsertRowid } = db
      .prepare('INSERT INTO users (name, reg_no, email, phone, password_hash) VALUES (?, ?, ?, ?, ?)')
      .run(data.name, data.regNo, data.email, data.phone, hash);
    const user = { id: Number(lastInsertRowid), name: data.name };
    res.status(201).json({ token: sign(user), user });
  });

  router.post('/login', limiter, (req, res) => {
    const { email, password } = validateLogin(req.body);
    const row = db.prepare('SELECT id, name, password_hash FROM users WHERE email = ?').get(email);
    if (!row || !bcrypt.compareSync(password, row.password_hash)) {
      throw new HttpError(401, 'Incorrect email or password.');
    }
    const user = { id: row.id, name: row.name };
    res.json({ token: sign(user), user });
  });

  // The owner can see their own details; nobody else ever can.
  router.get('/me', requireAuth, (req, res) => {
    const me = db.prepare('SELECT id, name, reg_no, email, phone, created_at FROM users WHERE id = ?').get(req.user.id);
    res.json({ user: me });
  });

  return router;
}

module.exports = { authRouter, optionalAuth, requireAuth };
