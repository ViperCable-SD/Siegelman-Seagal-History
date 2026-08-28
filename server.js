'use strict';

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const PUBLIC_UPLOADS = path.join(DATA_DIR, 'uploads');
const FAMILY_UPLOADS = path.join(DATA_DIR, 'family-only');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const ADMIN_KEY = process.env.ADMIN_KEY || '';
const FAMILY_PASSCODE = process.env.FAMILY_PASSCODE || '';
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 150);
const COOKIE_SECRET = process.env.COOKIE_SECRET || ADMIN_KEY || 'change-me-in-production';

[PUBLIC_UPLOADS, FAMILY_UPLOADS].forEach((dir) => fs.mkdirSync(dir, { recursive: true }));

/* =================================================================
   Storage
   One JSON file plus two upload folders. Back up DATA_DIR and you
   have backed up the entire archive.
================================================================= */

const COLLECTIONS = ['people', 'media', 'stories', 'places', 'events', 'messages'];
const db = {};
COLLECTIONS.forEach((c) => { db[c] = []; });

let site = { name: 'Siegelman / Seagal', tagline: '', accessionPrefix: 'SS' };

try {
  const parsed = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  COLLECTIONS.forEach((c) => { if (Array.isArray(parsed[c])) db[c] = parsed[c]; });
  if (parsed.site) site = Object.assign(site, parsed.site);
} catch (err) {
  if (err.code !== 'ENOENT') {
    console.error('db.json unreadable, keeping a copy and starting fresh:', err.message);
    try { fs.copyFileSync(DB_FILE, DB_FILE + '.broken-' + Date.now()); } catch (_) {}
  }
}

let saveTimer = null;
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try {
      const tmp = DB_FILE + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(Object.assign({ site }, db), null, 2));
      fs.renameSync(tmp, DB_FILE);
    } catch (err) {
      console.error('Save failed:', err.message);
    }
  }, 150);
}

const newId = () => crypto.randomBytes(9).toString('hex');

function clean(value, maxLength) {
  return String(value == null ? '' : value)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function multiline(value, maxLength) {
  return String(value == null ? '' : value)
    .replace(/\r\n/g, '\n')
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function slugify(name) {
  return clean(name, 60).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || newId();
}

function idList(value, pool) {
  const wanted = String(value || '').split(',').map((s) => s.trim()).filter(Boolean);
  return wanted.filter((id) => pool.some((p) => p.id === id)).slice(0, 40);
}

/* =================================================================
   Access control
   ADMIN_KEY       — edits and deletions
   FAMILY_PASSCODE — unlocks Next Generations for living relatives
================================================================= */

const familyToken = () =>
  crypto.createHmac('sha256', COOKIE_SECRET).update('family-access').digest('hex');

function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return '';
}

function sameSecret(given, expected) {
  if (!expected || !given || given.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

const isAdmin = (req) => sameSecret(req.get('x-admin-key') || req.query.key || '', ADMIN_KEY);

function isFamily(req) {
  if (!FAMILY_PASSCODE) return true;          // no passcode set: nothing is hidden
  if (isAdmin(req)) return true;
  return sameSecret(readCookie(req, 'family'), familyToken());
}

const requireAdmin = (req, res, next) =>
  isAdmin(req) ? next() : res.status(403).json({ error: 'That change needs the keeper key.' });

/* ---- Rate limiting ---- */
const hits = new Map();
function rateLimit(max, windowMs) {
  return (req, res, next) => {
    const key = req.ip + ':' + req.path;
    const now = Date.now();
    const recent = (hits.get(key) || []).filter((t) => now - t < windowMs);
    if (recent.length >= max) {
      return res.status(429).json({ error: 'That is a lot at once. Wait a few minutes, then try again.' });
    }
    recent.push(now);
    hits.set(key, recent);
    if (hits.size > 5000) hits.clear();
    next();
  };
}

/* =================================================================
   Uploads
================================================================= */

const MEDIA_KINDS = {
  photo: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.heif', '.tif', '.tiff'],
  document: ['.pdf', '.doc', '.docx', '.txt', '.rtf', '.odt', '.md'],
  audio: ['.mp3', '.m4a', '.wav', '.aac', '.ogg', '.oga'],
  video: ['.mp4', '.mov', '.webm', '.m4v']
};
const EXT_KIND = new Map();
Object.entries(MEDIA_KINDS).forEach(([kind, exts]) => exts.forEach((e) => EXT_KIND.set(e, kind)));

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, PUBLIC_UPLOADS),
    filename: (req, file, cb) => cb(null, newId() + path.extname(file.originalname).toLowerCase())
  }),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!EXT_KIND.has(ext)) {
      return cb(new Error(`${ext || 'That file type'} cannot be added. Use a photo, a PDF or document, an audio file, or a video.`));
    }
    cb(null, true);
  }
});

