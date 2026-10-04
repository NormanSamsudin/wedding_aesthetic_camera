// Wish booth: welcome → countdown → record → review → save → thank you.

const $ = (sel) => document.querySelector(sel);
const IDLE_RESET_MS = 60_000;
const THANKS_MS = 6_000;
const PROMPT_MS = 6_000;
const FLUSH_MS = 30_000;

const state = {
  config: { maxSeconds: 60 },
  text: window.TEXT.en,
  stream: null,
  recorder: null,
  chunks: [],
  blob: null,
  thumb: null,
  mimeType: '',
  startedAt: 0,
  recordedAt: '',
  durationMs: 0,
};

// ---------- screens ----------

let idleTimer = null;
function show(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('active', s.id === `s-${id}`));
  document.body.classList.toggle('live', id === 'countdown' || id === 'recording');
  clearTimeout(idleTimer);
  // Walk-away safety: screens waiting on a guest go back to the start.
  if (id === 'review') {
    idleTimer = setTimeout(reset, IDLE_RESET_MS);
  }
}
document.addEventListener('pointerdown', () => {
  if (document.querySelector('#s-review.active')) show('review');
});

async function reset() {
  state.blob = null;
  state.thumb = null;
  const pb = $('#playback');
  pb.pause();
  if (pb.src) URL.revokeObjectURL(pb.src);
  pb.removeAttribute('src');
  // Pick up a newly selected or edited event between guests.
  await loadConfig();
  showHome();
}

// Nothing can be recorded until an event is selected in /settings.
function showHome() {
  show(state.config.event ? 'welcome' : 'no-event');
}

// ---------- config & text ----------

function renderCouple(el, text) {
  el.textContent = '';
  const parts = text.split('&');
  parts.forEach((part, i) => {
    el.append(part);
    if (i < parts.length - 1) {
      const amp = document.createElement('span');
      amp.className = 'amp';
      amp.textContent = '&';
      el.append(amp);
    }
  });
}

async function loadConfig() {
  try {
    state.config = await (await fetch('/api/config', { cache: 'no-store' })).json();
  } catch {}
  // Names, colour, language and max length come from the selected event.
  const c = state.config.event || {};
  if (c.accent) document.documentElement.style.setProperty('--accent', c.accent);
  document.querySelectorAll('[data-text]').forEach((el) => {
    const value = c[el.dataset.text] || '';
    if (el.dataset.text === 'couple') renderCouple(el, value);
    else el.textContent = value;
  });
  state.text = window.textFor(state.config.event);
  window.applyText(state.text);
  updateNotice();
}

// Quiet line at the bottom of the welcome screen for the organiser.
async function updateNotice() {
  const notes = [];
  if (state.config.lowStorage) notes.push(state.text.lowStorage);
  const waiting = await window.wishQueue.count();
  if (waiting) notes.push(state.text.waiting(waiting));
  $('#notice').textContent = notes.join(' · ');
  $('#notice').hidden = !notes.length;
}

// ---------- prompts ----------

// While counting down and recording, show an idea of what to say, changing
// every few seconds. The event's own prompts win over the built-in ones.
let promptTimer = null;
function startPrompts() {
  clearInterval(promptTimer);
  const own = state.config.event?.prompts;
  const list = own?.length ? own : state.text.prompts;
  let i = Math.floor(Math.random() * list.length);
  const els = document.querySelectorAll('[data-prompt]');
  els.forEach((el) => {
    el.classList.remove('fading');
    el.textContent = list[i];
  });
  if (list.length < 2) return;
  promptTimer = setInterval(() => {
    i = (i + 1) % list.length;
    els.forEach((el) => el.classList.add('fading'));
    setTimeout(() => {
      els.forEach((el) => {
        el.textContent = list[i];
        el.classList.remove('fading');
      });
    }, 600);
  }, PROMPT_MS);
}
function stopPrompts() {
  clearInterval(promptTimer);
}

// ---------- camera ----------

