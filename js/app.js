import { APP_NAME, ENABLE_OUTDOOR_TESTS, THEME } from "./config.js";
import { currentLocale, packIsComplete, setLocale, t } from "./i18n.js";
import { LOCALES, localeByCode, matchNavigator } from "./locales.js";
import {
  addNomination,
  blankState,
  canStartBattery,
  computeBadges,
  createUser,
  inviteesOf,
  isDemoMode,
  loadState,
  markInviteQc,
  newId,
  redeemInvite,
  resumeTarget,
  saveState,
  trySyncSession
} from "./store.js";
import {
  attachPercentiles,
  bestCmj,
  combineBalance,
  CORE_TESTS,
  liveCmj,
  liveRepeat,
  liveSitup,
  liveSteps,
  reactionSummary,
  sampleBalance,
  sampleCmjTrio,
  sampleReact,
  sampleRepeat,
  sampleSitup,
  sampleStep,
  shuttleResult,
  sprintResult,
  tapSummary,
  visibleTests
} from "./battery.js";
import { beep, isVoiceOn, playCue, setVoiceOn, speak, speakClip, stopSpeak, takeCueToken, unlockVoice } from "./audio.js";
import { collectArea, placeLabel, safetyFlags } from "./conditions.js";
import { demoMarkup, stepMarkup, videoMarkup } from "./demos.js";
import {
  haversineMeters,
  holdScreenAwake,
  motionPermissionKind,
  releaseScreenAwake,
  requestMotionPermission,
  sensorSupport,
  startMotionRecording,
  watchGps
} from "./motion.js";
import { measureHeartRate } from "./ppg.js";
import { analyzeBalance, detectMovementOnset, liveCue, mirwaldMaturityOffset, samplingStats } from "./signal.js";
import {
  HIGHER_BETTER,
  RADAR_KEYS,
  TEST_IDS,
  dedupeSessions,
  historyFor,
  lineChartSvg,
  radarScores,
  radarSvg,
  traceFromSamples,
  traceSvg,
  trendNeed
} from "./progress.js";
import { qualityOf, retriesCapped, shouldHoldStage, stepQuality, summarizeAttempts } from "./battery.js";

const SPORTS = ["athletics", "football", "kabaddi", "kho", "hockey", "wrestling", "badminton", "cricket", "basketball", "volleyball", "swimming", "other"];
const SCRIPT = {
  cmj: ["cmj.ready", "cmj.do", "cmj.done", "cmj.safety"],
  repeat: ["repeat.ready", "repeat.do", "repeat.done", "repeat.safety"],
  balance: ["balance.ready", "balance.do", "balance.done", "balance.safety"],
  situp: ["situp.ready", "situp.do", "situp.done", "situp.safety"],
  react: ["rt.ready", "rt.do", "rt.ready", "rt.ready"],
  step: ["step.ready", "step.do", "step.do", "step.safety"],
  sprint: ["sprint.ready", "sprint.ready", "sprint.ready", "sprint.ready"],
  shuttle: ["shuttle.ready", "shuttle.ready", "shuttle.ready", "shuttle.ready"]
};
const STAGES = {
  cmj: [
    { id: "practice", seconds: 4, kind: "cmj" },
    { id: "trial", seconds: 5, kind: "cmj" },
    { id: "trial", seconds: 5, kind: "cmj" }
  ],
  repeat: [
    { id: "practice", seconds: 5, kind: "repeat" },
    { id: "trial", seconds: 15, kind: "repeat" },
    { id: "trial", seconds: 15, kind: "repeat" }
  ],
  balance: [
    { id: "left", seconds: 20, kind: "balance" },
    { id: "right", seconds: 20, kind: "balance" }
  ],
  situp: [
    { id: "practice", seconds: 6, kind: "situp" },
    { id: "trial", seconds: 30, kind: "situp" },
    { id: "trial", seconds: 30, kind: "situp" }
  ],
  react: [
    { id: "rt-practice", kind: "rt", count: 3 },
    { id: "rt", kind: "rt", count: 5 },
    { id: "tap", kind: "tap", seconds: 10 }
  ],
  step: [
    { id: "practice", seconds: 8, kind: "steps" },
    { id: "ppg1", kind: "ppg", seconds: 12 },
    { id: "trial", seconds: 180, kind: "steps" },
    { id: "ppg2", kind: "ppg", seconds: 12 }
  ],
  sprint: [
    { id: "trial", kind: "sprint" },
    { id: "trial", kind: "sprint" }
  ],
  shuttle: [
    { id: "trial", kind: "shuttle" },
    { id: "trial", kind: "shuttle" }
  ]
};
const ERR = {
  shake: "err.cmj.shake",
  knees: "err.cmj.knees",
  unclear: "err.cmj.unclear",
  lost: "err.repeat.lost",
  foot: "err.balance.foot",
  small: "err.situp.small",
  taps: "err.tap.small",
  early: "err.rt.early",
  step: "err.step.miss",
  sprint: "err.sprint.quick",
  shuttle: "err.shuttle.quick",
  finger: "err.ppg.finger",
  low_rate: "qc.lowRate",
  short: "err.cmj.unclear",
  flat: "err.cmj.unclear",
  sensor: "err.sensor",
  nograv: "err.sensor.nograv",
  insecure: "err.sensor.insecure",
  unavailable: "err.sensor.none",
  denied: "err.sensor.denied"
};

let db = blankState();
const ui = {
  screen: "home",
  mode: "casual",
  step: 0,
  form: {},
  flow: null,
  error: "",
  notice: "",
  buddy: false,
  adding: false,
  deleteArmed: false,
  inviteOffer: false,
  runToken: 0,
  cancelers: [],
  rtResolve: null,
  turnResolve: null,
  lastSessionId: null,
  stuck: false,
  watch: false,
  sensorPerm: "",
  weatherState: "",
  detail: null,
  progressFilter: "all"
};

const displayName = () => {
  const localized = t("app.name");
  return localized && localized !== "app.name" ? localized : APP_NAME;
};
const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (n, d = 1) => (Number.isFinite(Number(n)) ? Number(n).toFixed(d) : "–");
const user = () => db.users[db.currentUserId] || null;
const persist = () => saveState(localStorage, db);

function go(screen, replace = false) {
  if (screen !== "test") cancelRun();
  if (screen !== "sensors") stopSensorPreview();
  ui.stuck = false;
  ui.screen = screen;
  ui.error = "";
  const url = `${location.pathname}${location.search}#/${screen}`;
  if (replace) history.replaceState({ screen }, "", url);
  else history.pushState({ screen }, "", url);
  render();
  window.scrollTo(0, 0);
}

function cancelRun() {
  ui.runToken += 1;
  ui.cancelers.forEach((fn) => fn());
  ui.cancelers = [];
  ui.rtResolve = null;
  ui.turnResolve = null;
  stopSpeak();
  releaseScreenAwake();
  if (ui.flow?.rec) ui.flow.rec.stop();
  if (ui.flow?.gps) ui.flow.gps.stop();
}

function sleep(ms) {
  return new Promise((resolve, reject) => {
    const id = setTimeout(resolve, ms);
    ui.cancelers.push(() => {
      clearTimeout(id);
      reject(new Error("cancel"));
    });
  });
}

function inviteLink(code) {
  const url = new URL(location.href);
  url.hash = "";
  url.search = `?invite=${encodeURIComponent(code)}`;
  return url.toString();
}

function wizard() {
  const mode = ui.adding ? ui.form.mode || ui.mode : ui.mode;
  const steps = ["name", "age", "body"];
  if (mode === "athlete") steps.push("sport");
  steps.push("hold");
  return steps;
}

function readFields() {
  document.querySelectorAll("input[data-field], select[data-field], textarea[data-field]").forEach((el) => {
    ui.form[el.dataset.field] = el.type === "checkbox" ? el.checked : el.value;
  });
}

function ensureDraft() {
  if (!db.inProgress || db.inProgress.athleteId !== db.currentUserId) {
    db.inProgress = {
      athleteId: db.currentUserId,
      mode: user()?.mode || ui.mode,
      startedAt: new Date().toISOString(),
      tests: {},
      practiceSession: false
    };
  }
  persist();
}

function shell(body, { back = false, title = "" } = {}) {
  const who = user();
  const nav = [
    ["home", "nav.home", icon("home")],
    ["battery", "nav.tests", icon("run")],
    ["timeline", "nav.progress", icon("chart")],
    ["invite", "nav.invite", icon("gift")]
  ];
  return `
    <a class="skip" href="#main">${esc(t("common.back"))}</a>
    <header class="top">
      ${back ? `<button type="button" class="icon-btn" data-act="back" aria-label="${esc(t("common.back"))}">${icon("back")}</button>` : `<span class="mark" aria-hidden="true">${icon("spark")}</span>`}
      <div class="brand">
        <div class="word">${esc(title || displayName())}</div>
        ${who && ui.screen === "home" ? `<div class="sub">${esc(who.name)}</div>` : ""}
      </div>
      <button type="button" class="icon-btn" data-act="voice-toggle" aria-pressed="${db.voiceOn !== false}" aria-label="${esc(t(db.voiceOn === false ? "voice.off" : "voice.on"))}">${icon(db.voiceOn === false ? "mute" : "vol")}</button>
      <button type="button" class="text-btn help" data-act="stuck">${esc(t("stuck.label"))}</button>
    </header>
    <main id="main">${body}</main>
    ${stuckSheet()}
    <nav class="tabbar" aria-label="${esc(displayName())}">
      ${nav
        .map(
          ([id, key, svg]) =>
            `<button type="button" data-act="goto" data-to="${id}" class="${ui.screen === id ? "on" : ""}">${svg}<span>${esc(t(key))}</span></button>`
        )
        .join("")}
    </nav>`;
}

function render() {
  const root = document.getElementById("app");
  const map = {
    home: viewHome,
    language: viewLanguage,
    onboard: viewOnboard,
    consent: viewConsent,
    battery: viewBattery,
    test: viewTest,
    results: viewResults,
    sensors: viewSensors,
    timeline: viewTimeline,
    detail: viewDetail,
    howto: viewHowto,
    invite: viewInvite,
    nominate: viewNominate,
    family: viewFamily,
    profile: viewProfile
  };
  const view = map[ui.screen] || viewHome;
  root.innerHTML = view();
  const live = document.getElementById("live");
  if (live && ui.flow && ui.screen === "test") {
    const script = stageScript();
    live.textContent = script;
  }
}

function applyTextSize() {
  if (typeof document === "undefined") return;
  document.documentElement.dataset.text = db.textSize === "large" ? "large" : "normal";
}

function textSizeControl() {
  const size = db.textSize === "large" ? "large" : "normal";
  return `<div class="seg text-size" role="group" aria-label="${esc(t("text.size"))}">
    <button type="button" class="${size === "normal" ? "on" : ""}" data-act="text-size" data-size="normal">${esc(t("text.normal"))}</button>
    <button type="button" class="${size === "large" ? "on" : ""}" data-act="text-size" data-size="large">${esc(t("text.large"))}</button>
  </div>`;
}

function stuckSheet() {
  if (!ui.stuck) return "";
  const inTest = ui.screen === "test" && ui.flow;
  return `<div class="sheet-back"><div class="sheet" role="dialog" aria-label="${esc(t("stuck.title"))}">
    <h2>${esc(t("stuck.title"))}</h2>
    <p class="lead">${esc(t("text.help"))}</p>
    ${textSizeControl()}
    ${inTest ? `<button type="button" class="btn primary" data-act="watch-demo">${esc(t("stuck.demo"))}</button>` : ""}
    <button type="button" class="btn ghost" data-act="hear">${esc(t("stuck.voice"))}</button>
    ${inTest ? `<button type="button" class="btn ghost" data-act="restart-test">${esc(t("stuck.restart"))}</button>` : ""}
    ${inTest ? `<button type="button" class="btn ghost" data-act="skip-test">${esc(t("stuck.skip"))}</button>` : ""}
    <button type="button" class="btn ghost" data-act="sensors">${esc(t("stuck.sensors"))}</button>
    <button type="button" class="btn ghost" data-act="goto" data-to="language">${esc(t("stuck.lang"))}</button>
    <button type="button" class="btn ghost" data-act="goto" data-to="home">${esc(t("stuck.home"))}</button>
    <button type="button" class="btn ghost" data-act="stuck-close">${esc(t("stuck.close"))}</button>
  </div></div>`;
}

function progressBits() {
  const tests = db.inProgress?.tests || {};
  const ids = CORE_TESTS;
  const done = ids.filter((id) => tests[id] && (tests[id].ok || tests[id].skipped)).length;
  const here = ui.flow?.id && ids.includes(ui.flow.id) ? ids.indexOf(ui.flow.id) : Math.min(done, ids.length - 1);
  const n = here + 1;
  return `<p class="progress-label">${esc(t("test.progress", { n, m: ids.length }))}</p>
    <div class="progress" aria-hidden="true">${ids
      .map((id, i) => `<span class="${tests[id]?.ok || tests[id]?.skipped ? "on" : ""} ${ui.flow?.id === id && i === here ? "now" : ""}"></span>`)
      .join("")}</div>`;
}

