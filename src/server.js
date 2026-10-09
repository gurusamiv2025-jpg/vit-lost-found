const { openDb, defaultPath } = require('./db');
const { createApp } = require('./app');

if (!process.env.JWT_SECRET) {
  console.warn('[warn] JWT_SECRET is not set; using a development-only secret.');
}
const db = openDb();
const port = Number(process.env.PORT) || 3000;
createApp(db).listen(port, () => {
  console.log(`VIT Lost & Found running at http://localhost:${port}  (db: ${defaultPath()})`);
});
