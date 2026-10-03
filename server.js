// Wedding Wish Booth server.
//
// Runs on the laptop. The tablet opens the booth page over the local wifi,
// records a wish, and uploads it here. Every wish is saved in ./wishes and
// listed in ./wishes/index.json. Nothing leaves the laptop.

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const qrcode = require('qrcode-terminal');
const { ensureCertificates, CA_CERT } = require('./lib/certs');

const ROOT = __dirname;
const WISHES_DIR = path.join(ROOT, 'wishes');
const INDEX_FILE = path.join(WISHES_DIR, 'index.json');
const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));

fs.mkdirSync(WISHES_DIR, { recursive: true });

// ---------- wish index ----------

function readIndex() {
  try {
    return JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8'));
  } catch {
    return [];
  }
}

// Writes are queued so two uploads finishing together can't clobber each other,
// and go through a temp file so a crash never leaves a half-written index.
let writeQueue = Promise.resolve();
function addToIndex(entry) {
  writeQueue = writeQueue.then(() => {
    const list = readIndex();
    list.push(entry);
    const tmp = `${INDEX_FILE}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(list, null, 2));
    fs.renameSync(tmp, INDEX_FILE);
  });
  return writeQueue;
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

// ---------- app ----------

const app = express();
app.disable('x-powered-by');
app.use(express.json());

app.get('/api/config', (req, res) => {
  res.json({
    couple: config.couple,
    date: config.date,
    welcomeLine: config.welcomeLine,
    accent: config.accent,
    maxSeconds: config.maxSeconds,
    httpsPort: config.httpsPort,
    pinRequired: Boolean(config.galleryPin),
  });
});

const upload = multer({
  storage: multer.diskStorage({
    destination: WISHES_DIR,
    filename: (req, file, cb) => cb(null, `.upload-${crypto.randomUUID()}`),
  }),
  limits: { fileSize: 500 * 1024 * 1024, files: 2 },
});

app.post(
  '/api/wishes',
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

      fs.renameSync(video.path, path.join(WISHES_DIR, `${base}.${ext}`));
      let thumbFile = null;
      if (thumb && thumb.size > 0) {
        thumbFile = `${base}.jpg`;
        fs.renameSync(thumb.path, path.join(WISHES_DIR, thumbFile));
      }

      const entry = {
        id: base,
        createdAt: now.toISOString(),
        durationMs: Number(req.body.durationMs) || null,
        video: `${base}.${ext}`,
        thumb: thumbFile,
        mimeType: `video/${ext}`,
      };
      await addToIndex(entry);
      console.log(`  ♡ saved a wish (${(video.size / 1e6).toFixed(1)} MB)`);
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

app.get('/api/wishes', requireGallery, (req, res) => {
  res.json(readIndex().slice().reverse());
});

// Videos and thumbnails, with range requests so seeking is instant.
app.use(
  '/media',
  requireGallery,
  express.static(WISHES_DIR, { index: false, dotfiles: 'ignore', fallthrough: false })
);

app.get('/wish-booth-ca.crt', (req, res) => {
  res.type('application/x-x509-ca-cert').sendFile(CA_CERT);
});

app.use(express.static(path.join(ROOT, 'public'), { extensions: ['html'] }));

// ---------- start ----------

async function start() {
  const { ips, cert, key } = await ensureCertificates();
  const ip = ips[0] || 'localhost';

  https.createServer({ cert, key }, app).listen(config.httpsPort);
  // Plain http is only for the first-time setup page, which installs the
  // certificate on the tablet.
  http.createServer(app).listen(config.httpPort);

  const setupUrl = `http://${ip}:${config.httpPort}/setup`;
  console.log('\n  Wedding Wish Booth is running\n');
  console.log(`  Booth (open on the tablet):  https://${ip}:${config.httpsPort}/`);
  console.log(`  First-time tablet setup:     ${setupUrl}`);
  if (ips.length > 1) console.log(`  Other addresses on this laptop: ${ips.slice(1).join(', ')}`);
  console.log(`  Wishes are saved in:         ${WISHES_DIR}\n`);
  console.log('  Scan with the tablet to open the setup page:\n');
  qrcode.generate(setupUrl, { small: true });
}

start().catch((err) => {
  console.error(err);
  process.exit(1);
});
