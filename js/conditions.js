/**
 * Coarse place and weather. Exact coordinates are used only to call the
 * weather service and are never returned or stored.
 */

const AREA_KEYS = ["city", "district", "state", "tempC", "humidity", "feelsC", "heatIndexC", "windKmh", "uv", "aqi", "pm25", "altitudeM"];

/** Rothfusz heat index. Temperature in Celsius, humidity in percent. */
export function heatIndexC(tempC, rh) {
  const t = Number(tempC);
  const h = Number(rh);
  if (!Number.isFinite(t) || !Number.isFinite(h)) return null;
  if (t < 27) return Math.round(t * 10) / 10;
  const tf = (t * 9) / 5 + 32;
  let hi =
    -42.379 +
    2.04901523 * tf +
    10.14333127 * h -
    0.22475541 * tf * h -
    0.00683783 * tf * tf -
    0.05481717 * h * h +
    0.00122874 * tf * tf * h +
    0.00085282 * tf * h * h -
    0.00000199 * tf * tf * h * h;
  if (h < 13 && tf >= 80 && tf <= 112) {
    hi -= ((13 - h) / 4) * Math.sqrt((17 - Math.abs(tf - 95)) / 17);
  } else if (h > 85 && tf >= 80 && tf <= 87) {
    hi += ((h - 85) / 10) * ((87 - tf) / 5);
  }
  const c = ((hi - 32) * 5) / 9;
  return Math.round(c * 10) / 10;
}

export function publicArea(raw) {
  const out = {};
  for (const key of AREA_KEYS) {
    if (raw && raw[key] != null && raw[key] !== "") out[key] = raw[key];
  }
  return out;
}

export function safetyFlags(area) {
  if (!area) return { heat: false, air: false };
  const heat = Number(area.heatIndexC) >= 32 || Number(area.feelsC) >= 35;
  const air = Number(area.aqi) >= 100 || Number(area.pm25) >= 35.5;
  return { heat, air };
}

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

export async function lookupArea(lat, lon) {
  const q = `latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lon)}`;
  const [place, weather, air, elev] = await Promise.all([
    getJson(`https://api.bigdatacloud.net/data/reverse-geocode-client?${q}&localityLanguage=en`),
    getJson(
      `https://api.open-meteo.com/v1/forecast?${q}&current=temperature_2m,relative_humidity_2m,apparent_temperature,wind_speed_10m,uv_index`
    ),
    getJson(`https://air-quality-api.open-meteo.com/v1/air-quality?${q}&current=us_aqi,pm2_5`),
    getJson(`https://api.open-meteo.com/v1/elevation?${q}`)
  ]);
  const current = weather.current || {};
  const tempC = current.temperature_2m;
  const humidity = current.relative_humidity_2m;
  const city = place.city || place.locality || "";
  const district = place.locality && place.locality !== city ? place.locality : place.localityInfo?.administrative?.[2]?.name || "";
  return publicArea({
    city,
    district,
    state: place.principalSubdivision || "",
    tempC,
    humidity,
    feelsC: current.apparent_temperature,
    heatIndexC: heatIndexC(tempC, humidity),
    windKmh: current.wind_speed_10m,
    uv: current.uv_index,
    aqi: air.current?.us_aqi,
    pm25: air.current?.pm2_5,
    altitudeM: Array.isArray(elev.elevation) ? elev.elevation[0] : null
  });
}

export function readPosition(geolocation) {
  const geo = geolocation || (typeof navigator !== "undefined" ? navigator.geolocation : null);
  if (!geo) return Promise.reject(new Error("no-geo"));
  return new Promise((resolve, reject) => {
    geo.getCurrentPosition(
      (pos) => resolve(pos),
      (err) => reject(err),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 10 * 60 * 1000 }
    );
  });
}

export async function collectArea(geolocation) {
  const pos = await readPosition(geolocation);
  const area = await lookupArea(pos.coords.latitude, pos.coords.longitude);
  if (Number.isFinite(pos.coords.altitude)) area.altitudeM = Math.round(pos.coords.altitude);
  return publicArea(area);
}
