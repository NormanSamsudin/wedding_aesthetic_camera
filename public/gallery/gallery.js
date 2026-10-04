// Wish gallery: a cinema-style home page with rows of wishes and a full-screen player.

const $ = (sel) => document.querySelector(sel);
const REFRESH_MS = 15_000;
const NEW_FOR_MS = 15 * 60_000;
const BOOTH_IDLE_MS = 2 * 60_000;

let wishes = []; // newest first
let event = null; // the event whose wishes are showing
let T = window.TEXT.en; // its language

// ?event=<id> looks back at another event; otherwise the selected one.
const pinned = new URLSearchParams(location.search).get('event');
const media = (file) => `/media/${encodeURIComponent(event.id)}/${encodeURIComponent(file)}`;
const clock = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).toLowerCase();
const when = (w) => clock(new Date(w.createdAt));

// ---------- data ----------

async function load() {
  const query = pinned ? `?event=${encodeURIComponent(pinned)}` : '';
  const res = await fetch(`/api/wishes${query}`, { cache: 'no-store' });
  if (res.status === 401) {
    $('#pin').hidden = false;
    $('#pin-input').focus();
    return false;
  }
  const next = await res.json();
  const sameEvent = next.event?.id === event?.id;
  const changed = !sameEvent || next.wishes.map((w) => w.id).join() !== wishes.map((w) => w.id).join();
  event = next.event;
  wishes = event ? next.wishes : [];
  if (!sameEvent) {
    T = window.textFor(event);
    window.applyText(T);
    $('#logo').textContent = event?.couple || '';
    document.title = event ? T.wishesFor(event.couple) : 'Wishes';
  }
  if (changed) render();
  return true;
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
    tag.textContent = T.newTag;
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
  { key: 'morning', from: 5, to: 12 },
  { key: 'afternoon', from: 12, to: 17 },
  { key: 'evening', from: 17, to: 21 },
  { key: 'night', from: 21, to: 29 },
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
    const label = T[session];
    const prefix = multiDay ? `${new Date(day).toLocaleDateString(T.locale, { weekday: 'long' })} ` : '';
    return row(`${prefix}${multiDay ? label.toLowerCase() : label}`, items);
  });
}

function render() {
  $('#empty').hidden = wishes.length > 0;
  $('#home').hidden = !wishes.length;
  document.querySelectorAll('.filter').forEach((b) => b.classList.toggle('on', b.dataset.filter === filter));
  if (filter === 'all') {
    $('#rows').replaceChildren(...[row(T.justIn, wishes.slice(0, 15)), ...sessionRows(wishes)].filter(Boolean));
  } else {
    const list = wishes.filter((w) => sessionOf(w) === filter);
    const rows = sessionRows(list);
    if (!rows.length) {
      const p = document.createElement('p');
      p.className = 'none';
      p.textContent = T.noneInSession(T[filter]);
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

// Normally the gallery is shown inside the booth page (so the tablet stays
// full screen); if it was opened on its own, navigate instead.
function backToBooth(startRecording) {
  if (window.parent !== window && window.parent.closeGallery) window.parent.closeGallery(startRecording);
  else location.href = startRecording ? '/?start=1' : '/';
}
$('.to-booth').addEventListener('click', (e) => {
  e.preventDefault();
  backToBooth(true);
});

// The gallery lives on the booth tablet, so go back to the booth by itself
// when guests walk away (unless a wish is playing).
let boothTimer = null;
function backSoon() {
  clearTimeout(boothTimer);
  boothTimer = setTimeout(() => {
    const v = $('#player-video');
    if ($('#player').hidden || v.paused || v.ended) backToBooth(false);
    else backSoon();
  }, BOOTH_IDLE_MS);
}
['pointerdown', 'scroll', 'keydown'].forEach((e) => addEventListener(e, backSoon, { passive: true }));
backSoon();

start();