/* ---- Accession numbers: SS.1948.014 ---- */
function accession(year) {
  const era = /^\d{4}$/.test(String(year || '').trim()) ? String(year).trim() : 'nd';
  const used = db.media.filter((m) => m.accession && m.accession.includes('.' + era + '.')).length;
  return `${site.accessionPrefix}.${era}.${String(used + 1).padStart(3, '0')}`;
}

/* ---- First run: plant the family and the founding photograph ---- */
if (!db.people.length || !db.media.length) {
  try {
    const seed = JSON.parse(fs.readFileSync(path.join(__dirname, 'seed.json'), 'utf8'));
    if (seed.site) site = Object.assign(site, seed.site);

    if (!db.people.length && Array.isArray(seed.people)) {
      seed.people.forEach((person) => {
        db.people.push({
          id: newId(),
          slug: slugify(person.name),
          name: person.name,
          generation: Number(person.generation) || 2,
          relation: person.relation || '',
          born: person.born || '',
          died: person.died || '',
          birthPlace: person.birthPlace || '',
          summary: person.summary || '',
          biography: person.biography || '',
          portraitId: null,
          memorial: false,
          visibility: 'public',
          createdAt: Date.now()
        });
      });
      console.log(`Planted ${db.people.length} people from seed.json`);
    }

    if (!db.media.length && Array.isArray(seed.media)) {
      const byName = {};
      db.people.forEach((p) => { byName[p.name] = p.id; });

      seed.media.forEach((entry) => {
        const source = path.join(__dirname, 'public', path.basename(entry.sourceFile || ''));
        if (!fs.existsSync(source)) {
          console.error('Seed image missing, skipping:', entry.sourceFile);
          return;
        }
        const ext = path.extname(source).toLowerCase();
        const filename = newId() + ext;
        fs.copyFileSync(source, path.join(PUBLIC_UPLOADS, filename));

        const year = entry.year || '';
        const fourDigit = year.match(/(\d{4})/);
        const item = {
          id: newId(),
          accession: accession(year),
          kind: EXT_KIND.get(ext) || 'photo',
          section: entry.section || 'albums',
          title: entry.title || 'Untitled',
          caption: entry.caption || '',
          year,
          decade: fourDigit ? String(Math.floor(Number(fourDigit[1]) / 10) * 10) + 's' : '',
          event: entry.event || '',
          album: entry.album || '',
          medium: entry.medium || '',
          place: entry.place || '',
          peopleIds: (entry.people || []).map((n) => byName[n]).filter(Boolean),
          handwrittenBack: entry.handwrittenBack || '',
          transcript: '',
          contributor: entry.contributor || 'The family',
          visibility: 'public',
          file: filename,
          originalName: path.basename(source),
          size: fs.statSync(source).size,
          createdAt: Date.now()
        };
        db.media.push(item);
        if (entry.cover) site.coverMediaId = item.id;
        console.log(`Planted ${item.accession} — ${item.title}`);
      });
    }

    save();
  } catch (err) {
    console.error('Could not read seed.json:', err.message);
  }
}

