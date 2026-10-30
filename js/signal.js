/**
 * Sensor math for KhelTara.
 * CMJ flight detection and the physics-informed impulse anchor come from the
 * earlier phone CMJ / vGRF prototype. Height shown to people is flight time:
 * h = g t^2 / 8. No video frames are stored.
 */

export const G = 9.80665;

export function jumpHeightCmFromFlightTime(flightTimeS) {
  const t = Number(flightTimeS);
  if (!Number.isFinite(t) || t <= 0) return 0;
  return ((G * t * t) / 8) * 100;
}

/** RSI = flight time / contact time. */
export function rsiFromTimes(flightTimeS, contactTimeS) {
  const flight = Number(flightTimeS);
  const contact = Number(contactTimeS);
  if (!Number.isFinite(flight) || !Number.isFinite(contact) || contact <= 0 || flight < 0) return 0;
  return flight / contact;
}

export function linearSlope(xs, ys) {
  const n = Math.min(xs?.length || 0, ys?.length || 0);
  if (n < 2) return 0;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    const x = Number(xs[i]);
    const y = Number(ys[i]);
    sx += x;
    sy += y;
    sxx += x * x;
    sxy += x * y;
  }
  const den = n * sxx - sx * sx;
  if (Math.abs(den) < 1e-12) return 0;
  return (n * sxy - sx * sy) / den;
}

export function repeatedJumpSummary(jumps) {
  const list = Array.isArray(jumps) ? jumps : [];
  if (!list.length) {
    return { count: 0, meanHeightCm: 0, meanContactS: 0, meanRsi: 0, fatigueSlope: 0 };
  }
  const heights = list.map((j) => Number(j.heightCm) || 0);
  const contacts = list.map((j) => Number(j.contactS)).filter((c) => Number.isFinite(c) && c > 0);
  const rsis = list
    .filter((j) => Number(j.contactS) > 0)
    .map((j) => rsiFromTimes(j.flightS, j.contactS));
  const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);
  return {
    count: list.length,
    meanHeightCm: mean(heights),
    meanContactS: mean(contacts),
    meanRsi: mean(rsis),
    fatigueSlope: linearSlope(heights.map((_, i) => i), heights)
  };
}

function demeanRms(values) {
  if (!values.length) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  let acc = 0;
  for (const v of values) acc += (v - mean) * (v - mean);
  return Math.sqrt(acc / values.length);
}

/**
 * Sway RMS is the root-mean-square of demeaned accelerometer axes (m/s^2).
 * Gyroscope RMS is returned beside it (device rotationRate units) and is
 * not mixed into the number, because the units differ.
 * A plain number array is treated as one accelerometer axis.
 */
export function swayRms(samples) {
  if (!samples?.length) return { accelRms: 0, gyroRms: 0, swayRms: 0 };
  if (typeof samples[0] === "number") {
    const accelRms = demeanRms(samples.map(Number));
    return { accelRms, gyroRms: 0, swayRms: accelRms };
  }
  const accelRms = Math.hypot(
    demeanRms(samples.map((s) => Number(s.ax) || 0)),
    demeanRms(samples.map((s) => Number(s.ay) || 0)),
    demeanRms(samples.map((s) => Number(s.az) || 0))
  );
  const hasGyro = samples.some((s) => s.gx != null || s.gy != null || s.gz != null);
  const gyroRms = hasGyro
    ? Math.hypot(
        demeanRms(samples.map((s) => Number(s.gx) || 0)),
        demeanRms(samples.map((s) => Number(s.gy) || 0)),
        demeanRms(samples.map((s) => Number(s.gz) || 0))
      )
    : 0;
  return { accelRms, gyroRms, swayRms: accelRms };
}

function smooth(signal, radius) {
  const out = signal.slice();
  const r = Math.max(1, radius | 0);
  for (let i = 0; i < signal.length; i++) {
    let acc = 0;
    let n = 0;
    for (let k = -r; k <= r; k++) {
      const j = i + k;
      if (j >= 0 && j < signal.length) {
        acc += signal[j];
        n++;
      }
    }
    out[i] = acc / n;
  }
  return out;
}

/** Count peaks with a minimum gap and prominence above the mean. */
export function countReps(signal, sampleRate, opts = {}) {
  if (!signal || signal.length < 3 || !(sampleRate > 0)) return 0;
  const minInterval = Math.max(1, Math.round((opts.minIntervalS ?? 0.4) * sampleRate));
  const prominence = opts.minProminence ?? 0.15;
  const radius = opts.smooth == null ? 2 : opts.smooth;
  const sm = radius > 0 ? smooth(signal.map(Number), radius) : signal.map(Number);
  const mean = sm.reduce((a, b) => a + b, 0) / sm.length;
  const peaks = [];
  for (let i = 1; i < sm.length - 1; i++) {
    if (sm[i] >= sm[i - 1] && sm[i] > sm[i + 1] && sm[i] > mean + prominence) {
      if (!peaks.length || i - peaks[peaks.length - 1] >= minInterval) peaks.push(i);
    }
  }
  return peaks.length;
}

