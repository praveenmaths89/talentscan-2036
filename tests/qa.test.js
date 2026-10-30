import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { clipFailureShouldSpeak, hasVoiceClip, scoreVoice } from "../js/audio.js";
import { retriesCapped, shouldHoldStage, stepQuality, tapSummary } from "../js/battery.js";
import { placeLabel } from "../js/conditions.js";
import { pageDir } from "../js/i18n.js";
import { enableTorch, measureHeartRate, openCamera } from "../js/ppg.js";
import { resolveMotionPermission } from "../js/motion.js";
import {
  analyzeBalance,
  analyzeCmjSamples,
  shuttleResult,
  sprintResult,
  synthesizeCmjSamples
} from "../js/signal.js";
import { resumeTarget } from "../js/store.js";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("large text keeps Next on screen and the stepper at least 44px", () => {
  const css = read("../styles.css");
  const app = read("../js/app.js");
  assert.match(css, /\.stepper button \{[^}]*min-width:\s*48px/s);
  assert.match(css, /\.stepper button \{[^}]*min-height:\s*48px/s);
  assert.match(css, /\.icon-btn \{[^}]*min-height:\s*48px/s);
  assert.match(app, /class="sticky-cta"/);
  assert.match(app, /data-act="onboard-next"/);
  const age = app.slice(app.indexOf('step === "age"'), app.indexOf('step === "body"'));
  assert.equal(age.includes("c0.script"), false);
  assert.match(age, /onboard\.age/);
});

test("a stalled heart-rate camera still ends and the lens is stopped", async () => {
  const previousFrame = globalThis.requestAnimationFrame;
  let stopped = 0;
  const devices = {
    getUserMedia: async () => ({
      getVideoTracks: () => [{ stop() { stopped += 1; }, applyConstraints: async () => {}, getCapabilities: () => ({}) }],
      getTracks: () => [{ stop() { stopped += 1; } }]
    })
  };
  globalThis.requestAnimationFrame = () => 0;
  const video = { readyState: 0, play: async () => {} };
  const canvas = { getContext: () => ({ drawImage() {}, getImageData: () => ({ data: new Uint8ClampedArray(16) }), clearRect() {} }) };
  try {
    const result = await measureHeartRate(video, canvas, 1000, null, devices);
    assert.equal(result.ok, false);
    assert.equal(result.reason, "finger");
    assert.ok(stopped > 0);
  } finally {
    globalThis.requestAnimationFrame = previousFrame;
  }
});

test("countdown clips are not fetched for unfinished languages and AbortError is not a missing file", () => {
  assert.equal(hasVoiceClip("en"), true);
  assert.equal(hasVoiceClip("hi"), true);
  assert.equal(hasVoiceClip("ur"), false);
  assert.equal(hasVoiceClip("ta"), false);
  assert.equal(clipFailureShouldSpeak({ name: "AbortError" }), false);
  assert.equal(clipFailureShouldSpeak({ missing: true }), true);
  const app = read("../js/app.js");
  assert.match(app, /ui\.flow\.count = n/);
  assert.match(app, /ui\.flow\.count = t\("coach\.go"\)/);
});

test("a short sprint or shuttle is not described as a bad jump", () => {
  const sprint = sprintResult({ beepT: 0, finishT: 0.4, onsetT: 0.1 });
  assert.equal(sprint.ok, false);
  assert.equal(sprint.reason, "sprint");
  assert.equal(sprintResult({ beepT: 0, finishT: 4.2, onsetT: 0.2 }).ok, true);
  const shuttle = shuttleResult([0.4, 0.8], 0);
  assert.equal(shuttle.reason, "shuttle");
  assert.equal(shuttleResult([1.2, 2.5, 3.8, 5.1], 0).ok, true);
  const en = JSON.parse(read("../locales/en.json"));
  assert.match(en["err.sprint.quick"], /too quick/i);
  assert.doesNotMatch(en["err.sprint.quick"], /jump/i);
  assert.equal(retriesCapped(2), true);
  assert.equal(retriesCapped(1), false);
  const app = read("../js/app.js");
  const alertAt = app.indexOf('class="error" role="alert"');
  const stepsAt = app.indexOf('<ol class="steps">');
  assert.ok(alertAt > 0 && alertAt < stepsAt);
});

test("a bad practice is blocked and early movement is scored before takeoff", () => {
  assert.equal(shouldHoldStage({ id: "practice", kind: "cmj" }, { ok: false, reason: "unclear" }), true);
  assert.equal(shouldHoldStage({ id: "ppg1", kind: "ppg" }, { ok: false, reason: "finger" }), false);
  const quiet = analyzeCmjSamples(synthesizeCmjSamples(0.45), { massKg: 50 });
  assert.equal(quiet.ok, true);
  const early = synthesizeCmjSamples(0.45);
  for (let i = 0; i < 45; i++) {
    early[i].az = i % 2 ? 1 : 24;
    early[i].bw = early[i].az / 9.81;
  }
  const moved = analyzeCmjSamples(early, { massKg: 50 });
  assert.equal(moved.ok, false);
  assert.equal(moved.reason, "shake");
  const noisy = [];
  for (let i = 0; i < 90; i++) noisy.push({ t: i / 50, ax: 0, ay: 0, az: i % 2 ? 1 : 22, gx: 0, gy: 0, gz: 0 });
  assert.equal(analyzeCmjSamples(noisy).reason, "shake");
});

