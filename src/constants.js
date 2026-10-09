// Official VIT campus landmarks, grouped for the location picker.
const VENUE_GROUPS = {
  'Academic Blocks': ['SJT', 'TT', 'PRP', 'SMV', 'MB', 'GDN', 'CDMM'],
  "Men's Hostel Blocks": 'ABCDEFGHIJKLMNOPQRST'.split('').map((c) => `MH-${c}`),
  "Ladies' Hostel Blocks": 'ABCDEFGHIJ'.split('').map((c) => `LH-${c}`),
  'Food Courts': ['Gazebo', 'Food Mall', 'DC'],
  'Other Landmarks': ['Central Library', 'Sports Complex'],
};

const VENUES = Object.values(VENUE_GROUPS).flat();

const CATEGORIES = ['ID Cards', 'Room Keys', 'Calculators', 'Lab Equipment', 'Earphones', 'Wallets'];

// Supervised, public spots where a physical handoff can be arranged.
const CHECKPOINTS = [
  'SJT Ground Floor Reception',
  'Central Library Security Desk',
  'TT Main Entrance Security Desk',
  'Main Gate Security Office',
  'Food Mall Entrance',
  'Sports Complex Front Desk',
];

const ITEM_TYPES = ['lost', 'found'];

module.exports = { VENUE_GROUPS, VENUES, CATEGORIES, CHECKPOINTS, ITEM_TYPES };
