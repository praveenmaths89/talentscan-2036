import { estimateHrBpm } from "./signal.js";

/**
 * Read the camera only as light samples in a tiny canvas.
 * Tracks are stopped before we return. The series is not stored.
 */
export async function measureHeartRate(video, canvas, ms = 12000) {
  if (!navigator.mediaDevices?.getUserMedia) {
    return { ok: false, reason: "finger", bpm: null };
  }
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: "environment" }, width: { ideal: 160 }, height: { ideal: 120 } }
    });
  } catch {
    return { ok: false, reason: "finger", bpm: null };
  }
  const track = stream.getVideoTracks()[0];
  try {
    await track.applyConstraints({ advanced: [{ torch: true }] });
  } catch {
    /* torch is optional */
  }
  video.srcObject = stream;
  video.muted = true;
  video.playsInline = true;
  try {
    await video.play();
  } catch {
    stream.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
    return { ok: false, reason: "finger", bpm: null };
  }
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const series = [];
  const times = [];
  const t0 = performance.now();
  await new Promise((resolve) => {
    const tick = () => {
      const now = performance.now();
      if (video.readyState >= 2) {
        ctx.drawImage(video, 0, 0, 32, 32);
        const img = ctx.getImageData(0, 0, 32, 32);
        let green = 0;
        const px = img.data.length / 4;
        for (let i = 0; i < img.data.length; i += 4) green += img.data[i + 1];
        series.push(green / px);
        times.push(now);
      }
      if (now - t0 >= ms) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  stream.getTracks().forEach((t) => t.stop());
  video.srcObject = null;
  ctx.clearRect(0, 0, 32, 32);
  let fs = 30;
  if (times.length > 2) fs = ((times.length - 1) * 1000) / (times[times.length - 1] - times[0]);
  const hr = estimateHrBpm(series, fs);
  return { ...hr, sampleHz: fs };
}