function pickMimeType() {
  // MP4 first: it plays everywhere, including Safari. Newer Chrome and all
  // iPads record MP4; older Android Chrome falls back to WebM.
  const types = [
    'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
    'video/mp4',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
  ];
  return types.find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t)) || '';
}

async function startCamera() {
  if (!window.isSecureContext) {
    const httpsUrl = `https://${location.hostname}:${state.config.httpsPort || 3443}/`;
    blocked(`The booth must be opened over https. Open ${httpsUrl} instead. If you haven't set up this tablet yet, open /setup first.`);
    return false;
  }
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    blocked('This browser cannot record video. Please use Chrome on Android or Safari on iPad.');
    return false;
  }
  try {
    state.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    $('#preview').srcObject = state.stream;
    return true;
  } catch (err) {
    blocked(
      err.name === 'NotAllowedError'
        ? 'Camera or microphone permission was denied. Allow both for this site in the browser settings, then try again.'
        : `The camera could not start (${err.name}). Make sure no other app is using it.`
    );
    return false;
  }
}

function blocked(reason) {
  $('#blocked-reason').textContent = reason;
  show('blocked');
}

// Keep the tablet screen on while the booth is open.
let wakeLock = null;
async function keepAwake() {
  try {
    if ('wakeLock' in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => (wakeLock = null));
    }
  } catch {}
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') keepAwake();
});

// ---------- recording ----------

function captureThumb() {
  const video = $('#preview');
  if (!video.videoWidth) return;
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = Math.round((640 * video.videoHeight) / video.videoWidth);
  canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
  canvas.toBlob((b) => (state.thumb = b), 'image/jpeg', 0.82);
}

function countdown() {
  show('countdown');
  startPrompts();
  let n = 3;
  const el = $('#count');
  el.textContent = n;
  const tick = setInterval(() => {
    n -= 1;
    if (n === 0) {
      clearInterval(tick);
      startRecording();
    } else {
      // Restart the pop animation for each number.
      el.style.animation = 'none';
      void el.offsetWidth;
      el.style.animation = '';
      el.textContent = n;
    }
  }, 1000);
}

let recordTimer = null;
function startRecording() {
  state.chunks = [];
  state.thumb = null;
  state.mimeType = pickMimeType();
  const options = { videoBitsPerSecond: 2_500_000, audioBitsPerSecond: 128_000 };
  if (state.mimeType) options.mimeType = state.mimeType;
  const recorder = new MediaRecorder(state.stream, options);
  recorder.ondataavailable = (e) => e.data.size && state.chunks.push(e.data);
  recorder.onstop = finishRecording;
  recorder.start(1000);
  state.recorder = recorder;
  state.startedAt = performance.now();
  state.recordedAt = new Date().toISOString();

  show('recording');
  setTimeout(captureThumb, 1500);
  const max = state.config.event?.maxSeconds || 60;
  const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  const tick = () => {
    const secs = Math.floor((performance.now() - state.startedAt) / 1000);
    $('#timer').textContent = `${fmt(Math.min(secs, max))} / ${fmt(max)}`;
    if (secs >= max) stopRecording();
  };
  tick();
  recordTimer = setInterval(tick, 250);
}

function stopRecording() {
  clearInterval(recordTimer);
  stopPrompts();
  if (state.recorder && state.recorder.state !== 'inactive') state.recorder.stop();
}

function finishRecording() {
  state.durationMs = Math.round(performance.now() - state.startedAt);
  const type = state.recorder.mimeType || state.mimeType || 'video/webm';
  state.blob = new Blob(state.chunks, { type });
  if (!state.thumb) captureThumb();
  const pb = $('#playback');
  if (pb.src) URL.revokeObjectURL(pb.src);
  pb.src = URL.createObjectURL(state.blob);
  $('#play').hidden = false;
  show('review');
}

// ---------- upload ----------

