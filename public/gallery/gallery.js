// Wish gallery: a cinema-style home page with rows of wishes and a full-screen player.

const $ = (sel) => document.querySelector(sel);
const REFRESH_MS = 15_000;
const NEW_FOR_MS = 15 * 60_000;
const BOOTH_IDLE_MS = 2 * 60_000;
// Opened from the booth tablet: show a way back, hide downloads, and return
// to the booth by itself if guests walk away.
const fromBooth = new URLSearchParams(location.search).get('from') === 'booth';

let wishes = []; // newest first

const media = (file) => `/media/${encodeURIComponent(file)}`;
const clock = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).toLowerCase();
const when = (w) => clock(new Date(w.createdAt));

// ---------- data ----------

async function load() {
  const res = await fetch('/api/wishes', { cache: 'no-store' });
  if (res.status === 401) {
    $('#pin').hidden = false;
    $('#pin-input').focus();
    return false;
  }
  const next = await res.json();
  const changed = next.map((w) => w.id).join() !== wishes.map((w) => w.id).join();
  wishes = next;
  if (changed) render();
  return true;
}

async function loadConfig() {
  try {
    const c = await (await fetch('/api/config')).json();
    $('#logo').textContent = c.couple;
    document.title = `Wishes for ${c.couple}`;
  } catch {}
}

// ---------- rendering ----------

function tile(w, list) {
  const el = document.createElement('button');
  el.className = 'tile';
  if (w.thumb) el.style.backgroundImage = `url("${media(w.thumb)}")`;
  else {
    const initial = document.createElement('span');
    initial.className = 'initial';
    initial.textContent = '♡';
    el.append(initial);
  }
  const age = Date.now() - new Date(w.createdAt);
  if (age >= 0 && age < NEW_FOR_MS) {
    const tag = document.createElement('span');
    tag.className = 'new';
    tag.textContent = 'NEW';
    el.append(tag);
  }
  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = when(w);
  el.append(label);
  el.addEventListener('click', () => openPlayer(list, list.indexOf(w)));
  return el;
}

function row(title, list) {
  if (!list.length) return null;
  const frag = document.createElement('section');
  const h = document.createElement('h2');
  h.className = 'row-title';
  h.textContent = title;
  const wrap = document.createElement('div');
  wrap.className = 'row-wrap';
  const strip = document.createElement('div');
  strip.className = 'row';
  list.forEach((w) => strip.append(tile(w, list)));
  for (const dir of ['left', 'right']) {
    const btn = document.createElement('button');
    btn.className = `scroll-btn ${dir}`;
    btn.textContent = dir === 'left' ? '‹' : '›';
    btn.addEventListener('click', () =>
      strip.scrollBy({ left: (dir === 'left' ? -1 : 1) * strip.clientWidth * 0.85 })
    );
    wrap.append(btn);
  }
  wrap.prepend(strip);
  frag.append(h, wrap);
  return frag;
}

// Sessions of the day. Night runs past midnight, so a 1 am wish still
// counts as the night before.
const SESSIONS = [
  { key: 'morning', label: 'Morning', from: 5, to: 12 },
  { key: 'afternoon', label: 'Afternoon', from: 12, to: 17 },
  { key: 'evening', label: 'Evening', from: 17, to: 21 },
  { key: 'night', label: 'Night', from: 21, to: 29 },
];
function sessionOf(w) {
  const h = new Date(w.createdAt).getHours();
  const hour = h < 5 ? h + 24 : h;
  return SESSIONS.find((s) => hour >= s.from && hour < s.to).key;
}
function dayOf(w) {
  const d = new Date(w.createdAt);
  d.setHours(d.getHours() - 5);
  return d.toDateString();
}

let filter = 'all';

