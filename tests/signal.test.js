import test from "node:test";
import assert from "node:assert/strict";
import {
  G,
  analyzeBalance,
  analyzeCmjSamples,
  analyzeRepeatedJumps,
  analyzeSitups,
  computeAnchoredKinematics,
  countReps,
  estimateHrBpm,
  generateDynamicTrial,
  jumpHeightCmFromFlightTime,
  linearSlope,
  mirwaldMaturityOffset,
  repeatedJumpSummary,
  rsiFromTimes,
  swayRms,
  synthesizeBalance,
  synthesizeCmjSamples,
  synthesizePpg,
  synthesizeRepeatedJumps,
  synthesizeSitups
} from "../js/signal.js";
import { provisionalPercentile } from "../js/norms.js";
import { NORMS_DISCLAIMER } from "../js/config.js";

test("jump height from flight time uses h = g t^2 / 8", () => {
  const height = jumpHeightCmFromFlightTime(0.5);
  assert.ok(Math.abs(height - (G * 0.25 * 100) / 8) < 1e-6);
  assert.equal(jumpHeightCmFromFlightTime(0), 0);
  assert.equal(jumpHeightCmFromFlightTime(-1), 0);
});

test("RSI is flight divided by contact", () => {
  assert.equal(rsiFromTimes(0.4, 0.2), 2);
  assert.equal(rsiFromTimes(0.4, 0), 0);
});

test("repeated-jump summary reports count, means, RSI, and fatigue slope", () => {
  const summary = repeatedJumpSummary([
    { heightCm: 30, flightS: 0.5, contactS: 0.25 },
    { heightCm: 28, flightS: 0.48, contactS: 0.25 },
    { heightCm: 26, flightS: 0.46, contactS: 0.25 },
    { heightCm: 24, flightS: 0.44, contactS: 0.25 }
  ]);
  assert.equal(summary.count, 4);
  assert.equal(summary.meanHeightCm, 27);
  assert.equal(summary.meanContactS, 0.25);
  assert.ok(Math.abs(summary.meanRsi - (0.5 + 0.48 + 0.46 + 0.44) / 4 / 0.25) < 1e-9);
  assert.ok(Math.abs(summary.fatigueSlope - linearSlope([0, 1, 2, 3], [30, 28, 26, 24])) < 1e-9);
  assert.ok(summary.fatigueSlope < 0);
});

test("sway RMS of a flat signal is zero and a unit square wave is 1", () => {
  assert.equal(swayRms([1, 1, 1, 1]).swayRms, 0);
  const square = swayRms([1, -1, 1, -1]);
  assert.ok(Math.abs(square.swayRms - 1) < 1e-9);
  const balance = analyzeBalance(synthesizeBalance());
  assert.equal(balance.ok, true);
  assert.ok(balance.swayRms > 0.05 && balance.swayRms < 0.5);
  const stepped = synthesizeBalance();
  stepped[10].az = 40;
  assert.equal(analyzeBalance(stepped).ok, true);
  for (let i = 12; i < 18; i++) stepped[i] = { ...stepped[i], az: 28 };
  assert.equal(analyzeBalance(stepped).reason, "foot");
});

test("rep counting finds sit-up peaks and repeated jumps", () => {
  const sit = analyzeSitups(synthesizeSitups({ reps: 12, seconds: 30, fs: 50 }));
  assert.equal(sit.reps, 12);
  assert.equal(sit.ok, true);
  const signal = [];
  for (let i = 0; i < 100; i++) signal.push(i % 10 === 5 ? 5 : 0);
  assert.equal(countReps(signal, 10, { minIntervalS: 0.5, minProminence: 1, smooth: 0 }), 10);
  const jumps = analyzeRepeatedJumps(synthesizeRepeatedJumps());
  assert.equal(jumps.ok, true);
  assert.ok(jumps.count >= 6);
  assert.ok(jumps.meanContactS > 0);
  assert.ok(jumps.meanRsi > 0);
  assert.ok(jumps.fatigueSlope < 0);
});

test("CMJ flight-time height and impulse anchor agree", () => {
  const expected = jumpHeightCmFromFlightTime(0.45);
  const live = analyzeCmjSamples(synthesizeCmjSamples(0.45), { massKg: 50 });
  assert.equal(live.ok, true);
  assert.ok(Math.abs(live.jumpHeightCm - expected) < 2.5, `height ${live.jumpHeightCm} vs ${expected}`);
  assert.ok(live.pinn);
  assert.ok(Math.abs(live.pinn.vTakeoff - live.vTakeoffTarget) < 0.35);

  const fs = 100;
  const flightTime = 0.5;
  const t0 = 0.2;
  const tTakeoff = 0.7;
  const tLanding = tTakeoff + flightTime;
  const N = 200;
  const t = Array.from({ length: N }, (_, i) => i / fs);
  const vgrf = t.map((ti) => {
    if (ti >= t0 && ti < tTakeoff) return 2;
    if (ti >= tTakeoff && ti < tLanding) return 0;
    return 1;
  });
  const kin = computeAnchoredKinematics(
    t,
    vgrf,
    vgrf.slice(),
    fs,
    { t0, tBrake: 0.4, tProp: 0.5, tTakeoff, tLanding, flightTime },
    { massKg: 70 }
  );
  assert.ok(Math.abs(kin.metrics.vTakeoff - 0.5 * G * flightTime) < 0.2);
  assert.ok(Math.abs(kin.metrics.jumpHeightCm - jumpHeightCmFromFlightTime(flightTime)) < 3);

  const trial = generateDynamicTrial({ age: 14, sex: "M", massKg: 45, stateName: "Maharashtra" }, 7);
  assert.ok(Number.isFinite(trial.metrics.jumpHeightCm));
  assert.ok(trial.metrics.peakForceBW > 1);
});

test("Mirwald offset needs sitting height and matches the boys equation", () => {
  assert.equal(mirwaldMaturityOffset({ sex: "M", age: 14, heightCm: 160, weightKg: 50 }), null);
  const offset = mirwaldMaturityOffset({
    sex: "M",
    age: 14,
    heightCm: 160,
    sittingHeightCm: 80,
    weightKg: 50
  });
  const leg = 80;
  const ratio = (50 / 160) * 100;
  const manual =
    -9.236 + 0.0002708 * (leg * 80) - 0.001663 * (14 * leg) + 0.007216 * (14 * 80) + 0.02292 * ratio;
  assert.ok(Math.abs(offset - manual) < 1e-9);
  assert.equal(
    mirwaldMaturityOffset({ sex: "M", age: 14, heightCm: 160, sittingHeightCm: 170, weightKg: 50 }),
    null
  );
});

test("heart rate from an in-memory PPG trace", () => {
  const hr = estimateHrBpm(synthesizePpg(72, 12, 30), 30);
  assert.equal(hr.ok, true);
  assert.ok(Math.abs(hr.bpm - 72) <= 3, `bpm ${hr.bpm}`);
  const flat = estimateHrBpm(new Array(400).fill(10), 30);
  assert.equal(flat.reason, "finger");
});

test("percentiles are labelled provisional and are not validated", () => {
  const row = provisionalPercentile("cmj_cm", 40, 15, "M");
  assert.equal(row.validated, false);
  assert.equal(row.label, NORMS_DISCLAIMER);
  assert.equal(row.label, "provisional norms, not validated");
  assert.ok(row.percentile > 50);
  const slow = provisionalPercentile("rt_ms", 500, 15, "F");
  const fast = provisionalPercentile("rt_ms", 200, 15, "F");
  assert.ok(fast.percentile > slow.percentile);
});