/* =================================================================
   App
================================================================= */

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '200kb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(PUBLIC_UPLOADS, {
  maxAge: '30d', index: false,
  setHeaders: (res) => res.setHeader('X-Content-Type-Options', 'nosniff')
}));

// Family-only files pass through a gate
app.get('/family-uploads/:file', (req, res) => {
  if (!isFamily(req)) return res.status(403).type('text').send('This file is for family only.');
  const name = path.basename(req.params.file);
  res.sendFile(path.join(FAMILY_UPLOADS, name), (err) => {
    if (err && !res.headersSent) res.status(404).type('text').send('Not found.');
  });
});

/* ---- Unlocking Next Generations ---- */
app.post('/api/access', rateLimit(10, 15 * 60 * 1000), (req, res) => {
  if (!FAMILY_PASSCODE) return res.json({ ok: true, unlocked: true });
  if (!sameSecret(clean(req.body.passcode, 200), FAMILY_PASSCODE)) {
    return res.status(401).json({ error: 'That passcode does not match. Ask whoever sent you the link.' });
  }
  res.setHeader('Set-Cookie',
    `family=${familyToken()}; Path=/; Max-Age=${60 * 60 * 24 * 180}; HttpOnly; SameSite=Lax` +
    (req.secure ? '; Secure' : ''));
  res.json({ ok: true, unlocked: true });
});

app.post('/api/access/lock', (req, res) => {
  res.setHeader('Set-Cookie', 'family=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax');
  res.json({ ok: true, unlocked: false });
});

/* ---- Everything the front end needs, in one request ---- */
app.get('/api/bootstrap', (req, res) => {
  const family = isFamily(req);
  const visible = (row) => family || row.visibility !== 'family';
  res.json({
    site,
    unlocked: family,
    passcodeRequired: Boolean(FAMILY_PASSCODE),
    isAdmin: isAdmin(req),
    people: db.people.filter(visible),
    media: db.media.filter(visible),
    stories: db.stories.filter(visible),
    places: db.places.filter(visible),
    events: db.events.filter(visible),
    messages: db.messages
  });
});

/* ---- People ---- */
app.post('/api/people', requireAdmin, (req, res) => {
  const name = clean(req.body.name, 80);
  if (!name) return res.status(400).json({ error: 'A name is needed.' });
  let slug = slugify(name);
  while (db.people.some((p) => p.slug === slug)) slug += '-' + crypto.randomBytes(2).toString('hex');

  const person = {
    id: newId(),
    slug,
    name,
    generation: Math.min(9, Math.max(1, Number(req.body.generation) || 3)),
    relation: clean(req.body.relation, 120),
    born: clean(req.body.born, 40),
    died: clean(req.body.died, 40),
    birthPlace: clean(req.body.birthPlace, 120),
    summary: clean(req.body.summary, 400),
    biography: multiline(req.body.biography, 20000),
    portraitId: clean(req.body.portraitId, 40) || null,
    memorial: Boolean(req.body.memorial),
    visibility: req.body.visibility === 'family' ? 'family' : 'public',
    createdAt: Date.now()
  };
  db.people.push(person);
  save();
  res.status(201).json(person);
});

app.patch('/api/people/:id', requireAdmin, (req, res) => {
  const person = db.people.find((p) => p.id === req.params.id);
  if (!person) return res.status(404).json({ error: 'No such person.' });

  const text = { relation: 120, born: 40, died: 40, birthPlace: 120, summary: 400 };
  Object.entries(text).forEach(([field, max]) => {
    if (req.body[field] != null) person[field] = clean(req.body[field], max);
  });
  if (req.body.name != null && clean(req.body.name, 80)) person.name = clean(req.body.name, 80);
  if (req.body.biography != null) person.biography = multiline(req.body.biography, 20000);
  if (req.body.generation != null) {
    person.generation = Math.min(9, Math.max(1, Number(req.body.generation) || person.generation));
  }
  if (req.body.portraitId !== undefined) person.portraitId = clean(req.body.portraitId, 40) || null;
  if (req.body.memorial != null) person.memorial = Boolean(req.body.memorial);
  if (req.body.visibility != null) person.visibility = req.body.visibility === 'family' ? 'family' : 'public';

  save();
  res.json(person);
});