function send() {
  show('sending');
  $('#send-error').hidden = true;
  $('#progress').style.width = '0';

  const form = new FormData();
  form.append('durationMs', String(state.durationMs));
  form.append('recordedAt', state.recordedAt);
  const ext = state.blob.type.includes('mp4') ? 'mp4' : 'webm';
  form.append('video', state.blob, `wish.${ext}`);
  if (state.thumb) form.append('thumb', state.thumb, 'thumb.jpg');

  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/api/wishes');
  xhr.upload.onprogress = (e) => {
    if (e.lengthComputable) $('#progress').style.width = `${(e.loaded / e.total) * 100}%`;
  };
  xhr.onload = () => (xhr.status === 200 ? thanks(false) : failed(xhr.status));
  xhr.onerror = () => failed(0);
  xhr.send(form);
}

async function failed(status) {
  // No event selected: only the organiser can fix that, so keep the
  // recording in memory and let the guest retry.
  if (status !== 409) {
    // The server is down or couldn't save: keep the wish on the tablet and
    // send it later, so the guest isn't left waiting.
    try {
      await window.wishQueue.add({
        video: state.blob,
        thumb: state.thumb,
        durationMs: state.durationMs,
        recordedAt: state.recordedAt,
      });
      return thanks(true);
    } catch {}
  }
  $('#send-error-text').textContent = status === 409 ? state.text.noEvent : state.text.saveFailed;
  $('#send-error').hidden = false;
}

function thanks(later) {
  $('#thanks-note').textContent = later ? state.text.savedLater : state.text.saved;
  show('thanks');
  setTimeout(reset, THANKS_MS);
  if (!later) window.wishQueue.flush().then(updateNotice);
}

setInterval(() => window.wishQueue.flush().then(updateNotice), FLUSH_MS);

// ---------- wiring ----------

function goFullscreen() {
  keepAwake();
  const el = document.documentElement;
  if (document.fullscreenElement || document.webkitFullscreenElement) return;
  // Older iPad Safari only has the webkit-prefixed version.
  if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
  else el.webkitRequestFullscreen?.();
}
$('#start').addEventListener('click', async () => {
  goFullscreen();
  await loadConfig();
  if (!state.config.event) return showHome();
  countdown();
});

// Hidden way into settings for the organiser: hold the names for 3 seconds.
let holdTimer = null;
$('.names').addEventListener('pointerdown', () => {
  holdTimer = setTimeout(() => (location.href = '/settings/'), 3000);
});
['pointerup', 'pointerleave', 'pointercancel'].forEach((e) =>
  $('.names').addEventListener(e, () => clearTimeout(holdTimer))
);

// ---------- gallery ----------

$('#watch').addEventListener('click', () => {
  goFullscreen();
  $('#gallery').src = '/gallery/';
  $('#gallery').hidden = false;
});

// Called by the gallery's "Start recording" button and its idle timer.
window.closeGallery = async (startRecording) => {
  const frame = $('#gallery');
  frame.hidden = true;
  frame.src = 'about:blank';
  await loadConfig();
  if (startRecording && state.config.event) countdown();
  else showHome();
};
$('#stop').addEventListener('click', stopRecording);
$('#play').addEventListener('click', () => {
  $('#play').hidden = true;
  $('#playback').play();
});
$('#playback').addEventListener('ended', () => ($('#play').hidden = false));
$('#playback').addEventListener('click', () => {
  $('#playback').pause();
  $('#play').hidden = false;
});
$('#retake').addEventListener('click', () => {
  $('#playback').pause();
  stopPrompts();
  countdown();
});
$('#send').addEventListener('click', () => {
  $('#playback').pause();
  send();
});
$('#retry').addEventListener('click', send);

(async () => {
  await loadConfig();
  window.wishQueue.flush().then(updateNotice);
  if (!(await startCamera())) return;
  // "Start recording" in the gallery comes back here and goes straight to the countdown.
  if (new URLSearchParams(location.search).has('start') && state.config.event) {
    history.replaceState(null, '', '/');
    keepAwake();
    countdown();
  } else {
    showHome();
  }
})();
