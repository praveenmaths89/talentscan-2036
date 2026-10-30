import test from "node:test";
import assert from "node:assert/strict";
import {
  G,
  analyzeBalance,
  analyzeCmjSamples,
  analyzeRepeatedJumps,
  analyzeSitups,
  detectFlightWindows,
  detectTakeoffLanding,
  jumpHeightCmFromFlightTime,
  liveCue,
  normalizeSamples,
  samplingStats,
  stepSignal,
  synthesizeCmjSamples,
  synthesizeSteps
} from "../js/signal.js";
import { liveSteps, qualityOf, summarizeAttempts } from "../js/battery.js";
import { heatIndexC, publicArea, safetyFlags } from "../js/conditions.js";
import { pickVoice, scoreVoice } from "../js/audio.js";
import { lensCovered } from "../js/ppg.js";
import { sampleFromEvent } from "../js/motion.js";

function axesOnly(samples, map) {
  return samples.map((s, i) => {
    const next = map ? map(s, i) : s;
    return { t: next.t, ax: next.ax, ay: next.ay, az: next.az, gx: next.gx, gy: next.gy, gz: next.gz };
  });
}

test("iPhone and Android chest jumps are detected from magnitude", () => {
  const iphone = [];
  const fs = 60;
  for (let i = 0; i < fs * 2; i++) {
    const t = i / fs;
    let g = 1;
    if (t > 0.8 && t < 0.95) g = 2.1;
    else if (t >= 0.95 && t < 1.35) g = 0.35;
    else if (t >= 1.35 && t < 1.5) g = 3.1;
    iphone.push({ t, ax: 0.2, ay: -0.1, az: g * G, gx: 1, gy: 0, gz: 0 });
  }
  const soft = [];
  for (let i = 0; i < 50 * 2; i++) {
    const t = i / 50;
    let g = 1;
    if (t > 0.7 && t < 0.85) g = 1.7;
    else if (t >= 0.85 && t < 1.2) g = 0.72;
    else if (t >= 1.2 && t < 1.35) g = 2.4;
    soft.push({ t, ax: 0, ay: g * G, az: 0.4, gx: 0, gy: 0, gz: 0 });
  }
  const iphoneBw = iphone.map((s) => Math.hypot(s.ax, s.ay, s.az) / G);
  assert.ok(detectTakeoffLanding(iphoneBw, 60));
  const found = analyzeCmjSamples(iphone, { massKg: 55 });
  assert.equal(found.ok, true, found.reason);
  assert.ok(found.jumpHeightCm > 8, `height ${found.jumpHeightCm}`);
  const softFound = analyzeCmjSamples(soft, { massKg: 55 });
  assert.equal(softFound.ok, true, softFound.reason);
  const androidG = soft.map((s) => ({ ...s, ax: 0, ay: 0, az: Math.hypot(s.ax, s.ay, s.az) / G }));
  assert.equal(analyzeCmjSamples(androidG, { massKg: 55 }).ok, true);
});

test("g-unit and sideways phone traces still find a jump", () => {
  const base = synthesizeCmjSamples(0.42, 50);
  const sideways = axesOnly(base, (s) => ({ ...s, ax: s.az, ay: 0, az: 0 }));
  const gUnit = axesOnly(base, (s) => ({ ...s, ax: 0, ay: 0, az: s.az / G }));
  const side = analyzeCmjSamples(sideways, { massKg: 50 });
  const gee = analyzeCmjSamples(gUnit, { massKg: 50 });
  const expected = jumpHeightCmFromFlightTime(0.42);
  assert.equal(side.ok, true, side.reason);
  assert.equal(gee.ok, true, gee.reason);
  assert.ok(Math.abs(side.jumpHeightCm - expected) < 4, `side ${side.jumpHeightCm}`);
  assert.ok(Math.abs(gee.jumpHeightCm - expected) < 4, `g ${gee.jumpHeightCm}`);
  assert.equal(normalizeSamples(gUnit)[0].unit, "g");
});

test("a slow phone is rejected and a missing gravity stream is named", () => {
  const slow = [];
  for (let i = 0; i < 30; i++) {
    slow.push({ t: i * 0.1, ax: 0, ay: 0, az: i > 10 && i < 14 ? 0.4 : G, gx: 0, gy: 0, gz: 0 });
  }
  const result = analyzeCmjSamples(slow);
  assert.equal(result.ok, false);
  assert.ok(result.reason === "low_rate" || result.reason === "unclear" || result.reason === "short");
  const stats = samplingStats(slow);
  assert.ok(stats.fs < 15);
  const hidden = synthesizeCmjSamples(0.4).map((s) => ({ ...s, bw: undefined, noGravity: true, ax: 0, ay: 0, az: 0 }));
  assert.equal(analyzeCmjSamples(hidden).reason, "nograv");
});

