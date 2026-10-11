// Which camera and microphone the booth uses. The choice is saved in this
// browser only, because it belongs to the tablet the webcam is plugged into.
// "Auto" (no saved device) prefers a USB webcam when one is plugged in, and
// otherwise uses the tablet's front camera.

(() => {
  const KEY = 'wishbooth.devices';

  const VIDEO = { width: { ideal: 1280 }, height: { ideal: 720 } };
  const AUDIO = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };

  function load() {
    try {
      return JSON.parse(localStorage.getItem(KEY)) || {};
    } catch {
      return {};
    }
  }

  function save(prefs) {
    try {
      localStorage.setItem(KEY, JSON.stringify(prefs));
    } catch {}
  }

  // Chrome on Android names built-in cameras "camera2 1, facing front" and
  // "camera2 0, facing back". Anything else is a plugged-in camera.
  function isExternal(device) {
    return !!device.label && !/facing (front|back)/i.test(device.label);
  }

  // Saved ids can change after Chrome clears site data, so fall back to the
  // saved name before giving up on a device.
  function find(devices, kind, saved) {
    const list = devices.filter((d) => d.kind === kind);
    if (saved) {
      return list.find((d) => d.deviceId === saved.id) || list.find((d) => saved.label && d.label === saved.label) || null;
    }
    return kind === 'videoinput' ? list.find(isExternal) || null : null;
  }

  function constraints(video, audio) {
    return {
      video: video ? { ...VIDEO, deviceId: { exact: video.deviceId } } : { ...VIDEO, facingMode: 'user' },
      audio: audio ? { ...AUDIO, deviceId: { exact: audio.deviceId } } : AUDIO,
    };
  }

  // Opens the chosen camera and mic. The first call also asks for permission,
  // which Chrome needs before it shows device names.
  async function open() {
    const prefs = load();
    let stream = await navigator.mediaDevices.getUserMedia(constraints(null, null));
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      const video = find(devices, 'videoinput', prefs.video);
      const audio = find(devices, 'audioinput', prefs.audio);
      const current = stream.getVideoTracks()[0]?.getSettings().deviceId;
      if ((video && video.deviceId !== current) || audio) {
        stream.getTracks().forEach((t) => t.stop());
        stream = await navigator.mediaDevices.getUserMedia(constraints(video, audio));
      }
    } catch (err) {
      // The chosen device is busy or gone: keep the default camera running.
      console.warn('Using the default camera:', err);
      if (!stream.active) stream = await navigator.mediaDevices.getUserMedia(constraints(null, null));
    }
    return stream;
  }

  window.boothCamera = { load, save, isExternal, open };
})();
