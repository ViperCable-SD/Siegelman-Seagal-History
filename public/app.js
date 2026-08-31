'use strict';

/* =================================================================
   Small helpers
================================================================= */

const $ = (sel, root = document) => root.querySelector(sel);

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function frag(...nodes) {
  const f = document.createDocumentFragment();
  nodes.filter(Boolean).forEach((n) => f.appendChild(n));
  return f;
}

const ADMIN_KEY = new URLSearchParams(location.search).get('key') || '';

const state = {
  site: { name: 'Siegelman / Seagal', accessionPrefix: 'SS' },
  people: [], media: [], stories: [], places: [], events: [], messages: [],
  unlocked: false, passcodeRequired: false, isAdmin: false,
  ready: false
};

async function api(url, options = {}) {
  const opts = Object.assign({ headers: {} }, options);
  if (ADMIN_KEY) opts.headers['x-admin-key'] = ADMIN_KEY;
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Something went wrong. Try again.');
  return data;
}

const jsonPost = (url, body) =>
  api(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

const personById = (id) => state.people.find((p) => p.id === id);
const personBySlug = (slug) => state.people.find((p) => p.slug === slug);
const mediaById = (id) => state.media.find((m) => m.id === id);
const mediaUrl = (m) => (m.visibility === 'family' ? '/family-uploads/' : '/uploads/') + m.file;

const lifespan = (p) => (p.born || p.died) ? `${p.born || '?'} – ${p.died || ''}`.trim().replace(/–\s*$/, '–') : '';

function portraitFor(person) {
  if (person.portraitId) {
    const chosen = mediaById(person.portraitId);
    if (chosen && chosen.kind === 'photo') return chosen;
  }
  return state.media.find((m) => m.kind === 'photo' && m.peopleIds.includes(person.id)) || null;
}

const mediaFor = (person) => state.media.filter((m) => m.peopleIds.includes(person.id));
const storiesFor = (person) => state.stories.filter((s) => s.peopleIds.includes(person.id));

function setStatus(node, text, kind) {
  node.textContent = text;
  node.className = 'status' + (kind ? ' ' + kind : '');
}

function empty(title, message, ctaText, ctaHref) {
  const box = el('div', 'empty');
  box.appendChild(el('strong', null, title));
  box.appendChild(el('p', null, message));
  if (ctaText) {
    const link = el('a', 'btn', ctaText);
    link.href = ctaHref || '#/contribute';
    link.style.textDecoration = 'none';
    link.style.display = 'inline-block';
    box.appendChild(link);
  }
  return box;
}

/* =================================================================
   Reusable pieces
================================================================= */

function pageHead(eyebrow, title, intro) {
  const head = el('header', 'page-head');
  head.appendChild(el('p', 'label', eyebrow));
  head.appendChild(el('h1', null, title));
  if (intro) head.appendChild(el('p', 'intro', intro));
  return head;
}

function peopleLinks(ids) {
  const wrap = el('div', 'lab-people');
  ids.map(personById).filter(Boolean).forEach((p) => {
    const a = el('a', null, p.name);
    a.href = '#/people/' + p.slug;
    wrap.appendChild(a);
  });
  return wrap.children.length ? wrap : null;
}

const GLYPH = { document: '§', audio: '♪', video: '▶', photo: '✦' };

/** A museum object: the thing itself, then the wall label beside it. */
function objectCard(item, options = {}) {
  const card = el('article', 'object');

  const frame = el('div', 'object-frame');
  if (item.kind === 'photo') {
    const img = el('img');
    img.src = mediaUrl(item);
    img.alt = item.title;
    img.loading = 'lazy';
    frame.appendChild(img);
    frame.addEventListener('click', () => openLightbox(item));
  } else {
    frame.classList.add('is-doc');
    const glyph = el('div', 'object-glyph');
    glyph.appendChild(el('div', 'glyph', GLYPH[item.kind] || '✦'));
    glyph.appendChild(el('div', 'glyph-name', item.originalName));
    frame.appendChild(glyph);
    frame.addEventListener('click', () => window.open(mediaUrl(item), '_blank', 'noopener'));
  }
  if (item.visibility === 'family') frame.appendChild(el('span', 'flag-family', 'Family only'));
  card.appendChild(frame);

  const label = el('div', 'wall-label');
  label.appendChild(el('h3', null, item.title));
  const dateBits = [item.year, item.place].filter(Boolean).join(', ');
  if (dateBits) label.appendChild(el('p', 'lab-date', dateBits));

  const medium = item.medium || ({
    photo: 'Photograph', document: 'Document', audio: 'Audio recording', video: 'Moving image'
  })[item.kind];
  const mediumLine = [medium, item.event, item.album].filter(Boolean).join(' · ');
  label.appendChild(el('p', 'lab-medium', mediumLine));

  if (item.caption && !options.hideCaption) label.appendChild(el('p', 'lab-medium', item.caption));
  label.appendChild(el('p', 'lab-credit', 'Contributed by ' + item.contributor));

  const links = peopleLinks(item.peopleIds);
  if (links) label.appendChild(links);
  label.appendChild(el('span', 'accession', item.accession));

  if (item.handwrittenBack) label.appendChild(el('div', 'back-note', item.handwrittenBack));
  if (state.isAdmin) label.appendChild(deleteButton('media', item.id, item.title));

  card.appendChild(label);
  return card;
}

function deleteButton(collection, id, name) {
  const btn = el('button', 'btn-quiet', 'Remove');
  btn.type = 'button';
  btn.style.marginTop = '.6rem';
  btn.addEventListener('click', async () => {
    if (!confirm(`Remove "${name}" from the archive? This cannot be undone.`)) return;
    try {
      await api(`/api/${collection}/${id}`, { method: 'DELETE' });
      await loadData();
      route();
    } catch (err) {
      alert(err.message);
    }
  });
  return btn;
}

function personCard(person, className) {
  const link = el('a', className || 'person-card');
  link.href = '#/people/' + person.slug;

  const box = el('div', 'person-portrait');
  const portrait = portraitFor(person);
  if (portrait) {
    const img = el('img');
    img.src = mediaUrl(portrait);
    img.alt = person.name;
    img.loading = 'lazy';
    box.appendChild(img);
  } else {
    box.appendChild(el('div', 'person-empty', person.name.charAt(0)));
  }
  link.appendChild(box);
  link.appendChild(el('h3', null, person.name));

  const meta = [lifespan(person), person.relation].filter(Boolean).join(' · ');
  if (meta) link.appendChild(el('p', 'person-meta', meta));
  return link;
}

function storyCard(story) {
  const link = el('a', 'story-card');
  link.href = '#/stories/' + story.id;
  link.appendChild(el('h3', null, story.title));
  if (story.subtitle) link.appendChild(el('p', 'story-sub', story.subtitle));
  link.appendChild(el('p', 'story-teaser', story.body.slice(0, 190) + (story.body.length > 190 ? '…' : '')));
  const who = story.peopleIds.map(personById).filter(Boolean).map((p) => p.name).join(', ');
  const meta = ['Written by ' + story.author, story.year, who].filter(Boolean).join(' · ');
  link.appendChild(el('p', 'story-meta', meta));
  return link;
}

function pillStrip(labelText, options, current, onPick) {
  const strip = el('div', 'strip');
  strip.appendChild(el('span', 'label strip-label', labelText));
  options.forEach((opt) => {
    const pill = el('button', 'pill', opt.label);
    pill.type = 'button';
    pill.setAttribute('aria-pressed', String(opt.value === current));
    pill.addEventListener('click', () => onPick(opt.value));
    strip.appendChild(pill);
  });
  return strip;
}


/** A prominent way in to the upload form, so adding is never hidden. */
function addBar(text, href) {
  const bar = el('div', 'add-bar');
  const link = el('a', 'btn', text);
  link.href = href;
  bar.appendChild(link);
  bar.appendChild(el('span', 'add-hint', 'Anyone in the family can add to this.'));
  return bar;
}

/* =================================================================
   Lightbox
================================================================= */

function openLightbox(item) {
  const box = $('#lightbox');
  $('#lightbox-img').src = mediaUrl(item);
  $('#lightbox-img').alt = item.title;
  const bits = [item.title, item.year, item.accession, 'Contributed by ' + item.contributor].filter(Boolean);
  $('#lightbox-caption').textContent = bits.join(' · ');
  box.hidden = false;
  $('#lightbox-close').focus();
}

function closeLightbox() {
  $('#lightbox').hidden = true;
  $('#lightbox-img').src = '';
}

$('#lightbox-close').addEventListener('click', closeLightbox);
$('#lightbox').addEventListener('click', (e) => { if (e.target.id === 'lightbox') closeLightbox(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeLightbox(); });

/* =================================================================
   Form helpers
================================================================= */

function field(labelText, control, opts = {}) {
  const wrap = el('div', 'field' + (opts.span2 ? ' span-2' : ''));
  const id = 'f' + Math.random().toString(36).slice(2, 9);
  control.id = id;
  const label = el('label', null, labelText);
  label.setAttribute('for', id);
  if (opts.optional) {
    label.appendChild(document.createTextNode(' '));
    label.appendChild(el('span', 'opt', 'optional'));
  }
  wrap.appendChild(label);
  wrap.appendChild(control);
  if (opts.hint) wrap.appendChild(el('p', 'hint', opts.hint));
  return wrap;
}

function textInput(placeholder, maxLength) {
  const input = el('input');
  input.type = 'text';
  input.placeholder = placeholder || '';
  if (maxLength) input.maxLength = maxLength;
  return input;
}

function textArea(placeholder, rows, maxLength) {
  const area = el('textarea');
  area.rows = rows || 4;
  area.placeholder = placeholder || '';
  if (maxLength) area.maxLength = maxLength;
  return area;
}

function selectInput(options) {
  const select = el('select');
  options.forEach(([value, text]) => {
    const opt = el('option', null, text);
    opt.value = value;
    select.appendChild(opt);
  });
  return select;
}

/** Pills for tagging people. Returns the node plus a getter for the ids. */
function peoplePicker() {
  const chosen = new Set();
  const wrap = el('fieldset', 'field field-block span-2');
  wrap.appendChild(el('legend', null, 'Who is in it?'));
  const strip = el('div', 'strip');
  state.people.slice().sort(byGeneration).forEach((person) => {
    const pill = el('button', 'pill', person.name);
    pill.type = 'button';
    pill.setAttribute('aria-pressed', 'false');
    pill.addEventListener('click', () => {
      const on = pill.getAttribute('aria-pressed') === 'true';
      pill.setAttribute('aria-pressed', String(!on));
      if (on) chosen.delete(person.id); else chosen.add(person.id);
    });
    strip.appendChild(pill);
  });
  wrap.appendChild(strip);
  return {
    node: wrap,
    value: () => Array.from(chosen).join(','),
    reset: () => {
      chosen.clear();
      strip.querySelectorAll('.pill').forEach((p) => p.setAttribute('aria-pressed', 'false'));
    }
  };
}

const byGeneration = (a, b) => (a.generation - b.generation) || a.createdAt - b.createdAt;

/* Everyone is placed by how far they stand from Dora and Nathan. */
const GENERATIONS = {
  1: { title: 'Dora and Nathan', note: 'Where the family starts.' },
  2: { title: 'Their children', note: 'The nine.' },
  3: { title: 'Grandchildren', note: 'The children of the nine.' },
  4: { title: 'Great-grandchildren', note: 'Their children in turn.' },
  5: { title: 'Great-great-grandchildren', note: 'The newest arrivals.' },
  6: { title: 'Great-great-great-grandchildren', note: '' }
};
const GEN_MAX = 6;
const genTitle = (n) => (GENERATIONS[n] || {}).title || ('Generation ' + n);
const genNote = (n) => (GENERATIONS[n] || {}).note || '';

/** Which generation bands to show: everything occupied, plus one empty invitation. */
function generationRange() {
  const present = state.people.map((p) => p.generation);
  const highest = present.length ? Math.max.apply(null, present) : 2;
  const range = [];
  for (let g = 1; g <= Math.min(GEN_MAX, Math.max(highest + 1, 5)); g++) range.push(g);
  return range;
}

function peopleIn(gen) {
  return state.people.filter((p) => p.generation === gen).sort(byGeneration);
}

function formShell(titleText, noteText) {
  const panel = el('section', 'panel');
  panel.appendChild(el('h2', null, titleText));
  if (noteText) panel.appendChild(el('p', 'panel-note', noteText));
  const form = el('form', 'form');
  panel.appendChild(form);
  return { panel, form };
}

function submitRow(buttonText) {
  const row = el('div', 'actions span-2');
  const button = el('button', 'btn', buttonText);
  button.type = 'submit';
  const status = el('p', 'status');
  row.appendChild(button);
  row.appendChild(status);
  return { row, button, status };
}

/* =================================================================
   Views
================================================================= */

const views = {};

/* ---- Our Family Story (home) ---- */
views.home = () => {
  const wrap = document.createDocumentFragment();

  const hero = el('section', 'hero');
  const cover = (state.site.coverMediaId && mediaById(state.site.coverMediaId))
    || state.media.find((m) => m.kind === 'photo' && m.visibility === 'public');
  if (cover) {
    hero.classList.add('has-figure');
    const figure = el('div', 'hero-figure');
    const img = el('img');
    img.src = mediaUrl(cover);
    img.alt = '';
    figure.appendChild(img);
    hero.appendChild(figure);
  }

  const inner = el('div', 'hero-inner');
  inner.appendChild(el('p', 'label hero-eyebrow', 'A family archive'));
  const h1 = el('h1');
  h1.appendChild(document.createTextNode('Siegelman '));
  h1.appendChild(el('em', null, '/'));
  h1.appendChild(document.createTextNode(' Seagal'));
  inner.appendChild(h1);
  inner.appendChild(el('p', 'hero-tagline', 'Dora and Nathan Seagal, their nine children, and everyone who came after.'));

  const stats = el('div', 'hero-stats');
  const generations = new Set(state.people.map((p) => p.generation)).size;
  [
    [state.people.length, 'people'],
    [state.media.length, 'objects'],
    [state.stories.length, 'stories'],
    [generations, generations === 1 ? 'generation' : 'generations']
  ].forEach(([n, word]) => {
    const stat = el('div', 'hero-stat');
    stat.appendChild(el('b', null, String(n)));
    stat.appendChild(document.createTextNode(word));
    stats.appendChild(stat);
  });
  inner.appendChild(stats);
  hero.appendChild(inner);
  wrap.appendChild(hero);

  const page = el('div', 'page');

  if (cover && cover.kind === 'photo') {
    const plate = el('figure', 'plate');
    const shot = el('img');
    shot.src = mediaUrl(cover);
    shot.alt = cover.title;
    shot.addEventListener('click', () => openLightbox(cover));
    plate.appendChild(shot);

    const cap = el('figcaption');
    const left = el('div');
    left.appendChild(el('h2', null, cover.title));
    const dateBits = [cover.year || 'Undated', cover.place].filter(Boolean).join(', ');
    left.appendChild(el('p', 'lab-date', dateBits));
    if (cover.caption) left.appendChild(el('p', 'plate-caption', cover.caption));
    const named = peopleLinks(cover.peopleIds);
    if (named) left.appendChild(named);
    cap.appendChild(left);

    const right = el('div', 'plate-meta');
    if (cover.medium) right.appendChild(el('p', 'lab-medium', cover.medium));
    right.appendChild(el('p', 'lab-credit', 'Contributed by ' + cover.contributor));
    right.appendChild(el('span', 'accession', cover.accession));
    const fix = el('a', 'btn-quiet', 'Name someone in it');
    fix.href = '#/contribute/note';
    right.appendChild(fix);
    cap.appendChild(right);

    plate.appendChild(cap);
    page.appendChild(plate);
  }

  const origin = state.stories.find((s) => s.kind === 'origin');
  const story = el('section', 'readable');
  story.appendChild(el('p', 'label', 'Where the family came from'));
  if (origin) {
    story.appendChild(el('h2', null, origin.title));
    origin.body.split('\n\n').forEach((para, i) => {
      const p = el('p', i === 0 ? 'drop' : null, para);
      story.appendChild(p);
    });
    story.appendChild(el('p', 'lab-credit', 'Written by ' + origin.author));
  } else {
    story.appendChild(el('h2', null, 'This part is still unwritten'));
    story.appendChild(el('p', 'drop',
      'Every family archive begins with somebody sitting down and writing what they know — where the family came from, when they arrived, what the name was before it was changed, what they did for a living, and what everyone still argues about.'));
    story.appendChild(el('p', null,
      'When someone writes that account and marks it as the origin story, it appears here, on the front wall, before anything else.'));
    const cta = el('a', 'btn', 'Write the family story');
    cta.href = '#/contribute?form=story';
    cta.style.cssText = 'text-decoration:none;display:inline-block';
    story.appendChild(cta);
  }
  page.appendChild(story);

  page.appendChild(el('hr', 'rule'));

  page.appendChild(el('p', 'label', 'Start anywhere'));
  const doors = el('div', 'doors');
  [
    ['#/tree', 'Family Tree', 'Four generations, laid out as a chart you can walk through.'],
    ['#/people', 'People', 'A page for each person: dates, places, and everything tied to them.'],
    ['#/share', 'Share a Story', 'Write down something you remember and save it to the site.'],
    ['#/albums', 'Photo Albums', 'Sorted by person, branch, decade, or the occasion.'],
    ['#/documents', 'Documents & History', 'Immigration papers, service records, certificates, letters, clippings.'],
    ['#/voices', 'In Their Own Words', 'Recordings and oral histories, with transcripts.'],
    ['#/timeline', 'Timeline', 'From the oldest date anyone knows to this year.'],
    ['#/places', 'Places', 'A map of every address the family has called home.'],
    ['#/contribute', 'Contribute', 'Add a photograph, a memory, or a correction.']
  ].forEach(([href, title, blurb]) => {
    const door = el('a', 'door');
    door.href = href;
    door.appendChild(el('p', 'label', 'Section'));
    door.appendChild(el('h3', null, title));
    door.appendChild(el('p', null, blurb));
    doors.appendChild(door);
  });
  page.appendChild(doors);

  const recent = state.media.slice().sort((a, b) => b.createdAt - a.createdAt).slice(0, 4);
  if (recent.length) {
    page.appendChild(el('hr', 'rule'));
    page.appendChild(el('p', 'label', 'Most recently added'));
    const grid = el('div', 'objects');
    grid.style.marginTop = '1.2rem';
    recent.forEach((m) => grid.appendChild(objectCard(m, { hideCaption: true })));
    page.appendChild(grid);
  }

  wrap.appendChild(page);
  return wrap;
};

/* ---- Family Tree ---- */
views.tree = () => {
  const page = el('div', 'page');
  page.appendChild(pageHead('The family', 'Family Tree',
    'Oldest generation first, down to the youngest. Choose anyone to open their page.'));

  const bands = generationRange();
  bands.forEach((gen, index) => {
    const list = peopleIn(gen);
    const block = el('section', 'tree-gen');

    const head = el('div', 'tree-gen-head');
    head.appendChild(el('h2', null, genTitle(gen)));
    head.appendChild(el('span', 'rule-line'));
    head.appendChild(el('span', 'label', list.length ? list.length + ' people' : 'none yet'));
    block.appendChild(head);

    if (list.length) {
      const row = el('div', gen === 1 ? 'tree-couple' : 'tree-row');
      list.forEach((person, i) => {
        if (gen === 1 && i > 0) row.appendChild(el('span', 'tree-amp', 'and'));
        row.appendChild(treeNode(person));
      });
      block.appendChild(row);
    } else {
      const box = el('div', 'gen-empty');
      box.appendChild(el('p', null, 'This generation is waiting to be filled in.'));
      const link = el('a', 'btn-quiet', 'Add someone');
      link.href = '#/keeper';
      box.appendChild(link);
      block.appendChild(box);
    }

    if (index < bands.length - 1) block.appendChild(el('div', 'tree-descend'));
    page.appendChild(block);
  });

  return page;
};

function treeNode(person) {
  const node = el('a', 'node');
  node.href = '#/people/' + person.slug;
  const portrait = portraitFor(person);
  if (portrait) {
    const img = el('img', 'node-portrait');
    img.src = mediaUrl(portrait);
    img.alt = '';
    img.loading = 'lazy';
    node.appendChild(img);
  } else {
    node.appendChild(el('div', 'node-initial', person.name.charAt(0)));
  }
  const text = el('div');
  text.appendChild(el('span', 'node-name', person.name));
  const dates = [lifespan(person), person.relation].filter(Boolean)[0];
  if (dates) text.appendChild(el('span', 'node-dates', dates));
  node.appendChild(text);
  return node;
}

/* ---- People ---- */
views.people = () => {
  const page = el('div', 'page');
  page.appendChild(pageHead('The family', 'People',
    'Everyone is placed by how far they stand from Dora and Nathan. Each name opens a page holding their dates, their photographs, their stories and their places.'));

  generationRange().forEach((gen) => {
    const list = peopleIn(gen);
    const block = el('section', 'section-block');

    const head = el('div', 'gen-head');
    const heading = el('h2', null, genTitle(gen));
    head.appendChild(heading);
    head.appendChild(el('span', 'gen-count', list.length ? list.length + (list.length === 1 ? ' person' : ' people') : 'none yet'));
    block.appendChild(head);
    if (genNote(gen)) block.appendChild(el('p', 'gen-note', genNote(gen)));

    if (list.length) {
      const grid = el('div', 'people-grid');
      list.forEach((person) => grid.appendChild(personCard(person)));
      block.appendChild(grid);
    } else {
      const box = el('div', 'gen-empty');
      box.appendChild(el('p', null, 'Nobody has been added to this generation yet.'));
      const link = el('a', 'btn-quiet', 'Add someone');
      link.href = '#/keeper';
      box.appendChild(link);
      block.appendChild(box);
    }
    page.appendChild(block);
  });

  return page;
};

/* ---- One person ---- */
views.person = (slug) => {
  const person = personBySlug(slug);
  const page = el('div', 'page');
  if (!person) {
    page.appendChild(empty('No one here by that name', 'The link may be old, or the page may have been renamed.', 'Back to People', '#/people'));
    return page;
  }

  const head = el('header', 'person-head');
  const box = el('div', 'person-portrait');
  const portrait = portraitFor(person);
  if (portrait) {
    const img = el('img');
    img.src = mediaUrl(portrait);
    img.alt = person.name;
    box.appendChild(img);
  } else {
    box.appendChild(el('div', 'person-empty', person.name.charAt(0)));
  }
  head.appendChild(box);

  const info = el('div');
  info.appendChild(el('p', 'label', person.relation || 'Family'));
  info.appendChild(el('h1', null, person.name));
  const dates = lifespan(person);
  if (dates) info.appendChild(el('p', 'person-dates', dates));
  if (person.summary) info.appendChild(el('p', null, person.summary));

  const facts = el('ul', 'person-facts');
  [
    ['Born', [person.born, person.birthPlace].filter(Boolean).join(', ')],
    ['Died', person.died],
    ['Photographs', String(mediaFor(person).filter((m) => m.kind === 'photo').length)],
    ['Documents', String(mediaFor(person).filter((m) => m.kind === 'document').length)],
    ['Stories', String(storiesFor(person).length)]
  ].filter(([, v]) => v && v !== '0').forEach(([k, v]) => {
    const li = el('li');
    li.appendChild(el('span', 'label fact-key', k));
    li.appendChild(el('span', null, v));
    facts.appendChild(li);
  });
  if (facts.children.length) info.appendChild(facts);
  head.appendChild(info);
  page.appendChild(head);

  if (person.biography) {
    const bio = el('section', 'section-block story-body');
    bio.appendChild(el('h2', null, 'Life'));
    person.biography.split('\n\n').forEach((para) => bio.appendChild(el('p', null, para)));
    page.appendChild(bio);
  }

  const theirStories = storiesFor(person);
  if (theirStories.length) {
    const block = el('section', 'section-block');
    block.appendChild(el('h2', null, 'Stories and memories'));
    const list = el('div', 'story-list');
    theirStories.forEach((s) => list.appendChild(storyCard(s)));
    block.appendChild(list);
    page.appendChild(block);
  }

  const theirMedia = mediaFor(person);
  if (theirMedia.length) {
    const block = el('section', 'section-block');
    block.appendChild(el('h2', null, 'In the collection'));
    const grid = el('div', 'objects');
    theirMedia.forEach((m) => grid.appendChild(objectCard(m)));
    block.appendChild(grid);
    page.appendChild(block);
  }

  const theirPlaces = state.places.filter((pl) => pl.peopleIds.includes(person.id));
  if (theirPlaces.length) {
    const block = el('section', 'section-block');
    block.appendChild(el('h2', null, 'Places'));
    const list = el('div', 'place-list');
    theirPlaces.forEach((pl) => list.appendChild(placeCard(pl)));
    block.appendChild(list);
    page.appendChild(block);
  }

  if (!theirMedia.length && !theirStories.length && !person.biography) {
    page.appendChild(empty(
      'Nothing has been added about ' + person.name.split(' ')[0] + ' yet',
      'If you have a photograph, a document, or a memory, this page is where it will land.',
      'Add something', '#/contribute'
    ));
  }

  return page;
};

/* ---- Their Stories ---- */
views.stories = () => {
  const page = el('div', 'page');
  page.appendChild(pageHead('The family', 'Their Stories',
    'Longer accounts: biographies, memories written down, and the things that only get told at the table.'));

  const list = state.stories.filter((s) => ['story', 'origin'].includes(s.kind))
    .sort((a, b) => b.createdAt - a.createdAt);

  if (!list.length) {
    page.appendChild(empty('No stories yet', 'A story can be three sentences. The ones that get lost are always the short ones nobody wrote down.', 'Write one', '#/share'));
    return page;
  }

  const bar = el('p');
  const add = el('a', 'btn', 'Share a story');
  add.href = '#/share';
  add.style.cssText = 'text-decoration:none;display:inline-block';
  bar.appendChild(add);
  page.appendChild(bar);

  const wrap = el('div', 'story-list');
  wrap.style.marginTop = '1.5rem';
  list.forEach((s) => wrap.appendChild(storyCard(s)));
  page.appendChild(wrap);
  return page;
};

views.story = (id) => {
  const story = state.stories.find((s) => s.id === id);
  const page = el('div', 'page page-narrow');
  if (!story) {
    page.appendChild(empty('That story is not here', 'It may have been removed.', 'All stories', '#/stories'));
    return page;
  }

  const head = el('header', 'page-head');
  head.appendChild(el('p', 'label', story.kind === 'recipe' ? 'Recipe' : story.kind === 'tradition' ? 'Tradition' : story.kind === 'memorial' ? 'In memoriam' : 'Story'));
  head.appendChild(el('h1', null, story.title));
  if (story.subtitle) head.appendChild(el('p', 'person-dates', story.subtitle));
  const who = story.peopleIds.map(personById).filter(Boolean);
  const meta = el('p', 'story-meta');
  meta.textContent = ['Written by ' + story.author, story.year].filter(Boolean).join(' · ');
  head.appendChild(meta);
  if (who.length) head.appendChild(peopleLinks(story.peopleIds));
  page.appendChild(head);

  const body = el('article', 'story-body');
  story.body.split('\n\n').forEach((para) => body.appendChild(el('p', null, para)));
  page.appendChild(body);

  if (state.isAdmin) page.appendChild(deleteButton('stories', story.id, story.title));

  const back = el('p');
  const link = el('a', null, '← All stories');
  link.href = '#/stories';
  back.appendChild(link);
  page.appendChild(back);
  return page;
};

/* ---- Photo Albums ---- */
views.albums = (groupBy) => {
  const page = el('div', 'page');
  page.appendChild(pageHead('The collection', 'Photo Albums',
    'Every photograph in the archive, arranged four different ways. Each one carries its own label.'));

  page.appendChild(addBar('Add a photograph', '#/contribute/media'));

  const photos = state.media.filter((m) => m.kind === 'photo');
  if (!photos.length) {
    page.appendChild(empty('The albums are empty', 'Scan one photograph and it becomes the first object in the collection.', 'Add a photograph', '#/contribute?form=media'));
    return page;
  }

  const mode = ['album', 'decade', 'event', 'person'].includes(groupBy) ? groupBy : 'album';
  page.appendChild(pillStrip('Arrange by', [
    { value: 'album', label: 'Album or branch' },
    { value: 'decade', label: 'Decade' },
    { value: 'event', label: 'Occasion' },
    { value: 'person', label: 'Person' }
  ], mode, (value) => { location.hash = '#/albums/' + value; }));

  const groups = new Map();
  const push = (key, item) => {
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  };

  photos.forEach((photo) => {
    if (mode === 'person') {
      const named = photo.peopleIds.map(personById).filter(Boolean);
      if (!named.length) push('Not yet identified', photo);
      else named.forEach((p) => push(p.name, photo));
    } else {
      const key = { album: photo.album, decade: photo.decade, event: photo.event }[mode];
      push(key || ({ album: 'Unsorted', decade: 'Date unknown', event: 'No particular occasion' })[mode], photo);
    }
  });

  Array.from(groups.keys()).sort().forEach((key) => {
    const block = el('section', 'section-block');
    const h2 = el('h2', null, key);
    block.appendChild(h2);
    const grid = el('div', 'objects');
    groups.get(key).forEach((m) => grid.appendChild(objectCard(m)));
    block.appendChild(grid);
    page.appendChild(block);
  });

  return page;
};

/* ---- Documents & History ---- */
views.documents = () => {
  const page = el('div', 'page');
  page.appendChild(pageHead('The collection', 'Documents & History',
    'Immigration papers, military records, marriage and death certificates, letters, deeds, and anything the newspapers printed about us.'));

  page.appendChild(addBar('Add a document', '#/contribute/media'));

  const docs = state.media.filter((m) => m.kind === 'document' || m.section === 'documents');
  if (!docs.length) {
    page.appendChild(empty('No documents yet', 'A ship manifest or a discharge paper often settles an argument that has run for forty years.', 'Add a document', '#/contribute?form=media'));
    return page;
  }

  const byDecade = new Map();
  docs.forEach((d) => {
    const key = d.decade || 'Date unknown';
    if (!byDecade.has(key)) byDecade.set(key, []);
    byDecade.get(key).push(d);
  });

  Array.from(byDecade.keys()).sort().forEach((key) => {
    const block = el('section', 'section-block');
    block.appendChild(el('h2', null, key));
    const grid = el('div', 'objects');
    byDecade.get(key).forEach((d) => grid.appendChild(objectCard(d)));
    block.appendChild(grid);
    page.appendChild(block);
  });

  return page;
};

/* ---- In Their Own Words ---- */
views.voices = () => {
  const page = el('div', 'page');
  page.appendChild(pageHead('The family', 'In Their Own Words',
    'Recorded voices and moving pictures. Where someone has typed up a transcript, it sits underneath.'));

  page.appendChild(addBar('Add a recording', '#/contribute/media'));

  const recordings = state.media.filter((m) => m.kind === 'audio' || m.kind === 'video');
  if (!recordings.length) {
    page.appendChild(empty('No recordings yet',
      'A phone can record an hour of someone talking. Ask about the crossing, the first apartment, or how their parents met — and put the file here.',
      'Add a recording', '#/contribute?form=media'));
    return page;
  }

  recordings.forEach((item) => {
    const box = el('article', 'voice');
    box.appendChild(el('p', 'label', item.kind === 'audio' ? 'Audio' : 'Video'));
    box.appendChild(el('h3', null, item.title));
    const meta = [item.year, item.place].filter(Boolean).join(', ');
    if (meta) box.appendChild(el('p', 'lab-date', meta));

    const player = el(item.kind === 'audio' ? 'audio' : 'video');
    player.controls = true;
    player.preload = 'metadata';
    player.src = mediaUrl(item);
    box.appendChild(player);

    if (item.caption) box.appendChild(el('p', 'lab-medium', item.caption));
    const links = peopleLinks(item.peopleIds);
    if (links) box.appendChild(links);
    box.appendChild(el('p', 'lab-credit', 'Recorded and contributed by ' + item.contributor));
    box.appendChild(el('span', 'accession', item.accession));

    if (item.transcript) {
      const details = el('details', 'transcript');
      details.appendChild(el('summary', null, 'Read the transcript'));
      details.appendChild(el('div', 'transcript-body', item.transcript));
      box.appendChild(details);
    }
    if (state.isAdmin) box.appendChild(deleteButton('media', item.id, item.title));
    page.appendChild(box);
  });

  return page;
};

/* ---- Traditions & Recipes ---- */
views.traditions = () => {
  const page = el('div', 'page');
  page.appendChild(pageHead('The collection', 'Traditions & Recipes',
    'What gets made every year, who made it first, and the step everybody does differently.'));

  const list = state.stories.filter((s) => s.kind === 'tradition' || s.kind === 'recipe');
  if (!list.length) {
    page.appendChild(empty('Nothing written down yet',
      'Recipes are the first thing lost and the easiest thing to save. Write one the way you actually make it, including the parts that are wrong.',
      'Add a recipe', '#/contribute?form=story'));
    return page;
  }

  ['recipe', 'tradition'].forEach((kind) => {
    const group = list.filter((s) => s.kind === kind);
    if (!group.length) return;
    const block = el('section', 'section-block');
    block.appendChild(el('h2', null, kind === 'recipe' ? 'Recipes' : 'Traditions'));
    const grid = el('div', 'story-list');
    group.forEach((s) => {
      const card = el('article', 'recipe-card');
      card.appendChild(el('h3', null, s.title));
      if (s.subtitle) card.appendChild(el('p', 'story-sub', s.subtitle));
      card.appendChild(el('div', 'recipe-body', s.body));
      const who = s.peopleIds.map(personById).filter(Boolean).map((p) => p.name).join(', ');
      card.appendChild(el('p', 'lab-credit', ['From ' + s.author, who].filter(Boolean).join(' · ')));
      if (state.isAdmin) card.appendChild(deleteButton('stories', s.id, s.title));
      grid.appendChild(card);
    });
    block.appendChild(grid);
    page.appendChild(block);
  });

  return page;
};

/* ---- Places ---- */
views.places = () => {
  const page = el('div', 'page');
  page.appendChild(pageHead('In context', 'Places',
    'Every address the family is known to have lived at, in the order we found out about them.'));

  if (!state.places.length) {
    page.appendChild(empty('No places on the map yet',
      'A village of origin, the first address in this country, the shop, the house everyone remembers — each one needs a name and a pair of coordinates.',
      'Add a place', '#/contribute?form=place'));
    return page;
  }

  const map = el('div');
  map.id = 'map';
  page.appendChild(map);

  const list = el('div', 'place-list');
  state.places.forEach((pl) => list.appendChild(placeCard(pl)));
  page.appendChild(list);

  setTimeout(() => drawMap(), 30);
  return page;
};

function placeCard(place) {
  const card = el('article', 'place-card');
  card.appendChild(el('h3', null, place.name));
  if (place.years) card.appendChild(el('p', 'place-years', place.years));
  if (place.note) card.appendChild(el('p', null, place.note));
  const links = peopleLinks(place.peopleIds);
  if (links) card.appendChild(links);
  if (state.isAdmin) card.appendChild(deleteButton('places', place.id, place.name));
  return card;
}

function drawMap() {
  const node = document.getElementById('map');
  if (!node || typeof L === 'undefined' || !state.places.length) return;
  const map = L.map(node);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    maxZoom: 18
  }).addTo(map);

  const markers = state.places.map((place) => {
    const marker = L.marker([place.lat, place.lng]).addTo(map);
    const lines = [`<strong>${escapeHtml(place.name)}</strong>`];
    if (place.years) lines.push(escapeHtml(place.years));
    if (place.note) lines.push(escapeHtml(place.note));
    marker.bindPopup(lines.join('<br>'));
    return marker;
  });

  map.fitBounds(L.featureGroup(markers).getBounds().pad(0.25));
  if (state.places.length === 1) map.setZoom(12);
}

