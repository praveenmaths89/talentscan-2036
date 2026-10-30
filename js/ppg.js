import { estimateHrBpm } from "./signal.js";

/** A fingertip over the lens looks red, not like a room. */
export function lensCovered({ r, g, b }) {
  const red = Number(r) || 0;
  const green = Number(g) || 0;
  const blue = Number(b) || 0;
  return red > 40 && red > green * 1.08 && red > blue * 1.25;
}

/** Strict camera first, then what cheap Samsung phones actually accept. */
export const CAMERA_ATTEMPTS = [
  { audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 160 }, height: { ideal: 120 } } },
  { audio: false, video: { facingMode: "environment" } },
  { audio: false, video: true }
];

export async function openCamera(devices) {
  let last;
  for (const constraints of CAMERA_ATTEMPTS) {
    try {
      return await devices.getUserMedia(constraints);
    } catch (error) {
      last = error;
    }
  }
  throw last || new Error("camera");
}

/** Chrome uses advanced constraints. Samsung Internet often wants torch: true or ImageCapture. */
export async function enableTorch(track) {
  if (!track) return false;
  const caps = typeof track.getCapabilities === "function" ? track.getCapabilities() : {};
  if (caps && caps.torch === false) return false;
  const attempts = [];
  if (typeof track.applyConstraints === "function") {
    attempts.push(() => track.applyConstraints({ advanced: [{ torch: true }] }));
    attempts.push(() => track.applyConstraints({ torch: true }));
  }
  if (typeof ImageCapture === "function") {
    attempts.push(async () => {
      const capture = new ImageCapture(track);
      if (typeof capture.setOptions !== "function") throw new Error("no torch options");
      await capture.setOptions({ torch: true });
    });
  }
  for (const attempt of attempts) {
    try {
      await attempt();
      return true;
    } catch {
      /* try the next switch this phone understands */
    }
  }
  return false;
}

/**
 * Read the camera only as light samples in a tiny canvas.
 * Tracks are stopped before we return. The series is not stored.
 */
function stopCamera(stream, video) {
  try {
    stream?.getTracks?.().forEach((track) => track.stop());
  } catch {
    /* already stopped */
  }
  if (video) video.srcObject = null;
}

export async function measureHeartRate(video, canvas, ms = 12000, onCue, mediaDevices) {
  const devices = mediaDevices || (typeof navigator !== "undefined" ? navigator.mediaDevices : null);
  const limit = Math.max(1000, Number(ms) || 12000);
  if (!devices?.getUserMedia) {
    return { ok: false, reason: "finger", bpm: null, torch: false };
  }
  let stream = null;
  let hardTimer = null;
  let closed = false;
  const giveUp = { ok: false, reason: "finger", bpm: null, torch: false, timedOut: true };
  try {
    return await Promise.race([
      readPulse(video, canvas, limit, onCue, (next) => {
        stream = next;
        if (closed) stopCamera(stream, video);
      }, devices),
      new Promise((resolve) => {
        hardTimer = setTimeout(() => resolve(giveUp), limit + 800);
      })
    ]);
  } finally {
    closed = true;
    if (hardTimer) clearTimeout(hardTimer);
    stopCamera(stream, video);
  }
}

async function readPulse(video, canvas, ms, onCue, keepStream, devices) {
  let stream;
  try {
    stream = await openCamera(devices);
  } catch {
    return { ok: false, reason: "finger", bpm: null, torch: false };
  }
  keepStream(stream);
  const track = stream.getVideoTracks()[0];
  const torch = await enableTorch(track);
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  try {
    await video.play();
  } catch {
    return { ok: false, reason: "finger", bpm: null, torch };
  }
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const series = [];
  const times = [];
  let covered = 0;
  let seen = 0;
  const t0 = performance.now();
  await new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(backup);
      clearInterval(poll);
      resolve();
    };
    const backup = setTimeout(finish, ms + 400);
    const poll = setInterval(() => {
      if (performance.now() - t0 >= ms) finish();
    }, 200);
    const tick = () => {
      if (settled) return;
      const now = performance.now();
      if (video.readyState >= 2 && ctx) {
        try {
          ctx.drawImage(video, 0, 0, 32, 32);
          const img = ctx.getImageData(0, 0, 32, 32);
          let red = 0;
          let green = 0;
          let blue = 0;
          const px = img.data.length / 4;
          for (let i = 0; i < img.data.length; i += 4) {
            red += img.data[i];
            green += img.data[i + 1];
            blue += img.data[i + 2];
          }
          const rgb = { r: red / px, g: green / px, b: blue / px };
          seen += 1;
          if (lensCovered(rgb)) covered += 1;
          series.push(rgb.g);
          times.push(now);
          if (onCue) onCue(lensCovered(rgb) ? "still" : "cover");
        } catch {
          /* a stalled frame must not trap the test */
        }
      }
      if (now - t0 >= ms) finish();
      else if (typeof requestAnimationFrame === "function") requestAnimationFrame(tick);
    };
    if (typeof requestAnimationFrame === "function") requestAnimationFrame(tick);
  });
  try {
    ctx.clearRect(0, 0, 32, 32);
  } catch {
    /* canvas may already be gone */
  }
  if (!seen || covered / seen < 0.55) {
    return { ok: false, reason: "finger", bpm: null, torch, sampleHz: 0 };
  }
  let fs = 30;
  if (times.length > 2) fs = ((times.length - 1) * 1000) / Math.max(1, times[times.length - 1] - times[0]);
  const hr = estimateHrBpm(series, fs);
  return { ...hr, sampleHz: fs, torch };
}
