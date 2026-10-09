// Creates the SQLite database and schema. Pass --reset to wipe existing data first.
const fs = require('fs');
const { openDb, defaultPath } = require('../src/db');

const file = defaultPath();
if (process.argv.includes('--reset')) {
  for (const suffix of ['', '-wal', '-shm']) fs.rmSync(file + suffix, { force: true });
  console.log(`Removed existing database at ${file}`);
}
const db = openDb(file);
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all();
console.log(`Database ready at ${file}`);
console.log(`Tables: ${tables.map((t) => t.name).join(', ')}`);
db.close();