function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---- Timeline ---- */
views.timeline = () => {
  const page = el('div', 'page');
  page.appendChild(pageHead('In context', 'Timeline',
    'Births, deaths, arrivals, marriages and turning points, from the oldest date anyone knows through to today.'));

  const entries = [];
  state.events.forEach((e) => entries.push({
    year: e.sortYear, label: e.year, title: e.title, detail: e.detail, kind: 'event', id: e.id
  }));
  state.people.forEach((p) => {
    const born = String(p.born || '').match(/\d{3,4}/);
    if (born) entries.push({ year: Number(born[0]), label: p.born, title: p.name + ' is born', detail: p.birthPlace, kind: 'birth', slug: p.slug });
    const died = String(p.died || '').match(/\d{3,4}/);
    if (died) entries.push({ year: Number(died[0]), label: p.died, title: p.name + ' dies', detail: '', kind: 'death', slug: p.slug });
  });

  if (!entries.length) {
    page.appendChild(empty('The timeline is empty',
      'It fills itself in as people get birth and death years, and as anyone adds a dated event.',
      'Add an event', '#/contribute?form=event'));
    return page;
  }

  entries.sort((a, b) => a.year - b.year);
  const line = el('div', 'timeline');
  entries.forEach((entry) => {
    const row = el('div', 'tl-entry' + (entry.kind === 'birth' ? ' is-birth' : entry.kind === 'death' ? ' is-death' : ''));
    row.appendChild(el('span', 'tl-year', entry.label || String(entry.year)));
    if (entry.slug) {
      const link = el('a', 'tl-title', entry.title);
      link.href = '#/people/' + entry.slug;
      link.style.textDecoration = 'none';
      row.appendChild(link);
    } else {
      row.appendChild(el('div', 'tl-title', entry.title));
    }
    if (entry.detail) row.appendChild(el('p', 'tl-detail', entry.detail));
    if (state.isAdmin && entry.id) row.appendChild(deleteButton('events', entry.id, entry.title));
    line.appendChild(row);
  });
  page.appendChild(line);
  return page;
};