test("sit-ups and steps use magnitude, not a single axis", () => {
  const reps = 10;
  const fs = 50;
  const seconds = 20;
  const samples = [];
  const interval = seconds / reps;
  for (let i = 0; i < seconds * fs; i++) {
    const t = i / fs;
    const phase = (t % interval) / interval;
    const hump = phase > 0.25 && phase < 0.5 ? 8 * Math.sin(((phase - 0.25) / 0.25) * Math.PI) : 0;
    samples.push({ t, ax: G + hump, ay: 0, az: 0 });
  }
  const sit = analyzeSitups(samples);
  assert.equal(sit.reps, reps);
  const steps = liveSteps(synthesizeSteps(20, 20, 50).map((s) => ({ t: s.t, ax: s.az, ay: 0, az: 0 })));
  assert.equal(steps.ok, true);
  assert.ok(steps.steps >= 8);
  assert.ok(stepSignal(synthesizeSteps(20, 20, 50)).some((v) => v > 2));
});

test("flight windows accept a chest-soft valley between two spikes", () => {
  const fs = 50;
  const bw = [];
  for (let i = 0; i < 100; i++) bw.push(1);
  for (let i = 0; i < 6; i++) bw.push(2.2);
  for (let i = 0; i < 16; i++) bw.push(0.58);
  for (let i = 0; i < 6; i++) bw.push(2.4);
  for (let i = 0; i < 40; i++) bw.push(1);
  const windows = detectFlightWindows(bw, fs);
  assert.ok(windows.length >= 1);
  assert.ok(windows[0].flightS > 0.2 && windows[0].flightS < 0.5);
});

test("live cues distinguish holding still from a jump", () => {
  const still = [];
  for (let i = 0; i < 20; i++) still.push({ t: i / 50, ax: 0, ay: 0, az: G });
  assert.equal(liveCue(still, "cmj").id, "hold");
  const jump = still.slice();
  jump.push({ t: 0.4, ax: 0, ay: 0, az: 22 });
  assert.equal(liveCue(jump, "cmj").id, "jump");
});

test("two trials keep the best and flag a sloppy pair", () => {
  const steady = summarizeAttempts([32, 34], "max");
  assert.equal(steady.value, 34);
  assert.equal(steady.consistent, true);
  assert.equal(qualityOf({ ok: true, consistent: true }), "good");
  const messy = summarizeAttempts([20, 40], "max");
  assert.equal(messy.consistent, false);
  assert.equal(qualityOf({ ok: true, unreliable: true }), "retry");
  assert.equal(qualityOf({ ok: true, sample: true, consistent: true }), "none");
});

test("voice picker prefers an Indian neural voice", () => {
  const voices = [
    { name: "English compact", lang: "en-US", localService: true },
    { name: "Google हिन्दी", lang: "hi-IN", localService: false },
    { name: "Microsoft Neerja Online (Natural)", lang: "en-IN", localService: false },
    { name: "Fred", lang: "en-US", localService: true }
  ];
  const pick = pickVoice(voices, "en");
  assert.equal(pick.name.includes("Neerja"), true);
  assert.ok(scoreVoice(voices[1], "hi") > scoreVoice(voices[2], "hi"));
  assert.equal(scoreVoice(voices[3], "hi"), -1);
});

test("finger cover, heat, and stored place drop exact coordinates", () => {
  assert.equal(lensCovered({ r: 140, g: 40, b: 20 }), true);
  assert.equal(lensCovered({ r: 80, g: 90, b: 85 }), false);
  const hi = heatIndexC(34, 60);
  assert.ok(hi > 38, `heat ${hi}`);
  const area = publicArea({ city: "Pune", state: "Maharashtra", tempC: 31, latitude: 18.5, lon: 73.8, aqi: 140 });
  assert.equal(area.city, "Pune");
  assert.equal(area.latitude, undefined);
  assert.equal(area.lon, undefined);
  assert.equal(safetyFlags({ heatIndexC: 40, aqi: 80 }).heat, true);
  assert.equal(safetyFlags(area).air, true);
});

test("a motion event keeps gravity and does not invent a body-weight channel", () => {
  const sample = sampleFromEvent(
    {
      accelerationIncludingGravity: { x: 0.2, y: 0.1, z: 9.7 },
      rotationRate: { alpha: 1, beta: 2, gamma: 3 },
      interval: 16
    },
    0.1
  );
  assert.equal(sample.noGravity, false);
  assert.equal(sample.bw, undefined);
  assert.equal(sample.az, 9.7);
  const linear = sampleFromEvent({ acceleration: { x: 0, y: 0, z: 3 } }, 0.2);
  assert.equal(linear.noGravity, true);
  const empty = sampleFromEvent({}, 0.3);
  assert.equal(empty.missing, true);
});

test("balance still rejects a hard foot-down on a normalised trace", () => {
  const samples = [];
  for (let i = 0; i < 40; i++) samples.push({ t: i / 50, ax: 0.1, ay: 0, az: G, gx: 0, gy: 0, gz: 0 });
  assert.equal(analyzeBalance(samples).ok, true);
  samples[20] = { ...samples[20], az: 30 };
  assert.equal(analyzeBalance(samples).ok, true);
  for (let i = 8; i < 14; i++) samples[i] = { ...samples[i], az: 28 };
  assert.equal(analyzeBalance(samples).reason, "foot");
  const jumps = analyzeRepeatedJumps(synthesizeCmjSamples(0.3).concat(synthesizeCmjSamples(0.28)));
  assert.equal(typeof jumps.count, "number");
});