export function median(values) {
  const nums = (values || []).map(Number).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!nums.length) return 0;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 ? nums[mid] : (nums[mid - 1] + nums[mid]) / 2;
}

/**
 * Mirwald maturity offset (years from peak height velocity).
 * Needs age, sex, standing height, sitting height, and weight.
 * Returns null when any of those are missing so the field stays skippable.
 * Boys / girls equations as published for cm, kg, and years.
 */
export function mirwaldMaturityOffset(person) {
  if (!person) return null;
  const sex = person.sex === "M" || person.sex === "F" ? person.sex : null;
  const age = Number(person.age);
  const heightCm = Number(person.heightCm);
  const sittingHeightCm = Number(person.sittingHeightCm);
  const weightKg = Number(person.weightKg);
  if (!sex) return null;
  if (![age, heightCm, sittingHeightCm, weightKg].every((v) => Number.isFinite(v) && v > 0)) return null;
  if (!(sittingHeightCm < heightCm)) return null;
  const leg = heightCm - sittingHeightCm;
  const ratio = (weightKg / heightCm) * 100;
  if (sex === "M") {
    return (
      -9.236 +
      0.0002708 * (leg * sittingHeightCm) -
      0.001663 * (age * leg) +
      0.007216 * (age * sittingHeightCm) +
      0.02292 * ratio
    );
  }
  return (
    -9.376 +
    0.0001882 * (leg * sittingHeightCm) +
    0.0022 * (age * leg) +
    0.005841 * (age * sittingHeightCm) -
    0.002658 * (age * weightKg) +
    0.07693 * ratio
  );
}

function seriesStd(values) {
  if (!values?.length) return 0;
  let mean = 0;
  for (const value of values) mean += value;
  mean /= values.length;
  let variance = 0;
  for (const value of values) variance += (value - mean) ** 2;
  return Math.sqrt(variance / values.length);
}

/**
 * Loudest 0.4 s of standing time before the push.
 * The crouch itself is not "the phone moved before the jump".
 */
export function stillnessBeforeTakeoff(values, fs, takeoffIndex) {
  const list = values || [];
  const rate = Math.max(1, Number(fs) || 1);
  const win = Math.max(5, Math.round(rate * 0.4));
  const end = Math.max(0, Math.min(list.length, Number(takeoffIndex) - Math.round(rate * 0.35)));
  if (end < 5) return seriesStd(list.slice(0, Math.max(5, Math.min(list.length, Number(takeoffIndex) || list.length))));
  if (end <= win) return seriesStd(list.slice(0, end));
  let worst = 0;
  const step = Math.max(1, Math.round(rate * 0.1));
  for (let start = 0; start + win <= end; start += step) {
    const sd = seriesStd(list.slice(start, start + win));
    if (sd > worst) worst = sd;
  }
  return worst;
}

function sampleMagnitude(sample) {
  return Math.hypot(Number(sample?.ax) || 0, Number(sample?.ay) || 0, Number(sample?.az) || 0);
}

/** A footfall is a short run of samples, not one Chromium outlier. */
export function footfall(samples) {
  const mags = [];
  for (const sample of samples || []) {
    if (sample?.missing) continue;
    mags.push(sampleMagnitude(sample));
  }
  if (mags.length < 8) return false;
  const sorted = mags.slice().sort((a, b) => a - b);
  const baseline = sorted[Math.floor(sorted.length / 2)] || 0;
  let run = 0;
  for (const mag of mags) {
    if (Math.abs(mag - baseline) > 6) {
      run += 1;
      if (run >= 4) return true;
    } else run = 0;
  }
  return false;
}

export function qcCmj({ flightS, sampleHz, stillStd, flightGyroRms }) {
  const errors = [];
  const warnings = [];
  // 15 Hz still shows a 0.25 s flight. 20 Hz used to fail normal phone WebViews.
  if (!(Number(sampleHz) >= 15)) errors.push("low_rate");
  else if (Number(sampleHz) < 25) warnings.push("low_rate");
  if (!(flightS >= 0.2 && flightS <= 0.85)) errors.push("unclear");
  // Hands on the chest are never as quiet as a lab mount.
  if (stillStd != null && stillStd > 0.9) errors.push("shake");
  else if (stillStd != null && stillStd > 0.45) warnings.push("shake");
  // rotationRate is degrees per second. 6 deg/s rejected almost every real jump.
  if (flightGyroRms != null && flightGyroRms > 220) errors.push("knees");
  return { pass: errors.length === 0, errors, warnings };
}

/**
 * Phones report accelerationIncludingGravity in m/s^2 or, more rarely, in g.
 * The quiet part of a trace sits near 1 g. Scale g-unit traces up to m/s^2.
 */
