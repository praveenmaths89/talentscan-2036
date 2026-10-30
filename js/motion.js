import { G, sampleToBw } from "./signal.js";

export function motionPermissionKind() {
  const DME = typeof DeviceMotionEvent !== "undefined" ? DeviceMotionEvent : null;
  if (DME && typeof DME.requestPermission === "function") return "ios";
  if (typeof window !== "undefined" && "DeviceMotionEvent" in window) return "standard";
  return "none";
}

/** iOS Safari requires a user gesture. Android Chrome does not. */
export async function requestMotionPermission() {
  const DME = typeof DeviceMotionEvent !== "undefined" ? DeviceMotionEvent : null;
  if (DME && typeof DME.requestPermission === "function") {
    try {
      return await DME.requestPermission();
    } catch {
      return "denied";
    }
  }
  return "granted";
}

export function startMotionRecording() {
  const samples = [];
  const start = performance.now();
  let live = true;
  const handler = (ev) => {
    if (!live) return;
    const acc = ev.accelerationIncludingGravity || ev.acceleration || { x: 0, y: 0, z: G };
    const rot = ev.rotationRate || {};
    const sample = {
      t: (performance.now() - start) / 1000,
      ax: acc.x || 0,
      ay: acc.y || 0,
      az: acc.z || 0,
      gx: rot.alpha || 0,
      gy: rot.beta || 0,
      gz: rot.gamma || 0
    };
    sample.bw = sampleToBw(sample);
    samples.push(sample);
  };
  window.addEventListener("devicemotion", handler);
  return {
    samples,
    stop() {
      live = false;
      window.removeEventListener("devicemotion", handler);
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
  if (!navigator.geolocation) return { stop() {} };
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