function weatherCard() {
  if (!db.areaChoice) {
    return `<article class="card weather"><h2>${esc(t("weather.title"))}</h2><p>${esc(t("weather.ask"))}</p>
      <button type="button" class="btn primary" data-act="weather-allow">${esc(t("weather.allow"))}</button>
      <button type="button" class="btn ghost" data-act="weather-skip">${esc(t("weather.skip"))}</button></article>`;
  }
  if (!db.area) {
    return ui.weatherState === "loading"
      ? `<p class="note">${esc(t("weather.title"))}…</p>`
      : ui.weatherState === "fail"
        ? `<p class="note">${esc(t("weather.fail"))}</p>`
        : "";
  }
  const flags = safetyFlags(db.area);
  const place = placeLabel(db.area);
  return `<article class="card weather">
    <h2>${esc(t("weather.title"))}</h2>
    ${place ? `<p>${esc(place)}</p>` : ""}
    <ul class="metrics">
      <li><span>${esc(t("weather.temp"))}</span><strong>${esc(fmt(db.area.tempC, 0))}°</strong></li>
      <li><span>${esc(t("weather.feels"))}</span><strong>${esc(fmt(db.area.feelsC, 0))}°</strong></li>
      <li><span>${esc(t("weather.humid"))}</span><strong>${esc(fmt(db.area.humidity, 0))}%</strong></li>
      <li><span>${esc(t("weather.wind"))}</span><strong>${esc(fmt(db.area.windKmh, 0))}</strong></li>
      <li><span>${esc(t("weather.uv"))}</span><strong>${esc(fmt(db.area.uv, 1))}</strong></li>
      <li><span>${esc(t("weather.aqi"))}</span><strong>${db.area.aqi == null ? "–" : esc(fmt(db.area.aqi, 0))}</strong></li>
    </ul>
    ${flags.heat ? `<p class="warn">${esc(t("weather.heat"))}</p>` : ""}
    ${flags.air ? `<p class="warn">${esc(t("weather.air"))}</p>` : ""}
    <p class="note">${esc(t("weather.note"))}</p>
  </article>`;
}

function viewSensors() {
  const perm = ui.sensorPerm;
  const statusKey =
    perm === "denied" ? "sensor.denied" : perm === "unavailable" ? "sensor.none" : perm === "insecure" ? "sensor.insecure" : "sensor.lead";
  return shell(
    `<section data-screen="sensors">
      <h1>${esc(t("sensor.title"))}</h1>
      <p>${esc(t("sensor.lead"))}</p>
      <p class="script" id="s-status">${esc(t(statusKey))}</p>
      <div class="sensor-grid">
        <div><span>${esc(t("sensor.mag"))}</span><strong id="s-mag">–</strong></div>
        <div><span>${esc(t("sensor.rate"))}</span><strong id="s-rate">–</strong></div>
      </div>
      <p class="note" id="s-axes">${esc(t("sensor.axes"))}: –</p>
      <button type="button" class="btn primary xl" data-act="sensor-start">${esc(t("sensor.button"))}</button>
      <button type="button" class="btn ghost" data-act="goto" data-to="battery">${esc(t("sensor.next"))}</button>
    </section>`,
    { back: true, title: t("sensor.title") }
  );
}

function viewHome() {
  const who = user();
  const draft = db.inProgress && db.inProgress.athleteId === who?.id;
  return shell(`
    ${isDemoMode() ? `<p class="banner">${esc(t("demo.banner"))}</p>` : ""}
    ${ui.inviteOffer ? `<div class="card invite-offer"><p>${esc(t("invite.addPerson"))}</p><button type="button" class="btn primary" data-act="join-invite">${esc(t("invite.addPerson"))}</button><button type="button" class="btn ghost" data-act="dismiss-invite">${esc(t("common.cancel"))}</button></div>` : ""}
    ${draft ? `<button type="button" class="banner linkish" data-act="resume">${esc(t("cache.banner"))} ${esc(t("home.continue"))}</button>` : ""}
    <section class="hero" data-screen="home">
      <div class="hero-art">${art("hero")}</div>
      ${who ? `<p class="hello">${esc(t("home.hello"))}, ${esc(who.name)}</p>` : ""}
      <h1>${esc(displayName())}</h1>
      <p class="lead">${esc(t("app.tagline"))}</p>
    </section>
    <button type="button" class="btn primary xl" data-act="start">${esc(draft ? t("home.continue") : t("home.start"))}</button>
    <p class="how">${icon("phone")} ${esc(t("home.how"))}</p>
    <p class="kicker">${esc(t("text.size"))}</p>
    ${textSizeControl()}
    <div class="modes" role="group" aria-label="${esc(t("profile.mode"))}">
      ${modeCard("casual")}
      ${modeCard("athlete")}
    </div>
    ${progressBits()}
    <div class="link-row">
      <button type="button" data-act="sensors">${esc(t("home.sensor"))}</button>
      <button type="button" data-act="goto" data-to="language">${esc(t("home.language"))}</button>
      <button type="button" data-act="goto" data-to="family">${esc(t("home.family"))}</button>
      <button type="button" data-act="goto" data-to="profile">${esc(t("profile.title"))}</button>
      <button type="button" data-act="goto" data-to="nominate">${esc(t("nominate.title"))}</button>
    </div>
    <p class="disclaimer">${esc(t("home.disclaimer"))}</p>
  `);
}

function modeCard(mode) {
  const on = (whoMode() || ui.mode) === mode;
  return `<button type="button" class="mode ${on ? "on" : ""}" data-act="mode" data-mode="${mode}" aria-pressed="${on}">
    <span class="mode-ico">${icon(mode === "casual" ? "smile" : "medal")}</span>
    <span><strong>${esc(t("home.mode." + mode))}</strong><small>${esc(t("home.mode." + mode + ".sub"))}</small></span>
  </button>`;
}

function whoMode() {
  return user()?.mode;
}

function viewLanguage() {
  const cur = currentLocale();
  return shell(
    `<section data-screen="language"><h1>${esc(t("lang.title"))}</h1>
    <p class="lead">${esc(t("lang.first"))}</p>
    <p class="kicker">${esc(t("text.size"))}</p>
    ${textSizeControl()}
    <p class="note">${esc(t("text.help"))}</p>
    <div class="lang-grid">
      ${LOCALES.map((l) => {
        const on = l.code === cur;
        const suggested = l.code === (ui.suggestedLang || matchNavigator(typeof navigator !== "undefined" ? navigator.languages || [navigator.language] : []));
        return `<button type="button" class="lang ${on ? "on" : ""}" data-act="lang" data-lang="${l.code}" lang="${l.code}" dir="ltr" aria-pressed="${on}">
          ${suggested ? `<span class="suggest">${esc(t("lang.suggested"))}</span>` : ""}
          <span class="native" dir="${l.dir === "rtl" ? "rtl" : "ltr"}">${esc(l.native)}</span><small>${esc(l.name)}</small>
          ${l.ready ? "" : `<small>${esc(t("lang.englishNow"))}</small>`}
        </button>`;
      }).join("")}
    </div>
    ${packIsComplete() ? "" : `<p class="note">${esc(t("lang.fallback"))}</p>`}
    </section>`,
    { back: true, title: t("home.language") }
  );
}

function viewOnboard() {
  const steps = wizard();
  const step = steps[Math.min(ui.step, steps.length - 1)];
  const f = ui.form;
  let body = "";
  if (step === "name") {
    body = `<label>${esc(t("onboard.name"))}<input data-field="name" value="${esc(f.name || "")}" autocomplete="nickname" required></label>`;
  } else if (step === "age") {
    body = `<p>${esc(t("onboard.age"))}</p>
      <div class="stepper">
        <button type="button" data-act="bump" data-target="age" data-delta="-1" aria-label="-">−</button>
        <input data-field="age" inputmode="numeric" value="${esc(f.age ?? 14)}">
        <button type="button" data-act="bump" data-target="age" data-delta="1" aria-label="+">+</button>
      </div>
      <p>${esc(t("onboard.sex"))}</p>
      <div class="seg">${["F", "M", "X"].map((s) => `<button type="button" class="${(f.sex || "X") === s ? "on" : ""}" data-act="sex" data-sex="${s}">${esc(t("onboard.sex." + s.toLowerCase()))}</button>`).join("")}</div>`;
  } else if (step === "body") {
    body = `<p class="script">${esc(t("c0.script"))}</p><p class="note">${esc(t("onboard.optional"))}</p>
      ${numField("heightCm", "onboard.height", f.heightCm)}
      ${numField("weightKg", "onboard.weight", f.weightKg)}
      ${numField("sittingHeightCm", "onboard.sitting", f.sittingHeightCm)}
      <button type="button" class="btn ghost" data-act="skip-body">${esc(t("onboard.skip"))}</button>`;
  } else if (step === "sport") {
    body = `<p>${esc(t("onboard.sport"))}</p><div class="chips">${SPORTS.map((s) => `<button type="button" class="chip ${(f.sport || "") === s ? "on" : ""}" data-act="sport" data-sport="${s}">${esc(t("sports." + s))}</button>`).join("")}</div>`;
  } else {
    body = `<div class="hero-art">${art("hold")}</div><h2>${esc(t("onboard.hold.title"))}</h2><p>${esc(t("onboard.hold.body"))}</p>`;
  }
  return shell(
    `<section data-screen="onboard"><p class="kicker">${esc(t("onboard.title"))}</p><h1>${esc(displayName())}</h1>
    <div class="dots">${steps.map((_, i) => `<span class="${i === ui.step ? "on" : ""}"></span>`).join("")}</div>
    ${body}
    ${ui.error ? `<p class="error" role="alert">${esc(ui.error)}</p>` : ""}
    <div class="sticky-cta"><button type="button" class="btn primary xl" data-act="onboard-next">${esc(t("onboard.next"))}</button></div></section>`,
    { back: true, title: t("onboard.title") }
  );
}

function numField(field, key, value) {
  return `<label>${esc(t(key))}<input data-field="${field}" inputmode="decimal" value="${esc(value ?? "")}" placeholder="${esc(t("onboard.skip"))}"></label>`;
}

function viewConsent() {
  const f = ui.form;
  return shell(
    `<section data-screen="consent"><h1>${esc(t("consent.title"))}</h1>
    <p>${esc(t("consent.body"))}</p>
    <p class="note">${esc(t("consent.law"))}</p>
    <label>${esc(t("consent.name"))}<input data-field="guardianName" value="${esc(f.guardianName || "")}"></label>
    <label class="check"><input type="checkbox" data-field="consent" ${f.consent ? "checked" : ""}> ${esc(t("consent.check"))}</label>
    ${ui.error ? `<p class="error" role="alert">${esc(ui.error)}</p>` : ""}
    <div class="sticky-cta"><button type="button" class="btn primary xl" data-act="save-consent">${esc(t("consent.save"))}</button></div></section>`,
    { back: true, title: t("consent.title") }
  );
}

function viewBattery() {
  const who = user();
  if (!who) return shell(`<section data-screen="battery"><p>${esc(t("onboard.need"))}</p><button class="btn primary" type="button" data-act="goto" data-to="onboard">${esc(t("home.start"))}</button></section>`, { back: true });
  const tests = db.inProgress?.athleteId === who.id ? db.inProgress.tests : {};
  const list = (ids) =>
    ids
      .map((id) => {
        const done = tests[id] && (tests[id].ok || tests[id].skipped);
        return `<button type="button" class="test-row" data-act="open-test" data-id="${id}">
          <span class="bubble">${icon(id)}</span>
          <span><strong>${esc(t("tests." + id))}</strong><small>${esc(done ? t("battery.done") : t("battery.todo"))}</small></span>
          <span class="tick ${done ? "on" : ""}">${done ? "✓" : ""}</span>
        </button>`;
      })
      .join("");
  const any = Object.keys(tests).length > 0;
  return shell(
    `<section data-screen="battery"><h1>${esc(t("battery.title"))}</h1><p>${esc(t("battery.sub"))}</p>
    ${progressBits()}
    ${weatherCard()}
    <div class="stack">${list(CORE_TESTS)}</div>
    ${ENABLE_OUTDOOR_TESTS ? `<h2>${esc(t("battery.outdoor"))}</h2><div class="stack">${list(["sprint", "shuttle"])}</div>` : ""}
    ${any ? `<button type="button" class="btn primary xl" data-act="see-card">${esc(t("battery.see"))}</button>` : ""}
    <button type="button" class="btn ghost" data-act="practice-all">${esc(t("battery.sampleAll"))}</button>
    <p class="note">${esc(t("battery.sampleAll.sub"))}</p>
    <p class="disclaimer">${esc(t("home.disclaimer"))}</p></section>`,
    { back: true, title: t("nav.tests") }
  );
}