/* ---- In Memoriam ---- */
views.memoriam = () => {
  const page = el('div', 'page');
  page.appendChild(pageHead('The family', 'In Memoriam',
    'The people we have lost, and what was said about them.'));

  const gone = state.people.filter((p) => p.memorial || (p.died && String(p.died).trim()));
  const tributes = state.stories.filter((s) => s.kind === 'memorial');

  if (!gone.length && !tributes.length) {
    page.appendChild(empty('No memorial pages yet',
      'A person appears here once a date of death is recorded for them, or when someone writes a tribute.',
      'Write a tribute', '#/contribute?form=story'));
    return page;
  }

  if (gone.length) {
    const band = el('section', 'memoriam');
    band.appendChild(el('p', 'label', 'Remembered'));
    band.appendChild(el('h2', null, 'Those who came before'));
    const list = el('div', 'mem-list');
    gone.sort(byGeneration).forEach((p) => list.appendChild(personCard(p, 'mem-person')));
    band.appendChild(list);
    page.appendChild(band);
  }

  if (tributes.length) {
    const block = el('section', 'section-block');
    block.style.marginTop = '3rem';
    block.appendChild(el('h2', null, 'Tributes'));
    const list = el('div', 'story-list');
    tributes.forEach((s) => list.appendChild(storyCard(s)));
    block.appendChild(list);
    page.appendChild(block);
  }

  return page;
};

