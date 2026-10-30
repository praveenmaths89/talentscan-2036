import { ENABLE_OUTDOOR_TESTS } from "./config.js";
import { provisionalPercentile } from "./norms.js";
import {
  analyzeBalance,
  analyzeCmjSamples,
  analyzeRepeatedJumps,
  analyzeSitups,
  countReps,
  estimateFs,
  estimateHrBpm,
  median,
  sprintResult,
  shuttleResult,
  stepSignal,
  synthesizeBalance,
  synthesizeCmjSamples,
  synthesizePpg,
  synthesizeRepeatedJumps,
  synthesizeSitups,
  synthesizeSteps
} from "./signal.js";

export const CORE_TESTS = ["cmj", "repeat", "balance", "situp", "react", "step"];
export const OUTDOOR_TESTS = ["sprint", "shuttle"];

export function visibleTests() {
  return ENABLE_OUTDOOR_TESTS ? CORE_TESTS.concat(OUTDOOR_TESTS) : CORE_TESTS.slice();
}

function pct(key, value, athlete) {
  if (!athlete) return null;
  return provisionalPercentile(key, value, athlete.age, athlete.sex);
}

function cmjFrom(raw, sample) {
  if (!raw?.ok) return { ok: false, reason: raw?.reason || "unclear", sample };
  return {
    ok: true,
    sample,
    reason: null,
    jumpHeightCm: raw.jumpHeightCm,
    flightS: raw.flightS,
    pinn: raw.pinn || null,
    trials: [{ jumpHeightCm: raw.jumpHeightCm, flightS: raw.flightS }]
  };
}

export function sampleCmj() {
  return cmjFrom(analyzeCmjSamples(synthesizeCmjSamples(0.45), { massKg: 50 }), true);
}

export function sampleCmjTrio() {
  const trials = [0.42, 0.46, 0.44].map((flight) =>
    cmjFrom(analyzeCmjSamples(synthesizeCmjSamples(flight), { massKg: 50 }), true)
  );
  return bestCmj(trials);
}

export function liveCmj(samples, athlete) {
  return cmjFrom(analyzeCmjSamples(samples, athlete), false);
}

export function bestCmj(trials) {
  const good = (trials || []).filter((t) => t && t.ok !== false && Number.isFinite(t.jumpHeightCm));
  if (!good.length) return null;
  const best = good.reduce((a, b) => (b.jumpHeightCm > a.jumpHeightCm ? b : a));
  return {
    ok: true,
    sample: good.every((t) => t.sample),
    jumpHeightCm: best.jumpHeightCm,
    flightS: best.flightS,
    pinn: best.pinn || null,
    trials: good.map((t) => ({ jumpHeightCm: t.jumpHeightCm, flightS: t.flightS })),
    percentileKey: "cmj_cm",
    percentileValue: best.jumpHeightCm
  };
}

export function sampleRepeat() {
  const raw = analyzeRepeatedJumps(synthesizeRepeatedJumps(), { minCount: 3 });
  return { ...raw, sample: true };
}

export function liveRepeat(samples) {
  return { ...analyzeRepeatedJumps(samples, { minCount: 3 }), sample: false };
}

export function sampleBalance() {
  const left = analyzeBalance(synthesizeBalance({ amp: 0.12 }));
  const right = analyzeBalance(synthesizeBalance({ amp: 0.16 }));
  return combineBalance(left, right, true);
}

export function combineBalance(left, right, sample) {
  if (!left?.ok || !right?.ok) {
    return { ok: false, reason: left?.reason || right?.reason || "foot", sample, left, right };
  }
  const swayRms = (left.swayRms + right.swayRms) / 2;
  return {
    ok: true,
    sample,
    swayRms,
    gyroRms: (left.gyroRms + right.gyroRms) / 2,
    left: left.swayRms,
    right: right.swayRms,
    percentileKey: "sway",
    percentileValue: swayRms
  };
}

export function sampleSitup() {
  const raw = analyzeSitups(synthesizeSitups({ reps: 12 }));
  return { ...raw, sample: true, percentileKey: "situps", percentileValue: raw.reps };
}

export function liveSitup(samples) {
  const raw = analyzeSitups(samples);
  return { ...raw, sample: false, percentileKey: "situps", percentileValue: raw.reps };
}

export function reactionSummary(timesMs, sample = false) {
  const clean = (timesMs || []).map(Number).filter((n) => n >= 80 && n <= 1500);
  if (clean.length < 3) return { ok: false, reason: "early", sample, medianMs: null };
  const medianMs = median(clean);
  return {
    ok: true,
    sample,
    medianMs,
    timesMs: clean,
    percentileKey: "rt_ms",
    percentileValue: medianMs
  };
}

