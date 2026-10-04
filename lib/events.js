// Events: each wedding (or any occasion) gets its own folder holding its
// settings, its videos and its index of wishes:
//
//   <data folder>/<event id>/event.json   names, date, colour, max length
//   <data folder>/<event id>/index.json   one entry per wish (hidden ones too)
//   <data folder>/<event id>/*.mp4, *.jpg the wishes and their still frames
//
// The booth records into whichever event is selected, kept in
// <data folder>/active.json.

const fs = require('fs');
const os = require('os');
const path = require('path');

const ID_PATTERN = /^[a-z0-9][a-z0-9-]{0,79}$/;
const LANGUAGES = ['ms', 'en'];

// On a tablet running Termux, save into shared storage so the folders show up
// in Android's Files app and can be copied to a USB drive from there.
function defaultDataDir(root) {
  const shared = path.join(os.homedir(), 'storage', 'shared');
  if (fs.existsSync(shared)) return path.join(shared, 'WishBooth');
  return path.join(root, 'events');
}

function slug(text) {
  return String(text || '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

// Write through a temp file so a crash never leaves half-written JSON.
function writeJson(file, value) {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

function cleanFields(input, defaults) {
  const text = (v, max, fallback) => {
    const s = String(v ?? '').trim().slice(0, max);
    return s || fallback;
  };
  const accent = /^#[0-9a-f]{6}$/i.test(input.accent) ? input.accent : defaults.accent;
  const max = Math.round(Number(input.maxSeconds));
  const language = LANGUAGES.includes(input.language) ? input.language : defaults.language;
  // Prompts come from a textarea (one per line) or an array.
  const prompts = (Array.isArray(input.prompts) ? input.prompts : String(input.prompts ?? '').split('\n'))
    .map((p) => String(p).trim().slice(0, 120))
    .filter(Boolean)
    .slice(0, 8);
  return {
    couple: text(input.couple, 80, ''),
    date: text(input.date, 40, ''),
    welcomeLine: text(input.welcomeLine, 80, defaults.welcomeLine),
    accent,
    maxSeconds: max >= 10 && max <= 300 ? max : defaults.maxSeconds,
    language,
    prompts,
  };
}

function createStore(root, config) {
  const dataDir = config.dataDir ? path.resolve(root, config.dataDir) : defaultDataDir(root);
  const activeFile = path.join(dataDir, 'active.json');
  const defaults = {
    welcomeLine: config.welcomeLine || 'Welcome to the wedding of',
    accent: config.accent || '#B08D57',
    maxSeconds: config.maxSeconds || 60,
    language: LANGUAGES.includes(config.language) ? config.language : 'ms',
  };
  fs.mkdirSync(dataDir, { recursive: true });

  const dir = (id) => path.join(dataDir, id);
  const exists = (id) => typeof id === 'string' && ID_PATTERN.test(id) && fs.existsSync(path.join(dir(id), 'event.json'));

  function get(id) {
    if (!exists(id)) return null;
    const event = readJson(path.join(dir(id), 'event.json'), null);
    return event && { ...event, id };
  }

  function readIndex(id) {
    return exists(id) ? readJson(path.join(dir(id), 'index.json'), []) : [];
  }

  function list() {
    return fs
      .readdirSync(dataDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && exists(d.name))
      .map((d) => {
        const index = readIndex(d.name);
        const hidden = index.filter((w) => w.hidden).length;
        return { ...get(d.name), wishes: index.length - hidden, hidden };
      })
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  }

  function activeId() {
    const { id } = readJson(activeFile, {});
    return exists(id) ? id : null;
  }

  function setActive(id) {
    if (!exists(id)) return false;
    writeJson(activeFile, { id });
    return true;
  }

  function create(input) {
    const fields = cleanFields(input, defaults);
    if (!fields.couple) throw new Error('names are required');
    const base = slug(`${fields.couple} ${fields.date}`) || 'event';
    let id = base;
    for (let n = 2; fs.existsSync(dir(id)); n++) id = `${base}-${n}`;
    fs.mkdirSync(dir(id), { recursive: true });
    writeJson(path.join(dir(id), 'event.json'), { ...fields, createdAt: new Date().toISOString() });
    writeJson(path.join(dir(id), 'index.json'), []);
    return get(id);
  }

  function update(id, input) {
    const current = get(id);
    if (!current) return null;
    const fields = cleanFields({ ...current, ...input }, defaults);
    if (!fields.couple) throw new Error('names are required');
    writeJson(path.join(dir(id), 'event.json'), { ...fields, createdAt: current.createdAt });
    return get(id);
  }

  // Index writes are queued so two uploads finishing together can't clobber
  // each other.
  let writeQueue = Promise.resolve();
  function changeIndex(id, change) {
    const job = writeQueue.then(() => {
      const index = readIndex(id);
      const result = change(index);
      writeJson(path.join(dir(id), 'index.json'), index);
      return result;
    });
    writeQueue = job.catch(() => {});
    return job;
  }

  const addWish = (id, entry) => changeIndex(id, (index) => void index.push(entry));

  // Hidden wishes leave the gallery but their files stay in the folder.
  const setHidden = (id, wishId, hidden) =>
    changeIndex(id, (index) => {
      const wish = index.find((w) => w.id === wishId);
      if (!wish) return false;
      if (hidden) wish.hidden = true;
      else delete wish.hidden;
      return true;
    });

  return { dataDir, dir, exists, get, list, activeId, setActive, create, update, readIndex, addWish, setHidden, defaults };
}

module.exports = { createStore };