/* ---- Next Generations ---- */
views.next = () => {
  const page = el('div', 'page');
  page.appendChild(pageHead('The family', 'Next Generations',
    'Children and grandchildren of the living. This part of the site is kept behind a passcode, because people who are still growing up did not choose to be published.'));

  if (state.passcodeRequired && !state.unlocked) {
    const { panel, form } = formShell('Enter the family passcode',
      'Whoever keeps the site can send it to you. It is the same for everyone and it never appears in a search engine.');
    const input = el('input');
    input.type = 'password';
    input.autocomplete = 'current-password';
    form.appendChild(field('Passcode', input, { span2: true }));
    const { row, button, status } = submitRow('Unlock');
    form.appendChild(row);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      button.disabled = true;
      setStatus(status, 'Checking…');
      try {
        await jsonPost('/api/access', { passcode: input.value });
        await loadData();
        route();
      } catch (err) {
        button.disabled = false;
        setStatus(status, err.message, 'err');
      }
    });
    page.appendChild(panel);
    return page;
  }

  if (state.passcodeRequired) {
    const bar = el('div', 'strip');
    bar.appendChild(el('span', 'label', 'Unlocked'));
    const lock = el('button', 'btn-quiet', 'Lock this device again');
    lock.type = 'button';
    lock.addEventListener('click', async () => {
      await api('/api/access/lock', { method: 'POST' });
      await loadData();
      route();
    });
    bar.appendChild(lock);
    page.appendChild(bar);
  } else {
    const warn = el('div', 'empty');
    warn.style.textAlign = 'left';
    warn.appendChild(el('strong', null, 'This section is not protected yet'));
    warn.appendChild(el('p', null, 'No passcode has been set on the server, so anything marked family only is visible to everyone. Set FAMILY_PASSCODE in the hosting settings to close it.'));
    page.appendChild(warn);
  }

  const youngest = Math.max.apply(null, state.people.map((p) => p.generation).concat([2]));
  const recent = state.people.filter((p) => p.generation >= Math.max(3, youngest - 1)).sort(byGeneration);

  if (recent.length) {
    const block = el('section', 'section-block');
    block.appendChild(el('h2', null, 'The newest generations'));
    const grid = el('div', 'people-grid');
    recent.forEach((p) => grid.appendChild(personCard(p)));
    block.appendChild(grid);
    page.appendChild(block);
  }

  const familyOnly = state.media.filter((m) => m.visibility === 'family');
  if (familyOnly.length) {
    const block = el('section', 'section-block');
    block.appendChild(el('h2', null, 'Kept inside the family'));
    const grid = el('div', 'objects');
    familyOnly.forEach((m) => grid.appendChild(objectCard(m)));
    block.appendChild(grid);
    page.appendChild(block);
  }

  if (!recent.length && !familyOnly.length) {
    page.appendChild(empty('Nothing here yet',
      'As children and grandchildren are added to the tree, and as anyone marks an upload family only, it collects here.',
      'Add something', '#/contribute'));
  }

  return page;
};