export function tapSummary(count, seconds = 10, sample = false) {
  const taps = Math.max(0, Number(count) || 0);
  const per10 = seconds > 0 ? (taps * 10) / seconds : taps;
  return {
    ok: taps >= 5,
    reason: taps >= 5 ? null : "small",
    sample,
    taps,
    tapsPer10s: per10,
    percentileKey: "taps",
    percentileValue: per10
  };
}

export function sampleReact() {
  const reaction = reactionSummary([260, 280, 300, 240, 310], true);
  const taps = tapSummary(58, 10, true);
  return { ok: reaction.ok && taps.ok, sample: true, reaction, taps };
}

export function sampleStep() {
  const samples = synthesizeSteps(40, 20, 50);
  const fs = estimateFs(samples) || 50;
  const steps = countReps(
    samples.map((s) => s.az),
    fs,
    { minIntervalS: 0.35, minProminence: 0.8 }
  );
  const pre = estimateHrBpm(synthesizePpg(72, 12, 30), 30);
  const post = estimateHrBpm(synthesizePpg(108, 12, 30), 30);
  return {
    ok: steps >= 8 && pre.ok && post.ok,
    sample: true,
    steps,
    preBpm: pre.bpm,
    postBpm: post.bpm,
    percentileKey: "steps",
    percentileValue: steps
  };
}

export function liveSteps(samples) {
  const fs = estimateFs(samples) || 50;
  if (samples?.length > 20 && fs < 12) return { steps: 0, ok: false, reason: "low_rate", sampleHz: fs };
  const signal = stepSignal(samples);
  const steps = countReps(signal, fs, { minIntervalS: 0.35, minProminence: 1.2 });
  return { steps, ok: steps >= 8, reason: steps >= 8 ? null : "step", sampleHz: fs };
}

/** Best, mean, and whether two or more trials agree within 25%. */
export function summarizeAttempts(values, pick = "max") {
  const nums = (values || []).map(Number).filter((n) => Number.isFinite(n));
  if (!nums.length) return { value: null, mean: null, consistent: false, spread: null, count: 0, unreliable: true };
  const mean = nums.reduce((a, b) => a + b, 0) / nums.length;
  const spread = nums.length < 2 ? null : (Math.max(...nums) - Math.min(...nums)) / Math.max(1e-6, Math.abs(mean));
  const consistent = nums.length >= 2 && spread <= 0.25;
  let value = mean;
  if (pick === "max") value = Math.max(...nums);
  if (pick === "min") value = Math.min(...nums);
  return { value, mean, consistent, spread, count: nums.length, unreliable: !consistent };
}

export function qualityOf(result) {
  if (!result || result.skipped || result.sample) return "none";
  if (!result.ok || result.unreliable || result.consistent === false || result.quality === "retry") return "retry";
  return "good";
}

export function withPercentile(result, athlete) {
  if (!result || !result.percentileKey) return result;
  return { ...result, percentile: pct(result.percentileKey, result.percentileValue, athlete) };
}

export function attachPercentiles(tests, athlete) {
  const out = {};
  for (const [id, result] of Object.entries(tests || {})) {
    if (!result) continue;
    if (id === "cmj" && result.jumpHeightCm != null) {
      out[id] = { ...result, percentile: pct("cmj_cm", result.jumpHeightCm, athlete) };
    } else if (id === "repeat") {
      out[id] = {
        ...result,
        percentile: pct("repeat_count", result.count, athlete),
        rsiPercentile: pct("rsi", result.meanRsi, athlete)
      };
    } else if (id === "react" && result.reaction) {
      out[id] = {
        ...result,
        reaction: { ...result.reaction, percentile: pct("rt_ms", result.reaction.medianMs, athlete) },
        taps: result.taps ? { ...result.taps, percentile: pct("taps", result.taps.tapsPer10s, athlete) } : result.taps
      };
    } else if (result.percentileKey) {
      out[id] = withPercentile(result, athlete);
    } else if (id === "sprint") {
      out[id] = { ...result, percentile: pct("sprint_s", result.timeS, athlete) };
    } else if (id === "shuttle") {
      out[id] = { ...result, percentile: pct("shuttle_s", result.timeS, athlete) };
    } else out[id] = result;
  }
  return out;
}

export function coreComplete(tests) {
  return CORE_TESTS.every((id) => tests?.[id] && (tests[id].ok || tests[id].skipped));
}

export function anyQcPass(tests) {
  return CORE_TESTS.some((id) => tests?.[id]?.ok && !tests[id].sample && !tests[id].skipped);
}

export { sprintResult, shuttleResult, estimateHrBpm };
