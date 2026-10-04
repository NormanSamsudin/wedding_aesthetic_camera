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

const ROOT = __dirname;
const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const events = createStore(ROOT, config);

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

// ---------- app ----------

const app = express();
app.disable('x-powered-by');
app.use(express.json());

// The booth's settings come from the selected event; `event` is null until
// one is selected, and the booth won't record until then.
app.get('/api/config', (req, res) => {
  res.json({
    event: events.get(events.activeId()),
    httpsPort: config.httpsPort,
    pinRequired: Boolean(config.galleryPin),
  });
});

// ---------- events ----------

app.get('/api/events', (req, res) => {
  res.json({ active: events.activeId(), events: events.list(), defaults: events.defaults, folder: events.dataDir });
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
      const now = new Date();
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

// Wishes of the selected event, or of ?event=<id> to look back at another one.
app.get('/api/wishes', requireGallery, (req, res) => {
  const id = req.query.event || events.activeId();
  const event = events.get(id);
  if (!event) return res.json({ event: null, wishes: [] });
  res.json({ event, wishes: events.readIndex(id).slice().reverse() });
});

// Videos and thumbnails at /media/<event id>/<file>, with range requests so
// seeking is instant.
app.use('/media/:event', requireGallery, (req, res, next) => {
  if (!events.exists(req.params.event)) return res.sendStatus(404);
  express.static(events.dir(req.params.event), { index: false, dotfiles: 'ignore', fallthrough: false })(req, res, next);
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
  console.log(active ? `  Recording into:              ${active.couple} (${active.id})\n` : '  No event selected yet: open /settings to create one.\n');
  if (!ips.length) return;
  console.log('  Scan with the tablet to open the setup page:\n');
  qrcode.generate(setupUrl, { small: true });
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