/* ---- Share a Story (the template) ---- */
views.share = () => {
  const page = el('div', 'page page-narrow');
  page.appendChild(pageHead('The family', 'Share a Story',
    'Write down something you remember and save it here. It does not have to be long, finished, or certain — half a memory is worth more than none.'));

  const { panel, form } = formShell('Story template',
    'Three things: who is writing, what to call it, and the story itself.');
  form.classList.add('template-form');

  const author = textInput('Your name', 80);
  author.required = true;
  form.appendChild(field('Submitted by', author, {
    hint: 'This appears at the end of the story, so the family knows who told it.'
  }));

  const asOrigin = el('input');
  asOrigin.type = 'checkbox';
  const originLabel = el('label', 'checkline');
  originLabel.appendChild(asOrigin);
  originLabel.appendChild(el('span', null,
    'This is the family origin story — put it on the front page'));
  form.appendChild(originLabel);

  const title = textInput('The summer everyone slept on the porch', 180);
  title.required = true;
  form.appendChild(field('Title of the story', title, {}));

  const body = textArea(
    'Start anywhere. Leave a blank line between paragraphs.\n\nIf you are not sure of a name or a year, write it down anyway with a question mark — somebody else will know.',
    16, 60000
  );
  body.required = true;
  body.className = 'story-space';
  form.appendChild(field('The story', body, {}));

  const extras = el('fieldset', 'optional-extras');
  extras.appendChild(el('legend', null, 'If you know it'));
  extras.appendChild(el('p', 'extras-note',
    'Both optional. Naming people puts this story on their pages too, and a year places it on the timeline.'));

  const row = el('div', 'extras-row');
  const year = textInput('1962', 24);
  const yearField = field('Year it happened', year, { optional: true });
  const subtitle = textInput('One line underneath the title', 240);
  const subField = field('Subtitle', subtitle, { optional: true });
  row.appendChild(yearField);
  row.appendChild(subField);
  extras.appendChild(row);

  const picker = peoplePicker();
  picker.node.className = 'field field-block';
  picker.node.querySelector('legend').textContent = 'Who is this story about?';
  extras.appendChild(picker.node);
  form.appendChild(extras);

  const { row: actions, button, status } = submitRow('Save to the website');
  actions.className = 'actions';
  form.appendChild(actions);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    button.disabled = true;
    setStatus(status, 'Saving…');
    try {
      const saved = await jsonPost('/api/stories', {
        kind: asOrigin.checked ? 'origin' : 'story',
        title: title.value,
        subtitle: subtitle.value,
        body: body.value,
        author: author.value,
        year: year.value,
        peopleIds: picker.value()
      });
      const keepName = author.value;
      form.reset();
      author.value = keepName;
      body.className = 'story-space';
      picker.reset();
      setStatus(status, '');
      await loadData();
      showSaved(saved);
    } catch (err) {
      setStatus(status, err.message, 'err');
    } finally {
      button.disabled = false;
    }
  });

  page.appendChild(panel);

  const savedSlot = el('div');
  page.appendChild(savedSlot);

  function showSaved(story) {
    savedSlot.textContent = '';
    const note = el('div', 'saved-note');
    note.appendChild(el('strong', null, 'Saved to the website'));
    note.appendChild(el('p', null,
      `“${story.title}” is now part of the archive, and anyone visiting can read it.`));
    const link = el('a', null, 'Read it →');
    link.href = '#/stories/' + story.id;
    note.appendChild(link);
    savedSlot.appendChild(note);
    savedSlot.scrollIntoView({ block: 'center' });
    listSaved();
  }

  function listSaved() {
    const written = state.stories
      .filter((s) => ['story', 'origin'].includes(s.kind))
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 6);
    const block = el('section', 'section-block');
    block.style.marginTop = '3rem';
    block.appendChild(el('h2', null, 'Recently saved'));
    if (!written.length) {
      block.appendChild(el('p', 'hint', 'Nothing has been written yet. Yours would be the first.'));
    } else {
      const list = el('div', 'story-list');
      written.forEach((s) => list.appendChild(storyCard(s)));
      block.appendChild(list);
      const all = el('p');
      const link = el('a', null, 'Read all the stories →');
      link.href = '#/stories';
      all.appendChild(link);
      block.appendChild(all);
    }
    const existing = savedSlot.querySelector('.section-block');
    if (existing) existing.remove();
    savedSlot.appendChild(block);
  }

  listSaved();
  return page;
};

/* =================================================================
   Contribute
================================================================= */

views.contribute = (which) => {
  const page = el('div', 'page');
  page.appendChild(pageHead('Take part', 'Contribute',
    'Anyone in the family can add to this archive. Nothing needs to be finished or certain — a guess with a question mark is more useful than a gap.'));

  const forms = [
    { value: 'media', label: 'Photograph, document or recording' },
    { value: 'story', label: 'Story, memory or recipe' },
    { value: 'place', label: 'A place on the map' },
    { value: 'event', label: 'A date for the timeline' },
    { value: 'note', label: 'A note or correction' }
  ];
  const current = forms.some((f) => f.value === which) ? which : 'media';

  const tabs = el('div', 'tabs');
  forms.forEach((f) => {
    const pill = el('button', 'pill', f.label);
    pill.type = 'button';
    pill.setAttribute('aria-pressed', String(f.value === current));
    pill.addEventListener('click', () => { location.hash = '#/contribute/' + f.value; });
    tabs.appendChild(pill);
  });
  page.appendChild(tabs);

  page.appendChild(({
    media: mediaForm, story: storyForm, place: placeForm, event: eventForm, note: noteForm
  })[current]());

  if (current === 'note') page.appendChild(messageBoard());
  return page;
};

