// Redacts contact details that students sometimes paste into free text,
// so public listings and handoff chats never leak them.
const PATTERNS = [
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email hidden]'],
  [/(?:\+?91[\s-]?)?(?<!\d)[6-9]\d{4}[\s-]?\d{5}(?!\d)/g, '[phone hidden]'],
  [/\b\d{2}[A-Za-z]{3}\d{4}\b/g, '[reg. no. hidden]'],
];

function maskContactInfo(text) {
  if (typeof text !== 'string') return text;
  return PATTERNS.reduce((out, [re, label]) => out.replace(re, label), text);
}

// Stable pseudonym shown instead of a real identity, e.g. "Finder #4F2A".
function alias(role, userId, itemId) {
  const n = ((userId * 2654435761) ^ (itemId * 40503)) >>> 0;
  return `${role} #${(n % 0xffff).toString(16).toUpperCase().padStart(4, '0')}`;
}

module.exports = { maskContactInfo, alias };