function stageScript() {
  const flow = ui.flow;
  if (!flow) return "";
  if (flow.card === "done") return t(SCRIPT[flow.id][2]);
  const stage = STAGES[flow.id][flow.index];
  if (!stage) return t(SCRIPT[flow.id][0]);
  if (stage.kind === "tap") return t("tap.ready");
  if (stage.kind === "ppg") return t(stage.id === "ppg1" ? "ppg.before" : "ppg.after");
  if (flow.card === "do") return t(SCRIPT[flow.id][1]);
  return t(SCRIPT[flow.id][0]);
}

function viewTest() {
  const flow = ui.flow;
  if (!flow) return shell(`<p>–</p>`);
  const card = flow.card || "ready";
  const stage = STAGES[flow.id][flow.index];
  const errKey = flow.error ? reasonKey(flow.id, flow.error) : "";
  const capped = retriesCapped(flow.retries) && flow.error;
  const air = safetyFlags(db.area).air && (flow.id === "step" || flow.id === "sprint" || flow.id === "shuttle");
  let extra = "";
  if (card === "do" && flow.rt) {
    extra = `<button type="button" class="pad ${flow.rt === "go" ? "go" : ""}" data-act="rt-pad">${esc(flow.rt === "go" ? t("rt.go") : t("rt.wait"))}</button>`;
  } else if (card === "do" && flow.tapLive) {
    extra = `<p class="big-num" id="tap-count">${flow.taps || 0}</p>
      <div class="tap-row"><button type="button" class="btn primary" data-act="tap">${esc(t("tap.left"))}</button>
      <button type="button" class="btn primary" data-act="tap">${esc(t("tap.right"))}</button></div>`;
  } else if (card === "do" && stage?.kind === "ppg") {
    extra = `<p class="cue" id="cue">${esc(t("live.cover"))}</p><p class="note">${esc(t("ppg.note"))}</p><video id="ppg-video" playsinline autoplay muted></video><canvas id="ppg-canvas" width="32" height="32" hidden></canvas>`;
  } else if (card === "do" && stage?.kind === "sprint") {
    extra = `<button type="button" class="btn primary xl" data-act="sprint-finish">${esc(t("sprint.mark"))}</button>`;
  } else if (card === "do" && stage?.kind === "shuttle") {
    extra = `<p class="big-num" id="turns">${flow.turns || 0} / 4</p><button type="button" class="btn primary xl" data-act="shuttle-turn">${esc(t("shuttle.turn"))}</button>`;
  } else if (card === "do") {
    extra = `<div class="meter" aria-hidden="true"><span id="meter"></span></div>`;
  }
  if (card === "done" && flow.result) extra = metricHtml(flow.id, flow.result);
  const steps = [1, 2, 3]
    .map(
      (n) => `<li><span class="num">${n}</span><span class="step-art">${stepMarkup(flow.id, n)}</span><span>${esc(t(`steps.${flow.id}.${n}`))}</span></li>`
    )
    .join("");
  return shell(
    `<section data-screen="test" data-test="${flow.id}">
      ${progressBits()}
      <div class="phases" aria-hidden="true">
        <span class="${card === "ready" ? "on" : ""}">${esc(t("test.ready"))}</span>
        <span class="${card === "do" ? "on" : ""}">${esc(t("test.do"))}</span>
        <span class="${card === "done" ? "on" : ""}">${esc(t("test.done"))}</span>
      </div>
      ${ui.watch ? videoMarkup(flow.id) : demoMarkup(flow.id)}
      <h1 data-act="debug-tap">${esc(t("tests." + flow.id))}</h1>
      ${ui.debug ? debugPanel() : ""}
      ${errKey ? `<p class="error" role="alert">${esc(t(errKey))}</p>` : ""}
      ${card === "ready" ? `<p class="lead">${esc(t("coach." + flow.id))}</p>
        ${capped
          ? `<button type="button" class="btn primary xl" data-act="skip-test">${esc(t("test.skip"))}</button>`
          : `<button type="button" class="btn primary xl" data-act="run-stage">${esc(flow.error ? t("test.tryAgain") : primaryLabel(flow))}</button>`}
        <button type="button" class="btn ghost" data-act="watch-demo">${esc(ui.watch ? t("demo.hide") : t("demo.watch"))}</button>
        <ol class="steps">${steps}</ol>` : ""}
      ${card === "do" ? `<p class="cue" id="cue">${esc(flow.cue || t("live.wait"))}</p>` : ""}
      ${stageHint(flow, stage) ? `<p class="kicker">${esc(stageHint(flow, stage))}</p>` : ""}
      <p class="safety">${esc(t(SCRIPT[flow.id][3]))}</p>
      ${air ? `<p class="warn">${esc(t("weather.air"))}</p>` : ""}
      ${extra}
      <p class="count" id="count">${card === "do" && flow.count ? esc(String(flow.count)) : ""}</p>
      ${card === "ready" ? `
        <button type="button" class="btn ghost" data-act="use-sample">${esc(t("test.example"))}</button>
        <p class="note">${esc(t("test.sample.sub"))}</p>
        ${motionPermissionKind() === "ios" ? `<p class="note">${esc(t("test.ios"))}</p>` : `<p class="note">${esc(t("test.android"))}</p>`}
        ${sensorSupport().kind === "none" ? `<p class="note">${esc(t("err.sensor.none"))}</p>` : ""}
        ${flow.id === "balance" ? `<button type="button" class="btn ghost" data-act="foot">${esc(t("test.foot"))}</button>` : ""}
      ` : ""}
      ${card === "done" ? `<button type="button" class="btn primary xl" data-act="test-next">${esc(t("test.next"))}</button>` : ""}
      ${card === "do" ? `<button type="button" class="btn ghost" data-act="safety-stop">${esc(t("test.safetyStop"))}</button>` : ""}
      <button type="button" class="text-btn" data-act="hear">${esc(t("voice.repeat"))}</button>
      <label class="check"><input type="checkbox" data-act="buddy" ${ui.buddy ? "checked" : ""}> ${esc(t("test.buddy"))}</label>
      ${ui.buddy ? `<p class="note">${esc(t("test.buddy.script"))}</p>` : ""}
      ${card !== "done" ? `<button type="button" class="text-btn" data-act="skip-test">${esc(t("test.skip"))}</button>` : ""}
    </section>`,
    { back: true, title: t("tests." + flow.id) }
  );
}

function isPractice(stage) {
  return stage && (stage.id === "practice" || stage.id === "rt-practice");
}
function primaryLabel(flow) {
  const stage = STAGES[flow.id][flow.index];
  if (!stage) return t("test.real");
  if (isPractice(stage)) return t("test.practice");
  if (stage.kind === "ppg") return t("ppg.start");
  return t("test.real");
}
function needsTwo(id) {
  return ["cmj", "repeat", "situp", "sprint", "shuttle"].includes(id);
}
function stageHint(flow, stage) {
  if (!stage || flow.card === "done") return "";
  if (stage.id === "trial" && needsTwo(flow.id)) {
    const n = (flow.parts || []).filter((p) => p.stage === "trial" && p.ok !== false).length + 1;
    return t("test.attempt", { n });
  }
  if (flow.id === "balance") return t(stage.id === "left" ? "test.leg.left" : "test.leg.right");
  if (stage?.kind === "ppg") return t(stage.id === "ppg1" ? "ppg.before" : "ppg.after");
  return "";
}

function metricHtml(id, result) {
  if (!result || result.skipped) return `<p>${esc(t("battery.todo"))}</p>`;
  const rows = rowsFor(id, result);
  const pct = percentileOf(id, result);
  const quality = qualityOf(result);
  const badge = quality === "none" ? "" : `<p class="badge ${quality}">${esc(t("quality." + quality))}</p>`;
  return `${badge}<ul class="metrics">${rows
    .map((r) => `<li><span>${esc(r[0])}</span><strong>${esc(r[1])} ${esc(r[2] || "")}</strong></li>`)
    .join("")}</ul>${
    result.unreliable ? `<p class="warn">${esc(t("results.unreliable"))}</p>` : ""
  }${result.heartSkipped ? `<p class="note">${esc(t("heart.skipped"))}</p>` : ""}${
    pct ? `<p class="pct">${esc(t("results.percentile", { n: pct.percentile }))}</p><p class="disclaimer">${esc(t("results.disclaimer"))}</p>` : ""
  }`;
}

function rowsFor(id, result) {
  if (id === "cmj") {
    return [
      [t("metric.jump"), fmt(result.jumpHeightCm, 1), t("unit.cm")],
      [t("metric.flight"), fmt((result.flightS || 0) * 1000, 0), t("unit.ms")],
      [t("metric.best"), String(result.trials?.length || 1), ""]
    ];
  }
  if (id === "repeat") {
    return [
      [t("metric.count"), String(result.count ?? 0), ""],
      [t("metric.meanH"), fmt(result.meanHeightCm, 1), t("unit.cm")],
      [t("metric.contact"), fmt(result.meanContactS, 2), t("unit.s")],
      [t("metric.rsi"), fmt(result.meanRsi, 2), ""],
      [t("metric.fatigue"), fmt(result.fatigueSlope, 2), t("unit.perJump")]
    ];
  }
  if (id === "balance") {
    return [
      [t("metric.sway"), fmt(result.swayRms, 3), "m/s²"],
      [t("test.leg.left"), fmt(result.left, 3), ""],
      [t("test.leg.right"), fmt(result.right, 3), ""]
    ];
  }
  if (id === "situp") return [[t("metric.reps"), String(result.reps ?? 0), ""]];
  if (id === "react") {
    return [
      [t("metric.rt"), fmt(result.reaction?.medianMs, 0), t("unit.ms")],
      [t("metric.taps"), String(result.taps?.taps ?? 0), ""]
    ];
  }
  if (id === "step") {
    return [
      [t("metric.steps"), String(result.steps ?? 0), ""],
      [t("metric.hrBefore"), result.preBpm ? fmt(result.preBpm, 0) : "–", t("unit.bpm")],
      [t("metric.hrAfter"), result.postBpm ? fmt(result.postBpm, 0) : "–", t("unit.bpm")]
    ];
  }
  if (id === "sprint" || id === "shuttle") {
    return [[t(id === "sprint" ? "metric.sprint" : "metric.shuttle"), fmt(result.timeS, 2), t("unit.s")]];
  }
  return [];
}

function percentileOf(id, result) {
  if (!result) return null;
  if (result.percentile) return result.percentile;
  if (id === "repeat") return result.percentile || null;
  if (id === "react") return result.reaction?.percentile || null;
  return null;
}

function viewResults() {
  const session = db.sessions.find((s) => s.id === ui.lastSessionId) || db.sessions.find((s) => s.athleteId === db.currentUserId);
  const who = user();
  if (!session || !who) {
    return shell(
      `<section data-screen="results"><h1>${esc(t("results.title"))}</h1><p>${esc(t("results.empty"))}</p><button type="button" class="btn primary xl" data-act="start">${esc(t("home.start"))}</button></section>`,
      { back: true }
    );
  }
  const blocks = Object.entries(session.tests)
    .filter(([, v]) => v && !v.skipped)
    .map(([id, result]) => `<article class="card"><h2>${esc(t("tests." + id))}${result.sample ? " · " + esc(t("test.sample")) : ""}</h2>${metricHtml(id, result)}</article>`)
    .join("");
  const status = who.verification === "centre-verified" ? t("results.centre") : t("results.self");
  const mature =
    session.maturityOffset == null
      ? ""
      : `<p class="note">${esc(t("results.maturity", { y: fmt(session.maturityOffset, 2) }))}</p>`;
  return shell(
    `<section data-screen="results">
      <p class="pill ${who.verification === "centre-verified" ? "centre" : ""}">${esc(status)}</p>
      <h1>${esc(t("results.title"))}</h1>
      <p class="lead">${esc(who.name)} · ${esc(String(who.age))} ${esc(t("common.years"))}${who.sport ? " · " + esc(t("sports." + who.sport)) : ""}</p>
      <p class="note">${esc(t("results.next"))}</p>
      <button type="button" class="btn primary xl" data-act="share">${esc(t("results.share"))}</button>
      <button type="button" class="btn ghost" data-act="goto" data-to="timeline">${esc(t("timeline.title"))}</button>
      <button type="button" class="btn ghost" data-act="goto" data-to="battery">${esc(t("results.another"))}</button>
      <div class="disclaimer box">${esc(t("results.disclaimer"))}</div>
      ${session.hasSample ? `<p class="note">${esc(t("results.sampleNote"))}</p>` : ""}
      ${mature}
      ${session.conditions ? `<article class="card"><h2>${esc(t("weather.title"))}</h2><p>${esc(placeLabel(session.conditions))}</p><p class="note">${esc(t("results.conditions"))}</p><p>${esc(t("weather.temp"))} ${esc(fmt(session.conditions.tempC, 0))}° · ${esc(t("weather.humid"))} ${esc(fmt(session.conditions.humidity, 0))}% · ${esc(t("weather.aqi"))} ${session.conditions.aqi == null ? "–" : esc(fmt(session.conditions.aqi, 0))}</p></article>` : ""}
      ${blocks || `<p>${esc(t("results.empty"))}</p>`}
      <p>${esc(t("results.referral"))}</p>
      <p><strong>${esc(t("results.notSelection"))}</strong></p>
      <button type="button" class="btn primary xl" data-act="share">${esc(t("results.share"))}</button>
      <button type="button" class="btn ghost" data-act="goto" data-to="timeline">${esc(t("timeline.title"))}</button>
    </section>`,
    { back: true }
  );
}