export function normalizeSamples(samples) {
  const list = Array.isArray(samples) ? samples : [];
  const mags = [];
  for (const s of list) {
    const m = Math.hypot(Number(s?.ax) || 0, Number(s?.ay) || 0, Number(s?.az) || 0);
    if (m > 0.05) mags.push(m);
  }
  if (mags.length < 5) return list.map((s) => ({ ...s }));
  const sorted = mags.slice().sort((a, b) => a - b);
  const p70 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.7))];
  const unit = p70 >= 0.55 && p70 <= 2.8 ? "g" : "mps2";
  const scale = unit === "g" ? G / p70 : 1;
  return list.map((s) => ({
    ...s,
    ax: (Number(s?.ax) || 0) * scale,
    ay: (Number(s?.ay) || 0) * scale,
    az: (Number(s?.az) || 0) * scale,
    unit
  }));
}

export function samplingStats(samples) {
  const list = samples || [];
  const fs = estimateFs(list);
  const missing = list.filter((s) => s?.missing).length;
  const noGravity = list.filter((s) => s?.noGravity).length > list.length * 0.5 && list.length > 0;
  return { fs, count: list.length, missing, noGravity };
}

/** Magnitude in body weights. Ignores which way the phone faces. */
export function magnitudeBw(sample) {
  if (sample && Number.isFinite(sample.bw)) return sample.bw;
  const mag = Math.hypot(Number(sample?.ax) || 0, Number(sample?.ay) || 0, Number(sample?.az) || 0);
  if (!(mag > 0.05)) return 1;
  return mag > 4 ? mag / G : mag;
}

export function sampleToBw(sample) {
  if (sample && Number.isFinite(sample.bw)) return sample.bw;
  const ax = Number(sample?.ax) || 0;
  const ay = Number(sample?.ay) || 0;
  const az = Number(sample?.az) || 0;
  const mag = Math.hypot(ax, ay, az);
  return mag > 0.05 ? mag / G : 1;
}

export function estimateFs(samples) {
  if (!samples || samples.length < 2) return 0;
  const dur = Number(samples[samples.length - 1].t) - Number(samples[0].t);
  if (!(dur > 0)) return 0;
  return (samples.length - 1) / dur;
}

export function resampleSeries(samples, valueFn, fs = 100) {
  if (!samples?.length) return { t: [], v: [], fs, sampleHz: 0 };
  const t0 = Number(samples[0].t) || 0;
  const t1 = Number(samples[samples.length - 1].t) || 0;
  const dur = Math.max(1 / fs, t1 - t0);
  const sampleHz = estimateFs(samples);
  const N = Math.max(2, Math.min(6000, Math.round(dur * fs)));
  const t = new Array(N);
  const v = new Array(N);
  let k = 0;
  for (let i = 0; i < N; i++) {
    const ti = (i * dur) / Math.max(1, N - 1);
    t[i] = ti;
    const target = t0 + ti;
    while (k < samples.length - 2 && Number(samples[k + 1].t) < target) k++;
    const s0 = samples[k];
    const s1 = samples[Math.min(k + 1, samples.length - 1)];
    const span = Math.max(1e-4, Number(s1.t) - Number(s0.t));
    const w = Math.max(0, Math.min(1, (target - Number(s0.t)) / span));
    const a = valueFn(s0);
    const b = valueFn(s1);
    v[i] = a + w * (b - a);
  }
  return { t, v, fs: N > 1 ? (N - 1) / dur : fs, sampleHz };
}

/**
 * Physics-informed anchor from the CMJ prototype.
 * ∫ (vGRF - 1) g dt from quiet start to takeoff = v_takeoff = ½ g t_flight.
 */