function mediaForm() {
  const { panel, form } = formShell('Add a photograph, document or recording',
    'Scan or photograph the original if you can. Write down whatever you know, and mark the rest as uncertain.');

  const file = el('input');
  file.type = 'file';
  file.required = true;
  file.accept = '.jpg,.jpeg,.png,.gif,.webp,.heic,.heif,.tif,.tiff,.pdf,.doc,.docx,.txt,.rtf,.odt,.md,.mp3,.m4a,.wav,.aac,.ogg,.mp4,.mov,.webm,.m4v';
  form.appendChild(field('The file', file, { span2: true, hint: 'Photos, documents, audio or video. Up to 150 MB.' }));

  const section = selectInput([
    ['albums', 'Photo Albums'],
    ['documents', 'Documents & History'],
    ['voices', 'In Their Own Words']
  ]);
  form.appendChild(field('Which section', section, {}));

  const title = textInput('Nathan outside the shop', 160);
  title.required = true;
  form.appendChild(field('Title', title, {}));

  const year = textInput('1948, or "late 1930s"', 24);
  form.appendChild(field('Year', year, { optional: true, hint: 'A four-digit year files it into the right decade.' }));

  const place = textInput('Brooklyn, New York', 160);
  form.appendChild(field('Place', place, { optional: true }));

  const album = textInput('e.g. Ruth\u2019s branch, or Dora\u2019s album', 120);
  form.appendChild(field('Album or branch', album, { optional: true }));

  const event = textInput('e.g. Lillian and Sam\u2019s wedding', 120);
  form.appendChild(field('Occasion', event, { optional: true }));

  const medium = textInput('e.g. Silver gelatin print, 3 × 5 in.', 120);
  form.appendChild(field('Medium', medium, { optional: true, hint: 'What the original physically is, if you know.' }));

  const picker = peoplePicker();
  form.appendChild(picker.node);

  const caption = textArea('What is happening, who took it, anything you were told about it.', 3, 3000);
  form.appendChild(field('Description', caption, { span2: true, optional: true }));

  const back = textArea('Copy out anything written on the reverse, exactly as it appears.', 2, 800);
  form.appendChild(field('Writing on the back', back, { span2: true, optional: true }));

  const transcript = textArea('For recordings: paste a transcript here if you have one.', 3, 40000);
  form.appendChild(field('Transcript', transcript, { span2: true, optional: true }));

  const contributor = textInput('So the label can credit you', 80);
  contributor.required = true;
  form.appendChild(field('Your name', contributor, { span2: true }));

  const familyOnly = el('input');
  familyOnly.type = 'checkbox';
  const check = el('label', 'checkline span-2');
  check.appendChild(familyOnly);
  check.appendChild(el('span', null, 'Family only — keep this behind the passcode, out of public view'));
  form.appendChild(check);

  const { row, button, status } = submitRow('Add to the collection');
  form.appendChild(row);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!file.files[0]) return setStatus(status, 'Choose a file first.', 'err');
    const data = new FormData();
    data.append('file', file.files[0]);
    data.append('section', section.value);
    data.append('title', title.value);
    data.append('year', year.value);
    data.append('place', place.value);
    data.append('album', album.value);
    data.append('event', event.value);
    data.append('medium', medium.value);
    data.append('caption', caption.value);
    data.append('handwrittenBack', back.value);
    data.append('transcript', transcript.value);
    data.append('contributor', contributor.value);
    data.append('peopleIds', picker.value());
    data.append('visibility', familyOnly.checked ? 'family' : 'public');

    button.disabled = true;
    setStatus(status, 'Adding…');
    try {
      const saved = await api('/api/media', { method: 'POST', body: data });
      const name = contributor.value;
      form.reset();
      contributor.value = name;
      picker.reset();
      setStatus(status, `Added as ${saved.accession}. Thank you.`, 'ok');
      await loadData();
    } catch (err) {
      setStatus(status, err.message, 'err');
    } finally {
      button.disabled = false;
    }
  });

  return panel;
}

function storyForm() {
  const { panel, form } = formShell('Write a story, memory, recipe or tribute',
    'Write it the way you would say it out loud. Leave a blank line between paragraphs.');

  const kind = selectInput([
    ['story', 'A story or memory'],
    ['origin', 'The family origin story (appears on the front page)'],
    ['recipe', 'A recipe'],
    ['tradition', 'A tradition'],
    ['memorial', 'A tribute to someone who has died']
  ]);
  form.appendChild(field('What kind', kind, {}));

  const year = textInput('1962, or leave blank', 24);
  form.appendChild(field('Year it happened', year, { optional: true }));

  const title = textInput('The summer everyone slept on the porch', 180);
  title.required = true;
  form.appendChild(field('Title', title, { span2: true }));

  const subtitle = textInput('One line underneath', 240);
  form.appendChild(field('Subtitle', subtitle, { span2: true, optional: true }));

  const picker = peoplePicker();
  form.appendChild(picker.node);

  const body = textArea('Write as much as you like.', 12, 60000);
  body.required = true;
  form.appendChild(field('The story', body, { span2: true }));

  const author = textInput('Your name', 80);
  author.required = true;
  form.appendChild(field('Written by', author, { span2: true }));

  const familyOnly = el('input');
  familyOnly.type = 'checkbox';
  const check = el('label', 'checkline span-2');
  check.appendChild(familyOnly);
  check.appendChild(el('span', null, 'Family only — keep this behind the passcode'));
  form.appendChild(check);

  const { row, button, status } = submitRow('Publish');
  form.appendChild(row);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    button.disabled = true;
    setStatus(status, 'Publishing…');
    try {
      await jsonPost('/api/stories', {
        kind: kind.value, title: title.value, subtitle: subtitle.value,
        body: body.value, author: author.value, year: year.value,
        peopleIds: picker.value(), visibility: familyOnly.checked ? 'family' : 'public'
      });
      const name = author.value;
      form.reset();
      author.value = name;
      picker.reset();
      setStatus(status, 'Published. Thank you.', 'ok');
      await loadData();
    } catch (err) {
      setStatus(status, err.message, 'err');
    } finally {
      button.disabled = false;
    }
  });

  return panel;
}

function placeForm() {
  const { panel, form } = formShell('Put a place on the map',
    'To find the coordinates: open Google Maps, right-click the spot, and click the numbers at the top of the menu to copy them.');

  const name = textInput('412 Hopkinson Avenue, Brooklyn', 160);
  name.required = true;
  form.appendChild(field('Place', name, { span2: true }));

  const lat = textInput('40.6712', 20);
  lat.required = true;
  form.appendChild(field('Latitude', lat, {}));

  const lng = textInput('-73.9187', 20);
  lng.required = true;
  form.appendChild(field('Longitude', lng, {}));

  const years = textInput('1921–1949', 60);
  form.appendChild(field('Years there', years, { span2: true, optional: true }));

  const picker = peoplePicker();
  form.appendChild(picker.node);

  const note = textArea('What was there, who lived there, what happened there.', 3, 2000);
  form.appendChild(field('Note', note, { span2: true, optional: true }));

  const contributor = textInput('Your name', 80);
  form.appendChild(field('Added by', contributor, { span2: true, optional: true }));

  const { row, button, status } = submitRow('Add the place');
  form.appendChild(row);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    button.disabled = true;
    setStatus(status, 'Adding…');
    try {
      await jsonPost('/api/places', {
        name: name.value, lat: lat.value, lng: lng.value, years: years.value,
        note: note.value, contributor: contributor.value, peopleIds: picker.value()
      });
      form.reset();
      picker.reset();
      setStatus(status, 'On the map. Thank you.', 'ok');
      await loadData();
    } catch (err) {
      setStatus(status, err.message, 'err');
    } finally {
      button.disabled = false;
    }
  });

  return panel;
}

function eventForm() {
  const { panel, form } = formShell('Add a date to the timeline',
    'Births and deaths appear on the timeline by themselves. This is for everything else: arrivals, marriages, the shop opening, the move west.');

  const year = textInput('1913', 24);
  year.required = true;
  form.appendChild(field('Year', year, {}));

  const contributor = textInput('Your name', 80);
  form.appendChild(field('Added by', contributor, { optional: true }));

  const title = textInput('Nathan arrives at Ellis Island', 180);
  title.required = true;
  form.appendChild(field('What happened', title, { span2: true }));

  const picker = peoplePicker();
  form.appendChild(picker.node);

  const detail = textArea('Anything more you know, and how you know it.', 3, 3000);
  form.appendChild(field('Detail', detail, { span2: true, optional: true }));

  const { row, button, status } = submitRow('Add to the timeline');
  form.appendChild(row);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    button.disabled = true;
    setStatus(status, 'Adding…');
    try {
      await jsonPost('/api/events', {
        year: year.value, title: title.value, detail: detail.value,
        contributor: contributor.value, peopleIds: picker.value()
      });
      form.reset();
      picker.reset();
      setStatus(status, 'Added. Thank you.', 'ok');
      await loadData();
    } catch (err) {
      setStatus(status, err.message, 'err');
    } finally {
      button.disabled = false;
    }
  });

  return panel;
}