// One row per session in the order of the day, each oldest first so a row
// plays in the order it was recorded. The day is added only when the wishes
// span more than one day (for example after a test run).
function sessionRows(list) {
  const multiDay = new Set(list.map(dayOf)).size > 1;
  const groups = new Map();
  for (const w of list.slice().reverse()) {
    const key = `${dayOf(w)}|${sessionOf(w)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(w);
  }
  return [...groups.entries()].map(([key, items]) => {
    const [day, session] = key.split('|');
    const label = SESSIONS.find((s) => s.key === session).label;
    const prefix = multiDay ? `${new Date(day).toLocaleDateString([], { weekday: 'long' })} ` : '';
    return row(`${prefix}${multiDay ? label.toLowerCase() : label}`, items);
  });
}

function render() {
  $('#empty').hidden = wishes.length > 0;
  $('#home').hidden = !wishes.length;
  document.querySelectorAll('.filter').forEach((b) => b.classList.toggle('on', b.dataset.filter === filter));
  if (filter === 'all') {
    $('#rows').replaceChildren(...[row('Just in', wishes.slice(0, 15)), ...sessionRows(wishes)].filter(Boolean));
  } else {
    const list = wishes.filter((w) => sessionOf(w) === filter);
    const rows = sessionRows(list);
    if (!rows.length) {
      const p = document.createElement('p');
      p.className = 'none';
      p.textContent = `No wishes in the ${filter} yet.`;
      rows.push(p);
    }
    $('#rows').replaceChildren(...rows);
  }
  if (wishes.length && !featured) feature();
}

document.querySelectorAll('.filter').forEach((btn) =>
  btn.addEventListener('click', () => {
    filter = btn.dataset.filter;
    render();
    $('#rows').scrollIntoView({ behavior: 'smooth' });
  })
);

// ---------- featured wish ----------

let featured = null;
function feature() {
  const pool = wishes.length > 1 ? wishes.filter((w) => w !== featured) : wishes;
  featured = pool[Math.floor(Math.random() * pool.length)];
  if (!featured) return;
  $('#hero').hidden = false;
  $('#hero-title').textContent = `Recorded at ${when(featured)}`;
  const v = $('#hero-video');
  if (featured.thumb) v.poster = media(featured.thumb);
  v.src = media(featured.video);
  v.play().catch(() => {});
}
$('#hero-video').addEventListener('ended', feature);
$('#hero-video').addEventListener('error', () => setTimeout(feature, 3000));
$('#hero-play').addEventListener('click', () => featured && openPlayer(wishes, wishes.indexOf(featured)));
// Play all runs in the order the wishes were recorded.
// With a session picked, it plays just that session.
$('#play-all').addEventListener('click', () => {
  const list = filter === 'all' ? wishes : wishes.filter((w) => sessionOf(w) === filter);
  if (list.length) openPlayer(list.slice().reverse(), 0);
});

// ---------- player ----------

let queue = [];
let pos = 0;

function openPlayer(list, index) {
  queue = list.slice();
  $('#hero-video').pause();
  $('#player').hidden = false;
  document.body.style.overflow = 'hidden';
  playAt(index);
}

function playAt(i) {
  pos = Math.max(0, Math.min(i, queue.length - 1));
  const w = queue[pos];
  const v = $('#player-video');
  v.poster = w.thumb ? media(w.thumb) : '';
  v.src = media(w.video);
  v.play().catch(() => {});
  $('#player-name').textContent = when(w);
  $('#player-download').href = media(w.video);
  $('#player-download').setAttribute('download', w.video);
  $('#prev').disabled = pos === 0;
  $('#next').disabled = pos === queue.length - 1;

  const next = queue[pos + 1];
  $('#up-next').hidden = !next;
  if (next) {
    const t = tile(next, queue);
    $('#up-next-tile').replaceWith(t);
    t.id = 'up-next-tile';
  }
  wake();
}

function closePlayer() {
  const v = $('#player-video');
  v.pause();
  v.removeAttribute('src');
  v.load();
  $('#player').hidden = true;
  document.body.style.overflow = '';
  if (!$('#home').hidden) $('#hero-video').play().catch(() => {});
}

$('#player-video').addEventListener('ended', () => {
  if (pos < queue.length - 1) playAt(pos + 1);
});
$('#close').addEventListener('click', closePlayer);
$('#prev').addEventListener('click', () => playAt(pos - 1));
$('#next').addEventListener('click', () => playAt(pos + 1));
document.addEventListener('keydown', (e) => {
  if ($('#player').hidden) return;
  if (e.key === 'Escape') closePlayer();
  if (e.key === 'ArrowRight' && e.shiftKey) playAt(pos + 1);
  if (e.key === 'ArrowLeft' && e.shiftKey) playAt(pos - 1);
});

// Hide the controls while a wish plays untouched.
let idle = null;
function wake() {
  $('#player').classList.remove('idle');
  clearTimeout(idle);
  idle = setTimeout(() => $('#player').classList.add('idle'), 3000);
}
$('#player').addEventListener('pointermove', wake);
$('#player').addEventListener('pointerdown', wake);

// Swipe left or right on a touch screen to change wish.
let touchX = null;
$('#player').addEventListener('touchstart', (e) => (touchX = e.touches[0].clientX), { passive: true });
$('#player').addEventListener('touchend', (e) => {
  if (touchX === null) return;
  const dx = e.changedTouches[0].clientX - touchX;
  if (Math.abs(dx) > 80) playAt(pos + (dx < 0 ? 1 : -1));
  touchX = null;
});

// ---------- navigation ----------

window.addEventListener('scroll', () => $('.nav').classList.toggle('solid', scrollY > 40));

// ---------- PIN ----------

$('#pin-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const res = await fetch('/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin: $('#pin-input').value }),
  });
  if (res.ok) {
    $('#pin').hidden = true;
    start();
  } else {
    $('#pin-error').hidden = false;
  }
});

// ---------- start ----------

let polling = false;
async function start() {
  if (!(await load())) return;
  if (!polling) {
    polling = true;
    setInterval(() => load().catch(() => {}), REFRESH_MS);
  }
}

if (fromBooth) {
  $('#to-booth').hidden = false;
  $('#download-all').hidden = true;
  $('#player-download').hidden = true;
  let boothTimer = null;
  const backSoon = () => {
    clearTimeout(boothTimer);
    boothTimer = setTimeout(() => {
      const v = $('#player-video');
      if ($('#player').hidden || v.paused || v.ended) location.href = '/';
      else backSoon();
    }, BOOTH_IDLE_MS);
  };
  ['pointerdown', 'scroll', 'keydown'].forEach((e) => addEventListener(e, backSoon, { passive: true }));
  backSoon();
}

loadConfig();
start();
