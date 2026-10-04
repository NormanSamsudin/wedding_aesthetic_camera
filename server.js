// Wedding Wish Booth server.
//
// Runs on the laptop (or on the tablet itself under Termux). The booth page
// records a wish and uploads it here. Each wish is saved in the folder of the
// selected event (see lib/events.js). Nothing leaves the device.

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const qrcode = require('qrcode-terminal');
const { ensureCertificates, CA_CERT } = require('./lib/certs');
const { createStore } = require('./lib/events');
const { createLock } = require('./lib/lock');

const ROOT = __dirname;
const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const events = createStore(ROOT, config);
const lock = createLock(events.dataDir);

// Below this much free space the booth shows a quiet warning.
const LOW_STORAGE_BYTES = 1024 ** 3;

function storage() {
  try {
    const s = fs.statfsSync(events.dataDir);
    const free = s.bavail * s.bsize;
    return { free, total: s.blocks * s.bsize, low: free < LOW_STORAGE_BYTES };
  } catch {
    return null;
  }
}

function timestamp(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

// ---------- gallery PIN ----------

const sessions = new Set();
function readCookie(req, name) {
  const match = (req.headers.cookie || '').split(/;\s*/).find((c) => c.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}
function requireGallery(req, res, next) {
  if (!config.galleryPin || sessions.has(readCookie(req, 'gallery'))) return next();
  res.status(401).json({ error: 'pin required' });
}

// ---------- settings PIN ----------

const settingsAllowed = (req) => lock.allows(readCookie(req, 'settings'));
function requireSettings(req, res, next) {
  if (settingsAllowed(req)) return next();
  res.status(401).json({ error: 'settings are locked' });
}
const setSettingsCookie = (res, token) =>
  res.setHeader('Set-Cookie', `settings=${token}; Path=/; HttpOnly; SameSite=Strict`);

// ---------- app ----------

const app = express();
app.disable('x-powered-by');
app.use(express.json());

const withBackground = (event) => event && { ...event, background: events.backgroundUrl(event.id) };

// The booth's settings come from the selected event; `event` is null until
// one is selected, and the booth won't record until then.
app.get('/api/config', (req, res) => {
  res.json({
    event: withBackground(events.get(events.activeId())),
    httpsPort: config.httpsPort,
    pinRequired: Boolean(config.galleryPin),
    lowStorage: Boolean(storage()?.low),
  });
});

// ---------- settings ----------

app.get('/api/settings', (req, res) => {
  res.json({ locked: lock.isSet(), allowed: settingsAllowed(req) });
});

app.post('/api/settings/login', (req, res) => {
  const { token, wait } = lock.login(req.body?.pin);
  if (wait) return res.status(429).json({ error: `Too many tries. Wait ${wait} seconds.` });
  if (!token) return res.status(401).json({ error: "That PIN didn't match." });
  setSettingsCookie(res, token);
  res.json({ ok: true });
});

app.post('/api/settings/logout', (req, res) => {
  lock.logout(readCookie(req, 'settings'));
  res.json({ ok: true });
});

app.put('/api/settings/pin', requireSettings, (req, res) => {
  const pin = String(req.body?.pin ?? '').trim();
  try {
    lock.setPin(pin, readCookie(req, 'settings'));
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  // Keep the person who set the PIN signed in.
  if (pin) setSettingsCookie(res, lock.login(pin).token);
  console.log(pin ? '  ✦ settings PIN set' : '  ✦ settings PIN removed');
  res.json({ ok: true, locked: Boolean(pin) });
});

// ---------- events ----------

app.use('/api/events', requireSettings);

app.get('/api/events', (req, res) => {
  res.json({
    active: events.activeId(),
    events: events.list().map(withBackground),
    defaults: events.defaults,
    folder: events.dataDir,
    storage: storage(),
  });
});

// Every wish of one event, hidden ones included, for managing them.
app.get('/api/events/:id/wishes', (req, res) => {
  const event = events.get(req.params.id);
  if (!event) return res.status(404).json({ error: 'no such event' });
  res.json({ event, wishes: events.readIndex(event.id).slice().reverse() });
});

app.put('/api/events/:id/wishes/:wish', async (req, res) => {
  if (!events.exists(req.params.id)) return res.status(404).json({ error: 'no such event' });
  const found = await events.setHidden(req.params.id, req.params.wish, Boolean(req.body?.hidden));
  if (!found) return res.status(404).json({ error: 'no such wish' });
  res.json({ ok: true });
});

app.post('/api/events', (req, res) => {
  try {
    const event = events.create(req.body || {});
    events.setActive(event.id);
    console.log(`  ✦ created event "${event.couple}" in ${events.dir(event.id)}`);
    res.json(event);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.put('/api/events/:id', (req, res) => {
  try {
    const event = events.update(req.params.id, req.body || {});
    if (!event) return res.status(404).json({ error: 'no such event' });
    res.json(event);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Background photo for the booth screens, sent as a JPEG body.
app.put('/api/events/:id/background', express.raw({ type: 'image/jpeg', limit: '15mb' }), (req, res) => {
  const jpeg = req.body;
  if (!Buffer.isBuffer(jpeg) || jpeg.length < 4 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) {
    return res.status(400).json({ error: 'send the photo as a JPEG' });
  }
  if (!events.setBackground(req.params.id, jpeg)) return res.status(404).json({ error: 'no such event' });
  res.json({ ok: true, background: events.backgroundUrl(req.params.id) });
});

app.delete('/api/events/:id/background', (req, res) => {
  if (!events.setBackground(req.params.id, null)) return res.status(404).json({ error: 'no such event' });
  res.json({ ok: true, background: events.backgroundUrl(req.params.id) });
});

app.post('/api/events/:id/select', (req, res) => {
  if (!events.setActive(req.params.id)) return res.status(404).json({ error: 'no such event' });
  console.log(`  ✦ recording into "${events.get(req.params.id).couple}"`);
  res.json({ ok: true });
});

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, events.dir(req.eventId)),
    filename: (req, file, cb) => cb(null, `.upload-${crypto.randomUUID()}`),
  }),
  limits: { fileSize: 500 * 1024 * 1024, files: 2 },
});

// Pin the upload to the event selected when it starts.
function requireEvent(req, res, next) {
  req.eventId = events.activeId();
  if (!req.eventId) return res.status(409).json({ error: 'no event selected' });
  next();
}

app.post(
  '/api/wishes',
  requireEvent,
  upload.fields([
    { name: 'video', maxCount: 1 },
    { name: 'thumb', maxCount: 1 },
  ]),
  async (req, res) => {
    const video = req.files?.video?.[0];
    const thumb = req.files?.thumb?.[0];
    try {
      if (!video || video.size === 0) {
        if (thumb) fs.rmSync(thumb.path, { force: true });
        return res.status(400).json({ error: 'no video received' });
      }
      // A wish kept on the tablet while the server was down is sent later with
      // the time it was recorded.
      const now = new Date();
      const recorded = new Date(req.body.recordedAt);
      if (!Number.isNaN(recorded.getTime()) && recorded <= now.getTime() + 5 * 60_000 && recorded >= now.getTime() - 14 * 86_400_000) {
        now.setTime(recorded.getTime());
      }
      // Some browsers send the upload as text/plain, so check the file name too.
      const ext = /mp4/.test(video.mimetype) || /\.mp4$/i.test(video.originalname) ? 'mp4' : 'webm';
      const base = `${timestamp(now)}_wish_${crypto.randomBytes(2).toString('hex')}`;

      const folder = events.dir(req.eventId);
      fs.renameSync(video.path, path.join(folder, `${base}.${ext}`));
      let thumbFile = null;
      if (thumb && thumb.size > 0) {
        thumbFile = `${base}.jpg`;
        fs.renameSync(thumb.path, path.join(folder, thumbFile));
      } else if (thumb) {
        fs.rmSync(thumb.path, { force: true });
      }

      const entry = {
        id: base,
        createdAt: now.toISOString(),
        durationMs: Number(req.body.durationMs) || null,
        video: `${base}.${ext}`,
        thumb: thumbFile,
        mimeType: `video/${ext}`,
      };
      await events.addWish(req.eventId, entry);
      console.log(`  ♡ saved a wish to ${req.eventId} (${(video.size / 1e6).toFixed(1)} MB)`);
      res.json({ ok: true, id: entry.id });
    } catch (err) {
      console.error('Failed to save wish:', err);
      res.status(500).json({ error: 'could not save wish' });
    }
  }
);

app.post('/api/login', (req, res) => {
  if (!config.galleryPin || String(req.body?.pin) === String(config.galleryPin)) {
    const token = crypto.randomBytes(24).toString('hex');
    sessions.add(token);
    res.setHeader('Set-Cookie', `gallery=${token}; Path=/; HttpOnly; SameSite=Strict`);
    return res.json({ ok: true });
  }
  res.status(401).json({ error: 'wrong pin' });
});

// Wishes of the selected event. Looking back at another event with
// ?event=<id> needs the settings PIN, if one is set.
const otherEvent = (req, id) => id !== events.activeId() && !settingsAllowed(req);

app.get('/api/wishes', requireGallery, (req, res) => {
  const id = req.query.event || events.activeId();
  if (otherEvent(req, id)) return res.status(401).json({ error: 'settings are locked' });
  const event = events.get(id);
  if (!event) return res.json({ event: null, wishes: [] });
  const wishes = events.readIndex(id).filter((w) => !w.hidden).reverse();
  res.json({ event, wishes });
});

// Videos and thumbnails at /media/<event id>/<file>, with range requests so
// seeking is instant.
app.use('/media/:event', requireGallery, (req, res, next) => {
  if (!events.exists(req.params.event)) return res.sendStatus(404);
  if (otherEvent(req, req.params.event)) return res.sendStatus(401);
  express.static(events.dir(req.params.event), { index: false, dotfiles: 'ignore', fallthrough: false })(req, res, next);
});

// The booth's backdrop. Open like the booth itself, but another event's
// photo needs the settings PIN, as with its wishes.
app.get('/backdrop/:event', (req, res) => {
  if (otherEvent(req, req.params.event)) return res.sendStatus(401);
  const file = events.backgroundFile(req.params.event);
  if (!file) return res.sendStatus(404);
  res.sendFile(file, { maxAge: '1y' });
});

app.get('/wish-booth-ca.crt', (req, res) => {
  res.type('application/x-x509-ca-cert').sendFile(CA_CERT);
});

app.use(express.static(path.join(ROOT, 'public'), { extensions: ['html'] }));

// ---------- start ----------

async function start() {
  const { ips, cert, key } = await ensureCertificates();
  const ip = ips[0] || 'localhost';

  https.createServer({ cert, key }, app).listen(config.httpsPort);
  // Plain http is for the first-time setup page, which installs the
  // certificate on the tablet, and for running the booth on the tablet itself
  // (browsers allow the camera on http://localhost).
  http.createServer(app).listen(config.httpPort);

  const setupUrl = `http://${ip}:${config.httpPort}/setup`;
  console.log('\n  Wedding Wish Booth is running\n');
  console.log(`  Booth on this device:        http://localhost:${config.httpPort}/`);
  if (ips.length) {
    console.log(`  Booth (open on the tablet):  https://${ip}:${config.httpsPort}/`);
    console.log(`  First-time tablet setup:     ${setupUrl}`);
  }
  if (ips.length > 1) console.log(`  Other addresses on this laptop: ${ips.slice(1).join(', ')}`);
  console.log(`  Event folders are in:        ${events.dataDir}`);
  const active = events.get(events.activeId());
  console.log(active ? `  Recording into:              ${active.couple} (${active.id})` : '  No event selected yet: open /settings to create one.');
  const space = storage();
  if (space) console.log(`  Free space:                  ${(space.free / 1024 ** 3).toFixed(1)} GB${space.low ? ' (running low)' : ''}`);
  console.log('');
  if (!ips.length) return;
  console.log('  Scan with the tablet to open the setup page:\n');
  qrcode.generate(setupUrl, { small: true });
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