function noteForm() {
  const { panel, form } = formShell('Leave a note or a correction',
    'Wrong name on a photograph, a date that cannot be right, a question for whoever remembers. Everything here is public.');

  const kind = selectInput([['note', 'A note or question'], ['correction', 'A correction']]);
  form.appendChild(field('Kind', kind, {}));

  const name = textInput('Your name', 80);
  name.required = true;
  form.appendChild(field('Your name', name, {}));

  const subject = textInput('e.g. About SS.1948.003', 160);
  form.appendChild(field('About', subject, { span2: true, optional: true }));

  const body = textArea('What did you want to say?', 5, 4000);
  body.required = true;
  form.appendChild(field('Message', body, { span2: true }));

  const { row, button, status } = submitRow('Post');
  form.appendChild(row);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    button.disabled = true;
    setStatus(status, 'Posting…');
    try {
      await jsonPost('/api/messages', {
        name: name.value, body: body.value, subject: subject.value, kind: kind.value
      });
      body.value = '';
      setStatus(status, 'Posted.', 'ok');
      await loadData();
      route();
    } catch (err) {
      setStatus(status, err.message, 'err');
    } finally {
      button.disabled = false;
    }
  });

  return panel;
}

function messageBoard() {
  const block = el('section', 'section-block');
  block.appendChild(el('h2', null, 'What people have said'));

  if (!state.messages.length) {
    block.appendChild(empty('Nothing posted yet', 'The first question is usually about who is standing on the left.'));
    return block;
  }

  const childrenOf = new Map();
  state.messages.forEach((m) => {
    if (!m.parentId) return;
    if (!childrenOf.has(m.parentId)) childrenOf.set(m.parentId, []);
    childrenOf.get(m.parentId).push(m);
  });

  const thread = el('div', 'thread');
  state.messages
    .filter((m) => !m.parentId)
    .sort((a, b) => b.createdAt - a.createdAt)
    .forEach((m) => thread.appendChild(messageNode(m, childrenOf)));
  block.appendChild(thread);
  return block;
}

function messageNode(message, childrenOf) {
  const wrap = el('article', 'msg');
  const head = el('div', 'msg-head');
  head.appendChild(el('span', 'msg-name', message.name));
  head.appendChild(el('span', 'msg-time', new Date(message.createdAt).toLocaleDateString(undefined, {
    year: 'numeric', month: 'long', day: 'numeric'
  })));
  if (message.kind === 'correction') head.appendChild(el('span', 'msg-tag', 'Correction'));
  wrap.appendChild(head);

  if (message.subject) wrap.appendChild(el('p', 'label', message.subject));
  wrap.appendChild(el('p', 'msg-body', message.body));

  const replyBtn = el('button', 'btn-quiet', 'Reply');
  replyBtn.type = 'button';
  wrap.appendChild(replyBtn);
  if (state.isAdmin) wrap.appendChild(deleteButton('messages', message.id, 'this message'));

  const kids = childrenOf.get(message.id) || [];
  let replies = null;
  if (kids.length) {
    replies = el('div', 'replies');
    kids.sort((a, b) => a.createdAt - b.createdAt)
      .forEach((kid) => replies.appendChild(messageNode(kid, childrenOf)));
    wrap.appendChild(replies);
  }

  replyBtn.addEventListener('click', () => {
    if (wrap.querySelector(':scope > .reply-form')) return;
    const form = el('form', 'reply-form');
    const name = textInput('Your name', 80);
    name.required = true;
    name.setAttribute('aria-label', 'Your name');
    const body = textArea('Reply to ' + message.name, 3, 4000);
    body.required = true;
    body.setAttribute('aria-label', 'Your reply');

    const row = el('div', 'actions');
    const send = el('button', 'btn', 'Post reply');
    send.type = 'submit';
    const cancel = el('button', 'btn-quiet', 'Cancel');
    cancel.type = 'button';
    const status = el('p', 'status');
    row.append(send, cancel, status);
    cancel.addEventListener('click', () => form.remove());

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      send.disabled = true;
      setStatus(status, 'Posting…');
      try {
        await jsonPost('/api/messages', { name: name.value, body: body.value, parentId: message.id });
        await loadData();
        route();
      } catch (err) {
        send.disabled = false;
        setStatus(status, err.message, 'err');
      }
    });

    form.append(name, body, row);
    wrap.insertBefore(form, replies);
    name.focus();
  });

  return wrap;
}


/* =================================================================
   The keeper's page
   Only reachable with the admin key in the address. Everything the
   site needs that the public must not be able to do.
================================================================= */

function generationSelect(current) {
  const select = selectInput(Object.keys(GENERATIONS).map((g) => [g, g + ' — ' + genTitle(Number(g))]));
  select.value = String(current || 3);
  return select;
}

views.keeper = () => {
  const page = el('div', 'page');
  page.appendChild(pageHead('Keeper', 'Looking after the archive',
    'Only you can see this. It is here because adding people and fixing labels should never require the public to be trusted with it.'));

  if (!state.isAdmin) {
    const panel = el('section', 'panel');
    panel.appendChild(el('h2', null, 'Your keeper key is missing'));
    panel.appendChild(el('p', 'panel-note',
      'This page needs the key Render generated for you. Add it to the end of the site address, like this, then bookmark the result:'));
    const code = el('p', 'keeper-example', location.origin + '/?key=YOUR_ADMIN_KEY#/keeper');
    panel.appendChild(code);
    panel.appendChild(el('p', 'hint',
      'You will find ADMIN_KEY in your Render dashboard, under the service, on the Environment tab.'));
    page.appendChild(panel);
    return page;
  }

  /* ---------- add a person ---------- */
  const { panel: addPanel, form: addForm } = formShell('Add someone to the family',
    'Dates are worth adding even when approximate — a birth year puts the person on the timeline, and a death year gives them a place in In Memoriam.');

  const name = textInput('Ruth Seagal Kaplan', 80);
  name.required = true;
  addForm.appendChild(field('Full name', name, {}));

  const gen = generationSelect(3);
  addForm.appendChild(field('Generation', gen, {}));

  const relation = textInput('Daughter of Ruth', 120);
  addForm.appendChild(field('How they connect', relation, { optional: true }));

  const birthPlace = textInput('Brooklyn, New York', 120);
  addForm.appendChild(field('Born where', birthPlace, { optional: true }));

  const born = textInput('1955', 40);
  addForm.appendChild(field('Born', born, { optional: true }));

  const died = textInput('leave blank if living', 40);
  addForm.appendChild(field('Died', died, { optional: true }));

  const summary = textInput('One line that captures them', 400);
  addForm.appendChild(field('In a sentence', summary, { span2: true, optional: true }));

  const familyOnly = el('input');
  familyOnly.type = 'checkbox';
  const check = el('label', 'checkline span-2');
  check.appendChild(familyOnly);
  check.appendChild(el('span', null, 'Living and private — keep this person behind the family passcode'));
  addForm.appendChild(check);

  const addRow = submitRow('Add to the family');
  addForm.appendChild(addRow.row);

  addForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    addRow.button.disabled = true;
    setStatus(addRow.status, 'Adding…');
    try {
      await jsonPost('/api/people', {
        name: name.value, generation: Number(gen.value), relation: relation.value,
        born: born.value, died: died.value, birthPlace: birthPlace.value,
        summary: summary.value, visibility: familyOnly.checked ? 'family' : 'public'
      });
      addForm.reset();
      gen.value = '3';
      setStatus(addRow.status, 'Added.', 'ok');
      await loadData();
      route();
    } catch (err) {
      setStatus(addRow.status, err.message, 'err');
    } finally {
      addRow.button.disabled = false;
    }
  });
  page.appendChild(addPanel);

  /* ---------- edit the people already here ---------- */
  const peopleBlock = el('section', 'section-block');
  peopleBlock.appendChild(el('h2', null, 'Everyone in the archive'));
  peopleBlock.appendChild(el('p', 'gen-note',
    'Choose a name to correct their details, write their life, or pick the photograph that represents them.'));

  generationRange().forEach((g) => {
    const list = peopleIn(g);
    if (!list.length) return;
    peopleBlock.appendChild(el('p', 'label keeper-band', genTitle(g)));
    const rows = el('div', 'keeper-rows');
    list.forEach((person) => rows.appendChild(keeperPersonRow(person)));
    peopleBlock.appendChild(rows);
  });
  page.appendChild(peopleBlock);

  /* ---------- edit object labels ---------- */
  const mediaBlock = el('section', 'section-block');
  mediaBlock.appendChild(el('h2', null, 'Labels on the collection'));
  mediaBlock.appendChild(el('p', 'gen-note',
    'Fix a title, name who is in a photograph, or correct who contributed it.'));
  if (!state.media.length) {
    mediaBlock.appendChild(el('p', 'hint', 'Nothing has been uploaded yet.'));
  } else {
    const rows = el('div', 'keeper-rows');
    state.media.slice().sort((a, b) => b.createdAt - a.createdAt)
      .forEach((item) => rows.appendChild(keeperMediaRow(item)));
    mediaBlock.appendChild(rows);
  }
  page.appendChild(mediaBlock);

  return page;
};

function keeperRow(titleText, subtitleText) {
  const row = el('details', 'keeper-row');
  const summary = el('summary');
  summary.appendChild(el('span', 'keeper-name', titleText));
  if (subtitleText) summary.appendChild(el('span', 'keeper-sub', subtitleText));
  row.appendChild(summary);
  return row;
}