export function computeAnchoredKinematics(t, vgrfIn, rawImuBW, fs, phases, athlete = {}) {
  const dt = 1 / fs;
  const N = t.length;
  const vgrfBW = vgrfIn.slice();
  const i0 = Math.max(0, Math.min(N - 1, Math.round(phases.t0 * fs)));
  const iTo = Math.max(0, Math.min(N - 1, Math.round(phases.tTakeoff * fs)));
  const iLand = Math.max(0, Math.min(N - 1, Math.round(phases.tLanding * fs)));
  const vTakeoffTarget = 0.5 * G * phases.flightTime;
  let posImp = 0;
  let negImp = 0;
  for (let i = i0; i < iTo; i++) {
    const net = vgrfBW[i] - 1;
    if (net >= 0) posImp += net * G * dt;
    else negImp += -net * G * dt;
  }
  const alpha = (vTakeoffTarget + negImp) / Math.max(posImp, 1e-4);
  for (let i = i0; i < iTo; i++) {
    if (vgrfBW[i] > 1) vgrfBW[i] = 1 + (vgrfBW[i] - 1) * alpha;
  }
  for (let i = iTo; i < iLand; i++) vgrfBW[i] = 0;

  const vel = new Array(N).fill(0);
  const pos = new Array(N).fill(0);
  const powerRel = new Array(N).fill(0);
  for (let i = i0; i < N; i++) {
    if (i <= iTo) {
      const acc = (vgrfBW[i] - 1) * G;
      vel[i] = (i > 0 ? vel[i - 1] : 0) + acc * dt;
      pos[i] = (i > 0 ? pos[i - 1] : 0) + vel[i] * dt;
      powerRel[i] = vgrfBW[i] * G * vel[i];
    } else if (i > iTo && i < iLand) {
      const tf = (i - iTo) * dt;
      vel[i] = vel[iTo] - G * tf;
      pos[i] = pos[iTo] + vel[iTo] * tf - 0.5 * G * tf * tf;
      powerRel[i] = 0;
    } else if (i > 0) {
      vel[i] = vel[i - 1] * 0.78;
      pos[i] = pos[i - 1] * 0.8;
      powerRel[i] = vgrfBW[i] * G * vel[i];
    }
  }

  let iProp = Math.min(N - 1, Math.round((phases.tProp ?? phases.tTakeoff) * fs));
  let dipDepthM = 0;
  for (let i = i0 + 4; i < iTo; i++) {
    if (pos[i] < dipDepthM) dipDepthM = pos[i];
    if (vel[i - 1] < 0 && vel[i] >= 0) {
      iProp = i;
      break;
    }
  }

  const mass = Number(athlete.massKg);
  const hasMass = Number.isFinite(mass) && mass > 0;
  let peakForceBW = 0;
  let peakPowerRel = 0;
  for (let i = i0; i < iTo; i++) {
    if (vgrfBW[i] > peakForceBW) peakForceBW = vgrfBW[i];
    if (powerRel[i] > peakPowerRel) peakPowerRel = powerRel[i];
  }
  const vTo = vel[Math.max(0, Math.min(N - 1, iTo))];
  const jumpHeightCm = (100 * (vTo * vTo)) / (2 * G);
  const brakeMs = Math.max(0, Math.round((iProp * dt - phases.t0) * 1000));
  const propMs = Math.max(0, Math.round((phases.tTakeoff - iProp * dt) * 1000));
  const flightMs = Math.round(phases.flightTime * 1000);
  const contactMs = brakeMs + propMs;
  const rsiMod = jumpHeightCm / 100 / Math.max(contactMs / 1000, 0.15);
  return {
    fs,
    t,
    vgrfBW,
    rawImuBW,
    vel,
    pos,
    powerRel,
    vTakeoffTarget,
    metrics: {
      jumpHeightCm,
      peakForceBW,
      peakForceN: hasMass ? peakForceBW * mass * G : null,
      peakPowerRel,
      peakPowerW: hasMass ? peakPowerRel * mass : null,
      vTakeoff: vTo,
      rsiMod,
      brakeMs,
      propMs,
      flightMs,
      contactMs,
      dipDepthCm: Math.abs(dipDepthM * 100)
    }
  };
}

function gyroRmsDuring(samples, t0, tStart, tEnd) {
  const slice = samples.filter((s) => {
    if (s.gx == null && s.gy == null && s.gz == null) return false;
    const rel = Number(s.t) - t0;
    return rel >= tStart && rel <= tEnd;
  });
  if (slice.length < 3) return null;
  return swayRms(slice.map((s) => ({ ax: 0, ay: 0, az: 0, gx: s.gx, gy: s.gy, gz: s.gz }))).gyroRms;
}