function viewTimeline() {
  const who = user();
  const rows = dedupeSessions(db.sessions.filter((s) => s.athleteId === who?.id));
  const filter = ui.progressFilter || "all";
  const ids = filter === "all" ? TEST_IDS : [filter];
  const chips = ["all"].concat(TEST_IDS).map((id) => {
    const label = id === "all" ? t("progress.all") : t("tests." + id);
    return `<button type="button" class="chip ${filter === id ? "on" : ""}" data-act="progress-filter" data-test="${id}">${esc(label)}</button>`;
  }).join("");
  const blocks = ids.map((id) => historyBlock(rows, id)).join("");
  const real = rows
    .filter((s) => !s.practiceSession)
    .slice()
    .sort((a, b) => String(a.completedAt).localeCompare(String(b.completedAt)));
  const first = real[0];
  const latest = real[real.length - 1];
  const radar = first && latest ? labeledRadar(first, latest) : `<p class="note">${esc(t("progress.need", { n: trendNeed(real.length) }))}</p>`;
  return shell(
    `<section data-screen="timeline">
      <h1>${esc(t("timeline.title"))}</h1>
      <div class="chips">${chips}</div>
      ${rows.length ? "" : `<p>${esc(t("progress.need", { n: 2 }))}</p><button type="button" class="btn primary xl" data-act="start">${esc(t("home.start"))}</button>`}
      <h2>${esc(t("progress.radar"))}</h2>
      <p class="note">${esc(t("progress.radar.sub"))}</p>
      ${radar}
      ${blocks || (rows.length ? `<p class="note">${esc(t("progress.need", { n: 2 }))}</p>` : "")}
      <p class="disclaimer">${esc(t("results.disclaimer"))}</p>
    </section>`,
    { back: true, title: t("nav.progress") }
  );
}

function labeledRadar(first, latest) {
  let svg = radarSvg(radarScores(first), radarScores(latest));
  for (const key of RADAR_KEYS) svg = svg.replace(`>${key}<`, `>${esc(t("progress." + key))}<`);
  return `<div class="plot-card">${svg}<p class="note">${esc(t("progress.first"))} · ${esc(t("progress.latest"))}</p></div>`;
}

function historyBlock(rows, id) {
  const points = historyFor(rows, id);
  if (!points.length) return "";
  const higher = HIGHER_BETTER[id];
  const need = trendNeed(points.length);
  const chart = points.length >= 2 ? lineChartSvg(points, higher) : "";
  const rowsHtml = points
    .slice()
    .reverse()
    .map((point) => `<li><button type="button" data-act="open-detail" data-test="${id}" data-session="${point.sessionId}"><span>${esc(String(point.date).slice(0, 10))}</span><strong>${esc(fmt(point.value, id === "balance" ? 3 : 1))}</strong></button></li>`)
    .join("");
  return `<article class="card"><h2>${esc(t("tests." + id))}</h2>
    ${need ? `<p class="note">${esc(t("progress.need", { n: need }))}</p>` : chart}
    <ul class="metrics history-rows">${rowsHtml}</ul>
  </article>`;
}

function viewDetail() {
  const found = findDetail();
  if (!found) {
    return shell(`<section data-screen="detail"><h1>${esc(t("detail.title"))}</h1><p>${esc(t("progress.need", { n: 2 }))}</p><button type="button" class="btn primary" data-act="goto" data-to="timeline">${esc(t("timeline.title"))}</button></section>`, { back: true });
  }
  const { id, result } = found;
  const pct = result.percentile?.percentile ?? result.reaction?.percentile?.percentile;
  const marks = (result.trace?.marks || [])
    .map((mark) => `${esc(t("trace." + mark.name))}: ${esc(Number(mark.t).toFixed(2))}s`)
    .join(" · ");
  return shell(
    `<section data-screen="detail">
      <h1>${esc(t("tests." + id))}</h1>
      ${metricHtml(id, result)}
      ${marks ? `<p class="note">${marks}</p>` : ""}
      ${pct == null ? "" : `<div class="gauge" style="--p:${pct}"><span>${esc(String(pct))}</span></div>`}
      <h2>${esc(t("progress.what"))}</h2>
      <p>${esc(t("mean." + id))}</p>
      <h2>${esc(t("progress.improve"))}</h2>
      <p>${esc(t("tip." + id))}</p>
      <h2>${esc(t("progress.trace"))}</h2>
      <div class="plot-card">${traceSvg(result.trace) || `<p class="note">${esc(t("progress.notrace"))}</p>`}</div>
      <button type="button" class="btn ghost" data-act="open-how" data-test="${id}">${esc(t("how.open"))}</button>
      <button type="button" class="btn ghost" data-act="hear-detail">${esc(t("how.hear"))}</button>
    </section>`,
    { back: true }
  );
}

function viewHowto() {
  const id = ui.detail?.test || "cmj";
  return shell(
    `<section data-screen="howto">
      <h1>${esc(t("tests." + id))}</h1>
      <p class="kicker">${esc(t("how.title"))}</p>
      <h2>${esc(t("how.what"))}</h2><p>${esc(t("how." + id + ".what"))}</p>
      <h2>${esc(t("how.science"))}</h2><p>${esc(t("how." + id + ".science"))}</p>
      <h2>${esc(t("how.sensor"))}</h2><p>${esc(t("how." + id + ".sensor"))}</p>
      <h2>${esc(t("how.limit"))}</h2><p>${esc(t("how." + id + ".limit"))}</p>
      <button type="button" class="btn primary" data-act="hear-how">${esc(t("how.hear"))}</button>
    </section>`,
    { back: true }
  );
}

function findDetail() {
  const id = ui.detail?.test;
  if (!id) return null;
  const rows = dedupeSessions(db.sessions);
  const session = rows.find((s) => s.id === ui.detail.session) || rows.find((s) => s.tests?.[id]);
  if (!session?.tests?.[id]) return null;
  return { id, result: session.tests[id], session };
}

function spark(values) {
  if (values.length < 2) return "";
  const w = 320;
  const h = 90;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(1, max - min);
  const d = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * (w - 16) + 8;
      const y = h - 10 - ((v - min) / span) * (h - 24);
      return `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" role="img"><path d="${d}" /></svg>`;
}

function viewInvite() {
  const who = user();
  if (!who) return shell(`<section data-screen="invite"><button class="btn primary" type="button" data-act="start">${esc(t("home.start"))}</button></section>`, { back: true });
  const people = inviteesOf(db, who.id);
  const badges = computeBadges(db, who.id);
  const link = inviteLink(who.inviteCode);
  const qr = qrMarkup(link);
  return shell(
    `<section data-screen="invite"><h1>${esc(t("invite.title"))}</h1><p>${esc(t("invite.sub"))}</p>
    <p class="kicker">${esc(t("invite.count"))}: ${people.length}</p>
    <p class="code">${esc(who.inviteCode)}</p>
    <div class="qr">${qr}</div>
    <button type="button" class="btn primary" data-act="copy-invite">${esc(t("invite.copy"))}</button>
    <button type="button" class="btn ghost" data-act="share-invite">${esc(t("invite.share"))}</button>
    ${ui.notice ? `<p class="note" role="status">${esc(ui.notice)}</p>` : ""}
    <h2>${esc(t("invite.people"))}</h2>
    ${
      people.length
        ? `<ul class="metrics">${people
            .map((p) => `<li><span>${esc(p.inviteeName)}</span><strong>${p.qc ? "✓" : ""}</strong></li>`)
            .join("")}</ul>`
        : `<p>${esc(t("invite.none"))}</p>`
    }
    <div class="badges">${badges.map((b) => `<span class="pill">${esc(t("badges." + b))}</span>`).join("")}</div>
    <button type="button" class="btn ghost" data-act="add-person">${esc(t("invite.addPerson"))}</button>
    </section>`,
    { back: true, title: t("nav.invite") }
  );
}

function qrMarkup(text) {
  try {
    if (typeof qrcode !== "function") return "";
    const qr = qrcode(0, "M");
    qr.addData(text);
    qr.make();
    return qr.createSvgTag(4, 2);
  } catch {
    return "";
  }
}

function viewNominate() {
  const f = ui.form;
  return shell(
    `<section data-screen="nominate"><h1>${esc(t("nominate.title"))}</h1>
    <p>${esc(t("nominate.sub"))}</p>
    <label>${esc(t("nominate.name"))}<input data-field="nomName" value="${esc(f.nomName || "")}"></label>
    <label>${esc(t("nominate.contact"))}<input data-field="nomContact" value="${esc(f.nomContact || "")}" inputmode="tel"></label>
    <label class="check"><input type="checkbox" data-field="nomUnder" ${f.nomUnder ? "checked" : ""}> ${esc(t("nominate.under18"))}</label>
    <label class="check"><input type="checkbox" data-field="nomConsent" ${f.nomConsent ? "checked" : ""}> ${esc(t("nominate.consent"))}</label>
    <label class="check"><input type="checkbox" data-field="nomParent" ${f.nomParent ? "checked" : ""}> ${esc(t("nominate.parent"))}</label>
    <p class="note">${esc(t("nominate.need"))}</p>
    <p class="note">${esc(t("nominate.spotter"))}</p>
    ${ui.error ? `<p class="error" role="alert">${esc(ui.error)}</p>` : ""}
    ${ui.notice ? `<p class="note" role="status">${esc(ui.notice)}</p>` : ""}
    <button type="button" class="btn primary xl" data-act="save-nom">${esc(t("nominate.send"))}</button>
    </section>`,
    { back: true, title: t("nominate.title") }
  );
}

function viewFamily() {
  const who = user();
  const kids = (who?.childIds || []).map((id) => db.users[id]).filter(Boolean);
  const all = Object.values(db.users);
  return shell(
    `<section data-screen="family"><h1>${esc(t("family.title"))}</h1><p>${esc(t("family.sub"))}</p>
    ${all
      .map(
        (p) => `<article class="card"><strong>${esc(p.name)}</strong> · ${esc(String(p.age ?? ""))}
        ${p.id === db.currentUserId ? `<span class="pill">${esc(t("family.active"))}</span>` : ""}
        ${p.id !== db.currentUserId ? `<button type="button" class="btn ghost" data-act="switch-user" data-id="${p.id}">${esc(t("family.switch"))}</button>` : ""}
      </article>`
      )
      .join("")}
    <h2>${esc(t("family.add"))}</h2>
    <label>${esc(t("family.childName"))}<input data-field="childName" value="${esc(ui.form.childName || "")}"></label>
    <label>${esc(t("onboard.age"))}<input data-field="childAge" inputmode="numeric" value="${esc(ui.form.childAge || "10")}"></label>
    <div class="seg">
      <button type="button" class="${(ui.form.childSex || "X") === "F" ? "on" : ""}" data-act="child-sex" data-sex="F">${esc(t("onboard.sex.f"))}</button>
      <button type="button" class="${(ui.form.childSex || "X") === "M" ? "on" : ""}" data-act="child-sex" data-sex="M">${esc(t("onboard.sex.m"))}</button>
    </div>
    <label class="check"><input type="checkbox" data-field="childConsent"> ${esc(t("family.consent"))}</label>
    ${ui.error ? `<p class="error" role="alert">${esc(ui.error)}</p>` : ""}
    <button type="button" class="btn primary" data-act="add-child">${esc(t("family.add"))}</button>
    ${kids.length ? "" : ""}
    </section>`,
    { back: true, title: t("home.family") }
  );
}

