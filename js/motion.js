import { G } from "./signal.js";

export function motionPermissionKind() {
  const DME = typeof DeviceMotionEvent !== "undefined" ? DeviceMotionEvent : null;
  if (DME && typeof DME.requestPermission === "function") return "ios";
  if (typeof window !== "undefined" && "DeviceMotionEvent" in window) return "standard";
  return "none";
}

export function sensorSupport() {
  const kind = motionPermissionKind();
  const secure = typeof window === "undefined" || window.isSecureContext !== false;
  return {
    kind,
    secure,
    available: kind !== "none" && secure
  };
}

/**
 * iOS Safari only shows the motion prompt from a user gesture.
 * Call this directly inside the tap handler, before any other await.
 */
/**
 * iOS must grant motion. Android Chrome and Samsung Internet have no prompt;
 * a failing orientation check must not block the jump.
 */
export async function resolveMotionPermission(motionAsk, orientationAsk) {
  if (typeof motionAsk === "function") {
    try {
      const result = await motionAsk();
      if (result === "denied") return "denied";
    } catch {
      return "denied";
    }
  }
  if (typeof orientationAsk === "function") {
    try {
      await orientationAsk();
    } catch {
      /* Samsung and some Android WebViews reject this and still send motion */
    }
  }
  return "granted";
}

export async function requestMotionPermission() {
  const support = sensorSupport();
  if (!support.secure) return "insecure";
  if (support.kind === "none") return "unavailable";
  const DME = typeof DeviceMotionEvent !== "undefined" ? DeviceMotionEvent : null;
  const DOE = typeof DeviceOrientationEvent !== "undefined" ? DeviceOrientationEvent : null;
  const motionAsk = DME && typeof DME.requestPermission === "function" ? () => DME.requestPermission() : null;
  const orientationAsk = DOE && typeof DOE.requestPermission === "function" ? () => DOE.requestPermission() : null;
  return resolveMotionPermission(motionAsk, orientationAsk);
}

function finiteOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function sampleFromEvent(ev, t) {
  const withG = ev?.accelerationIncludingGravity;
  const linear = ev?.acceleration;
  const gx = finiteOrNull(withG?.x);
  const gy = finiteOrNull(withG?.y);
  const gz = finiteOrNull(withG?.z);
  const hasG = gx != null || gy != null || gz != null;
  const lx = finiteOrNull(linear?.x);
  const ly = finiteOrNull(linear?.y);
  const lz = finiteOrNull(linear?.z);
  const rot = ev?.rotationRate || {};
  if (!hasG && lx == null && ly == null && lz == null) {
    return { t, missing: true, noGravity: true, ax: 0, ay: 0, az: 0, gx: finiteOrNull(rot.alpha), gy: finiteOrNull(rot.beta), gz: finiteOrNull(rot.gamma) };
  }
  const sample = {
    t,
    missing: false,
    noGravity: !hasG,
    ax: hasG ? gx || 0 : lx || 0,
    ay: hasG ? gy || 0 : ly || 0,
    az: hasG ? gz || 0 : lz || 0,
    gx: finiteOrNull(rot.alpha),
    gy: finiteOrNull(rot.beta),
    gz: finiteOrNull(rot.gamma),
    intervalMs: Number.isFinite(ev?.interval) ? ev.interval : null
  };
  return sample;
}

export function startMotionRecording() {
  const samples = [];
  const start = typeof performance !== "undefined" ? performance.now() : Date.now();
  let live = true;
  const handler = (ev) => {
    if (!live) return;
    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    samples.push(sampleFromEvent(ev, (now - start) / 1000));
  };
  if (typeof window !== "undefined") window.addEventListener("devicemotion", handler, { passive: true });
  return {
    samples,
    stop() {
      live = false;
      if (typeof window !== "undefined") window.removeEventListener("devicemotion", handler, { passive: true });
      return samples;
    }
  };
}

export function haversineMeters(a, b) {
  if (!a || !b) return null;
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function watchGps(onFix) {
  if (typeof navigator === "undefined" || !navigator.geolocation) return { stop() {} };
  const id = navigator.geolocation.watchPosition(
    (pos) => {
      onFix({
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        accuracy: pos.coords.accuracy
      });
    },
    () => {},
    { enableHighAccuracy: true, maximumAge: 400, timeout: 8000 }
  );
  return {
    stop() {
      navigator.geolocation.clearWatch(id);
    }
  };
}

let wakeLock = null;

export async function holdScreenAwake() {
  try {
    if (typeof navigator !== "undefined" && navigator.wakeLock?.request) {
      wakeLock = await navigator.wakeLock.request("screen");
      return true;
    }
  } catch {
    /* older browsers and denied locks still let the test run */
  }
  return false;
}

export function releaseScreenAwake() {
  try {
    wakeLock?.release?.();
  } catch {
    /* ignore */
  }
  wakeLock = null;
}

export { G };