/** Single CMJ from a phone held on the chest. Refuses a flat or missing trace. */
export function analyzeCmjSamples(samples, athlete = {}) {
  if (!samples || samples.length < 15) return { ok: false, reason: "short" };
  if (samples.filter((s) => s?.noGravity).length > samples.length * 0.5) {
    return { ok: false, reason: "nograv" };
  }
  samples = normalizeSamples(samples);
  const stats = samplingStats(samples);
  const series = resampleSeries(samples, sampleToBw, 100);
  const fs = series.fs;
  const dt = series.t.length > 1 ? series.t[1] - series.t[0] : 0.01;
  const N = series.v.length;
  const t = series.t;
  const rawImuBW = series.v.slice();
  let bestVar = Infinity;
  let baseBW = 1;
  const win = Math.min(50, Math.floor(N / 3));
  if (win < 5) return { ok: false, reason: "short" };
  for (let start = 0; start <= N - win; start += 10) {
    let mean = 0;
    for (let i = start; i < start + win; i++) mean += rawImuBW[i];
    mean /= win;
    let variance = 0;
    for (let i = start; i < start + win; i++) variance += (rawImuBW[i] - mean) ** 2;
    variance /= win;
    // Only a quiet window near 1 g is standing. Flight is also quiet, and must not become the baseline.
    if (variance < bestVar && mean > 0.75 && mean < 1.35) {
      bestVar = variance;
      baseBW = mean;
    }
  }
  const scale = Math.max(0.4, baseBW);
  for (let i = 0; i < N; i++) rawImuBW[i] /= scale;
  const vgrfBW = rawImuBW.slice();
  for (let i = 2; i < N - 2; i++) {
    vgrfBW[i] =
      (rawImuBW[i - 2] + 2 * rawImuBW[i - 1] + 3 * rawImuBW[i] + 2 * rawImuBW[i + 1] + rawImuBW[i + 2]) / 9;
  }
  let minBW = Infinity;
  let maxBW = 0;
  const iFrom = Math.min(15, N - 1);
  for (let i = iFrom; i < N - 5; i++) {
    if (rawImuBW[i] < minBW) minBW = rawImuBW[i];
    if (rawImuBW[i] > maxBW) maxBW = rawImuBW[i];
  }
  if (!(maxBW - minBW >= 0.12)) return { ok: false, reason: "flat", sampleHz: series.sampleHz };

  const windows = detectFlightWindows(rawImuBW, fs).filter((w) => w.flightS >= 0.18 && w.flightS <= 0.85);
  const best = windows.reduce((a, b) => (b.flightS > a.flightS ? b : a), windows[0]);
  let flightTime = 0;
  let tTakeoff = 0;
  let tLanding = 0;
  let detected = false;
  if (best) {
    tTakeoff = t[Math.min(N - 1, best.start)];
    tLanding = t[Math.min(N - 1, best.end)];
    flightTime = tLanding - tTakeoff;
    detected = flightTime >= 0.18 && flightTime <= 0.85;
  }
  if (!detected) {
    const pattern = detectTakeoffLanding(rawImuBW, fs);
    if (pattern) {
      tTakeoff = t[Math.min(N - 1, pattern.start)];
      tLanding = t[Math.min(N - 1, pattern.end)];
      flightTime = Math.max(0.18, tLanding - tTakeoff);
      detected = flightTime >= 0.18 && flightTime <= 0.85;
    }
  }
  if (!detected) {
    const restless = stillnessBeforeTakeoff(rawImuBW, fs, N);
    const reason = restless > 0.45 ? "shake" : "unclear";
    return {
      ok: false,
      reason,
      detected: false,
      sampleHz: series.sampleHz,
      stillStd: restless,
      qc: { pass: false, errors: [reason] }
    };
  }

  const t0 = Math.max(t[0] + 0.02, tTakeoff - 0.66);
  const tBrake = t0 + 0.22;
  const tProp = t0 + 0.41;
  const kin = computeAnchoredKinematics(
    t,
    vgrfBW,
    rawImuBW,
    1 / dt,
    { t0, tBrake, tProp, tTakeoff, tLanding, flightTime },
    athlete
  );
  const iTake = Math.max(0, t.findIndex((time) => time >= tTakeoff));
  const stillStd = stillnessBeforeTakeoff(rawImuBW, fs, iTake < 0 ? N : iTake);
  const flightGyroRms = gyroRmsDuring(samples, Number(samples[0].t) || 0, tTakeoff, tLanding);
  const qc = qcCmj({
    flightS: flightTime,
    sampleHz: series.sampleHz,
    stillStd,
    flightGyroRms
  });
  const jumpHeightCm = jumpHeightCmFromFlightTime(flightTime);
  return {
    ok: qc.pass,
    reason: qc.pass ? null : qc.errors[0],
    detected: true,
    flightS: flightTime,
    jumpHeightCm,
    sampleHz: series.sampleHz || stats.fs,
    stillStd,
    qc,
    pinn: kin.metrics,
    vTakeoffTarget: kin.vTakeoffTarget
  };
}

/**
 * Takeoff is a sharp drop after a push. Landing is the next spike.
 * Primary: push above 1.5 g, valley below 0.5 g, landing above 1.5 g.
 * Fallback: a smaller drop that still has a push and a landing spike.
 */
export function detectTakeoffLanding(bw, fs) {
  if (!bw?.length || !(fs > 0)) return null;
  return (
    findJumpPattern(bw, fs, { push: 1.5, drop: 0.5, land: 1.5, minFlight: 0.15 }) ||
    findJumpPattern(bw, fs, { push: 1.25, drop: 0.8, land: 1.3, minFlight: 0.16, fromPeak: 0.7 })
  );
}

function findJumpPattern(bw, fs, opts) {
  const minFlight = Math.max(3, Math.round(opts.minFlight * fs));
  const maxFlight = Math.round(0.85 * fs);
  const look = Math.round(0.5 * fs);
  for (let i = 1; i < bw.length - minFlight; i++) {
    if (bw[i] < opts.push || bw[i] < bw[i - 1]) continue;
    const searchEnd = Math.min(bw.length - 1, i + look);
    let dropAt = -1;
    for (let j = i + 1; j <= searchEnd; j++) {
      const fell = bw[j] < opts.drop;
      const fromPeak = opts.fromPeak && bw[i] - bw[j] >= opts.fromPeak && bw[j] < 0.95;
      if (fell || fromPeak) {
        dropAt = j;
        break;
      }
    }
    if (dropAt < 0) continue;
    let end = dropAt;
    const ceiling = opts.drop + 0.2;
    while (end < bw.length && bw[end] < ceiling) end++;
    const flight = end - dropAt;
    if (flight < minFlight || flight > maxFlight) continue;
    let spike = 0;
    const spikeEnd = Math.min(bw.length, end + Math.round(0.25 * fs));
    for (let s = Math.max(end - 1, dropAt); s < spikeEnd; s++) if (bw[s] > spike) spike = bw[s];
    if (spike < opts.land) continue;
    return { start: dropAt, end, flightS: flight / fs, spike, push: bw[i] };
  }
  return null;
}