function viewProfile() {
  const who = user();
  if (!who) return shell(`<section data-screen="profile"><button type="button" class="btn primary" data-act="start">${esc(t("home.start"))}</button></section>`, { back: true });
  const badges = computeBadges(db, who.id);
  const offset = mirwaldMaturityOffset(who);
  return shell(
    `<section data-screen="profile"><h1>${esc(t("profile.title"))}</h1>
    <p class="pill ${who.verification === "centre-verified" ? "centre" : ""}">${esc(who.verification === "centre-verified" ? t("results.centre") : t("results.self"))}</p>
    <p>${esc(t("profile.centre.help"))}</p>
    ${offset == null ? "" : `<p class="note">${esc(t("results.maturity", { y: fmt(offset, 2) }))}</p>`}
    <div class="badges">${badges.map((b) => `<span class="pill">${esc(t("badges." + b))}</span>`).join("")}</div>
    <label>${esc(t("onboard.name"))}<input data-field="name" value="${esc(who.name)}"></label>
    <label>${esc(t("onboard.age"))}<input data-field="age" inputmode="numeric" value="${esc(who.age ?? "")}"></label>
    <label>${esc(t("profile.org"))}<input data-field="orgName" value="${esc(who.orgName || "")}"></label>
    <label>${esc(t("profile.orgKind"))}
      <select data-field="orgKind">
        <option value="">${esc(t("onboard.skip"))}</option>
        ${["school", "club", "federation"].map((k) => `<option value="${k}" ${who.orgKind === k ? "selected" : ""}>${esc(t("org." + k))}</option>`).join("")}
      </select>
    </label>
    <label>${esc(t("profile.orgRole"))}
      <select data-field="orgRole">
        <option value="">${esc(t("onboard.skip"))}</option>
        ${["athlete", "guardian", "coach", "teacher"].map((k) => `<option value="${k}" ${who.orgRole === k ? "selected" : ""}>${esc(t("role." + k))}</option>`).join("")}
      </select>
    </label>
    <div class="modes">${modeCard("casual")}${modeCard("athlete")}</div>
    <button type="button" class="btn primary" data-act="save-profile">${esc(t("common.save"))}</button>
    ${ui.notice ? `<p class="note">${esc(ui.notice)}</p>` : ""}
    <h2>${esc(t("profile.centre.btn"))}</h2>
    <label>${esc(t("profile.centre.name"))}<input data-field="centreName" value=""></label>
    <label>${esc(t("profile.centre.staff"))}<input data-field="centreStaff" value=""></label>
    <label class="check"><input type="checkbox" data-field="centreCheck"> ${esc(t("profile.centre.check"))}</label>
    <button type="button" class="btn ghost" data-act="save-centre">${esc(t("profile.centre.btn"))}</button>
    <button type="button" class="btn ghost" data-act="export">${esc(t("profile.export"))}</button>
    <button type="button" class="btn danger" data-act="${ui.deleteArmed ? "delete-confirm" : "delete-arm"}">${esc(t(ui.deleteArmed ? "profile.delete.confirm" : "profile.delete"))}</button>
    </section>`,
    { back: true, title: t("profile.title") }
  );
}

function onPointerDown(event) {
  startDemoVideo();
  const btn = event.target.closest("[data-act='rt-pad'], [data-act='tap']");
  if (!btn) return;
  event.preventDefault();
  if (btn.dataset.act === "rt-pad") onRtPad();
  else onTap();
}

function onClick(event) {
  const btn = event.target.closest("[data-act]");
  if (!btn) return;
  const act = btn.dataset.act;
  if (act === "buddy" || act === "rt-pad" || act === "tap") return;
  if (act === "goto") {
    ui.stuck = false;
    return go(btn.dataset.to);
  }
  if (act === "stuck") {
    ui.stuck = true;
    return render();
  }
  if (act === "stuck-close") {
    ui.stuck = false;
    return render();
  }
  if (act === "text-size") {
    db.textSize = btn.dataset.size === "large" ? "large" : "normal";
    applyTextSize();
    persist();
    return render();
  }
  if (act === "voice-toggle") {
    db.voiceOn = db.voiceOn === false;
    setVoiceOn(db.voiceOn);
    persist();
    return render();
  }
  if (act === "watch-demo") {
    ui.watch = !ui.watch;
    ui.stuck = false;
    render();
    return startDemoVideo();
  }
  if (act === "debug-tap") {
    ui.debugTaps = (ui.debugTaps || 0) + 1;
    if (ui.debugTaps >= 5) ui.debug = true;
    if (ui.debug) render();
    return;
  }
  if (act === "sensors") {
    ui.stuck = false;
    return openSensors();
  }
  if (act === "sensor-start") return startSensorPreview();
  if (act === "weather-allow") return allowWeather();
  if (act === "weather-skip") {
    db.areaChoice = "deny";
    persist();
    return render();
  }
  if (act === "restart-test") return restartTest();
  if (act === "back") return history.length > 1 ? history.back() : go("home");
  if (act === "mode") {
    readFields();
    ui.mode = btn.dataset.mode;
    if (user() && ui.screen === "profile") {
      user().mode = ui.mode;
      persist();
    }
    return render();
  }
  if (act === "lang") return chooseLang(btn.dataset.lang);
  if (act === "start" || act === "resume") return startPath();
  if (act === "onboard-next") return onboardNext();
  if (act === "sex") {
    readFields();
    ui.form.sex = btn.dataset.sex || "X";
    return render();
  }
  if (act === "child-sex") {
    readFields();
    ui.form.childSex = btn.dataset.sex;
    return render();
  }
  if (act === "sport") {
    ui.form.sport = btn.dataset.sport;
    return render();
  }
  if (act === "bump") {
    readFields();
    const field = btn.dataset.target;
    const cur = Number(ui.form[field] || 0);
    ui.form[field] = Math.max(5, Math.min(90, cur + Number(btn.dataset.delta)));
    return render();
  }
  if (act === "skip-body") {
    ui.form.heightCm = "";
    ui.form.weightKg = "";
    ui.form.sittingHeightCm = "";
    ui.step += 1;
    return render();
  }
  if (act === "save-consent") return saveConsent();
  if (act === "open-test") return openTest(btn.dataset.id);
  if (act === "progress-filter") {
    ui.progressFilter = btn.dataset.test || "all";
    return render();
  }
  if (act === "open-detail") {
    ui.detail = { test: btn.dataset.test, session: btn.dataset.session };
    return go("detail");
  }
  if (act === "open-how") {
    ui.detail = { ...(ui.detail || {}), test: btn.dataset.test || ui.detail?.test };
    return go("howto");
  }
  if (act === "hear-detail") {
    const id = ui.detail?.test || "cmj";
    return speak(`${t("mean." + id)} ${t("tip." + id)}`, currentLocale());
  }
  if (act === "hear-how") {
    const id = ui.detail?.test || "cmj";
    return speak([t("how." + id + ".what"), t("how." + id + ".science"), t("how." + id + ".sensor"), t("how." + id + ".limit")].join(" "), currentLocale());
  }
  if (act === "run-stage") return runStage(false);
  if (act === "use-sample") return useSample();
  if (act === "skip-practice") return skipPractice();
  if (act === "skip-test" || act === "safety-stop") return skipTest();
  if (act === "test-next") return go("battery");
  if (act === "hear") {
    ui.stuck = false;
    const id = ui.flow?.id;
    if (id && ui.screen === "test" && ui.flow.card !== "do") {
      render();
      return speakClip(currentLocale(), `coach-${id}`, t(`coach.${id}`));
    }
    return speak(stageScript() || t("home.how"), currentLocale());
  }
  if (act === "rt-pad") return onRtPad();
  if (act === "tap") return onTap();
  if (act === "foot") return onFoot();
  if (act === "sprint-finish" && ui.turnResolve) return ui.turnResolve("finish");
  if (act === "shuttle-turn") return onShuttleTurn();
  if (act === "practice-all") return practiceAll();
  if (act === "see-card") return seeCard(false);
  if (act === "share") return shareCard();
  if (act === "share-invite") return shareInvite();
  if (act === "copy-invite") return copyInvite();
  if (act === "add-person") {
    db.pendingInvite = user()?.inviteCode || null;
    return addPerson();
  }
  if (act === "join-invite") return addPerson();
  if (act === "dismiss-invite") {
    ui.inviteOffer = false;
    db.pendingInvite = null;
    persist();
    return render();
  }
  if (act === "save-nom") return saveNom();
  if (act === "add-child") return addChild();
  if (act === "switch-user") {
    db.currentUserId = btn.dataset.id;
    ui.mode = user()?.mode || ui.mode;
    persist();
    return go("home");
  }
  if (act === "save-profile") return saveProfile();
  if (act === "save-centre") return saveCentre();
  if (act === "export") return exportData();
  if (act === "delete-arm") {
    ui.deleteArmed = true;
    return render();
  }
  if (act === "delete-confirm") {
    db = blankState();
    persist();
    ui.deleteArmed = false;
    return go("home", true);
  }
}

function onInput(event) {
  const el = event.target;
  if (el?.dataset?.field) ui.form[el.dataset.field] = el.type === "checkbox" ? el.checked : el.value;
  if (el?.dataset?.act === "buddy") ui.buddy = el.checked;
}

async function chooseLang(code) {
  db.lang = code;
  db.askedLang = true;
  persist();
  await setLocale(code);
  document.title = displayName();
  go("home");
}

function startPath() {
  ui.mode = user()?.mode || ui.mode;
  if (!user()) {
    ui.step = 0;
    ui.form = { sex: "X", age: 14, mode: ui.mode };
    ui.adding = false;
    return go("onboard");
  }
  if (!canStartBattery(user())) return go("consent");
  ensureDraft();
  return go("battery");
}

function onboardNext() {
  readFields();
  const steps = wizard();
  const step = steps[ui.step];
  if (step === "name" && !String(ui.form.name || "").trim()) {
    ui.error = t("onboard.need");
    return render();
  }
  if (step === "age") {
    const age = Number(ui.form.age);
    if (!Number.isFinite(age) || age < 5 || age > 90 || !ui.form.sex) {
      ui.error = t("onboard.need");
      return render();
    }
  }
  ui.error = "";
  if (ui.step < steps.length - 1) {
    ui.step += 1;
    if (steps[ui.step] === "body") speak(t("c0.script"), currentLocale());
    return render();
  }
  if (Number(ui.form.age) < 18 && !ui.form.consent) return go("consent");
  commitUser();
  ensureDraft();
  go("battery");
}

function saveConsent() {
  readFields();
  if (!ui.form.consent || !String(ui.form.guardianName || "").trim()) {
    ui.error = t("consent.check");
    return render();
  }
  ui.form.guardianConsent = {
    name: String(ui.form.guardianName).trim(),
    at: new Date().toISOString(),
    statement: t("consent.check")
  };
  if (!user() || ui.adding) commitUser();
  else {
    user().guardianConsent = ui.form.guardianConsent;
    persist();
  }
  ensureDraft();
  go("battery");
}

function commitUser() {
  const fields = {
    name: ui.form.name,
    age: ui.form.age,
    sex: ui.form.sex || "X",
    heightCm: ui.form.heightCm,
    weightKg: ui.form.weightKg,
    sittingHeightCm: ui.form.sittingHeightCm,
    mode: ui.form.mode || ui.mode,
    sport: ui.form.sport || "",
    guardianConsent: ui.form.guardianConsent || null
  };
  const created = createUser(db, fields);
  if (db.pendingInvite) {
    const redeemed = redeemInvite(db, db.pendingInvite, created.id);
    if (!redeemed.ok && redeemed.reason === "self") ui.notice = t("invite.sub");
    db.pendingInvite = null;
    ui.inviteOffer = false;
  }
  db.currentUserId = created.id;
  ui.adding = false;
  persist();
}

function openTest(id) {
  if (!canStartBattery(user())) return go("consent");
  if (!visibleTests().includes(id) && !(ENABLE_OUTDOOR_TESTS && (id === "sprint" || id === "shuttle"))) return;
  cancelRun();
  stopSensorPreview();
  const saved = resumeTarget(db, STAGES[id]?.length);
  if (saved && saved.id === id && saved.index > 0) {
    ui.flow = { id, index: saved.index, card: "ready", parts: saved.parts || [], error: "", result: null, taps: 0, turns: 0, retries: 0 };
  } else {
    ui.flow = { id, index: 0, card: "ready", parts: [], error: "", result: null, taps: 0, turns: 0, retries: 0 };
  }
  ui.screen = "test";
  ui.watch = false;
  history.pushState({ screen: "test" }, "", `${location.pathname}${location.search}#/test`);
  ensureDraft();
  db.inProgress.testId = id;
  rememberFlow();
  render();
  speakClip(currentLocale(), `coach-${id}`, t(`coach.${id}`));
}

function restartTest() {
  const id = ui.flow?.id;
  ui.stuck = false;
  if (!id) return go("battery");
  if (db.inProgress) db.inProgress.resume = null;
  cancelRun();
  ui.flow = { id, index: 0, card: "ready", parts: [], error: "", result: null, taps: 0, turns: 0, retries: 0 };
  persist();
  render();
  speakClip(currentLocale(), `coach-${id}`, t(`coach.${id}`));
}

function rememberFlow() {
  if (!db.inProgress || !ui.flow) return;
  db.inProgress.resume = { id: ui.flow.id, index: ui.flow.index, parts: ui.flow.parts || [] };
  persist();
}

