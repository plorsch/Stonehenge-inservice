// Stonehenge Micro In-Service — a small, self-contained web server.
// No installs needed: run with `node server.js` (Node 18 or newer).
// Data lives in ./data/db.json (or $DATA_DIR/db.json), with daily backups in ./data/backups/.

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const ROOT = __dirname;
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const MEDIA_DIR = path.join(DATA_DIR, 'media');   // pictures and GIFs uploaded for topics
const DB_FILE = path.join(DATA_DIR, 'db.json');
const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
const SEED_FILE = path.join(ROOT, 'seed-topics.json');
const SEED_STAFF_FILE = path.join(ROOT, 'seed-staff.json');
const PUBLIC_DIR = path.join(ROOT, 'public');
const BACKUPS_TO_KEEP = 60;
const DB_VERSION = 2;
// Changes with every deploy; open kiosk pages reload themselves when it does.
const BUILD_ID = process.env.RENDER_GIT_COMMIT || String(Date.now());

// ---------- Small helpers ----------

// Render's servers run on UTC. Use the facility's time zone there so "today" and "this week"
// roll over at local midnight. Set the TZ environment variable to override.
if (process.env.RENDER && !process.env.TZ) process.env.TZ = 'America/Denver';

function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const newId = () => crypto.randomBytes(6).toString('hex');
const nowIso = () => new Date().toISOString();

function cleanText(v, max = 5000) {
  return String(v == null ? '' : v).replace(/\r\n/g, '\n').trim().slice(0, max);
}
function cleanList(v, max = 60, limit = 40) {
  return (Array.isArray(v) ? v : []).map(x => cleanText(x, max)).filter(Boolean).slice(0, limit);
}
// Birthday as "MM-DD" (no year kept). Accepts 2026-03-07, 3/7, 03/07/1990, 3-7.
function cleanMonthDay(v) {
  const s = cleanText(v, 20);
  let m = s.match(/^\d{4}-(\d{1,2})-(\d{1,2})/) || s.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-]\d{2,4})?$/);
  if (!m) return '';
  const mo = Number(m[1]), d = Number(m[2]);
  return mo >= 1 && mo <= 12 && d >= 1 && d <= 31 ? `${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}` : '';
}
// Hire date as YYYY-MM-DD. Accepts 2019-03-07 or 3/7/2019.
function cleanFullDate(v) {
  const s = cleanText(v, 20);
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return us ? `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}` : (cleanDate(s.slice(0, 10)) || '');
}
function cleanDate(v) {
  const s = cleanText(v, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
// The Monday that starts the week containing `date` (YYYY-MM-DD).
function weekStart(date = today()) {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() - ((dt.getDay() + 6) % 7));
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}
const weekday = (date = today()) => { const [y, m, d] = date.split('-').map(Number); return new Date(y, m - 1, d).getDay(); };
const pickRandom = arr => arr[crypto.randomInt(arr.length)];
const sameText = (a, b) => String(a).trim().toLowerCase() === String(b).trim().toLowerCase();

// ---------- Storage ----------

// Home screen decorations by month (January first). Emoji float behind the keypad; the message shows above it.
const DECOR_COLORS = ['none', 'blue', 'pink', 'green', 'purple', 'yellow', 'red', 'orange'];
function defaultDecor() {
  return { on: true, months: [
    { emoji: '❄️ ⛄ 🧤', message: 'Happy New Year! Stay warm out there.', color: 'blue' },
    { emoji: '❤️ 💕 🌹', message: 'Happy Valentine\'s month!', color: 'pink' },
    { emoji: '🍀 ☘️ 🌈', message: 'Lucky to work with you!', color: 'green' },
    { emoji: '🌷 🐣 🌸', message: 'Happy spring!', color: 'purple' },
    { emoji: '🌼 🐝 🌻', message: 'Spring is in full bloom!', color: 'yellow' },
    { emoji: '☀️ 🌻 🕶️', message: 'Hello, summer!', color: 'yellow' },
    { emoji: '🎆 ⭐ 🇺🇸', message: 'Happy Independence Day month!', color: 'red' },
    { emoji: '🍉 ☀️ 🌊', message: 'Stay cool and drink your water!', color: 'blue' },
    { emoji: '🍎 🍂 🌻', message: 'Hello, fall!', color: 'orange' },
    { emoji: '🎃 🍂 🍁', message: 'Happy fall, y\'all!', color: 'orange' },
    { emoji: '🦃 🍁 🥧', message: 'Thankful for you!', color: 'orange' },
    { emoji: '🎄 ❄️ 🎁', message: 'Happy holidays!', color: 'red' }
  ] };
}

function defaultSettings() {
  return {
    facilityName: 'Stonehenge',
    // When no schedule covers someone: 'weekly' = one topic per department per week (changes Monday),
    // 'daily' = one per department per day, 'random' = per person.
    fallbackMode: 'weekly',
    // Day of the week (0 = Sunday ... 6 = Saturday) when a Culture-category topic replaces the regular one.
    // null = no culture day; Culture topics then rotate like any other topic.
    cultureDay: 5,
    departments: ['CNA', 'Nursing', 'Dietary', 'Housekeeping', 'Therapy', 'Activities', 'Social Services', 'Administration'],
    allowUnlisted: true,      // staff not on the roster can type their name instead
    leaders: {},              // { department: leader name }, for the Clock-in check follow-up lists
    decor: defaultDecor(),    // home screen decorations, one set per month
    celebrations: true,       // show staff birthdays and work anniversaries on the kiosk
    // Sign-off lines shown on the kiosk's final screen; one is picked at random each time.
    closingMessages: ["Have a great shift!", "Thank you for what you do for our residents!", "Go give someone a shout out today, would ya?", "You make a difference!", "Our residents are lucky to have you.", "Thanks for learning something new today.", "Small moments of kindness add up. Thank you!", "You're the reason this place feels like home.", "Go make someone smile today!", "Teamwork makes the dream work. Have a great one!", "Thanks for showing up for our residents today.", "Your care matters more than you know.", "Proud to work alongside you!", "Take a deep breath. You've got this!", "Remember to drink some water today, too!", "Someone's day is better because you're here.", "Thanks for being part of the Stonehenge family.", "Kindness is contagious. Spread some today!", "You did it! Now go be awesome.", "Every resident you greet by name feels at home. Thank you!", "Thanks for keeping our residents safe.", "High five! Have a wonderful shift."],
    dailyPicks: {},           // { department: { date, topicId } }
    weeklyPicks: {}           // { department or 'culture|department': { week, topicId } }
  };
}

function loadJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw new Error(`Could not read ${file}: ${err.message}. Restore it from the backups folder if it is damaged.`);
  }
}

// Write to a temp file first, then rename, so a power cut never leaves a half-written file.
function writeJsonSafely(file, value) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

fs.mkdirSync(BACKUP_DIR, { recursive: true });

const config = Object.assign({ port: 8080, adminUser: 'admin', adminPassword: 'changeme' }, loadJson(CONFIG_FILE, {}));
if (!fs.existsSync(CONFIG_FILE)) writeJsonSafely(CONFIG_FILE, config);
// Hosting services set these as environment variables; they win over config.json.
if (process.env.PORT) config.port = Number(process.env.PORT);
const passwordFromEnv = !!process.env.ADMIN_PASSWORD;
if (passwordFromEnv) config.adminPassword = process.env.ADMIN_PASSWORD;