export function detectFlightWindows(bw, fs) {
  if (!bw?.length || !(fs > 0)) return [];
  let minBW = Infinity;
  let maxBW = 0;
  for (const v of bw) {
    if (v < minBW) minBW = v;
    if (v > maxBW) maxBW = v;
  }
  // A chest-held phone often only falls to ~0.6–0.75 g, not true zero.
  const thresh = Math.min(0.82, Math.max(0.5, minBW + 0.3));
  const minLen = Math.max(3, Math.round(0.16 * fs));
  const maxLen = Math.round(0.85 * fs);
  const spikeN = Math.max(2, Math.round(0.12 * fs));
  const windows = [];
  let start = -1;
  const close = (end) => {
    if (start < 0) return;
    const len = end - start;
    if (len >= minLen && len <= maxLen) {
      let sum = 0;
      let valley = Infinity;
      for (let j = start; j < end; j++) {
        sum += bw[j];
        if (bw[j] < valley) valley = bw[j];
      }
      const mean = sum / len;
      let spike = 0;
      for (let j = Math.max(0, start - spikeN); j < start; j++) if (bw[j] > spike) spike = bw[j];
      for (let j = end; j < Math.min(bw.length, end + spikeN); j++) if (bw[j] > spike) spike = bw[j];
      // Need a real unloading, or a takeoff/landing spike beside the valley.
      if (mean < 0.74 || valley < 0.62 || spike > 1.35) {
        windows.push({ start, end, flightS: len / fs, mean, valley, spike });
      }
    }
    start = -1;
  };
  for (let i = 0; i < bw.length; i++) {
    if (bw[i] < thresh) {
      if (start < 0) start = i;
    } else close(i);
  }
  close(bw.length);
  return windows;
}

/** Last moments of a trace, for on-screen cues. */
export function liveCue(samples, kind = "cmj") {
  const list = normalizeSamples(samples || []);
  if (list.length < 3) return { id: "wait" };
  const tail = list.slice(-Math.max(3, Math.min(list.length, 12)));
  const bw = tail.map((s) => (Number.isFinite(s.bw) ? s.bw : Math.hypot(s.ax, s.ay, s.az) / G));
  const mean = bw.reduce((a, b) => a + b, 0) / bw.length;
  let variance = 0;
  for (const v of bw) variance += (v - mean) ** 2;
  const std = Math.sqrt(variance / bw.length);
  const peak = Math.max(...bw);
  if (kind === "ppg") return { id: "cover" };
  if (peak > 1.55) return { id: kind === "cmj" || kind === "repeat" ? "jump" : "move" };
  if (std < 0.12 && mean > 0.7 && mean < 1.35) return { id: "hold" };
  return { id: "keep" };
}

export function stepSignal(samples) {
  const norm = normalizeSamples(samples || []);
  const mags = norm.map((s) => Math.hypot(Number(s.ax) || 0, Number(s.ay) || 0, Number(s.az) || 0));
  const med = median(mags.filter((m) => m > 0));
  return mags.map((m) => m - (med || 0));
}

export function analyzeRepeatedJumps(samples, opts = {}) {
  const minCount = opts.minCount ?? 3;
  if (!samples || samples.length < 15) return { ok: false, reason: "short", count: 0 };
  if (samples.filter((s) => s?.noGravity).length > samples.length * 0.5) {
    return { ok: false, reason: "nograv", count: 0 };
  }
  samples = normalizeSamples(samples);
  const series = resampleSeries(samples, sampleToBw, 100);
  let bestVar = Infinity;
  let base = 1;
  const win = Math.min(40, Math.floor(series.v.length / 4));
  if (win >= 5) {
    for (let start = 0; start <= series.v.length - win; start += 8) {
      let mean = 0;
      for (let i = start; i < start + win; i++) mean += series.v[i];
      mean /= win;
      let variance = 0;
      for (let i = start; i < start + win; i++) variance += (series.v[i] - mean) ** 2;
      variance /= win;
      if (variance < bestVar && mean > 0.75 && mean < 1.35) {
        bestVar = variance;
        base = mean;
      }
    }
  }
  const bw = series.v.map((v) => v / Math.max(0.4, base));
  const windows = detectFlightWindows(bw, series.fs);
  const jumps = windows.map((w, i) => {
    const contactS = i === 0 ? 0 : (w.start - windows[i - 1].end) / series.fs;
    return {
      flightS: w.flightS,
      heightCm: jumpHeightCmFromFlightTime(w.flightS),
      contactS
    };
  });
  const summary = repeatedJumpSummary(jumps);
  const ok = summary.count >= minCount;
  return {
    ok,
    reason: ok ? null : "lost",
    sampleHz: series.sampleHz,
    ...summary,
    jumps
  };
}

export function analyzeBalance(samples, opts = {}) {
  if (!samples || samples.length < 8) return { ok: false, reason: "short", swayRms: 0, gyroRms: 0 };
  samples = normalizeSamples(samples);
  const stats = samplingStats(samples);
  if (stats.count > 20 && stats.fs > 0 && stats.fs < 12) {
    return { ok: false, reason: "low_rate", swayRms: 0, gyroRms: 0, sampleHz: stats.fs };
  }
  const sway = swayRms(samples);
  let foot = Boolean(opts.footTouched);
  if (!foot) foot = footfall(samples);
  return {
    ok: !foot,
    reason: foot ? "foot" : null,
    swayRms: sway.swayRms,
    accelRms: sway.accelRms,
    gyroRms: sway.gyroRms,
    foot
  };
}

