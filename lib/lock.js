// Settings lock: an optional PIN that keeps guests out of /settings.
//
// The PIN is stored as a salted scrypt hash in <data folder>/lock.json.
// Delete that file to remove a forgotten PIN.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PIN_PATTERN = /^\d{4,8}$/;
const MAX_TRIES = 5;
const WAIT_MS = 60_000;

function createLock(dataDir) {
  const file = path.join(dataDir, 'lock.json');
  const sessions = new Set();
  let fails = 0;
  let waitUntil = 0;

  const hash = (pin, salt) => crypto.scryptSync(String(pin), salt, 32).toString('hex');

  function read() {
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      return null;
    }
  }

  const isSet = () => Boolean(read()?.hash);

  // Without a PIN, settings are open to anyone on the booth.
  const allows = (token) => !isSet() || sessions.has(token);

  // Returns a session token, or { wait } after too many wrong tries.
  function login(pin) {
    if (Date.now() < waitUntil) return { wait: Math.ceil((waitUntil - Date.now()) / 1000) };
    const stored = read();
    const ok =
      !stored?.hash ||
      crypto.timingSafeEqual(Buffer.from(hash(pin, stored.salt), 'hex'), Buffer.from(stored.hash, 'hex'));
    if (!ok) {
      fails += 1;
      if (fails >= MAX_TRIES) {
        fails = 0;
        waitUntil = Date.now() + WAIT_MS;
      }
      return {};
    }
    fails = 0;
    const token = crypto.randomBytes(24).toString('hex');
    sessions.add(token);
    return { token };
  }

  function logout(token) {
    sessions.delete(token);
  }

  // An empty PIN removes the lock. Changing it signs out everyone else.
  function setPin(pin, keepToken) {
    if (pin === '' || pin == null) {
      fs.rmSync(file, { force: true });
      return;
    }
    if (!PIN_PATTERN.test(String(pin))) throw new Error('the PIN must be 4 to 8 digits');
    const salt = crypto.randomBytes(16).toString('hex');
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ salt, hash: hash(pin, salt) }));
    fs.renameSync(tmp, file);
    for (const t of sessions) if (t !== keepToken) sessions.delete(t);
  }

  return { isSet, allows, login, logout, setPin };
}

module.exports = { createLock };
