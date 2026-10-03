// Wish booth: welcome → countdown → record → review → save → thank you.

const $ = (sel) => document.querySelector(sel);
const IDLE_RESET_MS = 60_000;
const THANKS_MS = 6_000;

const state = {
  config: { maxSeconds: 60 },
  stream: null,
  recorder: null,
  chunks: [],
  blob: null,
  thumb: null,
  mimeType: '',
  startedAt: 0,
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

function reset() {
  state.blob = null;
  state.thumb = null;
  const pb = $('#playback');
  pb.pause();
  if (pb.src) URL.revokeObjectURL(pb.src);
  pb.removeAttribute('src');
  show('welcome');
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
    state.config = await (await fetch('/api/config')).json();
  } catch {}
  const c = state.config;
  if (c.accent) document.documentElement.style.setProperty('--accent', c.accent);
  document.querySelectorAll('[data-text]').forEach((el) => {
    const value = c[el.dataset.text] || '';
    if (el.dataset.text === 'couple') renderCouple(el, value);
    else el.textContent = value;
  });
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

  show('recording');
  setTimeout(captureThumb, 1500);
  const max = state.config.maxSeconds || 60;
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
  const ext = state.blob.type.includes('mp4') ? 'mp4' : 'webm';
  form.append('video', state.blob, `wish.${ext}`);
  if (state.thumb) form.append('thumb', state.thumb, 'thumb.jpg');

  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/api/wishes');
  xhr.upload.onprogress = (e) => {
    if (e.lengthComputable) $('#progress').style.width = `${(e.loaded / e.total) * 100}%`;
  };
  xhr.onload = () => (xhr.status === 200 ? thanks() : failed());
  xhr.onerror = failed;
  xhr.send(form);
}

function failed() {
  // The recording stays in memory, so the guest can retry without re-recording.
  $('#send-error').hidden = false;
}

function thanks() {
  show('thanks');
  setTimeout(reset, THANKS_MS);
}

// ---------- wiring ----------

$('#start').addEventListener('click', () => {
  keepAwake();
  document.documentElement.requestFullscreen?.().catch(() => {});
  countdown();
});
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
  countdown();
});
$('#send').addEventListener('click', () => {
  $('#playback').pause();
  send();
});
$('#retry').addEventListener('click', send);

(async () => {
  await loadConfig();
  if (await startCamera()) show('welcome');
})();