test("one accelerometer spike is not a foot coming down", () => {
  const samples = [];
  for (let i = 0; i < 50; i++) samples.push({ t: i / 50, ax: 0.08 * Math.sin(i / 3), ay: 0.02, az: 9.8, gx: 0, gy: 0, gz: 0 });
  samples[20] = { ...samples[20], az: 40 };
  assert.equal(analyzeBalance(samples).ok, true);
  for (let i = 30; i < 36; i++) samples[i] = { ...samples[i], az: 30 };
  assert.equal(analyzeBalance(samples).reason, "foot");
});

test("an unfinished right-to-left pack does not flip the page", () => {
  assert.equal(pageDir({ complete: false, dir: "rtl" }), "ltr");
  assert.equal(pageDir({ complete: true, dir: "rtl" }), "rtl");
  assert.equal(pageDir({ complete: true, dir: "ltr" }), "ltr");
  const en = JSON.parse(read("../locales/en.json"));
  assert.equal(en["lang.englishNow"], "English for now");
});

test("missing heart rate does not mark steps as retry, and taps have their own error", () => {
  const skipped = stepQuality(true, false);
  assert.equal(skipped.quality, "good");
  assert.equal(skipped.heartSkipped, true);
  assert.equal(skipped.unreliable, false);
  assert.equal(stepQuality(false, false).quality, "retry");
  assert.equal(tapSummary(2, 10, false).reason, "taps");
  const en = JSON.parse(read("../locales/en.json"));
  assert.match(en["err.tap.small"], /tap/i);
  assert.doesNotMatch(en["err.tap.small"], /sit-up/i);
});

test("a saved mid-test resume is restored and a finished test is not", () => {
  const mid = resumeTarget({ inProgress: { resume: { id: "cmj", index: 1, parts: [{ ok: true }] } } }, 3);
  assert.equal(mid.id, "cmj");
  assert.equal(mid.index, 1);
  assert.equal(resumeTarget({ inProgress: { resume: { id: "cmj", index: 3, parts: [] } } }, 3), null);
  assert.match(read("../js/app.js"), /restoreResume\(\)/);
});

test("the home line is plain and a repeated place name is shown once", () => {
  const en = JSON.parse(read("../locales/en.json"));
  assert.equal(en["demo.banner"], "Saved on this phone.");
  assert.doesNotMatch(en["demo.banner"], /backend|Demo mode/i);
  assert.equal(placeLabel({ city: "New Delhi", district: "Delhi", state: "Delhi" }), "New Delhi, Delhi");
  assert.equal(placeLabel({ city: "Pune", district: "Pune", state: "Maharashtra" }), "Pune, Maharashtra");
});

test("Android motion, torch, voices, and autoplay have a phone path", async () => {
  assert.equal(await resolveMotionPermission(null, async () => { throw new Error("orientation"); }), "granted");
  assert.equal(await resolveMotionPermission(async () => "denied", null), "denied");
  const track = {
    calls: [],
    getCapabilities() { return {}; },
    applyConstraints(opts) {
      this.calls.push(opts);
      if (opts.advanced) throw new Error("samsung");
      return Promise.resolve();
    }
  };
  assert.equal(await enableTorch(track), true);
  assert.equal(track.calls.length, 2);
  let tries = 0;
  const stream = await openCamera({
    getUserMedia() {
      tries += 1;
      if (tries === 1) throw new Error("OverconstrainedError");
      return Promise.resolve({ id: "cam" });
    }
  });
  assert.equal(stream.id, "cam");
  assert.equal(tries, 2);
  const samsung = { name: "Samsung Hindi", lang: "hi-IN", localService: true };
  const generic = { name: "English", lang: "en-US", localService: true };
  assert.ok(scoreVoice(samsung, "hi") > scoreVoice(generic, "hi"));
  assert.ok(scoreVoice({ name: "Google हिन्दी", lang: "hi-IN", localService: false }, "hi") > scoreVoice(samsung, "hi"));
  const markup = read("../js/demos.js");
  assert.match(markup, /playsinline/);
  assert.match(markup, /x5-playsinline/);
  assert.match(markup, /muted/);
});

test("the script promises two scored jumps and does not call the whole check five minutes", () => {
  const en = JSON.parse(read("../locales/en.json"));
  const hi = JSON.parse(read("../locales/hi.json"));
  assert.match(en["cmj.ready"], /two jumps/);
  assert.doesNotMatch(en["cmj.ready"], /three jumps/);
  assert.match(hi["cmj.ready"], /दो छलांग/);
  assert.doesNotMatch(en["home.start"], /5-minute/);
  assert.match(en["battery.sub"], /three minutes/);
  assert.match(en["step.ready"], /three minutes/);
  const css = read("../styles.css");
  assert.match(css, /\.icon-btn \{[^}]*min-width:\s*48px/s);
});
