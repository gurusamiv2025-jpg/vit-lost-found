const { VENUES, CATEGORIES, CHECKPOINTS, ITEM_TYPES } = require('./constants');

class ValidationError extends Error {
  constructor(fields) {
    super('Please fix the highlighted fields.');
    this.status = 400;
    this.fields = fields;
  }
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const REG_NO = /^\d{2}[A-Z]{3}\d{4}$/; // e.g. 22BCE1234
const VIT_EMAIL = /^[a-z0-9._%+-]+@vitstudent\.ac\.in$/;
const PHONE = /^[6-9]\d{9}$/;

const str = (v) => (typeof v === 'string' ? v.trim() : '');

function textField(errors, body, key, label, min, max, { required = true } = {}) {
  const value = str(body[key]);
  if (!value) {
    if (required) errors[key] = `${label} is required.`;
    return value;
  }
  if (value.length < min) errors[key] = `${label} must be at least ${min} characters.`;
  else if (value.length > max) errors[key] = `${label} must be at most ${max} characters.`;
  return value;
}

function finish(errors, data) {
  if (Object.keys(errors).length) throw new ValidationError(errors);
  return data;
}

function validateRegistration(body = {}) {
  const errors = {};
  const name = textField(errors, body, 'name', 'Name', 2, 60);
  const regNo = str(body.regNo).toUpperCase();
  const email = str(body.email).toLowerCase();
  const phone = str(body.phone).replace(/[\s-]/g, '').replace(/^\+91/, '');
  const password = typeof body.password === 'string' ? body.password : '';

  if (!REG_NO.test(regNo)) errors.regNo = 'Registration number must look like 22BCE1234.';
  if (!VIT_EMAIL.test(email)) errors.email = 'Use your VIT student email (name@vitstudent.ac.in).';
  if (!PHONE.test(phone)) errors.phone = 'Enter a valid 10-digit Indian mobile number.';
  if (password.length < 8) errors.password = 'Password must be at least 8 characters.';
  else if (password.length > 128) errors.password = 'Password must be at most 128 characters.';
  else if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    errors.password = 'Password must contain at least one letter and one number.';
  }
  return finish(errors, { name, regNo, email, phone, password });
}

function validateLogin(body = {}) {
  const errors = {};
  const email = str(body.email).toLowerCase();
  const password = typeof body.password === 'string' ? body.password : '';
  if (!email) errors.email = 'Email is required.';
  if (!password) errors.password = 'Password is required.';
  return finish(errors, { email, password });
}

function validateItem(body = {}) {
  const errors = {};
  const type = str(body.type);
  if (!ITEM_TYPES.includes(type)) errors.type = 'Choose whether the item was lost or found.';
  const title = textField(errors, body, 'title', 'Title', 3, 80);
  const description = textField(errors, body, 'description', 'Description', 10, 1000);
  const category = str(body.category);
  if (!CATEGORIES.includes(category)) errors.category = 'Pick one of the listed categories.';
  const venue = str(body.venue);
  if (!VENUES.includes(venue)) errors.venue = 'Pick an official VIT campus venue.';

  const eventDate = str(body.eventDate);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate) || Number.isNaN(Date.parse(eventDate))) {
    errors.eventDate = 'Enter the date as YYYY-MM-DD.';
  } else {
    const d = new Date(`${eventDate}T00:00:00Z`);
    const today = new Date();
    const tomorrow = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 1);
    if (d.getTime() > tomorrow) errors.eventDate = 'The date cannot be in the future.';
    else if (tomorrow - d.getTime() > 366 * 864e5) errors.eventDate = 'The date must be within the last year.';
  }

  const verificationQuestion = textField(errors, body, 'verificationQuestion', 'Verification question', 8, 200);
  if (verificationQuestion && !errors.verificationQuestion && !verificationQuestion.endsWith('?')) {
    errors.verificationQuestion = 'Phrase the verification challenge as a question ending with "?".';
  }
  return finish(errors, { type, title, description, category, venue, eventDate, verificationQuestion });
}

function validateClaim(body = {}) {
  const errors = {};
  const answer = textField(errors, body, 'answer', 'Answer', 2, 300);
  const details = textField(errors, body, 'details', 'Additional details', 0, 500, { required: false });
  return finish(errors, { answer, details });
}

function validateDecision(body = {}) {
  const errors = {};
  const decision = str(body.decision);
  if (!['approve', 'reject'].includes(decision)) errors.decision = 'Decision must be approve or reject.';
  const note = textField(errors, body, 'note', 'Note', 0, 300, { required: false });
  return finish(errors, { decision, note });
}

function validateMessage(body = {}) {
  const errors = {};
  const text = textField(errors, body, 'body', 'Message', 1, 1000);
  return finish(errors, { body: text });
}

function validateMeetup(body = {}) {
  const errors = {};
  const checkpoint = str(body.checkpoint);
  if (!CHECKPOINTS.includes(checkpoint)) errors.checkpoint = 'Choose one of the official handoff checkpoints.';
  const time = str(body.time);
  const t = Date.parse(time);
  if (!time || Number.isNaN(t)) errors.time = 'Pick a date and time for the meetup.';
  else if (t < Date.now() - 5 * 60e3) errors.time = 'The meetup time must be in the future.';
  else if (t > Date.now() + 30 * 864e5) errors.time = 'Schedule the meetup within the next 30 days.';
  return finish(errors, { checkpoint, time: Number.isNaN(t) ? time : new Date(t).toISOString() });
}

function parseId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(404, 'Not found.');
  return id;
}

module.exports = {
  ValidationError,
  HttpError,
  validateRegistration,
  validateLogin,
  validateItem,
  validateClaim,
  validateDecision,
  validateMessage,
  validateMeetup,
  parseId,
};
