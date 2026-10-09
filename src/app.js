const path = require('path');
const express = require('express');
const { authRouter, optionalAuth } = require('./auth');
const { itemsRouter } = require('./routes/items');
const { claimsRouter } = require('./routes/claims');

function createApp(db) {
  const app = express();
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.set({
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'",
    });
    next();
  });
  app.use(express.json({ limit: '20kb' }));
  app.use(optionalAuth(db));

  app.get('/api/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/auth', authRouter(db));
  app.use('/api', itemsRouter(db));
  app.use('/api', claimsRouter(db));
  app.use('/api', (_req, _res, next) => next(Object.assign(new Error('Unknown API route.'), { status: 404 })));

  app.use(express.static(path.join(__dirname, '..', 'public')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Request body is not valid JSON.' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'Request body is too large.' });
    const status = err.status || 500;
    if (status >= 500) console.error(err);
    res.status(status).json({
      error: status >= 500 ? 'Something went wrong on our side. Please try again.' : err.message,
      ...(err.fields ? { fields: err.fields } : {}),
    });
  });
  return app;
}

module.exports = { createApp };