/* ---- Media ---- */
app.post('/api/media', rateLimit(40, 10 * 60 * 1000), (req, res) => {
  upload.single('file')(req, res, (err) => {
    if (err) {
      return res.status(400).json({
        error: err.code === 'LIMIT_FILE_SIZE'
          ? `That file is over ${MAX_UPLOAD_MB} MB. Try a smaller or shorter version.`
          : err.message
      });
    }
    if (!req.file) return res.status(400).json({ error: 'Choose a file to add.' });

    const title = clean(req.body.title, 160);
    const contributor = clean(req.body.contributor, 80);
    if (!title || !contributor) {
      fs.unlink(req.file.path, () => {});
      return res.status(400).json({ error: 'A title and your name are both needed.' });
    }

    const ext = path.extname(req.file.filename).toLowerCase();
    const visibility = req.body.visibility === 'family' && FAMILY_PASSCODE ? 'family' : 'public';
    const filename = req.file.filename;
    if (visibility === 'family') {
      try {
        fs.renameSync(req.file.path, path.join(FAMILY_UPLOADS, filename));
      } catch (moveErr) {
        console.error('Could not move to the family folder:', moveErr.message);
      }
    }

    const year = clean(req.body.year, 24);
    const fourDigit = year.match(/(\d{4})/);
    const item = {
      id: newId(),
      accession: accession(year),
      kind: EXT_KIND.get(ext),
      section: ['albums', 'documents', 'voices'].includes(req.body.section) ? req.body.section : 'albums',
      title,
      caption: multiline(req.body.caption, 3000),
      year,
      decade: fourDigit ? String(Math.floor(Number(fourDigit[1]) / 10) * 10) + 's' : '',
      event: clean(req.body.event, 120),
      album: clean(req.body.album, 120),
      medium: clean(req.body.medium, 120),
      place: clean(req.body.place, 160),
      peopleIds: idList(req.body.peopleIds, db.people),
      handwrittenBack: multiline(req.body.handwrittenBack, 800),
      transcript: multiline(req.body.transcript, 40000),
      contributor,
      visibility,
      file: filename,
      originalName: clean(req.file.originalname, 200),
      size: req.file.size,
      createdAt: Date.now()
    };

    db.media.push(item);
    save();
    res.status(201).json(item);
  });
});

/* ---- Stories, traditions, recipes, memorials ---- */
app.post('/api/stories', rateLimit(25, 10 * 60 * 1000), (req, res) => {
  const title = clean(req.body.title, 180);
  const body = multiline(req.body.body, 60000);
  const author = clean(req.body.author, 80);
  if (!title || !body || !author) {
    return res.status(400).json({ error: 'A title, some words, and your name are all needed.' });
  }
  const story = {
    id: newId(),
    kind: ['story', 'tradition', 'recipe', 'memorial', 'origin'].includes(req.body.kind) ? req.body.kind : 'story',
    title,
    subtitle: clean(req.body.subtitle, 240),
    body,
    author,
    year: clean(req.body.year, 24),
    peopleIds: idList(req.body.peopleIds, db.people),
    visibility: req.body.visibility === 'family' && FAMILY_PASSCODE ? 'family' : 'public',
    createdAt: Date.now()
  };
  db.stories.push(story);
  save();
  res.status(201).json(story);
});

/* ---- Places ---- */
app.post('/api/places', rateLimit(25, 10 * 60 * 1000), (req, res) => {
  const name = clean(req.body.name, 160);
  const lat = Number(req.body.lat);
  const lng = Number(req.body.lng);
  if (!name) return res.status(400).json({ error: 'A place name is needed.' });
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return res.status(400).json({ error: 'Latitude and longitude look wrong. Right-click the spot in Google Maps to copy them.' });
  }
  const place = {
    id: newId(),
    name,
    lat,
    lng,
    years: clean(req.body.years, 60),
    note: multiline(req.body.note, 2000),
    peopleIds: idList(req.body.peopleIds, db.people),
    contributor: clean(req.body.contributor, 80),
    visibility: 'public',
    createdAt: Date.now()
  };
  db.places.push(place);
  save();
  res.status(201).json(place);
});