let sensorRec = null;
let sensorTimer = null;
function stopSensorPreview() {
  if (sensorTimer) clearInterval(sensorTimer);
  sensorTimer = null;
  if (sensorRec) sensorRec.stop();
  sensorRec = null;
}
function openSensors() {
  stopSensorPreview();
  ui.screen = "sensors";
  ui.sensorPerm = "";
  history.pushState({ screen: "sensors" }, "", `${location.pathname}${location.search}#/sensors`);
  render();
}
async function startSensorPreview() {
  const perm = await requestMotionPermission();
  ui.sensorPerm = perm === "granted" ? "granted" : perm;
  render();
  if (perm !== "granted") return;
  stopSensorPreview();
  sensorRec = startMotionRecording();
  sensorTimer = setInterval(() => {
    const samples = sensorRec?.samples || [];
    const last = samples[samples.length - 1];
    const stats = samplingStats(samples.slice(-40));
    const set = (id, value) => {
      const el = document.getElementById(id);
      if (el) el.textContent = value;
    };
    if (!last || last.missing) {
      set("s-status", t("sensor.none"));
      return;
    }
    if (last.noGravity) set("s-status", t("sensor.nograv"));
    else if (stats.fs && stats.fs < 15) set("s-status", t("sensor.slow"));
    else set("s-status", t("sensor.ok"));
    const mag = Math.hypot(last.ax || 0, last.ay || 0, last.az || 0);
    set("s-mag", (mag > 4 ? mag / 9.81 : mag).toFixed(2));
    set("s-rate", stats.fs ? String(Math.round(stats.fs)) : "0");
    const axes = document.getElementById("s-axes");
    if (axes) axes.textContent = `${t("sensor.axes")}: ${Number(last.ax).toFixed(1)}, ${Number(last.ay).toFixed(1)}, ${Number(last.az).toFixed(1)}`;
  }, 200);
}

async function allowWeather() {
  db.areaChoice = "allow";
  ui.weatherState = "loading";
  persist();
  render();
  try {
    db.area = await collectArea();
    ui.weatherState = "ready";
  } catch {
    db.area = null;
    ui.weatherState = "fail";
  }
  persist();
  render();
}

function needsMotion(stage) {
  return stage && !["rt", "tap", "ppg"].includes(stage.kind);
}

function gateSamples(samples) {
  const useful = (samples || []).filter((s) => !s.missing);
  if (useful.length < 8) return { ok: false, reason: "sensor" };
  const stats = samplingStats(samples);
  if (stats.noGravity) return { ok: false, reason: "nograv" };
  if (stats.fs > 0 && stats.fs < 15) return { ok: false, reason: "low_rate" };
  return null;
}

function startDemoVideo() {
  const video = document.querySelector("video.demo-video");
  if (!video) return;
  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;
  video.setAttribute("playsinline", "");
  video.setAttribute("webkit-playsinline", "");
  video.setAttribute("x5-playsinline", "");
  video.loop = true;
  if (!video.getAttribute("src") && video.querySelector("source")) video.src = video.querySelector("source").src;
  const hide = () => video.classList.add("failed");
  video.addEventListener("error", hide);
  const poster = video.parentElement?.querySelector(".demo-poster");
  if (poster) poster.addEventListener("error", () => poster.classList.add("off"));
  const played = video.play();
  if (played && played.catch) {
    played.catch((err) => {
      if (err && err.name === "NotAllowedError") return;
      hide();
    });
  }
}

function debugPanel() {
  const samples = ui.debugSamples || [];
  const stats = samplingStats(samples);
  const mags = samples.filter((s) => !s.missing).map((s) => {
    const mag = Math.hypot(Number(s.ax) || 0, Number(s.ay) || 0, Number(s.az) || 0);
    return mag > 4 ? mag / 9.80665 : mag;
  });
  const min = mags.length ? Math.min(...mags) : 0;
  const max = mags.length ? Math.max(...mags) : 0;
  const head = samples
    .slice(0, 8)
    .map((s) => `${Number(s.t).toFixed(2)}  ${Number(s.ax).toFixed(2)}, ${Number(s.ay).toFixed(2)}, ${Number(s.az).toFixed(2)}`)
    .join("\n");
  const text = `n ${samples.length}\nfs ${Number(stats.fs).toFixed(1)}\nnoGravity ${stats.noGravity}\nmin g ${min.toFixed(2)}\nmax g ${max.toFixed(2)}\n${head}`;
  return `<pre class="debug-log">${esc(text)}</pre>`;
}

function reasonKey(testId, reason) {
  let code = reason || "unclear";
  if ((testId === "sprint" || testId === "shuttle") && (code === "unclear" || code === "short" || code === "flat")) code = testId;
  if ((testId === "react" || testId === "tap") && code === "small") code = "taps";
  return ERR[code] || (testId === "sprint" ? ERR.sprint : testId === "shuttle" ? ERR.shuttle : "err.cmj.unclear");
}

function sayFix(testId, reason) {
  const key = reasonKey(testId, reason);
  speakClip(currentLocale(), "try-again", `${t("coach.try")} ${t(key)}`);
}

function paceStage(stage) {
  if (!stage?.seconds) return stage;
  let fast = false;
  try {
    fast = new URLSearchParams(location.search).has("fast");
  } catch {
    fast = false;
  }
  if (fast && stage.seconds >= 4) {
    const seconds = stage.kind === "steps" && stage.id === "trial" ? 4 : stage.kind === "repeat" ? 3.2 : 2.5;
    return { ...stage, seconds: Math.min(stage.seconds, seconds) };
  }
  return stage;
}

function restoreResume() {
  const saved = db.inProgress?.resume;
  const count = STAGES[saved?.id]?.length;
  const target = resumeTarget(db, count);
  if (!target || !user()) return false;
  ui.flow = {
    id: target.id,
    index: target.index,
    card: "ready",
    parts: target.parts,
    error: "",
    result: null,
    taps: 0,
    turns: 0,
    retries: 0
  };
  ui.screen = "test";
  return true;
}

let prerollRec = null;

async function runStage(fromSample) {
  const flow = ui.flow;
  if (!flow || flow.card === "do") return;
  const token = ++ui.runToken;
  ui.cancelers = [];
  const stage = STAGES[flow.id][flow.index];
  if (!stage) return;
  flow.error = "";
  unlockVoice();
  try {
    if (!fromSample && needsMotion(stage)) {
      const permPromise = requestMotionPermission();
      const perm = await permPromise;
      if (perm !== "granted") {
        flow.error = perm === "denied" ? "denied" : perm === "insecure" ? "insecure" : perm === "unavailable" ? "unavailable" : "sensor";
        flow.card = "ready";
        render();
        sayFix(flow.id, flow.error);
        return;
      }
      await holdScreenAwake();
      prerollRec = startMotionRecording();
    }
    const paced = paceStage(stage);
    if (paced.kind !== "ppg" && paced.kind !== "rt" && paced.kind !== "tap") await countdown(token, paced.kind);
    else if (stage.kind !== "ppg") {
      flow.card = "do";
      render();
    }
    if (token !== ui.runToken) return;
    let piece = null;
    if (paced.kind === "cmj") piece = await captureCmj(paced, token);
    else if (paced.kind === "repeat") piece = await captureRepeat(paced, token);
    else if (paced.kind === "balance") piece = await captureBalance(paced, token);
    else if (paced.kind === "situp") piece = await captureSitup(paced, token);
    else if (paced.kind === "steps") piece = await captureSteps(paced, token);
    else if (paced.kind === "ppg") piece = await capturePpg(paced, token);
    else if (paced.kind === "rt") piece = await captureRt(paced, token);
    else if (paced.kind === "tap") piece = await captureTap(paced, token);
    else if (paced.kind === "sprint") piece = await captureSprint(token);
    else if (paced.kind === "shuttle") piece = await captureShuttle(token);
    if (token !== ui.runToken || !piece) return;
    piece.stage = stage.id;
    if (shouldHoldStage(stage, piece)) {
      flow.retries = (flow.retries || 0) + 1;
      flow.error = piece.reason || "unclear";
      flow.card = "ready";
      flow.count = "";
      render();
      sayFix(flow.id, flow.error);
      return;
    }
    flow.retries = 0;
    if (!piece.ok && stage.kind === "ppg") {
      flow.parts.push({ ...piece, stage: stage.id, bpm: null, skippedHeart: true });
      flow.error = piece.reason || "finger";
      sayFix(flow.id, "finger");
    } else flow.parts.push(piece);
    flow.index += 1;
    rememberFlow();
    if (flow.index >= STAGES[flow.id].length) return finishFlow(false);
    flow.card = "ready";
    flow.error = stage.kind === "ppg" && !piece.ok ? piece.reason : "";
    render();
    speakClip(currentLocale(), "rest", t("coach.rest"));
  } catch (error) {
    if (error?.message !== "cancel") {
      flow.error = flow.id === "sprint" || flow.id === "shuttle" ? flow.id : "unclear";
      flow.card = "ready";
      flow.count = "";
      render();
      sayFix(flow.id, flow.error);
    }
  }
}

async function countdown(token, kind) {
  const locale = currentLocale();
  const voice = takeCueToken();
  ui.flow.card = "do";
  ui.flow.count = "";
  ui.flow.cue = t("live.hold");
  render();
  await playCue(voice, locale, "hold-still", t("live.hold"));
  if (token !== ui.runToken) throw new Error("cancel");
  for (const n of [3, 2, 1]) {
    if (token !== ui.runToken) throw new Error("cancel");
    ui.flow.count = n;
    ui.flow.cue = String(n);
    const count = document.getElementById("count");
    if (count) count.textContent = String(n);
    const cue = document.getElementById("cue");
    if (cue) cue.textContent = String(n);
    beep(n === 1 ? 880 : 620, 90);
    await playCue(voice, locale, `count-${n}`, String(n));
  }
  if (token !== ui.runToken) throw new Error("cancel");
  const goCue = kind === "cmj" || kind === "repeat" ? t("live.jump") : t("live.keep");
  ui.flow.cue = goCue;
  ui.flow.count = t("coach.go");
  const cue = document.getElementById("cue");
  if (cue) cue.textContent = goCue;
  const count = document.getElementById("count");
  if (count) count.textContent = t("coach.go");
  beep(990, 160);
  await playCue(voice, locale, kind === "cmj" || kind === "repeat" ? "jump-now" : "go", goCue);
}

async function recordSeconds(seconds, token, kind) {
  const rec = prerollRec || startMotionRecording();
  prerollRec = null;
  ui.flow.rec = rec;
  const start = performance.now();
  const timer = setInterval(() => {
    const left = Math.max(0, seconds - (performance.now() - start) / 1000);
    const count = document.getElementById("count");
    if (count) count.textContent = `${Math.ceil(left)}s`;
    const last = rec.samples[rec.samples.length - 1];
    const meter = document.getElementById("meter");
    if (meter && last && !last.missing) {
      const mag = Math.hypot(last.ax || 0, last.ay || 0, last.az || 0);
      const bw = mag > 4 ? mag / 9.81 : mag || 1;
      meter.style.width = `${Math.max(8, Math.min(100, bw * 40))}%`;
    }
    const cue = liveCue(rec.samples, kind || "cmj");
    const label = cue.id === "landed" ? t("live.landed", { s: "" }) : t(`live.${cue.id}`);
    const cueEl = document.getElementById("cue");
    if (cueEl && label) cueEl.textContent = label;
  }, 250);
  ui.cancelers.push(() => clearInterval(timer));
  await sleep(seconds * 1000);
  clearInterval(timer);
  if (token !== ui.runToken) throw new Error("cancel");
  ui.debugSamples = rec.stop();
  return ui.debugSamples;
}