// Bring any older or partial database up to the current shape.
function upgradeDb(d) {
  d.topics = Array.isArray(d.topics) ? d.topics : [];
  d.responses = Array.isArray(d.responses) ? d.responses : [];
  d.usage = Array.isArray(d.usage) ? d.usage : [];
  d.employees = Array.isArray(d.employees) ? d.employees : [];
  d.schedules = Array.isArray(d.schedules) ? d.schedules : [];
  d.required = Array.isArray(d.required) ? d.required : [];
  d.announcements = Array.isArray(d.announcements) ? d.announcements : [];
  const old = d.settings || {};
  d.settings = Object.assign(defaultSettings(), old);
  if (Array.isArray(old.roles) && !old.departments) d.settings.departments = old.roles;
  if (old.mode === 'random') d.settings.fallbackMode = 'random';
  if (old.mode === 'fixed' && old.fixedTopicId) {
    d.schedules.push({ id: newId(), topicId: old.fixedTopicId, departments: [], startDate: today(), endDate: null, note: 'Converted from "one specific topic"', createdAt: nowIso() });
  }
  for (const k of ['roles', 'mode', 'fixedTopicId', 'dailyPick', 'showCorrectAnswer']) delete d.settings[k];
  for (const t of d.topics) {
    if (!Array.isArray(t.questions)) {
      t.questions = [{ id: newId(), text: t.question || '', correctAnswer: t.correctAnswer || '', wrongAnswers: t.wrongAnswers || [], hint: '', explanation: t.explanation || '' }];
      delete t.question; delete t.correctAnswer; delete t.wrongAnswers; delete t.explanation;
    }
    if (!Array.isArray(t.departments)) t.departments = [];
    for (const q of t.questions) {
      if (!Array.isArray(q.correctAnswers)) { q.correctAnswers = q.correctAnswer ? [q.correctAnswer] : []; delete q.correctAnswer; }
      if (!q.type) q.type = q.correctAnswers.length > 1 ? 'multi' : 'single';
    }
  }
  for (const r of d.responses) {
    if (!Array.isArray(r.attempts)) {
      r.attempts = r.answer ? [r.answer] : [];
      r.firstTryCorrect = !!r.correct;
      r.completed = true;
      r.kind = r.kind || 'rotation';
      r.department = r.department || r.role || '';
    }
  }
  d.version = DB_VERSION;
  return d;
}

let db = loadJson(DB_FILE, null);
if (!db) {
  db = upgradeDb({});
  for (const s of loadJson(SEED_FILE, [])) db.topics.push(makeTopic(s));
  for (const s of loadJson(SEED_STAFF_FILE, [])) {
    const { employee, errors } = validateEmployee(s);
    if (!errors.length) db.employees.push(Object.assign(employee, { id: newId(), createdAt: nowIso() }));
  }
  // Example "topic of the week" for CNAs and nurses, so the schedule feature has something to show.
  const cic = db.topics.find(t => t.title.startsWith('Change in Condition'));
  if (cic) {
    const end = new Date(); end.setDate(end.getDate() + 6);
    const endStr = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
    db.schedules.push({ id: newId(), topicId: cic.id, departments: ['CNA', 'Nursing'], startDate: today(), endDate: endStr, note: 'Sample topic of the week', createdAt: nowIso() });
  }
  saveDb();
  console.log(`Created a new database with ${db.topics.length} sample topics and ${db.employees.length} sample staff.`);
} else if (db.version !== DB_VERSION) {
  fs.copyFileSync(DB_FILE, path.join(BACKUP_DIR, `before-upgrade-${Date.now()}.json`));
  db = upgradeDb(db);
  saveDb();
  console.log('Upgraded the database to the latest format (a copy of the old one is in the backups folder).');
} else {
  upgradeDb(db);
}

// One-time refresh of the built-in sample topics to the shorter versions with GIFs (October 2026).
// A sample is updated only if its lesson is still the original text (or already the new text),
// so any topic you have edited is left alone. Culture samples are added if missing.
const ORIGINAL_SAMPLE_LESSONS = {
  "Change in Condition: Stop and Watch": 'f6bc69044b20716c',
  "Hand Hygiene: When to Use Soap and Water": '7f5fb4307766030a',
  "Fall Prevention: The Call Light": 'eebd16ee74e187f2',
  "Fire Safety: RACE": '374508c3397b0b4a',
  "Abuse Reporting: Your Duty": '79e57760ff37cf1a',
  "Dignity While Making Beds": '23856c4dbc2c56b0',
  "Locking the Housekeeping Cart": '104a2a2a00f8fbd8',
  "IDDSI Diet Textures": 'f28e0ec394daf80c',
  "Food Temperatures and the Danger Zone": '84d89843cce2ca8e',
  "Residents Who Self-Administer Medications": '01711e48131993ff',
  "Pressure Injury Prevention: Repositioning": '375338d465ec68cf'
};
if (!(db.settings.sampleRefresh >= 1)) {
  const hash = s => crypto.createHash('sha1').update(String(s || '')).digest('hex').slice(0, 16);
  for (const s of loadJson(SEED_FILE, [])) {
    const t = db.topics.find(x => sameText(x.title, s.title));
    if (!t) {
      if (sameText(s.category || '', 'Culture')) db.topics.push(makeTopic(s));
      continue;
    }
    const { topic } = validateTopicInput(s);
    if (ORIGINAL_SAMPLE_LESSONS[s.title] !== hash(t.lesson) && t.lesson !== topic.lesson) continue;
    t.lesson = topic.lesson;
    if (topic.image && !t.image) t.image = topic.image;
    topic.questions.forEach((q, i) => { if (t.questions[i]) Object.assign(t.questions[i], q, { id: t.questions[i].id }); });
    t.updatedAt = nowIso();
  }
  db.settings.sampleRefresh = 1;
  saveDb();
}

