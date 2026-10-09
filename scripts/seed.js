// Loads demo accounts and listings so reviewers can try every workflow immediately.
const bcrypt = require('bcryptjs');
const { openDb, defaultPath } = require('../src/db');

const db = openDb();
if (db.prepare('SELECT COUNT(*) AS n FROM users').get().n > 0) {
  console.log('Database already has data; skipping seed. Run "npm run db:reset" first for a clean demo.');
  process.exit(0);
}

const PASSWORD = 'Password123';
const hash = bcrypt.hashSync(PASSWORD, 10);
const users = [
  ['Aarav Sharma', '22BCE1001', 'aarav.sharma2022@vitstudent.ac.in', '9876500001'],
  ['Diya Nair', '22BIT2002', 'diya.nair2022@vitstudent.ac.in', '9876500002'],
  ['Rohan Iyer', '23BEC3003', 'rohan.iyer2023@vitstudent.ac.in', '9876500003'],
];
const addUser = db.prepare('INSERT INTO users (name, reg_no, email, phone, password_hash) VALUES (?, ?, ?, ?, ?)');
const ids = users.map((u) => Number(addUser.run(...u, hash).lastInsertRowid));
const [aarav, diya, rohan] = ids;

const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const addItem = db.prepare(
  `INSERT INTO items (type, title, description, category, venue, event_date, verification_question, reporter_id, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now', ?))`,
);
const item = (...a) => Number(addItem.run(...a).lastInsertRowid);

const idCard = item('found', 'VIT ID card near SJT lift', 'Found a student ID card with a blue lanyard on the 3rd floor near the SJT lifts.', 'ID Cards', 'SJT', daysAgo(1), 'What name and branch are printed on the ID card?', aarav, '-5 hours');
item('found', 'Casio fx-991EX calculator', 'Grey scientific calculator left on a desk in TT 412 after the CAT exam. Has a sticker on the back.', 'Calculators', 'TT', daysAgo(2), 'What sticker is on the back of the calculator?', diya, '-1 day');
item('found', 'Room key with red tag', 'Single room key on a red plastic tag found near the Gazebo counter.', 'Room Keys', 'Gazebo', daysAgo(0), 'What is written on the key tag?', rohan, '-2 hours');
item('found', 'boAt earphones in black case', 'Wireless earbuds in a black charging case found in the Central Library reading hall, 2nd floor.', 'Earphones', 'Central Library', daysAgo(3), 'What colour are the earbuds and is there any mark on the case?', diya, '-3 days');
item('lost', 'Brown leather wallet', 'Lost a brown leather wallet somewhere between Food Mall and MH-K. Contains a bank card and some cash.', 'Wallets', 'Food Mall', daysAgo(1), 'Which bank card is inside the wallet?', rohan, '-20 hours');
item('lost', 'Multimeter from EEE lab', 'Digital multimeter (yellow, Mastech) borrowed from the lab, left behind in PRP 2nd floor.', 'Lab Equipment', 'PRP', daysAgo(2), 'What model number and colour is the multimeter?', diya, '-2 days');
item('lost', 'LH-D hostel room key', 'Lost my room key with a small teddy keychain near the Sports Complex badminton courts.', 'Room Keys', 'Sports Complex', daysAgo(0), 'Describe the keychain attached to the key?', diya, '-1 hour');

// One approved claim with an active handoff chat, and one pending claim to review.
const addClaim = db.prepare("INSERT INTO claims (item_id, claimant_id, answer, details, status, decided_at) VALUES (?, ?, ?, ?, ?, ?)");
const approved = Number(addClaim.run(idCard, diya, 'Diya Nair, B.Tech IT', 'Lost it after my 2pm lab.', 'approved', new Date().toISOString()).lastInsertRowid);
addClaim.run(idCard, rohan, 'Rohan, ECE', '', 'pending', null);
const addMsg = db.prepare('INSERT INTO messages (claim_id, sender_id, body) VALUES (?, ?, ?)');
addMsg.run(approved, aarav, 'Claim approved. Let’s agree on a campus checkpoint and time for the handoff.');
addMsg.run(approved, diya, 'Thank you so much! I can come to the SJT reception after 5pm today.');

console.log(`Seeded ${users.length} demo users into ${defaultPath()} (password for all: ${PASSWORD}):`);
users.forEach((u) => console.log(`  - ${u[2]}`));
db.close();