async function captureCmj(stage, token) {
  const samples = await recordSeconds(stage.seconds, token, "cmj");
  const gate = gateSamples(samples);
  if (gate) return gate;
  const raw = liveCmj(samples, user() || {});
  if (raw.flightS) {
    const line = t("live.landed", { s: Number(raw.flightS).toFixed(2) });
    const cue = document.getElementById("cue");
    if (cue) cue.textContent = line;
    speak(line, currentLocale());
  }
  return { ...raw, trace: traceFromSamples("cmj", samples, raw), stage: stage.id };
}
async function captureRepeat(stage, token) {
  const samples = await recordSeconds(stage.seconds, token, "repeat");
  const gate = gateSamples(samples);
  if (gate) return gate;
  const raw = liveRepeat(samples);
  return { ...raw, trace: traceFromSamples("repeat", samples, raw) };
}
async function captureBalance(stage, token) {
  ui.flow.foot = false;
  const samples = await recordSeconds(stage.seconds, token, "balance");
  const gate = gateSamples(samples);
  if (gate) return gate;
  const raw = { ...analyzeBalance(samples, { footTouched: ui.flow.foot }), leg: stage.id };
  return { ...raw, trace: traceFromSamples("balance", samples, raw) };
}
async function captureSitup(stage, token) {
  const samples = await recordSeconds(stage.seconds, token, "situp");
  const gate = gateSamples(samples);
  if (gate) return gate;
  const raw = liveSitup(samples);
  return { ...raw, trace: traceFromSamples("situp", samples, raw) };
}
async function captureSteps(stage, token) {
  const metro = setInterval(() => {
    ui.flow.up = !ui.flow.up;
    beep(ui.flow.up ? 740 : 520, 70);
  }, 1200);
  ui.flow.up = true;
  ui.cancelers.push(() => clearInterval(metro));
  const samples = await recordSeconds(stage.seconds, token, "step");
  clearInterval(metro);
  const gate = gateSamples(samples);
  if (gate) return gate;
  const counted = liveSteps(samples);
  if (stage.id === "practice") return { ...counted, ok: true };
  return counted;
}
async function capturePpg(stage, token) {
  ui.flow.card = "do";
  ui.flow.cue = t("live.cover");
  render();
  speakClip(currentLocale(), "cover-camera", t("live.cover"));
  const video = document.getElementById("ppg-video");
  const canvas = document.getElementById("ppg-canvas");
  if (!video || !canvas) return { ok: false, reason: "finger", bpm: null };
  const hr = await measureHeartRate(video, canvas, (stage.seconds || 12) * 1000, (cue) => {
    if (token !== ui.runToken) return;
    const el = document.getElementById("cue");
    if (el) el.textContent = t(cue === "cover" ? "live.cover" : "live.hold");
  });
  return { ok: hr.ok, reason: hr.reason, bpm: hr.bpm, torch: hr.torch, stage: stage.id };
}
async function captureRt(stage, token) {
  const times = [];
  for (let i = 0; i < stage.count; i++) {
    ui.flow.card = "do";
    ui.flow.rt = "wait";
    ui.flow.rtEarly = false;
    render();
    await sleep(800 + Math.random() * 1400);
    if (token !== ui.runToken) throw new Error("cancel");
    if (ui.flow.rtEarly) return { ok: false, reason: "early" };
    ui.flow.rt = "go";
    ui.flow.rtGo = performance.now();
    beep(880, 150);
    const pad = document.querySelector(".pad");
    if (pad) {
      pad.classList.add("go");
      pad.textContent = t("rt.go");
    }
    const dt = await new Promise((resolve, reject) => {
      ui.rtResolve = resolve;
      ui.cancelers.push(() => reject(new Error("cancel")));
    });
    times.push(dt);
  }
  ui.flow.rt = null;
  const summary = reactionSummary(times, false);
  if (stage.id === "rt-practice") return { ...summary, ok: true };
  return summary;
}
async function captureTap(stage, token) {
  ui.flow.card = "do";
  ui.flow.tapLive = true;
  ui.flow.taps = 0;
  render();
  await sleep(stage.seconds * 1000);
  if (token !== ui.runToken) throw new Error("cancel");
  ui.flow.tapLive = false;
  return tapSummary(ui.flow.taps, stage.seconds, false);
}
async function captureSprint(token) {
  const beepT = performance.now() / 1000;
  ui.flow.card = "do";
  ui.flow.count = t("coach.go");
  render();
  const rec = startMotionRecording();
  ui.flow.rec = rec;
  let origin = null;
  let last = null;
  const gps = watchGps((fix) => {
    last = fix;
    if (!origin) origin = fix;
    const dist = haversineMeters(origin, fix);
    if (dist != null && dist >= 30) ui.turnResolve?.("gps");
  });
  ui.flow.gps = gps;
  const how = await new Promise((resolve, reject) => {
    ui.turnResolve = resolve;
    ui.cancelers.push(() => reject(new Error("cancel")));
  });
  gps.stop();
  const samples = rec.stop();
  const finishT = performance.now() / 1000;
  const onset = detectMovementOnset(samples, samples[0] ? samples[0].t : 0);
  const dist = origin && last ? haversineMeters(origin, last) : null;
  return {
    ...sprintResult({
      beepT: 0,
      finishT: finishT - beepT,
      onsetT: onset,
      gpsDistanceM: dist,
      gpsAccuracyM: last?.accuracy
    }),
    gpsUsed: how === "gps"
  };
}
async function captureShuttle(token) {
  ui.flow.card = "do";
  ui.flow.turns = 0;
  ui.flow.count = t("coach.go");
  render();
  const beepT = performance.now();
  const turns = [];
  const rec = startMotionRecording();
  ui.flow.rec = rec;
  let lastGyro = 0;
  const timer = setInterval(() => {
    const last = rec.samples[rec.samples.length - 1];
    if (!last) return;
    const mag = Math.hypot(last.gx || 0, last.gy || 0, last.gz || 0);
    if (mag > 220 && performance.now() - lastGyro > 1200 && turns.length < 4) {
      lastGyro = performance.now();
      turns.push((performance.now() - beepT) / 1000);
      ui.flow.turns = turns.length;
      const el = document.getElementById("turns");
      if (el) el.textContent = `${turns.length} / 4`;
      beep(700, 80);
      if (turns.length >= 4) ui.turnResolve?.("gyro");
    }
  }, 100);
  ui.cancelers.push(() => clearInterval(timer));
  await new Promise((resolve, reject) => {
    ui.turnResolve = () => {
      if (turns.length < 4) {
        turns.push((performance.now() - beepT) / 1000);
        ui.flow.turns = turns.length;
        const el = document.getElementById("turns");
        if (el) el.textContent = `${turns.length} / 4`;
      }
      if (turns.length >= 4) resolve("done");
    };
    ui.cancelers.push(() => reject(new Error("cancel")));
  });
  clearInterval(timer);
  rec.stop();
  if (token !== ui.runToken) throw new Error("cancel");
  return shuttleResult(turns, 0);
}

function onRtPad() {
  const flow = ui.flow;
  if (!flow) return;
  if (flow.rt === "wait") flow.rtEarly = true;
  if (flow.rt === "go" && ui.rtResolve) {
    const dt = performance.now() - flow.rtGo;
    const done = ui.rtResolve;
    ui.rtResolve = null;
    done(dt);
  }
}
function onTap() {
  if (!ui.flow?.tapLive) return;
  ui.flow.taps += 1;
  const el = document.getElementById("tap-count");
  if (el) el.textContent = String(ui.flow.taps);
  beep(500, 30);
}
function onFoot() {
  if (ui.flow) ui.flow.foot = true;
}
function onShuttleTurn() {
  if (ui.turnResolve) ui.turnResolve("tap");
}

function skipPractice() {
  if (!ui.flow) return;
  ui.flow.index += 1;
  ui.flow.error = "";
  ui.flow.card = "ready";
  render();
}

function skipTest() {
  if (!ui.flow) return go("battery");
  cancelRun();
  ensureDraft();
  db.inProgress.tests[ui.flow.id] = { ok: false, skipped: true };
  persist();
  ui.flow = null;
  go("battery");
}

function useSample() {
  const flow = ui.flow;
  if (!flow) return;
  cancelRun();
  const id = flow.id;
  let result;
  if (id === "cmj") result = sampleCmjTrio();
  else if (id === "repeat") result = sampleRepeat();
  else if (id === "balance") result = sampleBalance();
  else if (id === "situp") result = sampleSitup();
  else if (id === "react") result = sampleReact();
  else if (id === "step") result = sampleStep();
  else if (id === "sprint") result = { ...sprintResult({ beepT: 0, finishT: 5.4, onsetT: 0.18, gpsDistanceM: 31, gpsAccuracyM: 6 }), sample: true };
  else result = { ...shuttleResult([2.5, 5.1, 7.8, 10.4], 0), sample: true };
  flow.result = result;
  flow.card = "done";
  flow.error = "";
  storeResult(id, result);
  render();
  speak(t(SCRIPT[id][2]), currentLocale());
}

function carryTrace(id, result, parts) {
  if (!result) return result;
  const pool = (parts || []).filter((p) => p?.trace);
  const chosen = pool[pool.length - 1];
  return chosen?.trace ? { ...result, trace: result.trace || chosen.trace } : result;
}

function finishFlow() {
  const flow = ui.flow;
  const id = flow.id;
  const result = carryTrace(id, combineParts(id, flow.parts), flow.parts);
  flow.result = result;
  flow.card = "done";
  if (db.inProgress) db.inProgress.resume = null;
  storeResult(id, result);
  releaseScreenAwake();
  render();
  speakResult(id, result);
}

function tagQuality(result, values, pick) {
  const summary = summarizeAttempts(values, pick);
  return {
    ...result,
    consistent: summary.consistent,
    unreliable: Boolean(summary.unreliable),
    average: summary.mean,
    quality: summary.consistent ? "good" : "retry"
  };
}

function speakResult(id, result) {
  if (!result || result.skipped) return;
  const locale = currentLocale();
  if (id === "cmj" && result.jumpHeightCm) speak(t("coach.result.cmj", { n: Math.round(result.jumpHeightCm) }), locale);
  else if (id === "repeat") speak(t("coach.result.repeat", { n: result.count || 0 }), locale);
  else if (id === "situp") speak(t("coach.result.situp", { n: result.reps || 0 }), locale);
  else if (id === "react") speak(t("coach.result.react", { n: Math.round(result.reaction?.medianMs || 0) }), locale);
  else if (id === "sprint" || id === "shuttle") speak(t(`coach.result.${id}`, { n: fmt(result.timeS, 1) }), locale);
  else speak(t(`coach.result.${id}`), locale);
}

function combineParts(id, parts) {
  if (id === "cmj") {
    const trials = parts.filter((p) => p.stage === "trial" && p.ok !== false && Number.isFinite(p.jumpHeightCm));
    const best = bestCmj(trials);
    if (!best) return { ok: false, reason: "unclear" };
    return tagQuality(best, trials.map((t) => t.jumpHeightCm), "max");
  }
  if (id === "repeat") {
    const trials = parts.filter((p) => p.stage === "trial" && p.ok);
    if (!trials.length) return { ok: false, reason: "lost" };
    const best = trials.reduce((a, b) => ((b.count || 0) > (a.count || 0) ? b : a));
    return tagQuality(best, trials.map((t) => t.count), "max");
  }
  if (id === "balance") {
    const left = parts.find((p) => p.leg === "left" || p.stage === "left");
    const right = parts.find((p) => p.leg === "right" || p.stage === "right");
    const combined = combineBalance(left, right, false);
    const consistent = Boolean(left?.ok && right?.ok);
    return { ...combined, consistent, unreliable: !consistent, quality: consistent ? "good" : "retry" };
  }
  if (id === "situp") {
    const trials = parts.filter((p) => p.stage === "trial" && p.ok);
    if (!trials.length) return { ok: false, reason: "small" };
    const best = trials.reduce((a, b) => ((b.reps || 0) > (a.reps || 0) ? b : a));
    return tagQuality(best, trials.map((t) => t.reps), "max");
  }
  if (id === "react") {
    const reaction = parts.find((p) => p.stage === "rt") || parts.find((p) => p.medianMs != null);
    const taps = parts.find((p) => p.stage === "tap") || parts.find((p) => p.taps != null);
    const times = reaction?.timesMs || [];
    const spread = summarizeAttempts(times, "min");
    const steady = times.length >= 3 && (spread.spread == null || spread.spread <= 0.5);
    return {
      ok: Boolean(reaction?.ok && taps?.ok),
      sample: false,
      reaction,
      taps,
      consistent: steady,
      unreliable: !steady,
      quality: reaction?.ok && taps?.ok && steady ? "good" : "retry"
    };
  }
  if (id === "step") {
    const steps = parts.find((p) => p.stage === "trial") || { steps: 0, ok: false };
    const pre = parts.find((p) => p.stage === "ppg1");
    const post = parts.find((p) => p.stage === "ppg2");
    const heart = Boolean(pre?.bpm && post?.bpm);
    const rated = stepQuality(steps.ok, heart);
    return {
      ok: Boolean(steps.ok),
      sample: false,
      steps: steps.steps || 0,
      preBpm: pre?.bpm || null,
      postBpm: post?.bpm || null,
      percentileKey: steps.ok ? "steps" : null,
      percentileValue: steps.steps || 0,
      reason: steps.reason || null,
      ...rated
    };
  }
  if (id === "sprint" || id === "shuttle") {
    const trials = parts.filter((p) => p?.ok && Number.isFinite(p.timeS));
    if (!trials.length) return parts.find((p) => p) || { ok: false, reason: "unclear" };
    const best = trials.reduce((a, b) => (b.timeS < a.timeS ? b : a));
    return tagQuality(best, trials.map((t) => t.timeS), "min");
  }
  return parts[0] || { ok: false, reason: "unclear" };
}

function storeResult(id, result) {
  ensureDraft();
  const athlete = user();
  const wrapped = attachPercentiles({ [id]: result }, athlete)[id];
  db.inProgress.tests[id] = wrapped;
  db.inProgress.testId = null;
  if (wrapped?.ok && !wrapped.sample) markInviteQc(db, athlete.id);
  persist();
}