export function analyzeSitups(samples) {
  if (!samples || samples.length < 8) return { ok: false, reason: "short", reps: 0 };
  samples = normalizeSamples(samples);
  const fs = Math.max(5, estimateFs(samples) || 50);
  if (samples.length > 20 && fs < 12) return { ok: false, reason: "low_rate", reps: 0, sampleHz: fs };
  // Magnitude, not one axis, so the phone can face the chest or the sky.
  const signal = samples.map((s) => {
    if (Number.isFinite(s.bw) && (s.ax == null || s.ax === 0) && (s.ay == null || s.ay === 0) && s.az == null) {
      return s.bw;
    }
    const mag = Math.hypot(Number(s.ax) || 0, Number(s.ay) || 0, Number(s.az) || 0);
    return mag > 0.05 ? mag : Number(s.az) || 0;
  });
  const reps = countReps(signal, fs, { minIntervalS: 0.45, minProminence: 0.8 });
  return { ok: reps >= 1, reason: reps >= 1 ? null : "small", reps, sampleHz: fs };
}

/** Fingertip green-channel series already in memory. Nothing photographic is kept. */
export function estimateHrBpm(series, sampleRateHz) {
  const fs = Number(sampleRateHz);
  if (!series || series.length < 30 || !(fs >= 8)) return { ok: false, reason: "short", bpm: null };
  const mean = series.reduce((a, b) => a + b, 0) / series.length;
  let variance = 0;
  const x = series.map((v) => {
    const d = v - mean;
    variance += d * d;
    return d;
  });
  variance /= series.length;
  const amp = Math.sqrt(variance);
  if (!(amp > 0.4)) return { ok: false, reason: "finger", bpm: null };
  const minLag = Math.max(2, Math.round((fs * 60) / 180));
  const maxLag = Math.min(x.length - 2, Math.round((fs * 60) / 40));
  let bestLag = minLag;
  let best = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let acc = 0;
    for (let i = 0; i < x.length - lag; i++) acc += x[i] * x[i + lag];
    if (acc > best) {
      best = acc;
      bestLag = lag;
    }
  }
  const bpm = (60 * fs) / bestLag;
  if (!(bpm >= 40 && bpm <= 180)) return { ok: false, reason: "finger", bpm: null };
  return { ok: true, reason: null, bpm };
}

export function detectMovementOnset(samples, beepT, delta = 0.35) {
  if (!samples?.length) return null;
  const before = samples.filter((s) => Number(s.t) < beepT).slice(0, 40);
  const base = before.length
    ? before.reduce((a, s) => a + sampleToBw(s), 0) / before.length
    : 1;
  for (const s of samples) {
    if (Number(s.t) >= beepT && Math.abs(sampleToBw(s) - base) > delta) return Number(s.t);
  }
  return null;
}

export function sprintResult({ beepT, finishT, onsetT, gpsDistanceM, gpsAccuracyM }) {
  if (!(Number(finishT) > Number(beepT))) return { ok: false, reason: "sprint" };
  const timeS = Number(finishT) - Number(beepT);
  const reactionS = onsetT == null ? null : Number(onsetT) - Number(beepT);
  const gpsOk =
    Number.isFinite(gpsDistanceM) &&
    gpsDistanceM >= 20 &&
    (!Number.isFinite(gpsAccuracyM) || gpsAccuracyM <= 20);
  const ok = timeS >= 2.5 && timeS <= 20;
  return {
    ok,
    reason: ok ? null : "sprint",
    timeS,
    reactionS,
    gpsDistanceM: Number.isFinite(gpsDistanceM) ? gpsDistanceM : null,
    gpsOk
  };
}

export function shuttleResult(turnTimes, beepT) {
  const turns = (turnTimes || []).map(Number).filter((t) => t > beepT).slice(0, 4);
  if (turns.length < 4) return { ok: false, reason: "shuttle", turns: turns.length };
  const timeS = turns[3] - Number(beepT);
  const ok = timeS >= 4 && timeS <= 40;
  return { ok, reason: ok ? null : "shuttle", timeS, turns: 4 };
}

const STATE_FACTORS = {
  Haryana: 1.06,
  Punjab: 1.05,
  Maharashtra: 1.03,
  "Other India": 1
};