function saveDb() {
  const backupFile = path.join(BACKUP_DIR, `db-${today()}.json`);
  if (fs.existsSync(DB_FILE) && !fs.existsSync(backupFile)) {
    fs.copyFileSync(DB_FILE, backupFile);
    const old = fs.readdirSync(BACKUP_DIR).filter(f => /^db-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
    for (const f of old.slice(0, Math.max(0, old.length - BACKUPS_TO_KEEP))) fs.unlinkSync(path.join(BACKUP_DIR, f));
  }
  writeJsonSafely(DB_FILE, db);
}

// ---------- Topics and questions ----------

// type 'single' = pick one answer; 'multi' = select all that apply.
function validateQuestion(q, n) {
  const out = {
    id: cleanText(q.id, 20) || newId(),
    type: q.type === 'multi' ? 'multi' : 'single',
    text: cleanText(q.text, 1000),
    correctAnswers: cleanList(Array.isArray(q.correctAnswers) ? q.correctAnswers : [q.correctAnswer], 500, 8),
    wrongAnswers: cleanList(q.wrongAnswers, 500, 8),
    hint: cleanText(q.hint, 1000),
    explanation: cleanText(q.explanation, 2000)
  };
  const errors = [];
  const label = `Question ${n}`;
  if (!out.text) errors.push(`${label}: the question is empty.`);
  if (!out.correctAnswers.length) errors.push(`${label}: add the correct answer.`);
  if (out.type === 'single' && out.correctAnswers.length > 1) errors.push(`${label}: has more than one correct answer, so make it "select all that apply".`);
  if (out.wrongAnswers.length < 1) errors.push(`${label}: add at least one wrong answer.`);
  const all = [...out.correctAnswers, ...out.wrongAnswers].map(a => a.toLowerCase());
  if (new Set(all).size !== all.length) errors.push(`${label}: each answer choice must be different.`);
  return { question: out, errors };
}

function validateTopicInput(input) {
  const errors = [];
  const t = {
    title: cleanText(input.title, 200),
    category: cleanText(input.category, 100),
    lesson: cleanText(input.lesson, 5000),
    departments: cleanList(input.departments),
    inRotation: input.inRotation !== false,
    questions: []
  };
  // Optional picture or GIF shown above the lesson: an uploaded file (/media/...) or an https link.
  // Left out entirely when the input has no image field, so a spreadsheet import keeps the existing picture.
  if ('image' in input) {
    const img = cleanText(input.image, 1000);
    t.image = /^\/(media|samples)\/[\w-]+\.(png|jpe?g|gif|webp)$/i.test(img) || /^https:\/\/\S+$/i.test(img) ? img : '';
  }
  if (!t.title) errors.push('Title is required.');
  if (!t.lesson) errors.push('Lesson text is required.');
  const qs = Array.isArray(input.questions) ? input.questions.slice(0, 30) : [];
  if (!qs.length) errors.push('Add at least one question.');
  qs.forEach((q, i) => {
    const r = validateQuestion(q || {}, i + 1);
    t.questions.push(r.question);
    errors.push(...r.errors);
  });
  return { topic: t, errors };
}

function makeTopic(input) {
  const { topic } = validateTopicInput(input);
  return Object.assign(topic, {
    id: newId(), status: 'active', createdAt: nowIso(), updatedAt: nowIso(),
    lastUsedDate: input.lastUsedDate || null, responseCount: 0
  });
}

const findTopic = id => db.topics.find(t => t.id === id);
const findEmployee = id => db.employees.find(e => e.id === id);
const isLive = t => !!t && t.status === 'active';
const topicProblems = t => validateTopicInput(t).errors;
const forDepartment = (list, dept) => !list || list.length === 0 || list.some(d => sameText(d, dept || ''));

// Prefer topics that have gone longest without use; pick randomly among the stalest few.
function pickStalest(pool, avoidId) {
  let candidates = pool.filter(t => t.id !== avoidId);
  if (!candidates.length) candidates = pool;
  if (!candidates.length) return null;
  const sorted = candidates.slice().sort((a, b) => (a.lastUsedDate || '').localeCompare(b.lastUsedDate || ''));
  const oldest = sorted[0].lastUsedDate || '';
  const tied = sorted.filter(t => (t.lastUsedDate || '') === oldest);
  return pickRandom(tied.length > 1 ? tied : sorted.slice(0, Math.min(3, sorted.length)));
}

// Pick the question in a topic this person has seen least (and not the one they saw last).
function pickQuestion(topic, employeeId) {
  const qs = topic.questions;
  if (qs.length === 1 || !employeeId) return pickRandom(qs);
  const seen = {};
  let lastSeen = null;
  for (const r of db.responses) {
    if (r.employeeId === employeeId && r.topicId === topic.id) {
      seen[r.questionId] = (seen[r.questionId] || 0) + 1;
      lastSeen = r.questionId;
    }
  }
  let candidates = qs.filter(q => q.id !== lastSeen);
  const fewest = Math.min(...candidates.map(q => seen[q.id] || 0));
  candidates = candidates.filter(q => (seen[q.id] || 0) === fewest);
  return pickRandom(candidates);
}

function activeSchedulesFor(dept, date = today()) {
  return db.schedules
    .filter(s => s.startDate <= date && (!s.endDate || s.endDate >= date) && isLive(findTopic(s.topicId)) && forDepartment(s.departments, dept))
    // Department-specific schedules beat all-staff ones; then the most recently started wins.
    .sort((a, b) => (b.departments.length > 0) - (a.departments.length > 0) || b.startDate.localeCompare(a.startDate));
}

const lastRandomByDept = {};

const isCulture = t => sameText(t.category || '', 'Culture');

// Keep one pick per key for the whole week; choose a new stalest topic when the week changes.
function weeklyPick(key, pool) {
  const picks = db.settings.weeklyPicks;
  const pick = picks[key];
  const week = weekStart();
  if (pick && pick.week === week) {
    const t = findTopic(pick.topicId);
    if (isLive(t) && pool.includes(t)) return t;
  }
  const t = pickStalest(pool, pick ? pick.topicId : null);
  if (t) { picks[key] = { week, topicId: t.id }; saveDb(); }
  return t;
}

// The regular (non-required) topic for one department right now.
function regularTopicFor(dept, { peek = false } = {}) {
  const sched = activeSchedulesFor(dept)[0];
  if (sched) return { topic: findTopic(sched.topicId), source: 'schedule', scheduleId: sched.id };
  const key = dept || '(none)';
  const rotation = db.topics.filter(t => isLive(t) && t.inRotation && forDepartment(t.departments, dept));
  const cultureOn = Number.isInteger(db.settings.cultureDay);
  if (cultureOn && weekday() === db.settings.cultureDay) {
    const t = weeklyPick('culture|' + key, rotation.filter(isCulture));
    if (t) return { topic: t, source: 'culture' };
  }
  // On a culture-day schedule, Culture topics only appear on that day.
  const pool = cultureOn ? rotation.filter(t => !isCulture(t)) : rotation;
  if (db.settings.fallbackMode === 'random') {
    if (peek) return { topic: null, source: 'random', poolSize: pool.length };
    const t = pickStalest(pool, lastRandomByDept[key]);
    if (t) lastRandomByDept[key] = t.id;
    return { topic: t, source: 'random' };
  }
  if (db.settings.fallbackMode === 'weekly') return { topic: weeklyPick(key, pool), source: 'weekly' };
  const picks = db.settings.dailyPicks;
  const pick = picks[key];
  if (pick && pick.date === today()) {
    const t = findTopic(pick.topicId);
    if (isLive(t) && pool.includes(t)) return { topic: t, source: 'daily' };
  }
  const t = pickStalest(pool, pick ? pick.topicId : null);
  if (!t) return { topic: null, source: 'daily' };
  picks[key] = { date: today(), topicId: t.id };
  saveDb();
  return { topic: t, source: 'daily' };
}

function requiredDoneBy(employeeId, reqId) {
  return db.responses.some(r => r.employeeId === employeeId && r.requiredId === reqId && r.completed);
}

function pendingRequiredFor(emp) {
  return db.required
    .filter(q => q.active && (!q.endDate || q.endDate >= today()) && isLive(findTopic(q.topicId)) && forDepartment(q.departments, emp.department) && !requiredDoneBy(emp.id, q.id))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

function kioskItem(topic, employeeId, extra) {
  const q = pickQuestion(topic, employeeId);
  return Object.assign({
    topic: { id: topic.id, title: topic.title, category: topic.category, lesson: topic.lesson, image: topic.image || '' },
    question: { id: q.id, type: q.type, text: q.text, answers: shuffle([...q.correctAnswers, ...q.wrongAnswers]) }
  }, extra);
}

function recordUsage(topic) {
  const date = today();
  topic.lastUsedDate = date;
  topic.responseCount = (topic.responseCount || 0) + 1;
  const entry = db.usage.find(u => u.date === date && u.topicId === topic.id);
  if (entry) entry.responses += 1;
  else db.usage.push({ date, topicId: topic.id, title: topic.title, responses: 1 });
}

// ---------- Staff ----------

function cleanLast4(v) {
  const digits = String(v == null ? '' : v).replace(/\D/g, '');
  return digits.length >= 4 ? digits.slice(-4) : null;
}

function validateEmployee(input) {
  const e = {
    name: cleanText(input.name, 100).replace(/\s+/g, ' '),
    last4: cleanLast4(input.last4),
    department: cleanText(input.department, 60),
    active: input.active !== false
  };
  // Only touch these when given, so a roster import without them keeps what was entered by hand.
  if ('birthday' in input && (input.birthday || !input.keepBlank)) e.birthday = cleanMonthDay(input.birthday);
  if ('hireDate' in input && (input.hireDate || !input.keepBlank)) e.hireDate = cleanFullDate(input.hireDate);
  const errors = [];
  if (!e.name) errors.push('Name is required.');
  if (!e.last4) errors.push('Enter the last 4 digits of the Workday ID.');
  return { employee: e, errors };
}

// "Maria L." — enough for staff to recognize themselves without showing full names on the kiosk.
function shortName(name) {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0];
}

// ---------- HTTP helpers ----------

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp'
};