function practiceAll() {
  if (!canStartBattery(user())) return go("consent");
  ensureDraft();
  const tests = {
    cmj: sampleCmjTrio(),
    repeat: sampleRepeat(),
    balance: sampleBalance(),
    situp: sampleSitup(),
    react: sampleReact(),
    step: sampleStep()
  };
  db.inProgress.tests = tests;
  db.inProgress.practiceSession = true;
  seeCard(true);
}

function seeCard(practice) {
  const athlete = user();
  if (!athlete) return;
  const source = db.inProgress?.tests || {};
  const tests = attachPercentiles(source, athlete);
  const hasSample = practice || Object.values(tests).some((item) => item?.sample);
  const session = {
    id: newId(),
    athleteId: athlete.id,
    mode: athlete.mode,
    startedAt: db.inProgress?.startedAt || new Date().toISOString(),
    completedAt: new Date().toISOString(),
    tests,
    practiceSession: Boolean(practice || db.inProgress?.practiceSession),
    hasSample,
    maturityOffset: mirwaldMaturityOffset(athlete),
    coreComplete: CORE_TESTS.every((id) => tests[id] && (tests[id].ok || tests[id].skipped)),
    realCore: CORE_TESTS.every((id) => tests[id]?.ok && !tests[id].sample),
    qcPassed: CORE_TESTS.some((id) => tests[id]?.ok && !tests[id].sample),
    conditions: db.area ? { ...db.area } : null
  };
  db.sessions = dedupeSessions([session, ...db.sessions]).slice(0, 50);
  db.inProgress = null;
  ui.lastSessionId = session.id;
  persist();
  trySyncSession(session);
  go("results");
}

async function shareCard() {
  const session = db.sessions.find((s) => s.id === ui.lastSessionId);
  const who = user();
  if (!session || !who) return;
  const text = shareText(session, who);
  const canvas = drawCard(session, who);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  const file = new File([blob], "kheltara-card.png", { type: "image/png" });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ title: displayName(), text, files: [file] });
      return;
    }
  } catch (error) {
    if (error?.name === "AbortError") return;
  }
  try {
    if (navigator.share) {
      await navigator.share({ title: displayName(), text });
      return;
    }
  } catch (error) {
    if (error?.name === "AbortError") return;
  }
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener");
}

function shareText(session, who) {
  const lines = [
    `${displayName()}`,
    `${who.name}, ${who.age}`,
    who.verification === "centre-verified" ? t("results.centre") : t("results.self"),
    t("results.disclaimer")
  ];
  if (session.tests.cmj?.jumpHeightCm) lines.push(`${t("metric.jump")}: ${fmt(session.tests.cmj.jumpHeightCm, 1)} cm`);
  if (session.tests.situp?.reps != null) lines.push(`${t("metric.reps")}: ${session.tests.situp.reps}`);
  lines.push(inviteLink(who.inviteCode));
  return lines.join("\n");
}

function drawCard(session, who) {
  const canvas = document.createElement("canvas");
  canvas.width = 720;
  canvas.height = 960;
  const g = canvas.getContext("2d");
  g.fillStyle = "#F8FAFC";
  g.fillRect(0, 0, 720, 960);
  g.fillStyle = "#1D4ED8";
  g.fillRect(0, 0, 720, 180);
  g.fillStyle = "#ffffff";
  g.font = "800 56px Inter, sans-serif";
  g.fillText(displayName(), 48, 110);
  g.fillStyle = "#0F172A";
  g.font = "700 36px Inter, sans-serif";
  g.fillText(who.name, 48, 260);
  g.font = "600 24px Inter, sans-serif";
  g.fillStyle = "#475569";
  let y = 330;
  for (const [id, result] of Object.entries(session.tests)) {
    if (!result || result.skipped) continue;
    const row = rowsFor(id, result)[0];
    if (!row) continue;
    g.fillText(`${t("tests." + id)}: ${row[1]} ${row[2]}`, 48, y);
    y += 48;
  }
  g.fillStyle = "#B45309";
  g.font = "700 22px Nunito, sans-serif";
  wrapText(g, t("results.disclaimer"), 48, Math.min(y + 20, 820), 620, 30);
  return canvas;
}

function wrapText(g, text, x, y, max, lh) {
  const words = text.split(" ");
  let line = "";
  for (const word of words) {
    const trial = line ? `${line} ${word}` : word;
    if (g.measureText(trial).width > max) {
      g.fillText(line, x, y);
      line = word;
      y += lh;
    } else line = trial;
  }
  if (line) g.fillText(line, x, y);
}

async function shareInvite() {
  const who = user();
  if (!who) return;
  const text = `${displayName()}\n${inviteLink(who.inviteCode)}`;
  try {
    if (navigator.share) {
      await navigator.share({ title: displayName(), text });
      return;
    }
  } catch (error) {
    if (error?.name === "AbortError") return;
  }
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener");
}

async function copyInvite() {
  const who = user();
  if (!who) return;
  const link = inviteLink(who.inviteCode);
  try {
    await navigator.clipboard.writeText(link);
    ui.notice = t("invite.copied");
  } catch {
    ui.notice = link;
  }
  render();
}

function addPerson() {
  const code = user()?.inviteCode;
  if (db.pendingInvite == null && code) db.pendingInvite = code;
  if (!db.pendingInvite && code) db.pendingInvite = code;
  ui.adding = true;
  ui.step = 0;
  ui.form = { sex: "X", age: 12, mode: "casual" };
  ui.inviteOffer = false;
  persist();
  go("onboard");
}

function saveNom() {
  readFields();
  const who = user();
  if (!who) return startPath();
  const saved = addNomination(db, {
    nominatorId: who.id,
    name: ui.form.nomName,
    contact: ui.form.nomContact,
    under18: Boolean(ui.form.nomUnder),
    consentAttested: Boolean(ui.form.nomConsent),
    parentConsent: Boolean(ui.form.nomParent)
  });
  if (!saved.ok) {
    ui.error = t("nominate.need");
    ui.notice = "";
    return render();
  }
  persist();
  ui.error = "";
  ui.notice = `${t("nominate.saved")} ${saved.nomination.code}`;
  render();
}

function addChild() {
  readFields();
  const who = user();
  if (!who) return startPath();
  if (!ui.form.childConsent || !String(ui.form.childName || "").trim()) {
    ui.error = t("family.consent");
    return render();
  }
  const child = createUser(db, {
    name: ui.form.childName,
    age: ui.form.childAge,
    sex: ui.form.childSex || "X",
    mode: "casual",
    role: "child",
    guardianId: who.id,
    guardianConsent: { name: who.name, at: new Date().toISOString(), statement: t("family.consent") }
  });
  db.currentUserId = child.id;
  ui.form.childName = "";
  ui.error = "";
  persist();
  go("home");
}

function saveProfile() {
  readFields();
  const who = user();
  if (!who) return;
  who.name = String(ui.form.name || who.name).trim();
  who.age = Number(ui.form.age || who.age);
  who.orgName = ui.form.orgName || "";
  who.orgKind = ui.form.orgKind || "";
  who.orgRole = ui.form.orgRole || "";
  who.mode = ui.mode;
  persist();
  ui.notice = t("profile.saved");
  render();
}

function saveCentre() {
  readFields();
  const who = user();
  if (!who || !ui.form.centreCheck || !String(ui.form.centreName || "").trim()) return;
  who.verification = "centre-verified";
  who.centre = { name: ui.form.centreName, staff: ui.form.centreStaff || "", at: new Date().toISOString() };
  persist();
  ui.notice = t("results.centre");
  render();
}

function exportData() {
  const blob = new Blob([JSON.stringify(db, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "kheltara-data.json";
  a.click();
  URL.revokeObjectURL(a.href);
}

function icon(name) {
  const common = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
  const paths = {
    home: '<path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z"/>',
    run: '<circle cx="12" cy="5" r="2"/><path d="M8 21l2-6 3 2 2 4M7 10l3 1 2 3 4-1"/>',
    chart: '<path d="M4 19h16M7 16v-4M12 16V8M17 16v-6"/>',
    gift: '<rect x="4" y="10" width="16" height="10" rx="1"/><path d="M12 10v10M4 14h16M12 10c-2-4-6-4-6-1s4 1 6 1 6-2 6-1-4-3-6 1z"/>',
    back: '<path d="M15 5 8 12l7 7"/>',
    spark: '<path d="M12 3l1.6 5.2L19 10l-5.4 1.8L12 17l-1.6-5.2L5 10l5.4-1.8z"/>',
    lang: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3.2 3 14.8 0 18M12 3c-3 3.2-3 14.8 0 18"/>',
    phone: '<rect x="8" y="3" width="8" height="18" rx="2"/><path d="M11 18h2"/>',
    smile: '<circle cx="12" cy="12" r="9"/><path d="M8 13c1.2 2 6.8 2 8 0M9 9h.01M15 9h.01"/>',
    medal: '<circle cx="12" cy="14" r="5"/><path d="M9 4l3 6 3-6"/>',
    cmj: '<circle cx="12" cy="5" r="2"/><path d="M12 7v5M9 19l3-7 3 7"/>',
    repeat: '<path d="M7 7h8l-2-2M17 17H9l2 2"/><path d="M7 7v4M17 17v-4"/>',
    balance: '<circle cx="12" cy="5" r="2"/><path d="M12 7v8M12 15l-4 5M12 12l5 3"/>',
    situp: '<path d="M4 16h16M8 16c1-5 8-5 9 0"/><circle cx="8" cy="10" r="2"/>',
    react: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/>',
    step: '<circle cx="8" cy="6" r="2"/><path d="M8 8l-2 6 4 2 4-3 3 6"/>',
    sprint: '<circle cx="7" cy="6" r="2"/><path d="M6 20l3-6 3 2 5-8"/>',
    shuttle: '<path d="M4 12h16M16 8l4 4-4 4M8 8L4 12l4 4"/>',
    vol: '<path d="M4 10v4h3l4 3V7L7 10zM16 9a4 4 0 0 1 0 6"/>',
    mute: '<path d="M4 10v4h3l4 3V7L7 10zM16 10l4 4M20 10l-4 4"/>'
  };
  return `<svg ${common}>${paths[name] || paths.spark}</svg>`;
}

function art(name) {
  if (["hero", "hold", "cmj", "repeat", "balance", "situp", "step"].includes(name)) {
    return `<svg viewBox="0 0 160 140" class="art" aria-hidden="true">
      <rect x="18" y="108" width="124" height="10" rx="5" fill="var(--line)"/>
      <circle cx="78" cy="28" r="12" fill="var(--primary)"/>
      <path d="M78 40 v28" stroke="var(--ink)" stroke-width="6" stroke-linecap="round"/>
      <path d="M78 50 l-22 16M78 50 l18 10" stroke="var(--ink)" stroke-width="6" stroke-linecap="round"/>
      <path d="M78 68 l-16 32M78 68 l14 32" stroke="var(--primary)" stroke-width="6" stroke-linecap="round"/>
      <rect x="92" y="46" width="16" height="28" rx="3" fill="var(--mark)"/>
    </svg>`;
  }
  return `<div class="art-fallback">${icon(name)}</div>`;
}

async function boot() {
  db = loadState(localStorage);
  const params = new URLSearchParams(location.search);
  const invite = params.get("invite");
  if (invite) {
    db.pendingInvite = invite.toUpperCase();
    ui.inviteOffer = Boolean(db.currentUserId);
    persist();
  }
  ui.suggestedLang = matchNavigator(navigator.languages || [navigator.language]);
  setVoiceOn(db.voiceOn !== false);
  applyTextSize();
  if (!db.askedLang) {
    ui.screen = "language";
    if (!db.lang) db.lang = ui.suggestedLang || "en";
  } else if (!db.lang && ui.suggestedLang) {
    db.lang = ui.suggestedLang;
    persist();
  }
  await setLocale(db.lang || "en");
  document.title = displayName();
  const rootStyle = document.documentElement.style;
  rootStyle.setProperty("--primary", THEME.primary);
  rootStyle.setProperty("--bg", THEME.background);
  rootStyle.setProperty("--accent", THEME.accent);
  if (db.askedLang && restoreResume()) {
    history.replaceState({ screen: "test" }, "", `${location.pathname}${location.search}#/test`);
  } else if (db.askedLang && location.hash.startsWith("#/") && location.hash !== "#/test") {
    ui.screen = location.hash.slice(2);
  }
  document.body.addEventListener("click", onClick);
  document.body.addEventListener("pointerdown", onPointerDown);
  document.body.addEventListener("change", onInput);
  document.body.addEventListener("input", onInput);
  window.addEventListener("popstate", () => {
    const next = (location.hash || "#/home").replace("#/", "") || "home";
    cancelRun();
    if (next === "test") {
      if (!restoreResume()) ui.screen = "battery";
    } else ui.screen = next;
    if (ui.screen !== "sensors") stopSensorPreview();
    render();
  });
  if ("serviceWorker" in navigator && !location.search.includes("nosw=1")) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
  render();
}

boot();