/** Seeded practice trace used by the original simulator. Explicit opt-in only. */
export function generateDynamicTrial(athlete = {}, seed = 1) {
  let s = seed >>> 0 || 1;
  const rand = () => {
    s = (1664525 * s + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const fs = 100;
  const dt = 1 / fs;
  const N = Math.round(2.1 * fs);
  const maturity = 1 / (1 + Math.exp(-((athlete.age || 14) - 13.5) / 2.4));
  const sexFactor = athlete.sex === "F" ? 0.83 : 1;
  const stateFactor = STATE_FACTORS[athlete.stateName] || 1;
  const rand1 = (rand() - 0.46) * 0.14;
  const targetHeightM = Math.max(0.16, Math.min(0.68, (0.21 + 0.22 * maturity) * sexFactor * stateFactor * (1 + rand1)));
  const flightTime = Math.sqrt((8 * targetHeightM) / G);
  const t0 = 0.36;
  const tProp = t0 + 0.4;
  const tTakeoff = tProp + 0.26;
  const tLanding = tTakeoff + flightTime;
  const t = new Array(N);
  const vgrfBW = new Array(N);
  for (let i = 0; i < N; i++) {
    const ti = i * dt;
    t[i] = ti;
    let f = 1;
    if (ti >= t0 && ti < tProp) f = 1.8;
    else if (ti >= tProp && ti < tTakeoff) f = 2.4;
    else if (ti >= tTakeoff && ti < tLanding) f = 0;
    else if (ti >= tLanding) f = 1.2;
    vgrfBW[i] = f;
  }
  return computeAnchoredKinematics(
    t,
    vgrfBW,
    vgrfBW.slice(),
    fs,
    { t0, tBrake: t0 + 0.2, tProp, tTakeoff, tLanding, flightTime },
    athlete
  );
}

export function synthesizeCmjSamples(flightS = 0.45, fs = 100) {
  const dt = 1 / fs;
  const samples = [];
  let i = 0;
  const push = (bw, n) => {
    for (let k = 0; k < n; k++, i++) {
      const ripple = ((k % 5) - 2) * 0.004;
      samples.push({
        t: i * dt,
        bw: bw + ripple,
        ax: 0,
        ay: 0,
        az: (bw + ripple) * G,
        gx: 0,
        gy: 0,
        gz: 0.05
      });
    }
  };
  push(1, Math.round(0.9 * fs));
  push(2.3, Math.round(0.22 * fs));
  push(0.06, Math.round(flightS * fs));
  push(2.6, Math.round(0.1 * fs));
  push(1, Math.round(0.5 * fs));
  return samples;
}

export function synthesizeRepeatedJumps({
  count = 8,
  fs = 100,
  flight0 = 0.4,
  contactS = 0.22,
  drop = 0.015
} = {}) {
  const samples = [];
  let t = 0;
  const dt = 1 / fs;
  const add = (bw, dur) => {
    const n = Math.max(1, Math.round(dur * fs));
    for (let i = 0; i < n; i++, t += dt) {
      samples.push({ t, bw, ax: 0, ay: 0, az: bw * G, gx: 0, gy: 0, gz: 0 });
    }
  };
  add(1, 0.5);
  for (let j = 0; j < count; j++) {
    const flight = Math.max(0.18, flight0 - j * drop);
    add(2.1, 0.1);
    add(0.08, flight);
    add(1.25, contactS);
  }
  add(1, 0.3);
  return samples;
}

export function synthesizeBalance({ fs = 50, seconds = 20, amp = 0.15 } = {}) {
  const samples = [];
  const n = Math.round(seconds * fs);
  for (let i = 0; i < n; i++) {
    const t = i / fs;
    samples.push({
      t,
      ax: amp * Math.sin(2 * Math.PI * 0.4 * t),
      ay: amp * 0.4 * Math.cos(2 * Math.PI * 0.25 * t),
      az: G,
      gx: 0.02,
      gy: 0,
      gz: 0.04 * Math.sin(2 * Math.PI * 0.4 * t)
    });
  }
  return samples;
}

export function synthesizeSitups({ reps = 12, fs = 50, seconds = 30 } = {}) {
  const samples = [];
  const interval = seconds / reps;
  const n = Math.round(seconds * fs);
  for (let i = 0; i < n; i++) {
    const t = i / fs;
    const phase = (t % interval) / interval;
    const hump = phase > 0.25 && phase < 0.5 ? 8 * Math.sin(((phase - 0.25) / 0.25) * Math.PI) : 0;
    samples.push({ t, az: G + hump, ax: 0, ay: 0, bw: (G + hump) / G });
  }
  return samples;
}

export function synthesizePpg(bpm, seconds, fs) {
  const series = [];
  const freq = bpm / 60;
  const n = Math.round(seconds * fs);
  for (let i = 0; i < n; i++) {
    const t = i / fs;
    series.push(120 + 8 * Math.sin(2 * Math.PI * freq * t));
  }
  return series;
}

export function synthesizeSteps(count, seconds, fs = 50) {
  const samples = [];
  const interval = seconds / count;
  const n = Math.round(seconds * fs);
  for (let i = 0; i < n; i++) {
    const t = i / fs;
    const phase = (t % interval) / interval;
    const hump = phase > 0.1 && phase < 0.35 ? 6 * Math.sin(((phase - 0.1) / 0.25) * Math.PI) : 0;
    samples.push({ t, az: G + hump, ax: 0, ay: hump * 0.2, bw: (G + hump) / G });
  }
  return samples;
}