function keeperPersonRow(person) {
  const row = keeperRow(person.name, [lifespan(person), person.relation].filter(Boolean).join(' · ') || 'no dates yet');
  const form = el('form', 'form keeper-form');

  const name = textInput('', 80); name.value = person.name; name.required = true;
  form.appendChild(field('Name', name, {}));

  const gen = generationSelect(person.generation);
  form.appendChild(field('Generation', gen, {}));

  const born = textInput('', 40); born.value = person.born;
  form.appendChild(field('Born', born, { optional: true }));

  const died = textInput('', 40); died.value = person.died;
  form.appendChild(field('Died', died, { optional: true }));

  const relation = textInput('', 120); relation.value = person.relation;
  form.appendChild(field('How they connect', relation, {}));

  const birthPlace = textInput('', 120); birthPlace.value = person.birthPlace;
  form.appendChild(field('Born where', birthPlace, { optional: true }));

  const summary = textInput('', 400); summary.value = person.summary;
  form.appendChild(field('In a sentence', summary, { span2: true, optional: true }));

  const biography = textArea('Write as much as you like. Leave a blank line between paragraphs.', 8, 20000);
  biography.value = person.biography;
  form.appendChild(field('Their life', biography, { span2: true, optional: true }));

  const theirPhotos = state.media.filter((m) => m.kind === 'photo' && m.peopleIds.includes(person.id));
  const portrait = selectInput(
    [['', theirPhotos.length ? 'First photograph tagged with them' : 'No photographs tagged yet']]
      .concat(theirPhotos.map((m) => [m.id, m.title + (m.year ? ' (' + m.year + ')' : '')]))
  );
  portrait.value = person.portraitId || '';
  form.appendChild(field('Portrait', portrait, { span2: true,
    hint: 'Tag a photograph with this person and it becomes available here.' }));

  const memorial = el('input'); memorial.type = 'checkbox'; memorial.checked = Boolean(person.memorial);
  const memLabel = el('label', 'checkline span-2');
  memLabel.appendChild(memorial);
  memLabel.appendChild(el('span', null, 'Show on the In Memoriam page'));
  form.appendChild(memLabel);

  const priv = el('input'); priv.type = 'checkbox'; priv.checked = person.visibility === 'family';
  const privLabel = el('label', 'checkline span-2');
  privLabel.appendChild(priv);
  privLabel.appendChild(el('span', null, 'Living and private — keep behind the family passcode'));
  form.appendChild(privLabel);

  const { row: actions, button, status } = submitRow('Save changes');
  const remove = el('button', 'btn-quiet', 'Remove this person');
  remove.type = 'button';
  remove.addEventListener('click', async () => {
    if (!confirm(`Remove ${person.name} from the archive? Their photographs stay, but they will no longer be tagged in them.`)) return;
    try {
      await api('/api/people/' + person.id, { method: 'DELETE' });
      await loadData();
      route();
    } catch (err) { alert(err.message); }
  });
  actions.appendChild(remove);
  form.appendChild(actions);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    button.disabled = true;
    setStatus(status, 'Saving…');
    try {
      await api('/api/people/' + person.id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.value, generation: Number(gen.value), born: born.value, died: died.value,
          relation: relation.value, birthPlace: birthPlace.value, summary: summary.value,
          biography: biography.value, portraitId: portrait.value || null,
          memorial: memorial.checked, visibility: priv.checked ? 'family' : 'public'
        })
      });
      setStatus(status, 'Saved.', 'ok');
      await loadData();
    } catch (err) {
      setStatus(status, err.message, 'err');
    } finally {
      button.disabled = false;
    }
  });

  row.appendChild(form);
  return row;
}

function keeperMediaRow(item) {
  const row = keeperRow(item.title, [item.accession, item.year, 'by ' + item.contributor].filter(Boolean).join(' · '));
  const form = el('form', 'form keeper-form');

  const title = textInput('', 160); title.value = item.title; title.required = true;
  form.appendChild(field('Title', title, {}));

  const year = textInput('', 24); year.value = item.year;
  form.appendChild(field('Year', year, { optional: true }));

  const place = textInput('', 160); place.value = item.place;
  form.appendChild(field('Place', place, { optional: true }));

  const medium = textInput('', 120); medium.value = item.medium;
  form.appendChild(field('Medium', medium, { optional: true }));

  const album = textInput('', 120); album.value = item.album;
  form.appendChild(field('Album or branch', album, { optional: true }));

  const event = textInput('', 120); event.value = item.event;
  form.appendChild(field('Occasion', event, { optional: true }));

  const contributor = textInput('', 80); contributor.value = item.contributor;
  form.appendChild(field('Contributed by', contributor, { span2: true }));

  const caption = textArea('', 4, 3000); caption.value = item.caption;
  form.appendChild(field('Description', caption, { span2: true, optional: true }));

  const back = textArea('', 2, 800); back.value = item.handwrittenBack;
  form.appendChild(field('Writing on the back', back, { span2: true, optional: true }));

  const chosen = new Set(item.peopleIds);
  const picker = el('fieldset', 'field field-block span-2');
  picker.appendChild(el('legend', null, 'Who is in it?'));
  const strip = el('div', 'strip');
  state.people.slice().sort(byGeneration).forEach((person) => {
    const pill = el('button', 'pill', person.name);
    pill.type = 'button';
    pill.setAttribute('aria-pressed', String(chosen.has(person.id)));
    pill.addEventListener('click', () => {
      const on = pill.getAttribute('aria-pressed') === 'true';
      pill.setAttribute('aria-pressed', String(!on));
      if (on) chosen.delete(person.id); else chosen.add(person.id);
    });
    strip.appendChild(pill);
  });
  picker.appendChild(strip);
  form.appendChild(picker);

  const { row: actions, button, status } = submitRow('Save label');
  const remove = el('button', 'btn-quiet', 'Remove from the archive');
  remove.type = 'button';
  remove.addEventListener('click', async () => {
    if (!confirm(`Remove "${item.title}"? The file is deleted and cannot be recovered.`)) return;
    try {
      await api('/api/media/' + item.id, { method: 'DELETE' });
      await loadData();
      route();
    } catch (err) { alert(err.message); }
  });
  actions.appendChild(remove);
  form.appendChild(actions);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    button.disabled = true;
    setStatus(status, 'Saving…');
    try {
      await api('/api/media/' + item.id, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.value, year: year.value, place: place.value, medium: medium.value,
          album: album.value, event: event.value, contributor: contributor.value,
          caption: caption.value, handwrittenBack: back.value,
          peopleIds: Array.from(chosen).join(',')
        })
      });
      setStatus(status, 'Saved.', 'ok');
      await loadData();
    } catch (err) {
      setStatus(status, err.message, 'err');
    } finally {
      button.disabled = false;
    }
  });

  row.appendChild(form);
  return row;
}

/* =================================================================
   Router
================================================================= */

const ROUTES = {
  '': views.home,
  'tree': views.tree,
  'people': (a) => (a ? views.person(a) : views.people()),
  'stories': (a) => (a ? views.story(a) : views.stories()),
  'share': views.share,
  'albums': (a) => views.albums(a),
  'documents': views.documents,
  'voices': views.voices,
  'traditions': views.traditions,
  'places': views.places,
  'timeline': views.timeline,
  'memoriam': views.memoriam,
  'next': views.next,
  'contribute': (a) => views.contribute(a),
  'keeper': views.keeper
};

function route() {
  if (!state.ready) return;
  const raw = location.hash.replace(/^#\/?/, '');
  const [pathPart, queryPart] = raw.split('?');
  const parts = pathPart.split('/').filter(Boolean);
  const key = parts[0] || '';
  let arg = parts[1] || '';

  // support #/contribute?form=story as well as #/contribute/story
  if (!arg && queryPart) {
    const q = new URLSearchParams(queryPart);
    arg = q.get('form') || q.get('by') || '';
  }

  const view = ROUTES[key] || (() => {
    const page = el('div', 'page');
    page.appendChild(empty('That page is not part of the exhibit', 'The link may be out of date.', 'Back to the beginning', '#/'));
    return page;
  });

  const main = $('#view');
  main.textContent = '';
  main.appendChild(view(arg));
  window.scrollTo({ top: 0, behavior: 'instant' in window ? 'instant' : 'auto' });
  main.focus({ preventScroll: true });
  markCurrentLink(key);
  showKeeperLink();
  $('#sitenav').classList.remove('open');
  $('#menu-toggle').setAttribute('aria-expanded', 'false');
  const more = document.getElementById('more');
  if (more) more.open = false;
}

function showKeeperLink() {
  if (!state.isAdmin || document.getElementById('keeper-link')) return;
  const menu = document.querySelector('.more-menu');
  if (!menu) return;
  menu.appendChild(el('p', 'more-label', 'Keeper'));
  const link = el('a', null, 'Looking after the archive');
  link.id = 'keeper-link';
  link.href = '#/keeper';
  menu.appendChild(link);
}

function markCurrentLink(key) {
  document.querySelectorAll('.sitenav a').forEach((link) => {
    const target = link.getAttribute('href').replace(/^#\/?/, '').split('/')[0];
    if (target === key) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}

/* =================================================================
   Boot
================================================================= */

async function loadData() {
  const data = await api('/api/bootstrap');
  Object.assign(state, data);
  state.ready = true;
}

$('#menu-toggle').addEventListener('click', () => {
  const nav = $('#sitenav');
  const open = nav.classList.toggle('open');
  $('#menu-toggle').setAttribute('aria-expanded', String(open));
});

window.addEventListener('hashchange', route);

loadData()
  .then(route)
  .catch(() => {
    $('#view').textContent = '';
    const page = el('div', 'page');
    page.appendChild(empty('The archive could not be opened',
      'The server did not answer. Refresh the page, and if it keeps happening, tell whoever keeps the site.'));
    $('#view').appendChild(page);
  });
