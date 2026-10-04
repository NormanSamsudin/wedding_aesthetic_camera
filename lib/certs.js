// Local HTTPS certificates.
//
// Browsers only allow camera and microphone on https:// pages, so the booth
// needs a certificate the tablet trusts. We create a small private
// certificate authority (CA) once, which you install on the tablet one time,
// and then issue a server certificate for the laptop's current IP addresses.
// When the laptop moves to a new network, only the server certificate is
// re-issued, so the tablet keeps trusting it without reinstalling anything.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const selfsigned = require('selfsigned');

const CERT_DIR = path.join(__dirname, '..', 'certs');
const CA_CERT = path.join(CERT_DIR, 'wish-booth-ca.crt');
const CA_KEY = path.join(CERT_DIR, 'wish-booth-ca.key');
const SERVER_CERT = path.join(CERT_DIR, 'server.crt');
const SERVER_KEY = path.join(CERT_DIR, 'server.key');

function lanAddresses() {
  const ips = [];
  let interfaces = {};
  try {
    interfaces = os.networkInterfaces();
  } catch {
    // Android (Termux) refuses to list network interfaces; the booth then
    // runs on the tablet itself at http://localhost.
  }
  for (const list of Object.values(interfaces)) {
    for (const addr of list || []) {
      if (addr.family === 'IPv4' && !addr.internal) ips.push(addr.address);
    }
  }
  return ips;
}

function yearsFromNow(days) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

async function ensureCA() {
  if (fs.existsSync(CA_CERT) && fs.existsSync(CA_KEY)) {
    return { cert: fs.readFileSync(CA_CERT, 'utf8'), key: fs.readFileSync(CA_KEY, 'utf8') };
  }
  const pems = await selfsigned.generate(
    [
      { name: 'commonName', value: 'Wedding Wish Booth Local CA' },
      { name: 'organizationName', value: 'Wedding Wish Booth' },
    ],
    {
      keySize: 2048,
      algorithm: 'sha256',
      notAfterDate: yearsFromNow(3650),
      extensions: [
        { name: 'basicConstraints', cA: true, critical: true },
        { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
      ],
    }
  );
  fs.mkdirSync(CERT_DIR, { recursive: true });
  fs.writeFileSync(CA_CERT, pems.cert);
  fs.writeFileSync(CA_KEY, pems.private, { mode: 0o600 });
  return { cert: pems.cert, key: pems.private };
}

// True when the existing server certificate covers every given IP and is
// still valid for at least a week.
function serverCertCovers(ips) {
  if (!fs.existsSync(SERVER_CERT) || !fs.existsSync(SERVER_KEY)) return false;
  try {
    const cert = new crypto.X509Certificate(fs.readFileSync(SERVER_CERT));
    if (new Date(cert.validTo) < yearsFromNow(7)) return false;
    const san = cert.subjectAltName || '';
    return ips.every((ip) => san.includes(`IP Address:${ip}`));
  } catch {
    return false;
  }
}

async function ensureCertificates() {
  const ips = lanAddresses();
  const ca = await ensureCA();
  if (!serverCertCovers(ips)) {
    const pems = await selfsigned.generate([{ name: 'commonName', value: 'wish-booth.local' }], {
      keySize: 2048,
      algorithm: 'sha256',
      // Apple devices reject server certificates valid for more than 398 days.
      notAfterDate: yearsFromNow(390),
      ca: { cert: ca.cert, key: ca.key },
      extensions: [
        { name: 'basicConstraints', cA: false },
        { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
        { name: 'extKeyUsage', serverAuth: true },
        {
          name: 'subjectAltName',
          altNames: [
            { type: 2, value: 'localhost' },
            { type: 2, value: 'wish-booth.local' },
            { type: 7, ip: '127.0.0.1' },
            ...ips.map((ip) => ({ type: 7, ip })),
          ],
        },
      ],
    });
    fs.writeFileSync(SERVER_CERT, pems.cert);
    fs.writeFileSync(SERVER_KEY, pems.private, { mode: 0o600 });
  }
  return {
    ips,
    caPath: CA_CERT,
    cert: fs.readFileSync(SERVER_CERT),
    key: fs.readFileSync(SERVER_KEY),
  };
}

module.exports = { ensureCertificates, lanAddresses, CA_CERT };