function send(res, status, body, type = 'application/json', extra = {}) {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, Object.assign({ 'Content-Type': type, 'Cache-Control': 'no-store' }, extra));
  res.end(data);
}

function readBody(req, maxBytes = 1e6) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > maxBytes) { reject(new Error('Request too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function isAdmin(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Basic ')) return false;
  const [user, ...rest] = Buffer.from(header.slice(6), 'base64').toString('utf8').split(':');
  const given = Buffer.from(`${user}:${rest.join(':')}`);
  const expected = Buffer.from(`${config.adminUser}:${config.adminPassword}`);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

function requireAdmin(req, res) {
  if (isAdmin(req)) return true;
  send(res, 401, 'Admin sign-in required.', 'text/plain', { 'WWW-Authenticate': 'Basic realm="In-Service Admin", charset="UTF-8"' });
  return false;
}

function serveStatic(res, file) {
  const full = path.join(PUBLIC_DIR, file);
  if (!full.startsWith(PUBLIC_DIR)) return send(res, 404, 'Not found', 'text/plain');
  fs.readFile(full, (err, data) => {
    if (err) return send(res, 404, 'Not found', 'text/plain');
    send(res, 200, data, MIME[path.extname(full)] || 'application/octet-stream');
  });
}

function csvCell(v) {
  const s = String(v == null ? '' : v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function filterResponses(q) {
  return db.responses.filter(r =>
    (!q.get('from') || r.date >= q.get('from')) &&
    (!q.get('to') || r.date <= q.get('to')) &&
    (!q.get('topicId') || r.topicId === q.get('topicId')) &&
    (!q.get('department') || sameText(r.department, q.get('department'))) &&
    (!q.get('missed') || !r.firstTryCorrect)
  );
}

function todaysAnnouncements() {
  const d = today();
  return db.announcements.filter(a => a.startDate <= d && (!a.endDate || a.endDate >= d))
    .sort((a, b) => b.startDate.localeCompare(a.startDate)).map(a => ({ text: a.text, departments: a.departments }));
}
// Birthdays and work anniversaries for a day ("MM-DD"). Feb 29 birthdays show on Feb 28 in other years.
function celebrationsOn(date) {
  const md = date.slice(5), year = Number(date.slice(0, 4));
  const leap = new Date(year, 1, 29).getMonth() === 1;
  const out = [];
  for (const e of db.employees) {
    if (!e.active) continue;
    if (e.birthday && (e.birthday === md || (!leap && md === '02-28' && e.birthday === '02-29'))) out.push({ type: 'birthday', id: e.id, name: shortName(e.name), department: e.department });
    if (e.hireDate && e.hireDate.slice(5) === md && year - Number(e.hireDate.slice(0, 4)) >= 1) {
      out.push({ type: 'anniversary', id: e.id, name: shortName(e.name), department: e.department, years: year - Number(e.hireDate.slice(0, 4)) });
    }
  }
  return out;
}
const todaysCelebrations = () => celebrationsOn(today());

// ---------- Kiosk routes (no login) ----------

async function kioskRoutes(req, res, p, m) {
  if (m === 'GET' && p === '/api/kiosk/config') {
    const s = db.settings;
    // ?month=10 previews another month's decor from the admin page.
    const month = Number(new URL(req.url, 'http://localhost').searchParams.get('month')) || new Date().getMonth() + 1;
    const decor = s.decor && s.decor.on && month >= 1 && month <= 12 ? s.decor.months[month - 1] : null;
    return send(res, 200, { facilityName: s.facilityName, departments: s.departments, allowUnlisted: s.allowUnlisted, closingMessages: s.closingMessages, decor,
      announcements: todaysAnnouncements(), celebrations: s.celebrations ? todaysCelebrations() : [], build: BUILD_ID });
  }

  // Step 1: last 4 of Workday ID -> who might this be?
  if (m === 'POST' && p === '/api/kiosk/identify') {
    const last4 = cleanLast4((await readBody(req)).last4);
    if (!last4) return send(res, 400, { error: 'Enter 4 digits.' });
    const matches = db.employees.filter(e => e.active && e.last4 === last4)
      .map(e => ({ id: e.id, displayName: shortName(e.name), department: e.department }));
    return send(res, 200, { matches });
  }

  // Forgot code: first and last name -> their last 4. Needs at least two names so nobody can browse the roster.
  if (m === 'POST' && p === '/api/kiosk/lookup') {
    const words = s => String(s || '').toLowerCase().replace(/[^a-z\s,'-]/g, '').split(/[\s,]+/).map(w => w.replace(/['-]/g, '')).filter(Boolean);
    const typed = words(cleanText((await readBody(req)).name, 100)).filter(w => w.length > 1);
    if (typed.length < 2) return send(res, 400, { error: 'Type your first and last name.' });
    const matches = db.employees.filter(e => e.active && e.last4).filter(e => {
      const parts = words(e.name);
      return typed.every(t => parts.some(x => x === t || (t.length > 2 && x.startsWith(t))));
    }).slice(0, 3).map(e => ({ id: e.id, displayName: shortName(e.name), department: e.department, last4: e.last4 }));
    return send(res, 200, { matches });
  }

  // Step 2: confirmed person -> what they need to do this visit.
  if (m === 'POST' && p === '/api/kiosk/start') {
    const b = await readBody(req);
    let who;
    if (b.employeeId) {
      const e = findEmployee(String(b.employeeId));
      if (!e || !e.active) return send(res, 400, { error: 'We could not find you. Please start again.' });
      who = { employeeId: e.id, name: e.name, last4: e.last4, department: e.department };
    } else {
      if (!db.settings.allowUnlisted) return send(res, 400, { error: 'Please see your supervisor to be added.' });
      const name = cleanText(b.name, 100).replace(/\s+/g, ' ');
      if (!name) return send(res, 400, { error: 'Please enter your name.' });
      who = { employeeId: null, name, last4: cleanLast4(b.last4) || '', department: cleanText(b.department, 60) };
    }
    const items = [];
    // Required education first, every pending one, oldest first. The regular topic is skipped that visit.
    if (who.employeeId) {
      for (const q of pendingRequiredFor(findEmployee(who.employeeId))) {
        items.push(kioskItem(findTopic(q.topicId), who.employeeId, { kind: 'required', requiredId: q.id, reason: q.reason }));
      }
    }
    if (!items.length) {
      const r = regularTopicFor(who.department);
      if (r.topic) items.push(kioskItem(r.topic, who.employeeId, { kind: r.source === 'schedule' ? 'scheduled' : 'rotation', scheduleId: r.scheduleId || null }));
    }
    return send(res, 200, { who: Object.assign(who, { firstName: who.name.split(' ')[0] }), items });
  }

  // Step 3: each answer attempt. The first attempt creates the record; retries add to it.
  if (m === 'POST' && p === '/api/kiosk/answer') {
    const b = await readBody(req);
    const chosen = cleanList(Array.isArray(b.answer) ? b.answer : [b.answer], 500, 8);
    if (!chosen.length) return send(res, 400, { error: 'Please choose an answer.' });
    let r = b.responseId ? db.responses.find(x => x.id === String(b.responseId)) : null;
    if (b.responseId && (!r || r.completed)) return send(res, 400, { error: 'Please start again.' });
    const topic = findTopic(String(r ? r.topicId : b.topicId || ''));
    const q = topic && topic.questions.find(x => x.id === (r ? r.questionId : String(b.questionId || '')));
    if (!topic || !q) return send(res, 400, { error: 'This in-service is no longer available. Please start again.' });

    if (!r) {
      const w = b.who || {};
      const emp = w.employeeId ? findEmployee(String(w.employeeId)) : null;
      if (w.employeeId && !emp) return send(res, 400, { error: 'Please start again.' });
      const name = emp ? emp.name : cleanText(w.name, 100);
      if (!name) return send(res, 400, { error: 'Please start again.' });
      const kind = ['required', 'scheduled', 'rotation'].includes(b.kind) ? b.kind : 'rotation';
      r = {
        id: newId(), submittedAt: nowIso(), date: today(),
        employeeId: emp ? emp.id : null, name, last4: emp ? emp.last4 : cleanLast4(w.last4) || '',
        department: emp ? emp.department : cleanText(w.department, 60), verified: !!emp,
        kind, requiredId: kind === 'required' ? cleanText(b.requiredId, 20) : null,
        scheduleId: kind === 'scheduled' ? cleanText(b.scheduleId, 20) : null,
        topicId: topic.id, topicTitle: topic.title, questionId: q.id, question: q.text,
        correctAnswer: q.correctAnswers.join('; '), attempts: [], firstTryCorrect: false, completed: false, completedAt: null
      };
      db.responses.push(r);
      recordUsage(topic);
    }
    r.attempts.push(chosen.join('; '));
    const want = q.correctAnswers.map(a => a.toLowerCase()).sort();
    const got = [...new Set(chosen.map(a => a.toLowerCase()))].sort();
    const correct = want.length === got.length && want.every((a, i) => a === got[i]);
    if (r.attempts.length === 1) r.firstTryCorrect = correct;
    if (correct) { r.completed = true; r.completedAt = nowIso(); }
    saveDb();

    // Single choice: drop the wrong picks. Select-all: keep every choice (a partly right pick isn't "wrong").
    const all = [...q.correctAnswers, ...q.wrongAnswers];
    const tried = r.attempts.map(a => a.toLowerCase());
    const remaining = q.type === 'multi' ? all : all.filter(a => !tried.includes(a.toLowerCase()));
    return send(res, 200, {
      responseId: r.id,
      correct,
      firstTryCorrect: r.firstTryCorrect,
      hint: correct ? '' : q.hint,
      answers: correct ? [] : shuffle(remaining),   // try again with the wrong choices removed, in a new order
      correctAnswer: correct ? q.correctAnswers.join('; ') : null,
      explanation: correct ? q.explanation : ''
    });
  }
  return false;
}

// ---------- Clock-in check ----------

function addDays(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  const x = new Date(y, m - 1, d + n);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

// One shift per person per day (the earliest punch), so lunch and clock-out punches don't count twice.
// A shift counts as covered when that person finished an in-service the same day, or, for a clock-in
// at 6 pm or later, the next morning before noon (night shift finishing after midnight).
// Time clock rows for time off, not time worked.
const LEAVE_PAYCODE = /sick|vacation|\bpto\b|paid time off|holiday|bereave|jury|leave|absen|unpaid|fmla|no ?show/i;

function clockCheck(punches) {
  const shifts = new Map();
  // Like the old audit sheet: clock-ins before the kiosk's first in-service don't count.
  const firstDay = db.responses.reduce((min, r) => (!min || r.date < min ? r.date : min), '');
  let leave = 0, before = 0;
  for (const raw of punches) {
    const last4 = cleanLast4(raw.last4);
    const date = cleanDate(raw.date);
    if (!last4 || !date) continue;
    if (raw.paycode && LEAVE_PAYCODE.test(raw.paycode)) { leave++; continue; }
    if (!firstDay || date < firstDay) { before++; continue; }
    const time = /^\d{2}:\d{2}$/.test(raw.time || '') ? raw.time : '';
    const key = `${last4}|${cleanText(raw.name, 100).toLowerCase()}|${date}`;
    const prev = shifts.get(key);
    if (!prev || (time && (!prev.time || time < prev.time))) {
      shifts.set(key, { last4, name: cleanText(raw.name, 100), date, time, department: cleanText(raw.department, 100) });
    }
  }
  const results = [];
  for (const sh of shifts.values()) {
    let candidates = db.employees.filter(e => e.last4 === sh.last4);
    if (candidates.length > 1 && sh.name) {
      // Exports often write "Last, First"; match on any name part.
      const parts = sh.name.toLowerCase().split(/[\s,]+/).filter(x => x.length > 1);
      const score = e => e.name.toLowerCase().split(/\s+/).filter(x => parts.includes(x)).length;
      const best = Math.max(...candidates.map(score));
      if (best > 0) candidates = candidates.filter(e => score(e) === best);
    }
    const emp = candidates.length === 1 ? candidates[0] : null;
    const department = (emp && emp.department) || sh.department;
    const nightNext = sh.time && sh.time >= '18:00' ? addDays(sh.date, 1) : null;
    const mine = r => emp ? r.employeeId === emp.id : r.last4 === sh.last4;
    const onShift = r => r.date === sh.date || (nightNext && r.date === nightNext && new Date(r.submittedAt).getHours() < 12);
    const rs = db.responses.filter(r => mine(r) && onShift(r));
    const done = rs.find(r => r.completed);
    let status;
    if (done) status = 'done';
    else if (rs.length) status = 'unfinished';
    else status = 'missed';
    results.push({
      date: sh.date, time: sh.time, last4: sh.last4,
      name: emp ? emp.name : sh.name, department, leader: (emp && db.settings.leaders && db.settings.leaders[department]) || '',
      onRoster: !!emp, ambiguous: candidates.length > 1,
      status, completedAt: done ? done.completedAt : null, topic: done ? done.topicTitle : (rs[0] ? rs[0].topicTitle : '')
    });
  }
  results.sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
  const count = st => results.filter(r => r.status === st).length;
  return { shifts: results.length, done: count('done'), missed: count('missed'), unfinished: count('unfinished'), leave, before, firstDay, results };
}

// ---------- Admin routes ----------

function todayOverview() {
  const depts = db.settings.departments.length ? db.settings.departments : [''];
  return depts.map(d => {
    const r = regularTopicFor(d, { peek: true });
    return { department: d, topicId: r.topic ? r.topic.id : null, title: r.topic ? r.topic.title : null, source: r.source, poolSize: r.poolSize };
  });
}

function requiredProgress(q) {
  const targets = db.employees.filter(e => e.active && forDepartment(q.departments, e.department));
  const done = [], pending = [];
  for (const e of targets) {
    const r = db.responses.find(x => x.employeeId === e.id && x.requiredId === q.id && x.completed);
    if (r) done.push({ id: e.id, name: e.name, department: e.department, completedAt: r.completedAt, firstTryCorrect: r.firstTryCorrect });
    else pending.push({ id: e.id, name: e.name, department: e.department });
  }
  return { done, pending };
}

async function adminRoutes(req, res, p, m, url) {
  if (m === 'GET' && p === '/api/admin/state') {
    const topicStats = {};
    for (const r of db.responses) {
      const st = topicStats[r.topicId] || (topicStats[r.topicId] = { responses: 0, firstTry: 0 });
      st.responses += 1;
      if (r.firstTryCorrect) st.firstTry += 1;
    }
    return send(res, 200, {
      topics: db.topics.map(t => t.status === 'draft' ? Object.assign({}, t, { problems: topicProblems(t) }) : t),
      employees: db.employees, schedules: db.schedules, settings: db.settings, announcements: db.announcements,
      upcomingCelebrations: Array.from({ length: 31 }, (_, i) => addDays(today(), i)).flatMap(d => celebrationsOn(d).map(c => Object.assign(c, { date: d }))),
      required: db.required.map(q => { const pr = requiredProgress(q); return Object.assign({}, q, { doneCount: pr.done.length, pendingCount: pr.pending.length }); }),
      today: todayOverview(), todayDate: today(), topicStats,
      responseCountToday: db.responses.filter(r => r.date === today()).length,
      missedToday: db.responses.filter(r => r.date === today() && !r.firstTryCorrect).length,
      responseCountTotal: db.responses.length,
      kioskUrls: kioskUrls(), passwordFromEnv
    });
  }

  // Topics
  if (m === 'POST' && p === '/api/admin/topics/import') {
    // Rows from a spreadsheet, already grouped into topics by the admin page.
    const list = (await readBody(req, 20e6)).topics || [];
    let added = 0, updated = 0, drafts = 0;
    for (const input of list.slice(0, 500)) {
      const { topic, errors } = validateTopicInput(input || {});
      if (!topic.title) continue;
      const status = errors.length ? 'draft' : 'active';
      if (errors.length) drafts++;
      const lastUsedDate = cleanDate(input.lastUsedDate);
      const existing = db.topics.find(t => sameText(t.title, topic.title));
      if (existing) {
        Object.assign(existing, topic, { updatedAt: nowIso() });
        if (existing.status !== 'retired') existing.status = status;
        if (lastUsedDate && lastUsedDate > (existing.lastUsedDate || '')) existing.lastUsedDate = lastUsedDate;
        updated++;
      } else {
        db.topics.push(Object.assign(topic, { id: newId(), status, createdAt: nowIso(), updatedAt: nowIso(), lastUsedDate, responseCount: 0 }));
        added++;
      }
    }
    saveDb();
    return send(res, 200, { added, updated, drafts });
  }

  if (m === 'POST' && p === '/api/admin/topics') {
    const body = await readBody(req);
    const { errors } = validateTopicInput(body);
    if (body.draft ? !cleanText(body.title) : errors.length) return send(res, 400, { error: body.draft ? 'Title is required.' : errors.join(' ') });
    const t = makeTopic(body);
    if (errors.length) t.status = 'draft';
    db.topics.push(t);
    saveDb();
    return send(res, 200, { topic: t });
  }
  let mt = p.match(/^\/api\/admin\/topics\/(\w+)(?:\/(duplicate|retire|restore|rotation))?$/);
  if (mt) {
    const t = findTopic(mt[1]);
    if (!t) return send(res, 404, { error: 'Topic not found.' });
    const action = mt[2];
    if (m === 'PUT' && !action) {
      const body = await readBody(req);
      const { topic, errors } = validateTopicInput(body);
      // "Save as draft" keeps unfinished work without showing it on the iPad.
      if (body.draft) {
        if (!topic.title) return send(res, 400, { error: 'Title is required.' });
        Object.assign(t, topic, { status: t.status === 'retired' ? 'retired' : 'draft', updatedAt: nowIso() });
        saveDb();
        return send(res, 200, { topic: t });
      }
      if (errors.length) return send(res, 400, { error: errors.join(' ') });
      Object.assign(t, topic, { status: t.status === 'draft' ? 'active' : t.status, updatedAt: nowIso() });
      saveDb();
      return send(res, 200, { topic: t });
    }
    if (m === 'POST' && action === 'rotation') {
      t.inRotation = !!(await readBody(req)).inRotation;
      saveDb();
      return send(res, 200, { topic: t });
    }
    if (m === 'POST' && action === 'duplicate') {
      const copy = makeTopic(Object.assign({}, t, { title: `${t.title} (copy)`, inRotation: false, lastUsedDate: null,
        questions: t.questions.map(q => Object.assign({}, q, { id: null })) }));
      if (topicProblems(copy).length) copy.status = 'draft';
      db.topics.push(copy);
      saveDb();
      return send(res, 200, { topic: copy });
    }
    if (m === 'POST' && (action === 'retire' || action === 'restore')) {
      t.status = action === 'retire' ? 'retired' : (topicProblems(t).length ? 'draft' : 'active');
      t.updatedAt = nowIso();
      saveDb();
      return send(res, 200, { topic: t });
    }
  }

  // Staff roster
  if (m === 'POST' && p === '/api/admin/employees') {
    const { employee, errors } = validateEmployee(await readBody(req));
    if (errors.length) return send(res, 400, { error: errors.join(' ') });
    const e = Object.assign(employee, { id: newId(), createdAt: nowIso() });
    db.employees.push(e);
    saveDb();
    return send(res, 200, { employee: e });
  }
  if (m === 'POST' && p === '/api/admin/employees/import') {
    const rows = (await readBody(req, 10e6)).rows || [];
    let added = 0, updated = 0;
    const skipped = [];
    rows.forEach((row, i) => {
      const { employee, errors } = validateEmployee(row || {});
      if (errors.length) { skipped.push(`Row ${i + 2}: ${errors.join(' ')}`); return; }
      const existing = db.employees.find(e => e.last4 === employee.last4 && sameText(e.name, employee.name));
      if (existing) { Object.assign(existing, employee); updated++; }
      else { db.employees.push(Object.assign(employee, { id: newId(), createdAt: nowIso() })); added++; }
    });
    saveDb();
    return send(res, 200, { added, updated, skipped });
  }
  mt = p.match(/^\/api\/admin\/employees\/(\w+)$/);
  if (mt && m === 'PUT') {
    const e = findEmployee(mt[1]);
    if (!e) return send(res, 404, { error: 'Staff member not found.' });
    const { employee, errors } = validateEmployee(await readBody(req));
    if (errors.length) return send(res, 400, { error: errors.join(' ') });
    Object.assign(e, employee);
    saveDb();
    return send(res, 200, { employee: e });
  }

  // Announcements (no question; shown on the kiosk's home and end screens)
  if (m === 'POST' && p === '/api/admin/announcements') {
    const b = await readBody(req);
    const a = {
      id: newId(), text: cleanText(b.text, 200).replace(/\s+/g, ' '), departments: cleanList(b.departments),
      startDate: cleanDate(b.startDate), endDate: cleanDate(b.endDate), createdAt: nowIso()
    };
    if (!a.text) return send(res, 400, { error: 'Write the announcement.' });
    if (!a.startDate) return send(res, 400, { error: 'Choose a start date.' });
    if (a.endDate && a.endDate < a.startDate) return send(res, 400, { error: 'The end date is before the start date.' });
    db.announcements.push(a);
    saveDb();
    return send(res, 200, { announcement: a });
  }
  mt = p.match(/^\/api\/admin\/announcements\/(\w+)$/);
  if (mt && m === 'DELETE') {
    const i = db.announcements.findIndex(a => a.id === mt[1]);
    if (i < 0) return send(res, 404, { error: 'Not found.' });
    db.announcements.splice(i, 1);
    saveDb();
    return send(res, 200, { ok: true });
  }

  // Schedules (topic of the week, department topics)
  if (m === 'POST' && p === '/api/admin/schedules') {
    const b = await readBody(req);
    const s = {
      id: newId(), topicId: cleanText(b.topicId, 20), departments: cleanList(b.departments),
      startDate: cleanDate(b.startDate), endDate: cleanDate(b.endDate), note: cleanText(b.note, 200), createdAt: nowIso()
    };
    if (!isLive(findTopic(s.topicId))) return send(res, 400, { error: 'Choose an active topic.' });
    if (!s.startDate) return send(res, 400, { error: 'Choose a start date.' });
    if (s.endDate && s.endDate < s.startDate) return send(res, 400, { error: 'The end date is before the start date.' });
    db.schedules.push(s);
    saveDb();
    return send(res, 200, { schedule: s });
  }
  mt = p.match(/^\/api\/admin\/schedules\/(\w+)$/);
  if (mt && m === 'DELETE') {
    const i = db.schedules.findIndex(s => s.id === mt[1]);
    if (i < 0) return send(res, 404, { error: 'Not found.' });
    db.schedules.splice(i, 1);
    saveDb();
    return send(res, 200, { ok: true });
  }

  // Required education
  if (m === 'POST' && p === '/api/admin/required') {
    const b = await readBody(req);
    const q = { id: newId(), topicId: cleanText(b.topicId, 20), departments: cleanList(b.departments), reason: cleanText(b.reason, 300), endDate: cleanDate(b.endDate), active: true, createdAt: nowIso(), closedAt: null };
    if (q.endDate && q.endDate < today()) return send(res, 400, { error: 'The "show until" date has already passed.' });
    if (!isLive(findTopic(q.topicId))) return send(res, 400, { error: 'Choose an active topic.' });
    db.required.push(q);
    saveDb();
    return send(res, 200, { required: q });
  }
  mt = p.match(/^\/api\/admin\/required\/(\w+)(?:\/(close|reopen|progress))?$/);
  if (mt) {
    const q = db.required.find(x => x.id === mt[1]);
    if (!q) return send(res, 404, { error: 'Not found.' });
    if (m === 'GET' && mt[2] === 'progress') return send(res, 200, requiredProgress(q));
    if (m === 'POST' && (mt[2] === 'close' || mt[2] === 'reopen')) {
      q.active = mt[2] === 'reopen';
      q.closedAt = q.active ? null : nowIso();
      saveDb();
      return send(res, 200, { required: q });
    }
  }

  if (m === 'POST' && p === '/api/admin/media') {
    // A picture or GIF for a topic, sent as a data: URL from the admin page.
    const b = await readBody(req, 14e6);
    const mm = String(b.dataUrl || '').match(/^data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/=]+)$/);
    if (!mm) return send(res, 400, { error: 'Please choose a PNG, JPG, GIF or WebP picture.' });
    const data = Buffer.from(mm[2], 'base64');
    if (data.length > 10e6) return send(res, 400, { error: 'That picture is over 10 MB. Please use a smaller one.' });
    fs.mkdirSync(MEDIA_DIR, { recursive: true });
    const file = `${newId()}.${mm[1] === 'jpeg' ? 'jpg' : mm[1]}`;
    fs.writeFileSync(path.join(MEDIA_DIR, file), data);
    return send(res, 200, { url: `/media/${file}` });
  }

  if (m === 'PUT' && p === '/api/admin/settings') {
    const b = await readBody(req);
    const s = db.settings;
    if (['weekly', 'daily', 'random'].includes(b.fallbackMode)) s.fallbackMode = b.fallbackMode;
    if ('cultureDay' in b) s.cultureDay = Number.isInteger(b.cultureDay) && b.cultureDay >= 0 && b.cultureDay <= 6 ? b.cultureDay : null;
    if ('facilityName' in b) s.facilityName = cleanText(b.facilityName, 100) || 'Stonehenge';
    if (Array.isArray(b.departments)) s.departments = cleanList(b.departments, 60, 30);
    if ('allowUnlisted' in b) s.allowUnlisted = !!b.allowUnlisted;
    if ('celebrations' in b) s.celebrations = !!b.celebrations;
    if (Array.isArray(b.closingMessages)) s.closingMessages = cleanList(b.closingMessages, 200, 100);
    if (b.decor && typeof b.decor === 'object' && Array.isArray(b.decor.months) && b.decor.months.length === 12) {
      s.decor = { on: !!b.decor.on, months: b.decor.months.map(x => ({
        emoji: cleanText(x && x.emoji, 60), message: cleanText(x && x.message, 100),
        color: DECOR_COLORS.includes(x && x.color) ? x.color : 'none' })) };
    }
    if (b.leaders && typeof b.leaders === 'object') {
      s.leaders = {};
      for (const [d, l] of Object.entries(b.leaders).slice(0, 50)) if (cleanText(d, 60) && cleanText(l, 60)) s.leaders[cleanText(d, 60)] = cleanText(l, 60);
    }
    saveDb();
    return send(res, 200, { settings: s });
  }

  if (m === 'POST' && p === '/api/admin/pick-new-daily') {
    // Swap the current automatic topic (today's, this week's, or this week's culture topic) for one department.
    const dept = cleanText((await readBody(req)).department, 60);
    const key = dept || '(none)';
    const cur = regularTopicFor(dept, { peek: true });
    const rotation = db.topics.filter(t => isLive(t) && t.inRotation && forDepartment(t.departments, dept));
    const cultureOn = Number.isInteger(db.settings.cultureDay);
    const pool = cur.source === 'culture' ? rotation.filter(isCulture) : cultureOn ? rotation.filter(t => !isCulture(t)) : rotation;
    const t = pickStalest(pool, cur.topic ? cur.topic.id : null);
    if (!t) return send(res, 400, { error: 'No topics in the rotation for this department.' });
    if (cur.source === 'daily') db.settings.dailyPicks[key] = { date: today(), topicId: t.id };
    else if (cur.source === 'weekly') db.settings.weeklyPicks[key] = { week: weekStart(), topicId: t.id };
    else if (cur.source === 'culture') db.settings.weeklyPicks['culture|' + key] = { week: weekStart(), topicId: t.id };
    else return send(res, 400, { error: 'This department has a scheduled topic. Change it on the Schedule tab.' });
    saveDb();
    return send(res, 200, { topicId: t.id });
  }

  if (m === 'POST' && p === '/api/admin/password') {
    if (passwordFromEnv) return send(res, 400, { error: 'The password is set by the ADMIN_PASSWORD setting on the server. Change it there.' });
    const pw = String((await readBody(req)).password || '');
    if (pw.length < 6) return send(res, 400, { error: 'Use at least 6 characters.' });
    config.adminPassword = pw;
    writeJsonSafely(CONFIG_FILE, config);
    return send(res, 200, { ok: true });
  }

  if (m === 'GET' && p === '/api/admin/responses') {
    return send(res, 200, { responses: filterResponses(url.searchParams).slice().reverse() });
  }

  if (m === 'GET' && p === '/api/admin/responses.csv') {
    const cols = [
      ['Submitted', r => r.submittedAt], ['Date', r => r.date], ['Name', r => r.name], ['Workday last 4', r => r.last4],
      ['Department', r => r.department], ['On roster', r => r.verified ? 'yes' : 'no'],
      ['Type', r => r.kind], ['Topic', r => r.topicTitle], ['Question', r => r.question],
      ['First answer', r => r.attempts[0]], ['Correct answer', r => r.correctAnswer],
      ['Correct first try', r => r.firstTryCorrect ? 'yes' : 'no'], ['Tries', r => r.attempts.length],
      ['Finished', r => r.completed ? 'yes' : 'no'], ['Finished at', r => r.completedAt]
    ];
    const rows = filterResponses(url.searchParams).map(r => cols.map(([, f]) => csvCell(f(r))).join(','));
    return send(res, 200, '﻿' + [cols.map(c => c[0]).join(','), ...rows].join('\r\n'), 'text/csv; charset=utf-8',
      { 'Content-Disposition': `attachment; filename="inservice-responses-${today()}.csv"` });
  }

  if (m === 'POST' && p === '/api/admin/clock-check') {
    // Compare a time clock export against completed in-services. Nothing from the export is saved.
    const punches = ((await readBody(req, 20e6)).punches || []).slice(0, 50000);
    return send(res, 200, clockCheck(punches));
  }

  if (m === 'GET' && p === '/api/admin/usage') return send(res, 200, { usage: db.usage.slice().reverse() });

  if (m === 'GET' && p === '/api/admin/backup') {
    return send(res, 200, JSON.stringify(db, null, 2), 'application/json',
      { 'Content-Disposition': `attachment; filename="inservice-backup-${today()}.json"` });
  }

  if (m === 'POST' && p === '/api/admin/restore') {
    const b = await readBody(req, 100e6);
    if (!b || !Array.isArray(b.topics) || !Array.isArray(b.responses) || typeof b.settings !== 'object') {
      return send(res, 400, { error: 'That file is not an in-service backup.' });
    }
    // Keep a copy of what is being replaced.
    writeJsonSafely(path.join(BACKUP_DIR, `before-restore-${nowIso().replace(/[:.]/g, '-')}.json`), db);
    db = upgradeDb(b);
    saveDb();
    return send(res, 200, { topics: db.topics.length, responses: db.responses.length, employees: db.employees.length });
  }

  return false;
}

// ---------- Server ----------

async function handle(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const p = url.pathname;
  const m = req.method;

  if (m === 'GET' && (p === '/' || p === '/index.html')) return serveStatic(res, 'index.html');
  if (p.startsWith('/api/kiosk/')) {
    if ((await kioskRoutes(req, res, p, m)) !== false) return;
    return send(res, 404, { error: 'Not found' });
  }
  if (m === 'GET' && /^\/[\w.-]+\.(js|css|png|svg|ico)$/.test(p) && !p.startsWith('/admin')) return serveStatic(res, p.slice(1));
  const sample = m === 'GET' && p.match(/^\/samples\/([\w-]+\.gif)$/i);
  if (sample) return serveStatic(res, 'samples/' + sample[1]);
  const media = m === 'GET' && p.match(/^\/media\/([\w-]+\.(png|jpe?g|gif|webp))$/i);
  if (media) {
    // Uploaded files get a new name each time, so the iPad can cache them for good.
    return fs.readFile(path.join(MEDIA_DIR, media[1]), (err, data) => {
      if (err) return send(res, 404, 'Not found', 'text/plain');
      send(res, 200, data, MIME[path.extname(media[1]).toLowerCase()], { 'Cache-Control': 'public, max-age=31536000, immutable' });
    });
  }

  if (p === '/admin' || p.startsWith('/admin/') || p === '/admin.js' || p.startsWith('/api/admin/')) {
    if (!requireAdmin(req, res)) return;
    if (m === 'GET' && (p === '/admin' || p === '/admin/')) return serveStatic(res, 'admin.html');
    if (m === 'GET' && p === '/admin.js') return serveStatic(res, 'admin.js');
    if ((await adminRoutes(req, res, p, m, url)) !== false) return;
  }
  send(res, 404, { error: 'Not found' });
}

function kioskUrls() {
  const urls = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === 'IPv4' && !a.internal) urls.push(`http://${a.address}:${config.port}/`);
    }
  }
  return urls;
}

const server = http.createServer((req, res) => {
  handle(req, res).catch(err => {
    console.error(err);
    if (!res.headersSent) send(res, 500, { error: err.message || 'Server error' });
  });
});

server.listen(config.port, () => {
  console.log('');
  console.log('  Stonehenge Micro In-Service is running.');
  console.log('');
  console.log(`  On this computer:   http://localhost:${config.port}/`);
  for (const u of kioskUrls()) console.log(`  iPad / other PCs:   ${u}`);
  console.log(`  Admin page:         add "admin" to the end of the address, e.g. http://localhost:${config.port}/admin`);
  if (config.adminPassword === 'changeme' && !passwordFromEnv) {
    console.log('');
    console.log('  NOTE: the admin password is still "changeme". Change it on the Settings tab of the admin page.');
  }
  console.log('');
  console.log('  Leave this window open. Closing it stops the in-service site.');
});
