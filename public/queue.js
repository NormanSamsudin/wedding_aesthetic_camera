// Wishes that couldn't be sent (for example Termux was stopped) are kept in
// the browser's storage on the tablet and sent again once the server is back.

window.wishQueue = (() => {
  const DB = 'wish-booth';
  const STORE = 'pending';

  function open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function run(mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => {
        db.close();
        resolve(req?.result);
      };
      tx.onerror = tx.onabort = () => {
        db.close();
        reject(tx.error);
      };
    });
  }

  const add = (wish) => run('readwrite', (s) => s.add(wish));
  const all = () => run('readonly', (s) => s.getAll());
  const remove = (id) => run('readwrite', (s) => s.delete(id));
  const count = () => run('readonly', (s) => s.count()).catch(() => 0);

  function upload(wish) {
    const form = new FormData();
    form.append('durationMs', String(wish.durationMs));
    form.append('recordedAt', wish.recordedAt);
    const ext = wish.video.type.includes('mp4') ? 'mp4' : 'webm';
    form.append('video', wish.video, `wish.${ext}`);
    if (wish.thumb) form.append('thumb', wish.thumb, 'thumb.jpg');
    return fetch('/api/wishes', { method: 'POST', body: form });
  }

  // Send what's waiting, oldest first. Stops at the first failure so the
  // order is kept and a down server isn't hammered.
  let flushing = false;
  async function flush() {
    if (flushing) return;
    flushing = true;
    try {
      for (const wish of await all()) {
        const res = await upload(wish);
        if (!res.ok) break;
        await remove(wish.id);
      }
    } catch {
      // Still offline; try again on the next round.
    } finally {
      flushing = false;
    }
  }

  return { add, count, flush };
})();