/* ---- Timeline events ---- */
app.post('/api/events', rateLimit(30, 10 * 60 * 1000), (req, res) => {
  const title = clean(req.body.title, 180);
  const year = clean(req.body.year, 24);
  if (!title || !/\d{3,4}/.test(year)) {
    return res.status(400).json({ error: 'An event needs a title and a year.' });
  }
  const event = {
    id: newId(),
    title,
    year,
    sortYear: Number(year.match(/\d{3,4}/)[0]),
    detail: multiline(req.body.detail, 3000),
    peopleIds: idList(req.body.peopleIds, db.people),
    contributor: clean(req.body.contributor, 80),
    visibility: 'public',
    createdAt: Date.now()
  };
  db.events.push(event);
  save();
  res.status(201).json(event);
});

/* ---- Messages and corrections ---- */
app.post('/api/messages', rateLimit(25, 10 * 60 * 1000), (req, res) => {
  const name = clean(req.body.name, 80);
  const body = multiline(req.body.body, 4000);
  if (!name || !body) return res.status(400).json({ error: 'Add your name and a message.' });

  const parentId = clean(req.body.parentId, 40) || null;
  if (parentId && !db.messages.some((m) => m.id === parentId)) {
    return res.status(400).json({ error: 'The message you are replying to is gone.' });
  }
  const message = {
    id: newId(),
    name,
    body,
    parentId,
    subject: clean(req.body.subject, 160),
    kind: req.body.kind === 'correction' ? 'correction' : 'note',
    createdAt: Date.now()
  };
  db.messages.push(message);
  save();
  res.status(201).json(message);
});

/* ---- Deletion ---- */
app.delete('/api/:collection/:id', requireAdmin, (req, res) => {
  const { collection, id } = req.params;
  if (!COLLECTIONS.includes(collection)) return res.status(404).json({ error: 'Unknown collection.' });

  if (collection === 'messages') {
    const doomed = new Set([id]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const m of db.messages) {
        if (m.parentId && doomed.has(m.parentId) && !doomed.has(m.id)) { doomed.add(m.id); changed = true; }
      }
    }
    db.messages = db.messages.filter((m) => !doomed.has(m.id));
    save();
    return res.json({ ok: true, removed: doomed.size });
  }

  const index = db[collection].findIndex((row) => row.id === id);
  if (index === -1) return res.status(404).json({ error: 'Already gone.' });
  const [removed] = db[collection].splice(index, 1);

  if (collection === 'media' && removed.file) {
    const dir = removed.visibility === 'family' ? FAMILY_UPLOADS : PUBLIC_UPLOADS;
    fs.unlink(path.join(dir, removed.file), () => {});
  }
  if (collection === 'people') {
    db.media.forEach((m) => { m.peopleIds = m.peopleIds.filter((p) => p !== id); });
    db.stories.forEach((s) => { s.peopleIds = s.peopleIds.filter((p) => p !== id); });
    db.places.forEach((p) => { p.peopleIds = p.peopleIds.filter((x) => x !== id); });
    db.events.forEach((e) => { e.peopleIds = e.peopleIds.filter((x) => x !== id); });
  }
  save();
  res.json({ ok: true });
});

app.get('/healthz', (req, res) => res.type('text').send('ok'));

// Client-side routing uses the hash, so anything unmatched returns the shell
app.use((req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => {
  console.log(`${site.name} History — port ${PORT}, data in ${DATA_DIR}`);
  if (!ADMIN_KEY) console.log('ADMIN_KEY is not set: editing and deleting are switched off.');
  if (!FAMILY_PASSCODE) console.log('FAMILY_PASSCODE is not set: Next Generations is open to everyone.');
});
