// Stonehenge Micro In-Service — a small, self-contained web server.
// No installs needed: run with `node server.js` (Node 18 or newer).
// Data lives in ./data/db.json (or $DATA_DIR/db.json), with daily backups in ./data/backups/.

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const net = require('net');
const tls = require('tls');

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

function today(d = new Date()) {
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
// "Breinholt, John Philip", "John Philip Breinholt" and "John Breinholt" are the same person:
// same first and last name, ignoring middle names, commas and case.
function nameParts(n) {
  let s = String(n || '').toLowerCase().replace(/[^a-z,'\s-]/g, ' ').trim();
  const m = s.match(/^([^,]+),\s*(.+)$/);
  if (m) s = `${m[2]} ${m[1]}`;
  return s.split(/\s+/).filter(Boolean);
}
function looseSameName(a, b) {
  const x = nameParts(a), y = nameParts(b);
  if (!x.length || !y.length) return false;
  return x[0] === y[0] && x[x.length - 1] === y[y.length - 1];
}

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
    adminName: 'Patrick',     // the main admin login's first name, for the Today greeting
    // When no schedule covers someone: 'weekly' = one topic per department per week (changes Monday),
    // 'daily' = one per department per day, 'random' = per person.
    fallbackMode: 'weekly',
    // Day of the week (0 = Sunday ... 6 = Saturday) when a Culture-category topic replaces the regular one.
    // null = no culture day; Culture topics then rotate like any other topic.
    cultureDay: 5,
    // Quiz-only day (0-6, or null for none): no lesson, one question from a topic the person did in the past week.
    quizDay: null,
    quizText: { en: 'This checks something you learned this past week.', es: 'Esto repasa algo que aprendió esta semana.' },
    departments: ['CNA', 'Nursing', 'Dietary', 'Housekeeping', 'Therapy', 'Activities', 'Social Services', 'Administration'],
    allowUnlisted: true,      // staff not on the roster can type their name instead
    leaders: {},              // { department: leader name and email(s) }, for the Clock-in check lists and follow-up emails
    alertEmails: [],          // emailed when someone not on the roster does an in-service
    missedFollowup: true,     // a first-try miss asks the department leader to re-educate and attest
    jobDepartments: {},       // { job title: department }, so titles like "Registered Nurse (RN)" land in Nursing
    // New hire starter set: topics given one per visit, in this order, for this many days after the hire date.
    starter: { topicIds: [], days: 60 },
    // Spaced review: a first-try miss brings the topic back after firstDays, then after secondDays, asked a different way.
    review: { on: true, firstDays: 2, secondDays: 7 },
    decor: defaultDecor(),    // home screen decorations, one set per month
    celebrations: true,       // show staff birthdays and work anniversaries on the kiosk
    // Public streaks: shout-outs in the home screen banner, and a leaderboard ('off', 'home', 'end' or 'both')
    // of the facility's top 1 or 3, the leader of each department, or both (board: 'facility', 'dept', 'both').
    // button: a 🏆 button on the home screen that opens the full leaderboard.
    streaks: { shoutOuts: false, leaderboard: 'off', top: 3, board: 'facility', button: false },
    newsSeconds: 3,           // how long each announcement shows in the home screen banner
    kioskQuietMin: 120,       // warn on the admin page when the iPad hasn't checked in for this long (0 = never)
    // Shown to the person after their in-service on their day; one picked at random. {name} = first name, {years} = years worked.
    birthdayMessages: ['Happy birthday, {name}! We hope your day is as great as you are.', 'Happy birthday, {name}! Thanks for spending part of your special day with us.',
      'Happy birthday, {name}! Our residents and team are lucky to have you.', 'It\'s your day, {name}! Happy birthday from all of us.'],
    anniversaryMessages: ['Happy {years}-year anniversary, {name}! Thank you for being here.', '{years} years, {name}! Thank you for everything you do.'],
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
  d.popupSeen = Array.isArray(d.popupSeen) ? d.popupSeen : [];   // [{ id, employeeId, at, choice? }] who tapped "Got it" (or a custom button like "RSVP Yes") on a pop-up
  d.followups = Array.isArray(d.followups) ? d.followups : [];
  d.emailLog = Array.isArray(d.emailLog) ? d.emailLog : [];
  d.admins = Array.isArray(d.admins) ? d.admins : [];
  d.sessionSecret = d.sessionSecret || crypto.randomBytes(32).toString('hex');   // signs the admin sign-in cookie
  const old = d.settings || {};
  d.settings = Object.assign(defaultSettings(), old);
  d.settings.review = Object.assign({ on: true, firstDays: 2, secondDays: 7 }, d.settings.review);
  const st = d.settings.starter;
  d.settings.starter = { topicIds: st && Array.isArray(st.topicIds) ? st.topicIds : [], days: st && st.days > 0 ? st.days : 60 };
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
// One-time: more ways to ask each sample topic, so spaced review can ask a different question (October 2026).
// Adds only the new sample questions a topic doesn't already have; nothing you wrote is changed.
if (!(db.settings.sampleRefresh >= 2)) {
  for (const s of loadJson(SEED_FILE, [])) {
    const t = db.topics.find(x => sameText(x.title, s.title));
    if (!t) continue;
    const { topic } = validateTopicInput(s);
    // Only the questions written in October 2026, so an original you reworded isn't added back.
    const added = topic.questions.filter((q, i) => s.questions[i].added === '2026-10' && !t.questions.some(x => sameText(x.text, q.text)));
    if (!added.length) continue;
    t.questions.push(...added);
    t.updatedAt = nowIso();
  }
  db.settings.sampleRefresh = 2;
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
    explanation: cleanText(q.explanation, 2000),
    // Blank = everyone the topic is for. Otherwise only these departments get this question.
    departments: cleanList(q.departments, 60, 30)
  };
  const errors = [];
  const label = `Question ${n}`;
  if (!out.text) errors.push(`${label}: the question is empty.`);
  if (!out.correctAnswers.length) errors.push(`${label}: add the correct answer.`);
  if (out.type === 'single' && out.correctAnswers.length > 1) errors.push(`${label}: has more than one correct answer, so make it "select all that apply".`);
  if (out.wrongAnswers.length < 1) errors.push(`${label}: add at least one wrong answer.`);
  const all = [...out.correctAnswers, ...out.wrongAnswers].map(a => a.toLowerCase());
  if (new Set(all).size !== all.length) errors.push(`${label}: each answer choice must be different.`);
  // Optional Spanish version. Answers pair up with the English ones by position, so the counts must match.
  const es = q.es && typeof q.es === 'object' ? {
    text: cleanText(q.es.text, 1000),
    correctAnswers: cleanList(q.es.correctAnswers, 500, 8),
    wrongAnswers: cleanList(q.es.wrongAnswers, 500, 8),
    hint: cleanText(q.es.hint, 1000),
    explanation: cleanText(q.es.explanation, 2000)
  } : null;
  if (es && (es.text || es.correctAnswers.length || es.wrongAnswers.length || es.hint || es.explanation)) {
    if (!es.text) errors.push(`${label} (Spanish): the question is empty.`);
    if (es.correctAnswers.length !== out.correctAnswers.length || es.wrongAnswers.length !== out.wrongAnswers.length) {
      errors.push(`${label} (Spanish): give the same number of correct and wrong answers as in English, in the same order.`);
    }
    out.es = es;
  }
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
  // Like the picture, only touched when given, so a spreadsheet import keeps these.
  if ('annual' in input) t.annual = !!input.annual;
  if ('es' in input) {
    const es = input.es && typeof input.es === 'object' ? input.es : {};
    t.es = { title: cleanText(es.title, 200), lesson: cleanText(es.lesson, 5000) };
    if (!t.es.title && !t.es.lesson) t.es = null;
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

// The questions in a topic meant for this department. A question with no departments is for everyone;
// if none are left for this department, every question is fair game so nobody gets stuck.
function questionsFor(topic, dept) {
  const mine = topic.questions.filter(q => forDepartment(q.departments, dept));
  return mine.length ? mine : topic.questions;
}
// Pick the question in a topic this person has seen least (and not the one they saw last).
function pickQuestion(topic, employeeId, avoid = [], dept = '') {
  let qs = questionsFor(topic, dept);
  if (qs.length === 1 || !employeeId) return pickRandom(qs);
  // For a review, skip the questions they missed, so it's asked a different way (if the topic has other questions).
  if (avoid.length && qs.some(q => !avoid.includes(q.id))) qs = qs.filter(q => !avoid.includes(q.id));
  if (qs.length === 1) return qs[0];
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

// ---------- Quiz-only day ----------
const isQuizDay = (date = today()) => Number.isInteger(db.settings.quizDay) && weekday(date) === db.settings.quizDay;
// One question from a topic this person did in the past 7 days, ones they missed first, then the most recent.
// A different question than the ones they've already seen from it lately. Someone with nothing recent (new, PRN,
// back from leave, or not on the roster) gets a topic their department did this week.
function quizFor(emp, dept) {
  const from = addDays(today(), -7), now = today();
  const quizzedToday = new Set(db.responses.filter(r => emp && r.employeeId === emp.id && r.date === now && r.kind === 'quiz').map(r => r.topicId));
  const mine = emp ? db.responses.filter(r => r.employeeId === emp.id && r.completed && r.date >= from && r.date < now && r.kind !== 'quiz') : [];
  const byTopic = {};
  for (const r of mine) {
    const x = byTopic[r.topicId] || (byTopic[r.topicId] = { missed: false, last: '', seen: [] });
    x.missed = x.missed || !r.firstTryCorrect; x.last = r.submittedAt > x.last ? r.submittedAt : x.last; x.seen.push(r.questionId);
  }
  const ranked = Object.entries(byTopic).filter(([id]) => isLive(findTopic(id)) && !quizzedToday.has(id))
    .sort(([, a], [, b]) => (b.missed - a.missed) || b.last.localeCompare(a.last));
  if (ranked.length) { const [id, x] = ranked[0]; return { topic: findTopic(id), avoid: x.seen, from: 'mine' }; }
  // Nothing of their own: the topic their department did most this week.
  const count = {};
  for (const r of db.responses) if (r.date >= from && r.date < now && r.kind !== 'quiz' && sameText(r.department || '', dept || '') && isLive(findTopic(r.topicId)) && !quizzedToday.has(r.topicId)) count[r.topicId] = (count[r.topicId] || 0) + 1;
  const best = Object.entries(count).sort((a, b) => b[1] - a[1])[0];
  if (best) return { topic: findTopic(best[0]), avoid: [], from: 'dept' };
  return null;
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

// Answer choices as { en, es } pairs. Answers are always checked against the English text.
function choicesFor(q) {
  const es = q.es || { correctAnswers: [], wrongAnswers: [] };
  return [...q.correctAnswers.map((en, i) => ({ en, es: es.correctAnswers[i] || '' })),
    ...q.wrongAnswers.map((en, i) => ({ en, es: es.wrongAnswers[i] || '' }))];
}
// Spanish is offered only when the topic has a Spanish lesson and the question has a Spanish version.
const hasSpanish = (topic, q) => !!(topic.es && topic.es.lesson && q.es && q.es.text);

function kioskItem(topic, employeeId, extra, dept = '') {
  const q = pickQuestion(topic, employeeId, (extra && extra.avoid) || [], dept);
  if (extra) delete extra.avoid;
  return itemForQuestion(topic, q, extra);
}
function itemForQuestion(topic, q, extra) {
  const es = hasSpanish(topic, q);
  return Object.assign({
    topic: { id: topic.id, title: topic.title, category: topic.category, lesson: topic.lesson, image: topic.image || '' },
    question: { id: q.id, type: q.type, text: q.text, answers: shuffle(choicesFor(q)) },
    es: es ? { title: topic.es.title || topic.title, lesson: topic.es.lesson, question: q.es.text } : null,
    // Lets the iPad grade answers itself if the Wi-Fi drops mid in-service. The correct answers are only sent as a salted hash.
    offline: Object.assign({ hint: q.hint, explanation: q.explanation, hintEs: es ? q.es.hint : '', explanationEs: es ? q.es.explanation : '' }, answerKey(q))
  }, extra);
}
const answerSet = list => [...new Set(list.map(a => String(a).trim().toLowerCase()))].sort().join('\n');
function answerKey(q) {
  const salt = crypto.randomBytes(8).toString('hex');
  return { salt, key: crypto.createHash('sha256').update(salt + answerSet(q.correctAnswers)).digest('hex') };
}
const isRightAnswer = (q, chosen) => answerSet(chosen) === answerSet(q.correctAnswers);

// A new response record for a person's first answer to a question.
function newResponse(b, topic, q, at = new Date()) {
  const w = b.who || {};
  const emp = w.employeeId ? findEmployee(String(w.employeeId)) : null;
  if (w.employeeId && !emp) return null;
  const name = emp ? emp.name : cleanText(w.name, 100);
  if (!name) return null;
  const kind = ['required', 'scheduled', 'rotation', 'starter', 'annual', 'review', 'quiz'].includes(b.kind) ? b.kind : 'rotation';
  return {
    id: newId(), submittedAt: at.toISOString(), date: today(at),
    employeeId: emp ? emp.id : null, name, last4: emp ? emp.last4 : cleanLast4(w.last4) || '',
    department: emp ? emp.department : cleanText(w.department, 60), verified: !!emp,
    kind, requiredId: kind === 'required' ? cleanText(b.requiredId, 20) : null,
    scheduleId: kind === 'scheduled' ? cleanText(b.scheduleId, 20) : null,
    topicId: topic.id, topicTitle: topic.title, questionId: q.id, question: q.text,
    correctAnswer: q.correctAnswers.join('; '), attempts: [], firstTryCorrect: false, completed: false, completedAt: null
  };
}

// Encouragement after a correct answer: in-service milestones for the year, or a first-try streak.
const MILESTONES = [10, 25, 50, 75, 100, 150, 200, 250, 300, 365];
// Streaks count days: the first answer each day adds one if right on the first try, or resets it if not
// (even if the person never finished that question). More answers the same day don't change it.
// Returns { employeeId: { streak, year, events } }, where events are the milestones reached today.
function streakStats(onlyId) {
  const by = {};
  const date = today(), year = date.slice(0, 4);
  for (const r of db.responses) {
    if (!r.employeeId || !r.attempts.length || (onlyId && r.employeeId !== onlyId)) continue;
    const x = by[r.employeeId] || (by[r.employeeId] = { streak: 0, year: 0, events: [], day: null });
    // Only the first answer of each day counts, so taking it again can't add to or break the streak.
    const grew = x.day !== r.date && !!r.firstTryCorrect;
    if (x.day !== r.date) { x.streak = r.firstTryCorrect ? x.streak + 1 : 0; x.day = r.date; }
    if (r.completed && r.date.startsWith(year)) {
      x.year++;
      if (r.date === date && MILESTONES.includes(x.year)) x.events.push({ type: 'year', n: x.year });
    }
    if (r.date === date && grew && x.streak >= 5 && x.streak % 5 === 0) x.events.push({ type: 'streak', n: x.streak });
  }
  return by;
}
function cheerFor(emp) {
  if (!emp) return null;
  const x = streakStats(emp.id)[emp.id];
  const last = x && x.events[x.events.length - 1];
  // Only when the answer just given reached the mark.
  if (!last || (last.type === 'year' ? last.n !== x.year : last.n !== x.streak)) return null;
  return last.type === 'year'
    ? { en: `🏆 That's your ${last.n}th in-service this year!`, es: `🏆 ¡Es su in-service número ${last.n} este año!` }
    : { en: `🔥 ${last.n} days in a row right on the first try!`, es: `🔥 ¡${last.n} días seguidos correctos al primer intento!` };
}
// What to tell the person about spaced review after they finish a question.
function reviewNote(r) {
  if (!r.employeeId || !db.settings.review.on) return null;
  const state = reviewStates(r.employeeId).find(x => x.topicId === r.topicId);
  if (!r.firstTryCorrect) return 'later';                            // "We'll check back on this one in a few days."
  if (r.kind === 'review') return state ? 'progress' : 'mastered';  // "Nice, it's sticking." / "Got it! Mastered."
  return null;
}
const STREAK_LEADER_MIN = 3;
// Public streak lines for the kiosk, depending on the settings.
function publicStreaks() {
  const set = db.settings.streaks || {};
  const boardOn = (set.leaderboard && set.leaderboard !== 'off') || !!set.button;
  if (!set.shoutOuts && !boardOn) return { shoutOuts: [], leaders: [], deptLeaders: [], leadersOn: 'off', button: false };
  const stats = streakStats();
  const active = db.employees.filter(e => e.active && stats[e.id]);
  // A streak shout-out disappears if the streak breaks later the same day.
  const liveEvent = x => x.events.filter(ev => ev.type === 'year' || x.streak >= ev.n).pop();
  const shoutOuts = !set.shoutOuts ? [] : active.filter(e => liveEvent(stats[e.id])).map(e => {
    const ev = liveEvent(stats[e.id]);
    return { id: e.id, text: ev.type === 'year' ? `🏆 ${shortName(e.name)}: ${ev.n} in-services this year!` : `🔥 ${shortName(e.name)} is on a ${ev.n}-day streak!` };
  });
  const ranked = !boardOn ? [] : active.filter(e => stats[e.id].streak >= STREAK_LEADER_MIN && !e.noBoard)
    .sort((a, b) => stats[b.id].streak - stats[a.id].streak || a.name.localeCompare(b.name))
    .map(e => ({ id: e.id, name: shortName(e.name), department: e.department, streak: stats[e.id].streak }));
  const board = set.board || 'facility';
  // Ties share a place: "Top 3" is the top 3 streak lengths, with everyone who has them (the iPad shows a few names per place).
  const places = [...new Set(ranked.map(l => l.streak))].slice(0, set.top === 1 ? 1 : 3);
  const leaders = board === 'dept' ? [] : ranked.filter(l => places.includes(l.streak)).map(l => Object.assign(l, { rank: places.indexOf(l.streak) + 1 }));
  // The top streak in each department (everyone tied for it), in the order departments are listed in Settings.
  const deptLeaders = board === 'facility' ? [] : db.settings.departments.flatMap(d => {
    const mine = ranked.filter(l => sameText(l.department || '', d));
    return mine.filter(l => l.streak === (mine[0] || {}).streak).map(l => Object.assign({}, l, { department: d }));
  });
  return { shoutOuts, leaders, deptLeaders, leadersOn: set.leaderboard || 'off', button: !!set.button };
}

// ---------- New hire starter set and yearly topics ----------

// The date each person last finished each topic: { 'employeeId|topicId': 'YYYY-MM-DD' }.
function lastCompletions(employeeId) {
  const last = {};
  for (const r of db.responses) {
    if (!r.completed || !r.employeeId || (employeeId && r.employeeId !== employeeId)) continue;
    const k = `${r.employeeId}|${r.topicId}`;
    if (!last[k] || r.date > last[k]) last[k] = r.date;
  }
  return last;
}

const isNewHire = (emp, date = today()) => !!(emp && emp.active && emp.hireDate && addDays(emp.hireDate, db.settings.starter.days) >= date);
const starterTopicsFor = emp => db.settings.starter.topicIds.map(findTopic).filter(t => isLive(t) && forDepartment(t.departments, emp.department));

// The starter topics this new hire has finished since their hire date, and the next one to do.
function starterProgress(emp, last = lastCompletions(emp.id)) {
  const topics = starterTopicsFor(emp);
  const done = topics.filter(t => (last[`${emp.id}|${t.id}`] || '') >= emp.hireDate);
  return { total: topics.length, done: done.length, next: topics.find(t => !done.includes(t)) || null };
}

function addYears(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  const x = new Date(y + n, m - 1, d);
  if (x.getMonth() !== m - 1) x.setDate(0); // Feb 29 -> Feb 28
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}
const DUE_SOON_DAYS = 30;
// A yearly topic is due one year after it was last finished. It's offered on the iPad from 30 days before.
function annualStatus(last) {
  if (!last) return { status: 'never', last: null, due: null };
  const due = addYears(last, 1);
  return { status: due < today() ? 'overdue' : due <= addDays(today(), DUE_SOON_DAYS) ? 'soon' : 'current', last, due };
}
const annualTopicsFor = emp => db.topics.filter(t => t.annual && isLive(t) && forDepartment(t.departments, emp.department));

// The one yearly topic this person should do next: never done first, then the longest overdue, then due soonest.
function nextAnnualFor(emp) {
  const last = lastCompletions(emp.id);
  const rank = { never: 0, overdue: 1, soon: 2 };
  return annualTopicsFor(emp)
    .map(t => Object.assign({ topic: t }, annualStatus(last[`${emp.id}|${t.id}`])))
    .filter(x => x.status !== 'current')
    .sort((a, b) => rank[a.status] - rank[b.status] || (a.due || '').localeCompare(b.due || '') || a.topic.title.localeCompare(b.topic.title))[0] || null;
}

// ---------- Spaced review of missed questions ----------
// Worked out from the person's answers, so nothing extra is stored:
// a first-try miss starts a review (check-in 1, due firstDays later). A first-try right answer on that topic,
// on or after the due date, moves it to check-in 2 (due secondDays later), and then clears it.
// Another first-try miss starts it over. Answers before the due date don't move it either way, except misses.
function reviewStates(employeeId) {
  const cfg = db.settings.review;
  const states = {}; // 'employeeId|topicId' -> { employeeId, topicId, stage, due, missed: [questionIds], since }
  // In time order: answers saved offline can arrive after later ones.
  const list = db.responses.filter(r => r.employeeId && r.attempts.length && (!employeeId || r.employeeId === employeeId))
    .sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));
  for (const r of list) {
    const k = `${r.employeeId}|${r.topicId}`;
    const cur = states[k];
    if (!r.firstTryCorrect) {
      states[k] = { employeeId: r.employeeId, topicId: r.topicId, stage: 1, due: addDays(r.date, cfg.firstDays),
        missed: [...new Set([...(cur ? cur.missed : []), r.questionId])], since: cur ? cur.since : r.date, lastMiss: r.submittedAt };
    } else if (cur && r.date >= cur.due) {
      if (cur.stage === 1) Object.assign(cur, { stage: 2, due: addDays(r.date, cfg.secondDays) });
      else delete states[k];
    }
  }
  // Taken off by an admin: that review is dropped until the person misses the topic again.
  // People marked "no spaced review" on the Staff tab never get one.
  const skips = db.reviewSkips || [];
  return Object.values(states).filter(x => isLive(findTopic(x.topicId))
    && !skips.some(sk => sk.employeeId === x.employeeId && sk.topicId === x.topicId && sk.at >= x.lastMiss)
    && !(findEmployee(x.employeeId) || {}).noReview);
}
// The one review this person should do now: the most overdue.
function nextReviewFor(emp) {
  if (!db.settings.review.on) return null;
  return reviewStates(emp.id).filter(x => x.due <= today()).sort((a, b) => a.due.localeCompare(b.due))[0] || null;
}

function annualReport() {
  const last = lastCompletions();
  const staff = db.employees.filter(e => e.active);
  return db.topics.filter(t => t.annual && t.status !== 'retired').sort((a, b) => a.title.localeCompare(b.title)).map(t => {
    const people = staff.filter(e => forDepartment(t.departments, e.department)).map(e => Object.assign(
      { id: e.id, name: e.name, last4: e.last4, department: e.department }, annualStatus(last[`${e.id}|${t.id}`])));
    const count = st => people.filter(p => p.status === st).length;
    return { id: t.id, title: t.title, departments: t.departments, status: t.status,
      current: count('current'), soon: count('soon'), overdue: count('overdue'), never: count('never'), people };
  });
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
  if ('jobTitle' in input && (input.jobTitle || !input.keepBlank)) e.jobTitle = cleanText(input.jobTitle, 100);
  if ('noReview' in input) e.noReview = !!input.noReview;
  if ('noBoard' in input) e.noBoard = !!input.noBoard;   // kept off the streak board (department heads who work 5 days a week, say)
  const errors = [];
  if (!e.name) errors.push('Name is required.');
  if (!e.last4) errors.push('Enter the last 4 digits of the Workday ID.');
  return { employee: e, errors };
}

// "Maria L" — enough for staff to recognize themselves without showing full names on the kiosk.
function shortName(name) {
  const parts = name.trim().split(/\s+/);
  return parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}` : parts[0];
}

// ---------- HTTP helpers ----------

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
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

// Admin sign-in: the main "admin" login (ADMIN_PASSWORD), plus extra logins added in Settings (db.admins, scrypt-hashed passwords).
const hashPassword = (password, salt = crypto.randomBytes(16).toString('hex')) => ({ salt, hash: crypto.scryptSync(password, salt, 32).toString('hex') });
const okLogins = new Map();   // recently checked "user:password" -> username, so each page request doesn't re-run scrypt
function isAdmin(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Basic ')) return sessionUser(req);
  const [user, ...rest] = Buffer.from(header.slice(6), 'base64').toString('utf8').split(':');
  return checkLogin(user, rest.join(':'), header);
}
function checkLogin(user, pass, cacheKey = `${user}:${pass}`) {
  const header = cacheKey;
  const given = Buffer.from(`${user}:${pass}`);
  const expected = Buffer.from(`${config.adminUser}:${config.adminPassword}`);
  if (given.length === expected.length && crypto.timingSafeEqual(given, expected)) return config.adminUser;
  const key = crypto.createHash('sha256').update(header).digest('hex');
  const hit = okLogins.get(key);
  const a = (db.admins || []).find(x => x.username === String(user).trim().toLowerCase());
  if (!a) return null;
  if (hit && hit.u === a.username && hit.v === a.hash && Date.now() - hit.at < 600000) return a.username;
  const h = Buffer.from(hashPassword(pass, a.salt).hash, 'hex');
  if (!crypto.timingSafeEqual(h, Buffer.from(a.hash, 'hex'))) return null;
  okLogins.set(key, { u: a.username, v: a.hash, at: Date.now() });
  if (okLogins.size > 200) okLogins.delete(okLogins.keys().next().value);
  if (!a.lastSeen || Date.now() - Date.parse(a.lastSeen) > 3600000) { a.lastSeen = nowIso(); saveDb(); }
  return a.username;
}

// Signing in on the sign-in page sets a cookie that lasts 90 days. This is what the home-screen app uses,
// since an iPhone home-screen app can't show the browser's username/password box.
// The cookie stops working when that login's password changes or the login is removed.
const SESSION_DAYS = 90;
const loginStamp = user => user === config.adminUser ? crypto.createHash('sha256').update(String(config.adminPassword)).digest('hex').slice(0, 16)
  : ((db.admins || []).find(a => a.username === user) || {}).hash;
const sessionSig = (user, exp) => crypto.createHmac('sha256', db.sessionSecret).update(`${user}|${exp}|${loginStamp(user)}`).digest('base64url');
function sessionCookie(req, user) {
  const exp = Date.now() + SESSION_DAYS * 864e5;
  const secure = req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : '';
  return `adm=${encodeURIComponent(user)}.${exp}.${sessionSig(user, exp)}; Path=/; Max-Age=${SESSION_DAYS * 86400}; HttpOnly; SameSite=Lax${secure}`;
}
function sessionUser(req) {
  const m = /(?:^|;\s*)adm=([^;]+)/.exec(req.headers.cookie || '');
  if (!m) return null;
  const [u, exp, sig] = m[1].split('.');
  const user = decodeURIComponent(u || '');
  if (!user || !(Number(exp) > Date.now()) || !loginStamp(user)) return null;
  const want = Buffer.from(sessionSig(user, exp)), got = Buffer.from(sig || '');
  return want.length === got.length && crypto.timingSafeEqual(want, got) ? user : null;
}
function requireAdmin(req, res) {
  req.adminUser = isAdmin(req);
  if (req.adminUser) return true;
  const url = req.url || '/admin';
  if (req.method === 'GET' && !url.startsWith('/api/')) {
    res.writeHead(302, { Location: '/admin/login?next=' + encodeURIComponent(url), 'Cache-Control': 'no-store' });
    res.end();
  } else send(res, 401, { error: 'Please sign in again.', signIn: true });
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
    (!q.get('missed') || !r.firstTryCorrect) &&
    (!q.get('helpful') || (q.get('helpful') === 'up' ? r.helpful === true : q.get('helpful') === 'down' ? r.helpful === false : 'helpful' in r)) &&
    (!q.get('employeeId') || r.employeeId === q.get('employeeId')) &&
    (!q.get('kind') || (q.get('kind') === 'noquiz' ? r.kind !== 'quiz' : r.kind === q.get('kind')))
  );
}

function todaysAnnouncements() {
  const d = today();
  return db.announcements.filter(a => !a.popup && a.startDate <= d && (!a.endDate || a.endDate >= d))
    .sort((a, b) => b.startDate.localeCompare(a.startDate)).map(a => ({ text: a.text, departments: a.departments }));
}
// Pop-up announcements (an RSVP QR code, say) for this person after they pick their name.
// Shown once each, unless set to show every time; people not on the roster see them every time.
function popupsFor(who) {
  const d = today();
  return db.announcements.filter(a => a.popup && a.startDate <= d && (!a.endDate || a.endDate >= d))
    .filter(a => !a.departments.length || a.departments.includes(who.department))
    // Once per person, unless the button they picked is one that asks again next time (like "Not sure yet").
    .filter(a => a.everyTime || !who.employeeId || !db.popupSeen.some(x => x.id === a.id && x.employeeId === who.employeeId && !(a.repeat || []).includes(x.choice)))
    .map(a => ({ id: a.id, title: a.title, text: a.text, image: a.image, buttons: a.buttons || [], confirm: !!a.confirm }));
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

// When the iPad last checked in. It asks for its settings every minute while it shows the keypad.
// When the iPad last loaded its settings (it does every minute on the home screen). Kept in a small file so a restart
// or update doesn't look like the iPad went quiet.
const KIOSK_SEEN_FILE = path.join(DATA_DIR, 'kiosk-seen.json');
let kioskSeen = null;
try { kioskSeen = JSON.parse(fs.readFileSync(KIOSK_SEEN_FILE, 'utf8')); } catch { kioskSeen = null; }
let kioskSeenSaved = 0;
function noteKioskSeen(seen) {
  kioskSeen = seen;
  if (Date.now() - kioskSeenSaved < 5 * 60000) return;
  kioskSeenSaved = Date.now();
  try { fs.writeFileSync(KIOSK_SEEN_FILE, JSON.stringify(seen)); } catch { /* not important */ }
}
const serverStartedAt = nowIso();

// ---------- Email alerts and leader follow-ups ----------
// Email goes out through a Gmail account (GMAIL_USER + GMAIL_APP_PASSWORD), any SMTP server (SMTP_HOST, SMTP_USER, SMTP_PASS),
// or Brevo's email API (BREVO_API_KEY + MAIL_FROM), set on the server (Render: Environment).
// Until one is set nothing is emailed, but follow-ups still show on the admin Reports tab.
const SMTP = {
  host: process.env.SMTP_HOST || (process.env.GMAIL_USER ? 'smtp.gmail.com' : ''),
  port: Number(process.env.SMTP_PORT) || 465,
  secure: process.env.SMTP_SECURE !== 'false',   // TLS from the start (port 465)
  user: process.env.SMTP_USER || process.env.GMAIL_USER || '',
  pass: (process.env.SMTP_PASS || process.env.GMAIL_APP_PASSWORD || '').replace(/\s+/g, '')   // Google shows app passwords with spaces
};
const MAIL = { key: process.env.BREVO_API_KEY || '', from: process.env.MAIL_FROM || SMTP.user, fromName: process.env.MAIL_FROM_NAME || 'Stonehenge In-Service' };
const useSmtp = () => !!(SMTP.host && SMTP.user && SMTP.pass);
const emailReady = () => useSmtp() || !!(MAIL.key && MAIL.from);
// A small SMTP client (no packages needed): one connection per email.
function smtpSend(to, subject, html) {
  return new Promise((resolve, reject) => {
    const sock = SMTP.secure ? tls.connect({ host: SMTP.host, port: SMTP.port, servername: SMTP.host }) : net.connect({ host: SMTP.host, port: SMTP.port });
    sock.setTimeout(20000, () => { sock.destroy(); reject(new Error('The mail server did not answer.')); });
    sock.on('error', reject);
    const b64 = v => Buffer.from(v, 'utf8').toString('base64');
    const word = v => /^[\x20-\x7e]*$/.test(v) ? v : `=?UTF-8?B?${b64(v)}?=`;
    const msg = [`From: ${word(MAIL.fromName)} <${MAIL.from}>`, `To: ${to.join(', ')}`, `Subject: ${word(subject)}`, `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${crypto.randomBytes(12).toString('hex')}@${MAIL.from.split('@')[1] || 'localhost'}>`, 'MIME-Version: 1.0',
      'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', b64(html).replace(/.{76}/g, '$&\r\n')].join('\r\n');
    const steps = [[220, null], [250, `EHLO stonehenge-inservice`], [334, 'AUTH LOGIN'], [334, b64(SMTP.user)], [235, b64(SMTP.pass)], [250, `MAIL FROM:<${MAIL.from}>`],
      ...to.map(t => [250, `RCPT TO:<${t}>`]), [354, 'DATA'], [250, msg + '\r\n.'], [221, 'QUIT']];
    let i = 0, buf = '';
    sock.on('data', d => {
      buf += d.toString('utf8');
      // Wait for the last line of a reply ("250 ok", not "250-...").
      const lines = buf.split('\r\n').filter(Boolean);
      const last = lines[lines.length - 1];
      if (!buf.endsWith('\r\n') || !/^\d{3} /.test(last)) return;
      buf = '';
      const code = Number(last.slice(0, 3));
      if (code !== steps[i][0]) { sock.destroy(); return reject(new Error(code === 535 ? 'The mail server rejected the username or app password.' : last.slice(0, 200))); }
      i++;
      if (i >= steps.length) { sock.end(); return resolve(); }
      sock.write(steps[i][1] + '\r\n');
    });
  });
}
// Text without the **bold**, *italic*, __underline__ and ~~strike~~ marks, for emails, CSV and lists.
const plainText = t => String(t || '').replace(/\*\*(?=\S)(.+?)\*\*/g, '$1').replace(/__(?=\S)(.+?)__/g, '$1').replace(/~~(?=\S)(.+?)~~/g, '$1').replace(/(^|[^*\w])\*(?=\S)([^*]+?)\*(?![*\w])/g, '$1$2');
const emailsIn = text => [...new Set((String(text || '').match(/[^\s<>,;:"'()]+@[^\s<>,;:"'()]+\.[a-z]{2,}/gi) || []).map(e => e.toLowerCase()))];
function leaderFor(dept) {
  const key = Object.keys(db.settings.leaders || {}).find(k => sameText(k, dept || ''));
  return key ? db.settings.leaders[key] : '';
}
// "Andi, andi@x.com" -> "Andi"
const leaderName = l => String(l || '').replace(/[^\s,;<>()]+@[^\s,;<>()]+/g, '').replace(/[\s,;<>()]+$/, '').replace(/[\s,;<>()]+(?=[\s,;<>()])/g, '').trim();
const siteUrl = () => (process.env.PUBLIC_URL || process.env.RENDER_EXTERNAL_URL || `http://localhost:${config.port}`).replace(/\/$/, '');
const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function emailHtml(title, rows, button) {
  return `<div style="font-family:Arial,sans-serif;font-size:15px;color:#1d2b36;max-width:560px">
    <h2 style="color:#1f5f7a;margin:0 0 12px">${esc(title)}</h2>
    <table style="border-collapse:collapse">${rows.filter(r => r[1]).map(([k, v]) => `<tr><td style="padding:4px 14px 4px 0;color:#5b6b78;vertical-align:top">${esc(k)}</td><td style="padding:4px 0">${esc(v)}</td></tr>`).join('')}</table>
    ${button ? `<p style="margin:22px 0"><a href="${esc(button.url)}" style="background:#1f5f7a;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold">${esc(button.label)}</a></p>` : ''}
    <p style="color:#5b6b78;font-size:12px;margin-top:24px">Sent by the ${esc(db.settings.facilityName || 'Stonehenge')} in-service kiosk.</p></div>`;
}
async function sendEmail(to, subject, html, kind) {
  const log = { id: newId(), at: nowIso(), to, subject, kind, status: 'sent', error: '' };
  db.emailLog = [log].concat(db.emailLog || []).slice(0, 200);
  if (!to.length) log.status = 'no email address';
  else if (!emailReady()) log.status = 'email not set up';
  else if (useSmtp()) {
    try { await smtpSend(to, subject, html); } catch (err) { log.status = 'failed'; log.error = String(err.message || err).slice(0, 300); }
  } else {
    try {
      const r = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST', headers: { 'api-key': MAIL.key, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ sender: { email: MAIL.from, name: MAIL.fromName }, to: to.map(email => ({ email })), subject, htmlContent: html })
      });
      if (!r.ok) { log.status = 'failed'; log.error = (await r.text()).slice(0, 300); }
    } catch (err) { log.status = 'failed'; log.error = String(err.message || err).slice(0, 300); }
  }
  saveDb();
  return log;
}
const when = iso => new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
// Someone typed their name because they aren't on the roster: one email per name per day.
function alertUnlisted(r) {
  if (r.verified || r.alerted || !(db.settings.alertEmails || []).length) return;
  r.alerted = true;
  if (db.responses.some(x => x !== r && !x.verified && x.date === r.date && sameText(x.name, r.name))) return;
  sendEmail(db.settings.alertEmails, `Not on the roster: ${r.name} did an in-service`, emailHtml(`${r.name} isn't on the staff roster`, [
    ['Name typed', r.name], ['Last 4 typed', r.last4], ['Department', r.department], ['Topic', r.topicTitle], ['When', when(r.submittedAt)],
    ['What to do', 'Add them on the Staff tab of the admin page so their in-services count toward their record.']
  ], { url: siteUrl() + '/admin', label: 'Open the admin page' }), 'not on roster').catch(() => {});
}
// A first-try miss: the department leader re-educates the person and attests to it.
function followUpMiss(r) {
  if (!r.completed || r.firstTryCorrect || !db.settings.missedFollowup || db.followups.some(f => f.responseId === r.id)) return;
  const leader = leaderFor(r.department);
  const f = { id: newId(), token: crypto.randomBytes(18).toString('hex'), responseId: r.id, employeeId: r.employeeId, name: r.name, department: r.department,
    topicId: r.topicId, topicTitle: r.topicTitle, question: plainText(r.question), firstAnswer: r.attempts[0] || '', correctAnswer: r.correctAnswer,
    leader: leaderName(leader), emailedTo: emailsIn(leader), createdAt: nowIso(), attestedAt: null, attestedBy: '' };
  db.followups.push(f);
  saveDb();
  if (f.emailedTo.length) emailFollowup(f, false).catch(() => {});
}
function emailFollowup(f, reminder) {
  return sendEmail(f.emailedTo, `${reminder ? 'Reminder: please' : 'Please'} follow up: ${f.name} missed an in-service question`,
    emailHtml(`${reminder ? 'Reminder: ' : ''}${f.name} missed a question`, [
      ['Staff', `${f.name}${f.department ? ' (' + f.department + ')' : ''}`], ['Topic', f.topicTitle], ['Question', f.question],
      ['They first answered', f.firstAnswer], ['Correct answer', f.correctAnswer], ['When', when(f.createdAt)],
      ['What to do', 'Take a minute to go over this with them, then tap the button to confirm.']
    ], { url: `${siteUrl()}/attest/${f.token}`, label: "I've educated them" }), reminder ? 'reminder' : 'follow-up');
}
// One reminder email per leader listing everyone still waiting on them.
function digestHtml(list) {
  return `<div style="font-family:Arial,sans-serif;font-size:15px;color:#1d2b36;max-width:600px">
    <h2 style="color:#1f5f7a;margin:0 0 8px">Reminder: ${list.length} ${list.length === 1 ? 'person needs' : 'people need'} a quick re-education</h2>
    <p style="margin:0 0 14px;color:#5b6b78">Go over the question with each person, then tap their button to confirm.</p>
    ${list.map(f => `<div style="border:1px solid #dbe3e9;border-radius:10px;padding:12px 14px;margin-bottom:10px">
      <strong>${esc(f.name)}</strong>${f.department ? ` <span style="color:#5b6b78">(${esc(f.department)})</span>` : ''} <span style="color:#5b6b78;font-size:13px">· ${esc(when(f.createdAt))}</span>
      <div style="margin-top:4px">${esc(f.question)}</div>
      <div style="font-size:13px;color:#5b6b78;margin-top:2px">They answered: ${esc(f.firstAnswer)} · Correct: ${esc(f.correctAnswer)}</div>
      <div style="margin-top:10px"><a href="${esc(siteUrl() + '/attest/' + f.token)}" style="background:#1f5f7a;color:#fff;padding:8px 14px;border-radius:8px;text-decoration:none;font-weight:bold;font-size:14px">I've educated ${esc(f.name.split(' ')[0])}</a></div></div>`).join('')}
    <p style="color:#5b6b78;font-size:12px;margin-top:20px">Sent by the ${esc(db.settings.facilityName || 'Stonehenge')} in-service kiosk.</p></div>`;
}
function attestPage(f) {
  const done = f.attestedAt;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Follow-up</title>
  <style>body{font:16px/1.5 -apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#f3f6f8;color:#1d2b36;margin:0;padding:24px 16px}
  .card{max-width:520px;margin:0 auto;background:#fff;border:1px solid #dbe3e9;border-radius:14px;padding:22px}h1{font-size:21px;color:#1f5f7a;margin:0 0 12px}
  dt{color:#5b6b78;font-size:13px;margin-top:8px}dd{margin:0}input{width:100%;box-sizing:border-box;font:inherit;padding:10px;border:1px solid #dbe3e9;border-radius:8px;margin-top:4px}
  button{margin-top:14px;width:100%;font:inherit;font-weight:700;background:#1f5f7a;color:#fff;border:0;border-radius:10px;padding:14px;cursor:pointer}.ok{background:#e3f4ea;color:#1e7a4c;border-radius:10px;padding:12px;font-weight:700}</style></head>
  <body><div class="card"><h1>${esc(f.name)} missed a question</h1><dl>
  <dt>Department</dt><dd>${esc(f.department || '–')}</dd><dt>Topic</dt><dd>${esc(f.topicTitle)}</dd><dt>Question</dt><dd>${esc(f.question)}</dd>
  <dt>They first answered</dt><dd>${esc(f.firstAnswer)}</dd><dt>Correct answer</dt><dd>${esc(f.correctAnswer)}</dd></dl>
  <div id="box">${done ? `<p class="ok">✓ Educated. Confirmed by ${esc(f.attestedBy)} on ${esc(when(f.attestedAt))}.</p>`
    : `<label style="display:block;margin-top:16px">Your name<input id="by" autocomplete="name" value="${esc(f.leader)}"></label><button id="go">✓ I've educated them</button>`}</div></div>
  <script>var b=document.getElementById('go');if(b)b.onclick=function(){var n=document.getElementById('by').value.trim();if(!n){alert('Please type your name.');return}b.disabled=true;
  fetch(location.pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({by:n})}).then(function(r){return r.json()}).then(function(d){
  document.getElementById('box').innerHTML='<p class="ok">✓ Thank you! Recorded for '+${JSON.stringify(esc(f.name))}+'.</p>'}).catch(function(){b.disabled=false;alert('Could not save. Please try again.')})}</script></body></html>`;
}

async function kioskRoutes(req, res, p, m) {
  if (m === 'GET' && p === '/api/kiosk/config') {
    const s = db.settings;
    // ?month=10 previews another month's decor from the admin page.
    const previewMonth = Number(new URL(req.url, 'http://localhost').searchParams.get('month'));
    if (!previewMonth) {
      noteKioskSeen({ at: nowIso(), device: /iPad|Macintosh.*Mobile/.test(req.headers['user-agent'] || '') ? 'iPad' : 'browser',
        waiting: Math.max(0, Math.min(10000, Number(new URL(req.url, 'http://localhost').searchParams.get('waiting')) || 0)) });
    }
    const month = previewMonth || new Date().getMonth() + 1;
    const decor = s.decor && s.decor.on && month >= 1 && month <= 12 ? s.decor.months[month - 1] : null;
    return send(res, 200, { facilityName: s.facilityName, departments: s.departments, allowUnlisted: s.allowUnlisted, closingMessages: s.closingMessages, decor,
      announcements: todaysAnnouncements(), newsSeconds: s.newsSeconds || 3, streaks: publicStreaks(), birthdayMessages: s.birthdayMessages, anniversaryMessages: s.anniversaryMessages, celebrations: s.celebrations ? todaysCelebrations() : [], build: BUILD_ID });
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
        items.push(kioskItem(findTopic(q.topicId), who.employeeId, { kind: 'required', requiredId: q.id, reason: q.reason }, who.department));
      }
    }
    // Then, instead of the regular topic: the next new hire topic, a spaced review that is due, or one yearly topic that is due.
    const emp = who.employeeId ? findEmployee(who.employeeId) : null;
    if (!items.length && isNewHire(emp)) {
      const next = starterProgress(emp).next;
      if (next) items.push(kioskItem(next, emp.id, { kind: 'starter' }, who.department));
    }
    if (!items.length && emp) {
      const rv = nextReviewFor(emp);
      if (rv) items.push(kioskItem(findTopic(rv.topicId), emp.id, { kind: 'review', stage: rv.stage, avoid: rv.missed }, who.department));
    }
    // Quiz day: one question from their past week instead of a yearly or regular topic.
    if (!items.length && isQuizDay()) {
      const qz = quizFor(emp, who.department);
      if (qz) items.push(kioskItem(qz.topic, who.employeeId, { kind: 'quiz', avoid: qz.avoid, quizFrom: qz.from, quizText: db.settings.quizText }, who.department));
    }
    if (!items.length && emp) {
      const due = nextAnnualFor(emp);
      if (due) items.push(kioskItem(due.topic, emp.id, { kind: 'annual', due: due.due }, who.department));
    }
    if (!items.length) {
      const r = regularTopicFor(who.department);
      if (r.topic) items.push(kioskItem(r.topic, who.employeeId, { kind: r.source === 'schedule' ? 'scheduled' : 'rotation', scheduleId: r.scheduleId || null }, who.department));
    }
    return send(res, 200, { who: Object.assign(who, { firstName: who.name.split(' ')[0] }), items, popups: popupsFor(who) });
  }

  // "Got it" on a pop-up announcement, or the button they picked (like "RSVP Yes"). A new pick replaces the old one.
  if (m === 'POST' && p === '/api/kiosk/popup-seen') {
    const b = await readBody(req);
    const a = db.announcements.find(x => x.id === String(b.id || '') && x.popup);
    const e = b.employeeId && findEmployee(String(b.employeeId));
    if (a && e) {
      const choice = (a.buttons || []).includes(b.choice) ? b.choice : undefined;
      const had = db.popupSeen.find(x => x.id === a.id && x.employeeId === e.id);
      if (!had) { db.popupSeen.push(Object.assign({ id: a.id, employeeId: e.id, at: nowIso() }, choice ? { choice } : {})); saveDb(); }
      else if (choice && had.choice !== choice) { had.choice = choice; had.at = nowIso(); saveDb(); }
    }
    return send(res, 200, { ok: true });
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
      r = newResponse(b, topic, q);
      if (!r) return send(res, 400, { error: 'Please start again.' });
      db.responses.push(r);
      if (r.kind !== 'quiz') recordUsage(topic);   // a quiz doesn't make a topic "recently used" for the rotation
    }
    r.attempts.push(chosen.join('; '));
    r.lang = b.lang === 'es' ? 'es' : 'en';
    const correct = isRightAnswer(q, chosen);
    if (r.attempts.length === 1) r.firstTryCorrect = correct;
    if (correct) { r.completed = true; r.completedAt = nowIso(); }
    saveDb();
    if (r.attempts.length === 1) alertUnlisted(r);
    if (correct) followUpMiss(r);

    // Single choice: drop the wrong picks. Select-all: keep every choice (a partly right pick isn't "wrong").
    const all = choicesFor(q);
    const tried = r.attempts.map(a => a.toLowerCase());
    const remaining = q.type === 'multi' ? all : all.filter(a => !tried.includes(a.en.toLowerCase()));
    const es = hasSpanish(topic, q) ? q.es : null;
    return send(res, 200, {
      responseId: r.id,
      correct,
      firstTryCorrect: r.firstTryCorrect,
      hint: correct ? '' : q.hint,
      hintEs: correct || !es ? '' : es.hint,
      answers: correct ? [] : shuffle(remaining),   // try again with the wrong choices removed, in a new order
      correctAnswer: correct ? q.correctAnswers.join('; ') : null,
      explanation: correct ? q.explanation : '',
      explanationEs: correct && es ? es.explanation : '',
      cheer: correct ? cheerFor(r.employeeId && findEmployee(r.employeeId)) : null,
      review: correct ? reviewNote(r) : null,
      streaks: correct ? publicStreaks() : null   // fresh, so the end screen includes this answer
    });
  }

  // "Was this helpful?" on the last screen.
  if (m === 'POST' && p === '/api/kiosk/feedback') {
    const b = await readBody(req);
    const r = db.responses.find(x => x.id === String(b.responseId || ''));
    if (!r || !r.completed || 'helpful' in r) return send(res, 200, { ok: false });
    r.helpful = !!b.helpful;
    saveDb();
    return send(res, 200, { ok: true });
  }

  // Answers the iPad saved while it was offline. Every answer is graded again here; the iPad's grading is not trusted.
  if (m === 'POST' && p === '/api/kiosk/sync') {
    const records = ((await readBody(req, 5e6)).records || []).slice(0, 500);
    const done = [];
    for (const rec of records) {
      const offlineId = cleanText(rec && rec.offlineId, 40);
      if (!offlineId) continue;
      if (db.responses.some(x => x.offlineIds && x.offlineIds.includes(offlineId))) { done.push(offlineId); continue; }
      const attempts = (Array.isArray(rec.attempts) ? rec.attempts : []).slice(0, 20)
        .map(a => ({ chosen: cleanList(Array.isArray(a && a.answer) ? a.answer : [a && a.answer], 500, 8), at: new Date(a && a.at) }))
        .filter(a => a.chosen.length);
      let r = rec.responseId ? db.responses.find(x => x.id === String(rec.responseId)) : null;
      const topic = findTopic(String(r ? r.topicId : rec.topicId || ''));
      const q = topic && topic.questions.find(x => x.id === (r ? r.questionId : String(rec.questionId || '')));
      if (!topic || !q || !attempts.length) { done.push(offlineId); continue; } // can't be recorded; drop it
      // Use the iPad's times when they're believable (the last 30 days, not in the future).
      const now = Date.now();
      for (const a of attempts) if (isNaN(a.at) || a.at > now + 5 * 60000 || a.at < now - 30 * 86400000) a.at = new Date(now);
      if (!r) {
        r = newResponse(rec, topic, q, attempts[0].at);
        if (!r) { done.push(offlineId); continue; }
        db.responses.push(r);
        if (r.kind !== 'quiz') recordUsage(topic);
      }
      if (!r.completed) {
        for (const a of attempts) {
          const correct = isRightAnswer(q, a.chosen);
          r.attempts.push(a.chosen.join('; '));
          if (r.attempts.length === 1) r.firstTryCorrect = correct;
          if (correct) { r.completed = true; r.completedAt = a.at.toISOString(); break; }
        }
      }
      r.lang = rec.lang === 'es' ? 'es' : r.lang || 'en';
      r.offline = true;
      r.offlineIds = (r.offlineIds || []).concat(offlineId);
      done.push(offlineId);
      alertUnlisted(r);
      followUpMiss(r);
    }
    if (done.length) saveDb();
    return send(res, 200, { done });
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
      date: sh.date, time: sh.time, last4: sh.last4, employeeId: emp ? emp.id : null,
      name: emp ? emp.name : sh.name, department, leader: leaderName((emp && db.settings.leaders && db.settings.leaders[department]) || ''),
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
    if (isQuizDay()) return { department: d, topicId: null, title: null, source: 'quiz' };
    const r = regularTopicFor(d, { peek: true });
    return { department: d, topicId: r.topic ? r.topic.id : null, title: r.topic ? r.topic.title : null, source: r.source, poolSize: r.poolSize };
  });
}

// What each department is likely to get on the days ahead. Scheduled topics are firm; the rest is a forecast of the
// automatic rotation (the topic that has gone longest without use, as the kiosk would pick it), so it can change.
function forecast(start, days) {
  const depts = db.settings.departments.length ? db.settings.departments : [''];
  const cultureOn = Number.isInteger(db.settings.cultureDay);
  const mode = db.settings.fallbackMode;
  const lastUsed = {};
  for (const t of db.topics) lastUsed[t.id] = t.lastUsedDate || '';
  const stalest = (pool, avoidId) => {
    let c = pool.filter(t => t.id !== avoidId);
    if (!c.length) c = pool;
    return c.slice().sort((a, b) => lastUsed[a.id].localeCompare(lastUsed[b.id]) || a.title.localeCompare(b.title))[0] || null;
  };
  const held = {}; // key -> { period, topic }
  const now = today(), thisWeek = weekStart();
  const out = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(start, i), week = weekStart(date);
    const items = depts.map(dept => {
      if (isQuizDay(date)) return { department: dept, topicId: null, title: null, source: 'quiz' };
      const sched = activeSchedulesFor(dept, date)[0];
      if (sched) return { department: dept, topicId: sched.topicId, title: findTopic(sched.topicId).title, source: 'schedule', scheduleId: sched.id };
      const key = dept || '(none)';
      const rotation = db.topics.filter(t => isLive(t) && t.inRotation && forDepartment(t.departments, dept));
      let source, pool, hk, period;
      if (cultureOn && weekday(date) === db.settings.cultureDay && rotation.some(isCulture)) {
        source = 'culture'; pool = rotation.filter(isCulture); hk = 'culture|' + key; period = week;
      } else {
        pool = cultureOn ? rotation.filter(t => !isCulture(t)) : rotation;
        if (mode === 'random') return { department: dept, topicId: null, title: null, source: 'random', poolSize: pool.length };
        source = mode === 'weekly' ? 'weekly' : 'daily'; hk = key; period = mode === 'weekly' ? week : date;
      }
      let t = held[hk] && held[hk].period === period ? held[hk].topic : null;
      if (!t) {
        // Use the kiosk's real pick for the current day or week when it has made one.
        const real = source === 'daily' ? db.settings.dailyPicks[hk] : db.settings.weeklyPicks[hk];
        const realT = real && (source === 'daily' ? real.date === now && date === now : real.week === thisWeek && week === thisWeek) ? findTopic(real.topicId) : null;
        t = isLive(realT) && pool.includes(realT) ? realT : stalest(pool, held[hk] && held[hk].topic && held[hk].topic.id);
        if (t) lastUsed[t.id] = source === 'daily' ? date : addDays(week, 6);
        held[hk] = { period, topic: t };
      }
      return { department: dept, topicId: t ? t.id : null, title: t ? t.title : null, source };
    });
    out.push({ date, items });
  }
  return out;
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

function newHireList() {
  const last = lastCompletions();
  return db.employees.filter(e => isNewHire(e)).sort((a, b) => b.hireDate.localeCompare(a.hireDate)).map(e => {
    const pr = starterProgress(e, last);
    return { id: e.id, name: e.name, department: e.department, hireDate: e.hireDate, until: addDays(e.hireDate, db.settings.starter.days),
      done: pr.done, total: pr.total, next: pr.next ? pr.next.title : null };
  });
}

// An end-screen message: plain text, or { text, font, color, size, gif } when it has a style or a GIF.
function cleanMessage(m) {
  if (typeof m === 'string') return cleanText(m, 300);
  if (!m || typeof m !== 'object') return '';
  const text = cleanText(m.text, 300);
  const gif = cleanText(m.gif, 500);
  const out = {
    text,
    font: ['hand', 'marker', 'chalk', 'script', 'type', 'serif', 'bold'].includes(m.font) ? m.font : '',
    color: /^#[0-9a-f]{6}$/i.test(m.color || '') ? m.color : '',
    size: ['s', 'l', 'xl'].includes(m.size) ? m.size : '',
    gif: /^\/media\/[\w.-]+$/.test(gif) || /^https:\/\/[^\s"'<>]+$/.test(gif) ? gif : ''
  };
  for (const k of Object.keys(out)) if (!out[k]) delete out[k];
  if (!out.text && !out.gif) return '';
  return Object.keys(out).length === 1 && out.text ? out.text : out;
}

async function adminRoutes(req, res, p, m, url) {
  if (m === 'GET' && p === '/api/admin/state') {
    const topicStats = {};
    for (const r of db.responses) {
      const st = topicStats[r.topicId] || (topicStats[r.topicId] = { responses: 0, firstTry: 0, helpful: 0, notHelpful: 0, rated: [] });
      st.responses += 1;
      if (r.firstTryCorrect) st.firstTry += 1;
      if (r.helpful === true) st.helpful += 1;
      if (r.helpful === false) st.notHelpful += 1;
      // The latest few ratings, for the hover on the topic library.
      if (typeof r.helpful === 'boolean') { st.rated.push({ name: r.name, department: r.department, up: r.helpful, date: r.date }); if (st.rated.length > 8) st.rated.shift(); }
    }
    return send(res, 200, {
      topics: db.topics.map(t => t.status === 'draft' ? Object.assign({}, t, { problems: topicProblems(t) }) : t),
      employees: db.employees, schedules: db.schedules, settings: db.settings,
      announcements: db.announcements.map(a => a.popup ? Object.assign({}, a, { seen: db.popupSeen.filter(x => x.id === a.id).length,
        picks: (a.buttons || []).map(label => db.popupSeen.filter(x => x.id === a.id && x.choice === label).length) }) : a),
      upcomingCelebrations: Array.from({ length: 31 }, (_, i) => addDays(today(), i)).flatMap(d => celebrationsOn(d).map(c => Object.assign(c, { date: d }))),
      required: db.required.map(q => { const pr = requiredProgress(q); return Object.assign({}, q, { doneCount: pr.done.length, pendingCount: pr.pending.length }); }),
      today: todayOverview(), todayDate: today(), topicStats,
      responseCountToday: db.responses.filter(r => r.date === today()).length,
      missedToday: db.responses.filter(r => r.date === today() && !r.firstTryCorrect).length,
      responseCountTotal: db.responses.length,
      newHires: newHireList(),
      // The admin's own list keeps hidden people (greyed out) so they can be put back; the kiosk list leaves them out.
      streakTop: (() => { const st = streakStats(); const all = db.employees.filter(e => e.active && st[e.id] && st[e.id].streak >= STREAK_LEADER_MIN)
        .sort((a, b) => (!!a.noBoard - !!b.noBoard) || st[b.id].streak - st[a.id].streak || a.name.localeCompare(b.name));
        return all.filter(e => !e.noBoard).slice(0, 5).concat(all.filter(e => e.noBoard)).map(e => ({ id: e.id, name: e.name, department: e.department, streak: st[e.id].streak, hidden: !!e.noBoard })); })(),
      kioskUrls: kioskUrls(), passwordFromEnv, me: req.adminUser,
      meName: req.adminUser === config.adminUser ? db.settings.adminName : ((db.admins.find(a => a.username === req.adminUser) || {}).name || req.adminUser).split(' ')[0],
      isMainAdmin: req.adminUser === config.adminUser,
      layouts: (db.layouts || {})[req.adminUser] || {}
    });
  }

  // Topics
  // Spanish: download every topic for translation, then upload the file back to fill in only the Spanish.
  if (m === 'GET' && p === '/api/admin/topics/spanish.json') {
    const out = { about: 'Stonehenge in-service topics for Spanish translation. Fill in each "es" part and keep answers in the same order and count as English.',
      exported: nowIso(), topics: db.topics.filter(t => t.status !== 'retired').map(t => ({ id: t.id, title: t.title, lesson: t.lesson,
        es: { title: (t.es && t.es.title) || '', lesson: (t.es && t.es.lesson) || '' },
        questions: t.questions.map((q, i) => ({ n: i + 1, text: q.text, correctAnswers: q.correctAnswers, wrongAnswers: q.wrongAnswers, hint: q.hint || '', explanation: q.explanation || '', departments: q.departments || [],
          es: q.es || { text: '', correctAnswers: [], wrongAnswers: [], hint: '', explanation: '' } })) })) };
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Disposition': 'attachment; filename="inservice-topics-for-spanish.json"' });
    return res.end(JSON.stringify(out, null, 2));
  }
  if (m === 'POST' && p === '/api/admin/topics/spanish') {
    const list = (await readBody(req, 20e6)).topics || [];
    let topics = 0, questions = 0; const problems = [];
    for (const input of list.slice(0, 500)) {
      if (!input || typeof input !== 'object') continue;
      const t = db.topics.find(x => x.id === input.id) || db.topics.find(x => sameText(x.title, input.title));
      if (!t) { problems.push(`Not found: ${cleanText(input.title, 100) || 'a topic'}`); continue; }
      let touched = false;
      const es = input.es || {};
      const title = cleanText(es.title, 200), lesson = cleanText(es.lesson, 5000);
      if (title || lesson) { t.es = { title: title || (t.es && t.es.title) || '', lesson: lesson || (t.es && t.es.lesson) || '' }; touched = true; }
      (Array.isArray(input.questions) ? input.questions : []).forEach((qi, i) => {
        if (!qi || !qi.es || !cleanText(qi.es.text, 1000)) return;
        // Match by position, but only when the English question is still the same; otherwise look it up by its English text.
        const at = t.questions[(Number(qi.n) || i + 1) - 1];
        const q = at && (!qi.text || sameText(at.text, qi.text)) ? at : t.questions.find(x => sameText(x.text, qi.text));
        if (!q) { problems.push(`${t.title}: a question changed since the download, so its Spanish was skipped`); return; }
        const r = validateQuestion(Object.assign({}, q, { es: qi.es }), 1);
        const bad = r.errors.filter(e => e.includes('(Spanish)'));
        if (bad.length || !r.question.es) { problems.push(`${t.title}: ${bad[0] ? bad[0].replace('Question 1 (Spanish): ', '') : 'Spanish skipped'}`); return; }
        q.es = r.question.es; questions++; touched = true;
      });
      if (touched) { t.updatedAt = nowIso(); topics++; }
    }
    saveDb();
    return send(res, 200, { topics, questions, problems: problems.slice(0, 30) });
  }
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
        // A sheet without Spanish columns keeps the Spanish already written for the same question.
        for (const q of topic.questions) {
          const old = !q.es && existing.questions.find(x => x.es && sameText(x.text, q.text));
          if (old && old.es.correctAnswers.length === q.correctAnswers.length && old.es.wrongAnswers.length === q.wrongAnswers.length) q.es = old.es;
        }
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
      const copy = makeTopic(Object.assign({}, t, { title: `${t.title} (copy)`, inRotation: false, annual: false, lastUsedDate: null,
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
      row = row || {};
      // A row with a name but no Workday ID (like a birthday list) only updates someone already on the roster.
      if (!cleanLast4(row.last4) && cleanText(row.name) && ('birthday' in row || 'hireDate' in row)) {
        const found = db.employees.filter(e => looseSameName(e.name, row.name));
        if (found.length !== 1) { skipped.push(`${cleanText(row.name, 100)}: ${found.length ? 'more than one person with this name' : 'no one on Staff with this name'}`); return; }
        const extra = {};
        if (row.birthday && cleanMonthDay(row.birthday)) extra.birthday = cleanMonthDay(row.birthday);
        if (row.hireDate && cleanFullDate(row.hireDate)) extra.hireDate = cleanFullDate(row.hireDate);
        if (!Object.keys(extra).length) return;
        Object.assign(found[0], extra); updated++;
        return;
      }
      const { employee, errors } = validateEmployee(row);
      if (errors.length) { skipped.push(`Row ${i + 2}: ${errors.join(' ')}`); return; }
      if (!employee.department && employee.jobTitle) employee.department = (db.settings.jobDepartments || {})[employee.jobTitle] || '';
      const existing = db.employees.find(e => e.last4 === employee.last4 && sameText(e.name, employee.name))
        || db.employees.find(e => e.last4 === employee.last4 && looseSameName(e.name, employee.name));
      if (existing) { if (!employee.department) delete employee.department; Object.assign(existing, employee); updated++; }
      else { db.employees.push(Object.assign(employee, { id: newId(), createdAt: nowIso() })); added++; }
    });
    saveDb();
    return send(res, 200, { added, updated, skipped });
  }
  // Several staff at once: change department and/or active.
  if (m === 'POST' && p === '/api/admin/employees/bulk') {
    const b = await readBody(req);
    const ids = new Set(Array.isArray(b.ids) ? b.ids.map(String) : []);
    let changed = 0;
    for (const e of db.employees) {
      if (!ids.has(e.id)) continue;
      if (typeof b.department === 'string') e.department = cleanText(b.department, 60);
      if (typeof b.active === 'boolean') e.active = b.active;
      changed++;
    }
    saveDb();
    return send(res, 200, { changed });
  }
  // Fold job titles that were imported as departments into real departments ({ "Registered Nurse (RN)": "Nursing" }).
  // Remembered, so later imports with those titles land in the right department.
  if (m === 'POST' && p === '/api/admin/departments/group') {
    const map = (await readBody(req)).map || {};
    const s = db.settings;
    s.jobDepartments = s.jobDepartments || {};
    let moved = 0;
    for (const [fromRaw, toRaw] of Object.entries(map)) {
      const from = cleanText(fromRaw, 100), to = cleanText(toRaw, 60);
      if (!from || !to || from === to) continue;
      for (const e of db.employees) {
        if (e.department === from) { e.jobTitle = e.jobTitle || from; e.department = to; moved++; }
      }
      s.jobDepartments[from] = to;
      if (!s.departments.includes(to)) s.departments.push(to);
      s.departments = s.departments.filter(d => d !== from);
      for (const list of [db.schedules, db.required, db.announcements]) {
        for (const x of list) if (Array.isArray(x.departments) && x.departments.includes(from)) x.departments = [...new Set(x.departments.map(d => d === from ? to : d))];
      }
      if (s.leaders) delete s.leaders[from];
    }
    saveDb();
    return send(res, 200, { moved });
  }
  // Hide from / show on the streak board, one tap from the Settings streak card.
  mt = p.match(/^\/api\/admin\/employees\/(\w+)\/board$/);
  if (mt && m === 'POST') {
    const e = findEmployee(mt[1]);
    if (!e) return send(res, 404, { error: 'Staff member not found.' });
    e.noBoard = !!(await readBody(req)).hide;
    saveDb();
    return send(res, 200, { employee: e });
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
  // Adding (POST) and editing (PUT .../:id) check the same things.
  function announcementFrom(b) {
    const img = cleanText(b.image, 500);
    const a = {
      text: b.popup ? cleanText(b.text, 400).split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 6).join('\n')
        : cleanText(b.text, 200).replace(/\s+/g, ' '), departments: cleanList(b.departments),
      startDate: cleanDate(b.startDate), endDate: cleanDate(b.endDate)
    };
    // A pop-up: a big screen after they pick their name, with a title and a picture (like an RSVP QR code).
    // Its buttons can be custom (like "RSVP Yes" / "RSVP No"); what each person picks is kept. Blank means one "Got it" button.
    if (b.popup) Object.assign(a, { popup: true, title: cleanText(b.title, 80), everyTime: !!b.everyTime,
      image: /^\/media\/[\w-]+\.(png|jpe?g|gif|webp)$/i.test(img) ? img : '',
      buttons: [...new Set((Array.isArray(b.buttons) ? b.buttons : []).map(x => cleanText(x, 30)).filter(Boolean))].slice(0, 4) });
    if (a.popup) {
      a.confirm = a.buttons.length > 0 && !!b.confirm;
      // Buttons that don't count as "seen": the pop-up comes back next clock-in until they pick another one.
      a.repeat = (Array.isArray(b.repeat) ? b.repeat : []).map(x => cleanText(x, 30)).filter(x => a.buttons.includes(x));
    }
    if (a.popup && !a.title && !a.image) return { error: 'Give the pop-up a title or a picture.' };
    if (!a.text && !a.popup) return { error: 'Write the announcement.' };
    if (!a.startDate) return { error: 'Choose a start date.' };
    if (a.endDate && a.endDate < a.startDate) return { error: 'The end date is before the start date.' };
    return { a };
  }
  if (m === 'POST' && p === '/api/admin/announcements') {
    const { a, error } = announcementFrom(await readBody(req));
    if (error) return send(res, 400, { error });
    Object.assign(a, { id: newId(), createdAt: nowIso() });
    db.announcements.push(a);
    saveDb();
    return send(res, 200, { announcement: a });
  }
  // Who has seen a pop-up: everyone who tapped "Got it", plus people it was meant for who came in
  // since it started but haven't seen it, and people who haven't been in yet.
  mt = p.match(/^\/api\/admin\/announcements\/(\w+)\/seen(\.csv)?$/);
  if (mt && m === 'GET') {
    const a = db.announcements.find(x => x.id === mt[1] && x.popup);
    if (!a) return send(res, 404, { error: 'Not found.' });
    const person = e => ({ id: e.id, name: e.name, department: e.department });
    const seenBy = new Map(db.popupSeen.filter(x => x.id === a.id).map(x => [x.employeeId, x]));
    const meantFor = db.employees.filter(e => e.active && (!a.departments.length || a.departments.includes(e.department)));
    const lastIn = {};
    // "Since it started" means since the moment it was added (or its start date, if that's later): clock-ins
    // from earlier that day happened before the pop-up existed, so those people never had a chance to see it.
    const since = a.createdAt || '';
    for (const r of db.responses) if (r.employeeId && r.date >= a.startDate && r.submittedAt >= since && !(lastIn[r.employeeId] >= r.submittedAt)) lastIn[r.employeeId] = r.submittedAt;
    const seen = [...seenBy].map(([id, x]) => { const e = findEmployee(id); return e && Object.assign(person(e), { at: x.at }, x.choice ? { choice: x.choice } : {}); }).filter(Boolean).sort((x, y) => y.at.localeCompare(x.at));
    const missed = meantFor.filter(e => !seenBy.has(e.id) && lastIn[e.id]).map(e => Object.assign(person(e), { lastIn: lastIn[e.id] })).sort((x, y) => y.lastIn.localeCompare(x.lastIn));
    const notIn = meantFor.filter(e => !seenBy.has(e.id) && !lastIn[e.id]).map(person).sort((x, y) => x.name.localeCompare(y.name));
    if (mt[2]) {
      // Spreadsheet: one row per person the pop-up was meant for (plus anyone else who answered), with their answer.
      const wd = id => (findEmployee(id) || {}).last4 || '';
      const at = iso => iso ? new Date(iso).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
      const rows = [
        ...seen.map(x => [x.name, wd(x.id), x.department, x.choice || 'Got it', at(x.at), 'Answered']),
        ...missed.map(x => [x.name, wd(x.id), x.department, '', at(x.lastIn), "Came in but didn't answer"]),
        ...notIn.map(x => [x.name, wd(x.id), x.department, '', '', "Hasn't been in since it started"])
      ];
      const head = ['Name', 'Workday last 4', 'Department', 'Answer', 'When', 'Status'];
      const safe = String(a.title || 'pop-up').replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'pop-up';
      return send(res, 200, '\ufeff' + [head.join(','), ...rows.map(r => r.map(csvCell).join(','))].join('\r\n'), 'text/csv; charset=utf-8',
        { 'Content-Disposition': `attachment; filename="${safe}-answers-${today()}.csv"` });
    }
    return send(res, 200, { seen, missed, notIn, buttons: a.buttons || [], repeat: a.repeat || [] });
  }
  mt = p.match(/^\/api\/admin\/announcements\/(\w+)$/);
  if (mt && m === 'PUT') {
    const old = db.announcements.find(a => a.id === mt[1]);
    if (!old) return send(res, 404, { error: 'Not found.' });
    const { a, error } = announcementFrom(await readBody(req));
    if (error) return send(res, 400, { error });
    const was = old.buttons || [];
    for (const k of ['popup', 'title', 'everyTime', 'image', 'buttons', 'confirm', 'repeat']) delete old[k];
    Object.assign(old, a, { updatedAt: nowIso() });
    // A renamed button keeps its picks (matched by position). Picks for a removed button no longer count; those people see it again.
    const now = old.buttons || [];
    db.popupSeen = db.popupSeen.filter(x => {
      if (x.id !== old.id || !x.choice) return true;
      const n = was.indexOf(x.choice);
      if (now.includes(x.choice)) return true;
      if (n >= 0 && now[n]) { x.choice = now[n]; return true; }
      return false;
    });
    saveDb();
    return send(res, 200, { announcement: old });
  }
  if (mt && m === 'DELETE') {
    const i = db.announcements.findIndex(a => a.id === mt[1]);
    if (i < 0) return send(res, 404, { error: 'Not found.' });
    db.announcements.splice(i, 1);
    db.popupSeen = db.popupSeen.filter(x => x.id !== mt[1]);
    saveDb();
    return send(res, 200, { ok: true });
  }

  // Schedules (topic of the week, department topics)
  function scheduleFrom(b) {
    const s = { topicId: cleanText(b.topicId, 20), departments: cleanList(b.departments), startDate: cleanDate(b.startDate), endDate: cleanDate(b.endDate), note: cleanText(b.note, 200) };
    if (!isLive(findTopic(s.topicId))) return { error: 'Choose an active topic.' };
    if (!s.startDate) return { error: 'Choose a start date.' };
    if (s.endDate && s.endDate < s.startDate) return { error: 'The end date is before the start date.' };
    return { s };
  }
  if (m === 'POST' && p === '/api/admin/schedules') {
    const { s, error } = scheduleFrom(await readBody(req));
    if (error) return send(res, 400, { error });
    Object.assign(s, { id: newId(), createdAt: nowIso() });
    db.schedules.push(s);
    saveDb();
    return send(res, 200, { schedule: s });
  }
  mt = p.match(/^\/api\/admin\/schedules\/(\w+)$/);
  if (mt && m === 'PUT') {
    const old = db.schedules.find(x => x.id === mt[1]);
    if (!old) return send(res, 404, { error: 'Not found.' });
    const { s, error } = scheduleFrom(await readBody(req));
    if (error) return send(res, 400, { error });
    Object.assign(old, s, { updatedAt: nowIso() });
    saveDb();
    return send(res, 200, { schedule: old });
  }
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
    // Edit: who it's for, the reason and the end date. The topic stays, since who's done is counted against it.
    if (m === 'PUT' && !mt[2]) {
      const b = await readBody(req);
      const endDate = cleanDate(b.endDate);
      if (endDate && endDate < today() && endDate !== q.endDate) return send(res, 400, { error: 'The "show until" date has already passed.' });
      Object.assign(q, { departments: cleanList(b.departments), reason: cleanText(b.reason, 300), endDate, updatedAt: nowIso() });
      saveDb();
      return send(res, 200, { required: q });
    }
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
    if ('quizDay' in b) s.quizDay = Number.isInteger(b.quizDay) && b.quizDay >= 0 && b.quizDay <= 6 ? b.quizDay : null;
    if (b.quizText && typeof b.quizText === 'object') s.quizText = { en: cleanText(b.quizText.en, 300) || defaultSettings().quizText.en, es: cleanText(b.quizText.es, 300) || defaultSettings().quizText.es };
    if ('cultureDay' in b) s.cultureDay = Number.isInteger(b.cultureDay) && b.cultureDay >= 0 && b.cultureDay <= 6 ? b.cultureDay : null;
    if ('facilityName' in b) s.facilityName = cleanText(b.facilityName, 100) || 'Stonehenge';
    if (Array.isArray(b.departments)) s.departments = cleanList(b.departments, 60, 30);
    if ('allowUnlisted' in b) s.allowUnlisted = !!b.allowUnlisted;
    if ('celebrations' in b) s.celebrations = !!b.celebrations;
    if (b.review && typeof b.review === 'object') {
      const days = (v, d) => { const n = Math.round(Number(v)); return n >= 1 && n <= 60 ? n : d; };
      s.review = { on: !!b.review.on, firstDays: days(b.review.firstDays, s.review.firstDays), secondDays: days(b.review.secondDays, s.review.secondDays) };
    }
    if (b.streaks && typeof b.streaks === 'object') {
      s.streaks = { shoutOuts: !!b.streaks.shoutOuts, leaderboard: ['off', 'home', 'end', 'both'].includes(b.streaks.leaderboard) ? b.streaks.leaderboard : 'off',
        top: Number(b.streaks.top) === 1 ? 1 : 3, board: ['facility', 'dept', 'both'].includes(b.streaks.board) ? b.streaks.board : 'facility', button: !!b.streaks.button };
    }
    if (Array.isArray(b.birthdayMessages)) s.birthdayMessages = b.birthdayMessages.slice(0, 300).map(cleanMessage).filter(Boolean);
    if (Array.isArray(b.anniversaryMessages)) s.anniversaryMessages = b.anniversaryMessages.slice(0, 300).map(cleanMessage).filter(Boolean);
    if ('kioskQuietMin' in b && [0, 30, 60, 120, 240, 480].includes(Number(b.kioskQuietMin))) s.kioskQuietMin = Number(b.kioskQuietMin);
    if ('newsSeconds' in b) { const n = Number(b.newsSeconds); if (n >= 1 && n <= 60) s.newsSeconds = Math.round(n); }
    if (Array.isArray(b.closingMessages)) s.closingMessages = b.closingMessages.slice(0, 100).map(cleanMessage).filter(Boolean);
    if (b.decor && typeof b.decor === 'object' && Array.isArray(b.decor.months) && b.decor.months.length === 12) {
      s.decor = { on: !!b.decor.on, months: b.decor.months.map(x => ({
        emoji: cleanText(x && x.emoji, 60), message: cleanText(x && x.message, 100),
        color: DECOR_COLORS.includes(x && x.color) ? x.color : 'none' })) };
    }
    if (b.starter && typeof b.starter === 'object') {
      const days = Math.round(Number(b.starter.days));
      s.starter = {
        topicIds: [...new Set(cleanList(b.starter.topicIds, 20, 50))].filter(id => findTopic(id)),
        days: days >= 1 && days <= 365 ? days : s.starter.days
      };
    }
    if (b.leaders && typeof b.leaders === 'object') {
      s.leaders = {};
      for (const [d, l] of Object.entries(b.leaders).slice(0, 50)) if (cleanText(d, 60) && cleanText(l, 300)) s.leaders[cleanText(d, 60)] = cleanText(l, 300);
    }
    if ('alertEmails' in b) s.alertEmails = emailsIn([].concat(b.alertEmails || []).join(' ')).slice(0, 20);
    if ('missedFollowup' in b) s.missedFollowup = !!b.missedFollowup;
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

  // Extra admin logins. Only the main "admin" login can add or remove them; anyone can change their own password.
  const adminList = () => db.admins.map(a => ({ id: a.id, username: a.username, name: a.name, createdAt: a.createdAt, lastSeen: a.lastSeen || null }));
  if (m === 'GET' && p === '/api/admin/users') return send(res, 200, { users: adminList(), mainUser: config.adminUser });
  if (m === 'POST' && p === '/api/admin/users') {
    if (req.adminUser !== config.adminUser) return send(res, 403, { error: 'Only the main admin login can add logins.' });
    const b = await readBody(req);
    const name = cleanText(b.name, 80), username = cleanText(b.username, 40).toLowerCase(), password = String(b.password || '');
    if (!name) return send(res, 400, { error: 'Type their name.' });
    if (!/^[a-z0-9._-]{3,40}$/.test(username)) return send(res, 400, { error: 'Usernames are 3 or more letters or numbers, no spaces.' });
    if (username === config.adminUser || db.admins.some(a => a.username === username)) return send(res, 400, { error: 'That username is taken.' });
    if (password.length < 8) return send(res, 400, { error: 'The password needs at least 8 characters.' });
    db.admins.push(Object.assign({ id: newId(), username, name, createdAt: nowIso(), lastSeen: null }, hashPassword(password)));
    saveDb();
    return send(res, 200, { users: adminList() });
  }
  const au = p.match(/^\/api\/admin\/users\/([\w-]+)(\/password)?$/);
  if (au) {
    const a = db.admins.find(x => x.id === au[1]);
    if (!a) return send(res, 404, { error: 'Not found.' });
    const isMain = req.adminUser === config.adminUser;
    if (m === 'DELETE' && !au[2]) {
      if (!isMain) return send(res, 403, { error: 'Only the main admin login can remove logins.' });
      db.admins = db.admins.filter(x => x !== a); okLogins.clear(); saveDb();
      return send(res, 200, { users: adminList() });
    }
    if (m === 'POST' && au[2]) {
      if (!isMain && req.adminUser !== a.username) return send(res, 403, { error: 'You can only change your own password.' });
      const password = String((await readBody(req)).password || '');
      if (password.length < 8) return send(res, 400, { error: 'The password needs at least 8 characters.' });
      Object.assign(a, hashPassword(password)); okLogins.clear(); saveDb();
      return send(res, 200, { users: adminList() });
    }
  }
  if (m === 'POST' && p === '/api/admin/password') {
    if (req.adminUser !== config.adminUser) {   // an extra login changing its own password
      const a = db.admins.find(x => x.username === req.adminUser);
      const pw = String((await readBody(req)).password || '');
      if (!a || pw.length < 8) return send(res, 400, { error: 'Use at least 8 characters.' });
      Object.assign(a, hashPassword(pw)); okLogins.clear(); saveDb();
      return send(res, 200, { ok: true });
    }
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

  // One response in full: the question with every choice, what they picked on each try, the lesson, and how the person usually does.
  // Delete one response (asked twice on the admin page). It's kept aside in db.deletedResponses, so a backup can bring it back.
  const rdel = m === 'DELETE' && p.match(/^\/api\/admin\/responses\/([\w-]+)$/);
  if (rdel) {
    const i = db.responses.findIndex(x => x.id === rdel[1]);
    if (i < 0) return send(res, 404, { error: 'That response is already gone.' });
    const [r] = db.responses.splice(i, 1);
    db.deletedResponses = (db.deletedResponses || []).concat(Object.assign({}, r, { deletedAt: nowIso(), deletedBy: req.adminUser })).slice(-500);
    db.followups = (db.followups || []).filter(f => f.responseId !== r.id || f.attestedAt);
    saveDb();
    return send(res, 200, { ok: true });
  }
  const rd = m === 'GET' && p.match(/^\/api\/admin\/responses\/([\w-]+)$/);
  if (rd) {
    const r = db.responses.find(x => x.id === rd[1]);
    if (!r) return send(res, 404, { error: 'That response is gone.' });
    const topic = findTopic(r.topicId);
    const q = topic && (topic.questions.find(x => x.id === r.questionId) || topic.questions.find(x => x.text === r.question));
    const mine = r.employeeId ? db.responses.filter(x => x.employeeId === r.employeeId && x.attempts.length).sort((a, b) => a.submittedAt.localeCompare(b.submittedAt)) : [];
    const done = mine.filter(x => x.completed);
    const emp = r.employeeId ? findEmployee(r.employeeId) : null;
    return send(res, 200, {
      response: r,
      topic: topic ? { id: topic.id, title: topic.title, category: topic.category, lesson: topic.lesson } : null,
      question: q ? { text: q.text, type: q.type, correctAnswers: q.correctAnswers, wrongAnswers: q.wrongAnswers, hint: q.hint, explanation: q.explanation, changed: q.text !== r.question } : null,
      person: emp ? { id: emp.id, name: emp.name, department: emp.department, jobTitle: emp.jobTitle || '', hireDate: emp.hireDate || '' } : null,
      history: {
        total: done.length, firstTry: done.filter(x => x.firstTryCorrect).length,
        recent: mine.slice(-8).reverse().map(x => ({ id: x.id, date: x.date, topicId: x.topicId, topicTitle: x.topicTitle, firstTryCorrect: x.firstTryCorrect, completed: x.completed }))
      },
      followup: (db.followups || []).find(f => f.responseId === r.id) || null
    });
  }

  if (m === 'GET' && p === '/api/admin/responses.csv') {
    const cols = [
      ['Submitted', r => r.submittedAt], ['Date', r => r.date], ['Name', r => r.name], ['Workday last 4', r => r.last4],
      ['Department', r => r.department], ['On roster', r => r.verified ? 'yes' : 'no'],
      ['Type', r => r.kind], ['Topic', r => r.topicTitle], ['Question', r => plainText(r.question)],
      ['First answer', r => r.attempts[0]], ['Correct answer', r => r.correctAnswer],
      ['Correct first try', r => r.firstTryCorrect ? 'yes' : 'no'], ['Tries', r => r.attempts.length],
      ['Finished', r => r.completed ? 'yes' : 'no'], ['Finished at', r => r.completedAt],
      ['Language', r => r.lang === 'es' ? 'Spanish' : 'English'],
      ['Lesson helpful', r => r.helpful === true ? 'yes' : r.helpful === false ? 'no' : '']
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

  if (m === 'GET' && p === '/api/admin/kiosk-status') {
    return send(res, 200, { kioskSeen, serverStartedAt, now: nowIso(), responseCountToday: db.responses.filter(r => r.date === today()).length,
      lastResponseAt: db.responses.length ? db.responses[db.responses.length - 1].submittedAt : null });
  }

  if (m === 'POST' && p === '/api/admin/reviews/skip') {
    const b = await readBody(req);
    const employeeId = String(b.employeeId || ''), topicId = String(b.topicId || '');
    if (!findEmployee(employeeId) || !findTopic(topicId)) return send(res, 400, { error: 'That review is no longer there. Refresh the page.' });
    db.reviewSkips = (db.reviewSkips || []).filter(sk => !(sk.employeeId === employeeId && sk.topicId === topicId));
    db.reviewSkips.push({ employeeId, topicId, at: nowIso(), by: req.adminUser });
    saveDb();
    return send(res, 200, { ok: true });
  }
  if (m === 'GET' && p === '/api/admin/reviews') {
    const list = reviewStates().map(x => {
      const e = findEmployee(x.employeeId), t = findTopic(x.topicId);
      return Object.assign({ name: e ? e.name : '', department: e ? e.department : '', active: !!(e && e.active), title: t.title }, x);
    }).filter(x => x.active).sort((a, b) => a.due.localeCompare(b.due));
    // Topics need a few questions so a review can ask it a different way.
    const thin = db.topics.filter(t => isLive(t) && t.questions.length < 3).map(t => ({ id: t.id, title: t.title, questions: t.questions.length }));
    return send(res, 200, { reviews: list, thin, settings: db.settings.review });
  }

  if (m === 'GET' && p === '/api/admin/annual') return send(res, 200, { topics: annualReport(), dueSoonDays: DUE_SOON_DAYS });

  if (m === 'GET' && p === '/api/admin/usage') return send(res, 200, { usage: db.usage.slice().reverse() });

  if (m === 'GET' && p === '/api/admin/backup') {
    return send(res, 200, JSON.stringify(db, null, 2), 'application/json',
      { 'Content-Disposition': `attachment; filename="inservice-backup-${today()}.json"` });
  }

  // Go live: remove what was entered while testing. A full copy is saved in the backups folder first.
  const SAMPLE_STAFF = new Set(loadJson(SEED_STAFF_FILE, []).map(s => `${String(s.name).toLowerCase()}|${s.last4}`));
  const isSampleStaff = e => !!e && SAMPLE_STAFF.has(`${String(e.name || '').toLowerCase()}|${e.last4}`);
  const isSampleSchedule = x => !!x && /^sample /i.test(String(x.note || ''));
  // Practice run of a topic for the preview window: every question, one after another. Nothing is saved.
  const pv = m === 'GET' && p.match(/^\/api\/admin\/preview\/([\w-]+)$/);
  if (pv) {
    const topic = findTopic(pv[1]);
    if (!topic) return send(res, 404, { error: 'Topic not found.' });
    const only = url.searchParams.get('q');
    const qs = topic.questions.filter(q => !only || q.id === only);
    return send(res, 200, {
      who: { employeeId: null, name: 'Preview', firstName: 'Preview', department: '', last4: '' },
      items: qs.map(q => itemForQuestion(topic, q, { kind: 'rotation' }))
    });
  }
  if (m === 'POST' && p === '/api/admin/preview/answer') {
    const b = await readBody(req);
    const topic = findTopic(String(b.topicId || ''));
    const q = topic && topic.questions.find(x => x.id === String(b.questionId || ''));
    if (!topic || !q) return send(res, 400, { error: 'This topic or question was changed. Close the preview and open it again.' });
    const chosen = cleanList(Array.isArray(b.answer) ? b.answer : [b.answer], 500, 8);
    if (!chosen.length) return send(res, 400, { error: 'Please choose an answer.' });
    const tried = cleanList(b.tried || [], 500, 20).map(a => a.toLowerCase()).concat(chosen.map(a => a.toLowerCase()));
    const correct = isRightAnswer(q, chosen);
    const all = choicesFor(q);
    const remaining = q.type === 'multi' ? all : all.filter(a => !tried.includes(a.en.toLowerCase()));
    const es = hasSpanish(topic, q) ? q.es : null;
    return send(res, 200, {
      responseId: null, correct, firstTryCorrect: correct && !(b.tried || []).length,
      hint: correct ? '' : q.hint, hintEs: correct || !es ? '' : es.hint,
      answers: correct ? [] : shuffle(remaining),
      explanation: correct ? q.explanation : '', explanationEs: correct && es ? es.explanation : '',
      offline: true   // hides "Was this helpful?"
    });
  }

  // Today tab dashboard: the last 14 days, this week by department, and the most-missed questions.
  if (m === 'GET' && p === '/api/admin/forecast') {
    const start = weekStart(cleanDate(url.searchParams.get('start')) || today());
    const weeks = Math.min(Math.max(Number(url.searchParams.get('weeks')) || 1, 1), 8);
    // Simulate from today so later weeks account for the topics used before them.
    const from = start < weekStart() ? start : weekStart();
    const all = forecast(from, Math.round((Date.parse(addDays(start, 7 * weeks)) - Date.parse(from)) / 86400000));
    return send(res, 200, { today: today(), start, mode: db.settings.fallbackMode, cultureDay: db.settings.cultureDay,
      days: all.filter(d => d.date >= start),
      required: db.required.filter(q => q.active && (!q.endDate || q.endDate >= start)).map(q => ({ id: q.id, title: (findTopic(q.topicId) || {}).title || '', departments: q.departments, endDate: q.endDate || null })) });
  }

  // Each login's own tile order and widths, e.g. for the Settings tab.
  if (m === 'PUT' && p === '/api/admin/layout') {
    const b = await readBody(req);
    const page = cleanText(b.page, 30);
    if (!/^[a-z]+$/.test(page)) return send(res, 400, { error: 'Unknown page.' });
    db.layouts = db.layouts || {};
    const mine = db.layouts[req.adminUser] = db.layouts[req.adminUser] || {};
    if (b.reset) delete mine[page];
    else mine[page] = (Array.isArray(b.tiles) ? b.tiles : []).slice(0, 40)
      .map(t => ({ id: cleanText(t && t.id, 30), span: Math.min(12, Math.max(3, Math.round(Number(t && t.span) || 6))), h: Number(t && t.h) >= 120 ? Math.min(3000, Math.round(Number(t.h))) : 0 }))
      .filter(t => /^[a-z]+$/.test(t.id));
    saveDb();
    return send(res, 200, { ok: true });
  }

  if (m === 'GET' && p === '/api/admin/dashboard') {
    const t = today(), start14 = addDays(t, -13), start7 = addDays(t, -6);
    const days = Array.from({ length: 14 }, (_, i) => ({ date: addDays(start14, i), right: 0, missed: 0 }));
    const byDay = Object.fromEntries(days.map(d => [d.date, d]));
    const depts = new Map(), missedQ = new Map();
    let unlistedToday = 0, unfinishedToday = 0, quizzesToday = 0;
    for (const r of db.responses) {
      if (r.date < start14) continue;
      if (r.date === t && !r.verified) unlistedToday++;
      if (r.date === t && r.kind === 'quiz' && r.completed) quizzesToday++;
      if (!r.completed) { if (r.date === t) unfinishedToday++; continue; }
      const d = byDay[r.date];
      if (d) r.firstTryCorrect ? d.right++ : d.missed++;
      if (r.date >= start7) {
        const k = r.department || 'No department';
        const g = depts.get(k) || { department: k, right: 0, missed: 0 };
        r.firstTryCorrect ? g.right++ : g.missed++;
        depts.set(k, g);
        if (!r.firstTryCorrect) {
          const qk = `${r.topicId}|${r.questionId}`;
          const q = missedQ.get(qk) || { topicId: r.topicId, topicTitle: r.topicTitle, question: plainText(r.question), missed: 0 };
          q.missed++; missedQ.set(qk, q);
        }
      }
    }
    return send(res, 200, {
      today: t, start7, days,
      departments: [...depts.values()].sort((a, b) => (b.right + b.missed) - (a.right + a.missed)),
      topMissed: [...missedQ.values()].sort((a, b) => b.missed - a.missed).slice(0, 5),
      unlistedToday, unfinishedToday, quizzesToday, quizDay: isQuizDay(),
      followupsOpen: db.followups.filter(f => !f.attestedAt).length,
      // How many of those are from today's misses; the rest are older ones a leader hasn't closed yet.
      followupsToday: db.followups.filter(f => !f.attestedAt && (db.responses.find(r => r.id === f.responseId) || {}).date === t).length,
      celebrationsToday: db.settings.celebrations ? todaysCelebrations() : []
    });
  }
  if (m === 'GET' && p === '/api/admin/followups') {
    return send(res, 200, { followups: db.followups.slice().reverse().map(({ token, ...f }) => f), emailReady: emailReady(), mailFrom: MAIL.from, emailLog: (db.emailLog || []).slice(0, 30) });
  }
  const fa = m === 'POST' && p.match(/^\/api\/admin\/followups\/([\w-]+)\/attest$/);
  if (fa) {
    const f = db.followups.find(x => x.id === fa[1]);
    if (!f) return send(res, 404, { error: 'Not found.' });
    const b = await readBody(req);
    if (b.undo) { f.attestedAt = null; f.attestedBy = ''; } else if (!f.attestedAt) { f.attestedAt = nowIso(); f.attestedBy = cleanText(b.by, 80) || 'Admin'; }
    saveDb();
    return send(res, 200, { ok: true });
  }
  // "Remind": email the leader again, for one follow-up or (all) one email per leader with everything still open.
  const fr = m === 'POST' && p.match(/^\/api\/admin\/followups\/([\w-]+)\/remind$/);
  if (fr) {
    const f = db.followups.find(x => x.id === fr[1]);
    if (!f || f.attestedAt) return send(res, 400, { error: 'Already educated.' });
    f.emailedTo = emailsIn(leaderFor(f.department)).length ? emailsIn(leaderFor(f.department)) : f.emailedTo;   // pick up a newly added leader email
    if (!f.emailedTo.length) return send(res, 400, { error: `No leader email for ${f.department || 'this department'}. Add one in Settings → Department leaders.` });
    const log = await emailFollowup(f, true);
    if (log.status !== 'sent') return send(res, 400, { error: log.status === 'email not set up' ? 'Email is not connected yet (see Settings → Email alerts).' : 'Sending failed: ' + (log.error || log.status) });
    f.reminders = (f.reminders || []).concat(nowIso()); saveDb();
    return send(res, 200, { ok: true, to: f.emailedTo });
  }
  if (m === 'POST' && p === '/api/admin/followups/remind-all') {
    const groups = new Map(), skipped = [];
    for (const f of db.followups.filter(x => !x.attestedAt)) {
      const to = emailsIn(leaderFor(f.department)).length ? emailsIn(leaderFor(f.department)) : f.emailedTo;
      if (!to.length) { skipped.push(f.department || 'No department'); continue; }
      f.emailedTo = to;
      const k = to.join(',');
      groups.set(k, (groups.get(k) || []).concat(f));
    }
    if (!groups.size) return send(res, 400, { error: skipped.length ? `No leader emails for: ${[...new Set(skipped)].join(', ')}.` : 'Nothing is waiting.' });
    let sent = 0, failed = '';
    for (const [k, list] of groups) {
      const log = await sendEmail(k.split(','), `Reminder: ${list.length} in-service follow-up${list.length === 1 ? '' : 's'} waiting`, digestHtml(list), 'reminder');
      if (log.status === 'sent') { sent++; list.forEach(f => { f.reminders = (f.reminders || []).concat(nowIso()); }); } else failed = log.status === 'email not set up' ? 'Email is not connected yet (see Settings → Email alerts).' : log.error || log.status;
    }
    saveDb();
    if (!sent) return send(res, 400, { error: 'Sending failed: ' + failed });
    return send(res, 200, { ok: true, leaders: sent, skipped: [...new Set(skipped)] });
  }
  // Clock-in check: email each department leader the people (ticked on the admin page) who clocked in without doing the in-service.
  if (m === 'POST' && p === '/api/admin/clock-check/email') {
    const b = await readBody(req, 5e6);
    const people = (Array.isArray(b.people) ? b.people : []).slice(0, 2000).map(x => ({ name: cleanText(x.name, 100), last4: cleanLast4(x.last4) || '', department: cleanText(x.department, 60),
      shifts: Number(x.shifts) || 0, neverDone: !!x.neverDone, missedDates: cleanList(x.missedDates, 10, 62) })).filter(x => x.name);
    const groups = new Map(), skipped = [];
    for (const x of people) {
      const to = emailsIn(leaderFor(x.department));
      if (!to.length) { skipped.push(`${x.name}${x.department ? ' (' + x.department + ')' : ''}`); continue; }
      const k = to.join(',');
      groups.set(k, (groups.get(k) || []).concat(x));
    }
    if (!groups.size) return send(res, 400, { error: 'No leader emails for these departments. Add them in Settings → Department leaders, like "Dietary: Andi, andi@stonehenge.com".' });
    const md = d => { const [, mo, day] = d.split('-'); return `${Number(mo)}/${Number(day)}`; };
    let sent = 0, sentPeople = 0, failed = '';
    for (const [k, list] of groups) {
      const html = `<div style="font-family:Arial,sans-serif;font-size:15px;color:#1d2b36;max-width:600px">
        <h2 style="color:#1f5f7a;margin:0 0 8px">${list.length} ${list.length === 1 ? 'person' : 'people'} clocked in without doing the in-service</h2>
        <p style="margin:0 0 14px;color:#5b6b78">Please remind them to do their quick in-service on the iPad when they clock in.</p>
        <table style="border-collapse:collapse;width:100%">${list.map(x => `<tr><td style="padding:8px 10px;border-top:1px solid #dbe3e9"><strong>${esc(x.name)}</strong>${x.department ? ` <span style="color:#5b6b78">(${esc(x.department)})</span>` : ''}${x.neverDone ? ' <span style="color:#a4521b;font-size:13px">· hasn\'t done any yet</span>' : ''}</td>
          <td style="padding:8px 10px;border-top:1px solid #dbe3e9;color:#5b6b78;font-size:13px">Missed ${x.missedDates.length} of ${x.shifts} shift${x.shifts === 1 ? '' : 's'}: ${esc(x.missedDates.map(md).join(', '))}</td></tr>`).join('')}</table>
        <p style="color:#5b6b78;font-size:12px;margin-top:20px">Sent by the ${esc(db.settings.facilityName || 'Stonehenge')} in-service kiosk from the Clock-in check.</p></div>`;
      const log = await sendEmail(k.split(','), `${list.length} staff missed their in-service at clock-in`, html, 'clock-in check');
      if (log.status === 'sent') { sent++; sentPeople += list.length; } else failed = log.status === 'email not set up' ? 'Email is not connected yet (see Settings → Email alerts).' : log.error || log.status;
    }
    if (!sent) return send(res, 400, { error: 'Sending failed: ' + failed });
    return send(res, 200, { ok: true, leaders: sent, people: sentPeople, skipped });
  }
  if (m === 'POST' && p === '/api/admin/email/test') {
    const b = await readBody(req);
    const to = emailsIn(b.to).length ? emailsIn(b.to) : db.settings.alertEmails || [];
    if (!to.length) return send(res, 400, { error: 'Add an email address first.' });
    const log = await sendEmail(to, 'Test email from the in-service kiosk', emailHtml('It works! ✓', [['Sent to', to.join(', ')], ['When', when(nowIso())]]), 'test');
    return send(res, log.status === 'sent' ? 200 : 400, log.status === 'sent' ? { ok: true } : { error: log.status === 'email not set up' ? 'Email is not connected yet. Add GMAIL_USER and GMAIL_APP_PASSWORD in Render → Environment.' : 'Sending failed: ' + (log.error || log.status) });
  }

  if (m === 'GET' && p === '/api/admin/test-data') {
    return send(res, 200, {
      responses: (db.responses || []).length, usage: (db.usage || []).length,
      sampleStaff: db.employees.filter(isSampleStaff).map(e => e.name),
      sampleSchedules: db.schedules.filter(isSampleSchedule).length,
      announcements: (db.announcements || []).length, required: (db.required || []).length
    });
  }
  if (m === 'POST' && p === '/api/admin/test-data/clear') {
    const b = await readBody(req);
    const file = `before-go-live-${nowIso().replace(/[:.]/g, '-')}.json`;
    writeJsonSafely(path.join(BACKUP_DIR, file), db);
    const out = {};
    if (b.responses) { out.responses = db.responses.length; db.responses = []; db.usage = []; db.followups = []; db.emailLog = []; }
    if (b.sampleStaff) { const before = db.employees.length; db.employees = db.employees.filter(e => !isSampleStaff(e)); out.sampleStaff = before - db.employees.length; }
    if (b.sampleSchedules) { const before = db.schedules.length; db.schedules = db.schedules.filter(x => !isSampleSchedule(x)); out.sampleSchedules = before - db.schedules.length; }
    if (b.announcements) { out.announcements = db.announcements.length; db.announcements = []; }
    if (b.required) { out.required = db.required.length; db.required = []; }
    saveDb();
    return send(res, 200, Object.assign(out, { backup: file }));
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

  if (m === 'HEAD' && p === '/') { res.writeHead(200, { 'Cache-Control': 'no-store' }); return res.end(); } // the iPad checks the site is up before reloading
  if (m === 'GET' && (p === '/' || p === '/index.html')) return serveStatic(res, 'index.html');
  // The leader's "I've educated them" link from the follow-up email. The long random token is the key; no sign-in needed.
  const at = p.match(/^\/attest\/([a-f0-9]{36})$/);
  if (at) {
    const f = db.followups.find(x => x.token === at[1]);
    if (!f) return send(res, 404, '<p style="font-family:sans-serif">This follow-up link is no longer valid.</p>', 'text/html; charset=utf-8');
    if (m === 'POST') {
      const b = await readBody(req);
      if (!f.attestedAt) { f.attestedAt = nowIso(); f.attestedBy = cleanText(b.by, 80) || 'Leader'; saveDb(); }
      return send(res, 200, { ok: true });
    }
    return send(res, 200, attestPage(f), 'text/html; charset=utf-8');
  }
  if (p.startsWith('/api/kiosk/')) {
    if ((await kioskRoutes(req, res, p, m)) !== false) return;
    return send(res, 404, { error: 'Not found' });
  }
  if (m === 'GET' && /^\/[\w.-]+\.(js|css|png|svg|ico)$/.test(p) && !p.startsWith('/admin.js')) return serveStatic(res, p.slice(1));
  // The admin site as a home-screen app. Browsers fetch this without the password, so it stays public (nothing private in it).
  if (m === 'GET' && p === '/admin.webmanifest') return serveStatic(res, 'admin.webmanifest');
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

  if (m === 'GET' && p === '/admin/login') return serveStatic(res, 'admin-login.html');
  if (m === 'POST' && p === '/admin/login') {
    const b = await readBody(req);
    const user = checkLogin(String(b.username || '').trim().toLowerCase(), String(b.password || ''));
    if (!user) { await new Promise(r => setTimeout(r, 600)); return send(res, 401, { error: 'That username and password don\'t match.' }); }
    return send(res, 200, { ok: true }, 'application/json', { 'Set-Cookie': sessionCookie(req, user) });
  }
  if (p === '/admin/logout') {
    res.writeHead(302, { Location: '/admin/login', 'Set-Cookie': 'adm=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax', 'Cache-Control': 'no-store' });
    return res.end();
  }
  if (p === '/admin' || p.startsWith('/admin/') || p === '/admin.js' || p.startsWith('/api/admin/')) {
    if (!requireAdmin(req, res)) return;
    if (m === 'GET' && (p === '/admin' || p === '/admin/')) return serveStatic(res, 'admin.html');
    if (m === 'GET' && p === '/admin.js') return serveStatic(res, 'admin.js');
    // "Preview" on the admin page: the real kiosk screens, in practice mode. Nothing is saved.
    if (m === 'GET' && p === '/admin/preview') {
      return fs.readFile(path.join(PUBLIC_DIR, 'index.html'), 'utf8', (err, html) => {
        if (err) return send(res, 404, 'Not found', 'text/plain');
        send(res, 200, html.replace('<head>', '<head><base href="/">'), 'text/html; charset=utf-8');
      });
    }
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
