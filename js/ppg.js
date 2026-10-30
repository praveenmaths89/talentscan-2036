import { estimateHrBpm } from "./signal.js";

/** A fingertip over the lens looks red, not like a room. */
export function lensCovered({ r, g, b }) {
  const red = Number(r) || 0;
  const green = Number(g) || 0;
  const blue = Number(b) || 0;
  return red > 40 && red > green * 1.08 && red > blue * 1.25;
}

async function enableTorch(track) {
  if (!track?.applyConstraints) return false;
  const caps = typeof track.getCapabilities === "function" ? track.getCapabilities() : {};
  if (caps && caps.torch === false) return false;
  try {
    await track.applyConstraints({ advanced: [{ torch: true }] });
    return true;
  } catch {
    return false;
  }
}

/**
 * Read the camera only as light samples in a tiny canvas.
 * Tracks are stopped before we return. The series is not stored.
 */
export async function measureHeartRate(video, canvas, ms = 12000, onCue) {
  if (!navigator.mediaDevices?.getUserMedia) {
    return { ok: false, reason: "finger", bpm: null, torch: false };
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: "environment" }, width: { ideal: 160 }, height: { ideal: 120 } }
    });
  } catch {
    return { ok: false, reason: "finger", bpm: null, torch: false };
  }
  const track = stream.getVideoTracks()[0];
  const torch = await enableTorch(track);
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  try {
    await video.play();
  } catch {
    stream.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
    return { ok: false, reason: "finger", bpm: null, torch };
  }
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const series = [];
  const times = [];
  let covered = 0;
  let seen = 0;
  const t0 = performance.now();
  await new Promise((resolve) => {
    const tick = () => {
      const now = performance.now();
      if (video.readyState >= 2) {
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
      }
      if (now - t0 >= ms) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  stream.getTracks().forEach((t) => t.stop());
  video.srcObject = null;
  ctx.clearRect(0, 0, 32, 32);
  if (!seen || covered / seen < 0.55) {
    return { ok: false, reason: "finger", bpm: null, torch, sampleHz: 0 };
  }
  let fs = 30;
  if (times.length > 2) fs = ((times.length - 1) * 1000) / (times[times.length - 1] - times[0]);
  const hr = estimateHrBpm(series, fs);
  return { ...hr, sampleHz: fs, torch };
}
