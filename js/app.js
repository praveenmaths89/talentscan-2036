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
import { beep, speak, stopSpeak } from "./audio.js";
import { haversineMeters, motionPermissionKind, requestMotionPermission, startMotionRecording, watchGps } from "./motion.js";
import { measureHeartRate } from "./ppg.js";
import { analyzeBalance, detectMovementOnset, mirwaldMaturityOffset } from "./signal.js";

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
    { id: "practice", seconds: 3, kind: "cmj" },
    { id: "trial", seconds: 4, kind: "cmj" },
    { id: "trial", seconds: 4, kind: "cmj" },
    { id: "trial", seconds: 4, kind: "cmj" }
  ],
  repeat: [
    { id: "practice", seconds: 5, kind: "repeat" },
    { id: "trial", seconds: 15, kind: "repeat" }
  ],
  balance: [
    { id: "left", seconds: 20, kind: "balance" },
    { id: "right", seconds: 20, kind: "balance" }
  ],
  situp: [
    { id: "practice", seconds: 6, kind: "situp" },
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
  sprint: [{ id: "trial", kind: "sprint" }],
  shuttle: [{ id: "trial", kind: "shuttle" }]
};
const ERR = {
  shake: "err.cmj.shake",
  knees: "err.cmj.knees",
  unclear: "err.cmj.unclear",
  lost: "err.repeat.lost",
  foot: "err.balance.foot",
  small: "err.situp.small",
  early: "err.rt.early",
  step: "err.step.miss",
  finger: "err.ppg.finger",
  low_rate: "qc.lowRate",
  short: "err.cmj.unclear",
  flat: "err.cmj.unclear",
  sensor: "err.sensor"
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
  lastSessionId: null
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
      <button type="button" class="icon-btn" data-act="goto" data-to="language" aria-label="${esc(t("home.language"))}">${icon("lang")}</button>
    </header>
    <main id="main">${body}</main>
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
    timeline: viewTimeline,
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
    <div class="modes" role="group" aria-label="${esc(t("profile.mode"))}">
      ${modeCard("casual")}
      ${modeCard("athlete")}
    </div>
    <button type="button" class="btn primary xl" data-act="start">${esc(draft ? t("home.continue") : t("home.start"))}</button>
    <p class="how">${icon("phone")} ${esc(t("home.how"))}</p>
    <div class="link-row">
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
    <div class="lang-grid">
      ${LOCALES.map((l) => {
        const on = l.code === cur;
        return `<button type="button" class="lang ${on ? "on" : ""}" data-act="lang" data-lang="${l.code}" lang="${l.code}" dir="${l.dir}" aria-pressed="${on}">
          <span class="native">${esc(l.native)}</span><small>${esc(l.name)}</small>
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
    body = `<p class="script" id="live">${esc(t("c0.script"))}</p>
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
    <button type="button" class="btn primary xl" data-act="onboard-next">${esc(t("onboard.next"))}</button></section>`,
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
    <button type="button" class="btn primary xl" data-act="save-consent">${esc(t("consent.save"))}</button></section>`,
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
  const errKey = flow.error && ERR[flow.error] ? ERR[flow.error] : "";
  let extra = "";
  if (card === "do" && flow.rt) {
    extra = `<button type="button" class="pad ${flow.rt === "go" ? "go" : ""}" data-act="rt-pad">${esc(flow.rt === "go" ? t("rt.go") : t("rt.wait"))}</button>`;
  } else if (card === "do" && flow.tapLive) {
    extra = `<p class="big-num" id="tap-count">${flow.taps || 0}</p>
      <div class="tap-row"><button type="button" class="btn primary" data-act="tap">${esc(t("tap.left"))}</button>
      <button type="button" class="btn primary" data-act="tap">${esc(t("tap.right"))}</button></div>`;
  } else if (card === "do" && stage?.kind === "ppg") {
    extra = `<p class="note">${esc(t("ppg.note"))}</p><video id="ppg-video" playsinline autoplay muted></video><canvas id="ppg-canvas" width="32" height="32" hidden></canvas>`;
  } else if (card === "do" && stage?.kind === "sprint") {
    extra = `<button type="button" class="btn primary xl" data-act="sprint-finish">${esc(t("sprint.mark"))}</button>`;
  } else if (card === "do" && stage?.kind === "shuttle") {
    extra = `<p class="big-num" id="turns">${flow.turns || 0} / 4</p><button type="button" class="btn primary xl" data-act="shuttle-turn">${esc(t("shuttle.turn"))}</button>`;
  } else if (card === "do") {
    extra = `<div class="meter" aria-hidden="true"><span id="meter"></span></div>`;
  }
  if (card === "done" && flow.result) extra = metricHtml(flow.id, flow.result);
  const hint = stageHint(flow, stage);
  return shell(
    `<section data-screen="test" data-test="${flow.id}">
      <div class="phases" aria-hidden="true">
        <span class="${card === "ready" ? "on" : ""}">${esc(t("test.ready"))}</span>
        <span class="${card === "do" ? "on" : ""}">${esc(t("test.do"))}</span>
        <span class="${card === "done" ? "on" : ""}">${esc(t("test.done"))}</span>
      </div>
      <div class="fig fig-${flow.id}">${art(flow.id)}</div>
      <h1>${esc(t("tests." + flow.id))}</h1>
      ${hint ? `<p class="kicker">${esc(hint)}</p>` : ""}
      <p class="script" id="live">${esc(stageScript())}</p>
      <p class="safety">${esc(t(SCRIPT[flow.id][3]))}</p>
      ${errKey ? `<p class="error" role="alert">${esc(t(errKey))}</p>` : ""}
      ${extra}
      <p class="count" id="count">${card === "do" && flow.count ? esc(String(flow.count)) : ""}</p>
      ${card === "ready" ? `
        <button type="button" class="btn primary xl" data-act="run-stage">${esc(primaryLabel(flow))}</button>
        <button type="button" class="btn ghost" data-act="use-sample">${esc(t("test.sample"))}</button>
        <p class="note">${esc(t("test.sample.sub"))}</p>
        ${motionPermissionKind() === "ios" ? `<p class="note">${esc(t("test.ios"))}</p>` : ""}
        ${flow.error && isPractice(stage) ? `<button type="button" class="btn ghost" data-act="skip-practice">${esc(t("test.skip"))}</button>` : ""}
        ${flow.id === "balance" && card === "ready" ? `<button type="button" class="btn ghost" data-act="foot">${esc(t("test.foot"))}</button>` : ""}
      ` : ""}
      ${card === "done" ? `<button type="button" class="btn primary xl" data-act="test-next">${esc(t("test.next"))}</button>` : ""}
      ${card === "do" ? `<button type="button" class="btn ghost" data-act="safety-stop">${esc(t("test.safetyStop"))}</button>` : ""}
      <button type="button" class="text-btn" data-act="hear">${esc(t("test.hear"))}</button>
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
function stageHint(flow, stage) {
  if (!stage || flow.card === "done") return "";
  if (flow.id === "cmj" && stage.id === "trial") {
    const n = (flow.parts || []).filter((p) => p.stage === "trial").length + 1;
    return t("test.trial", { n, m: 3 });
  }
  if (flow.id === "balance") return t(stage.id === "left" ? "test.leg.left" : "test.leg.right");
  if (stage.kind === "ppg") return t(stage.id === "ppg1" ? "ppg.before" : "ppg.after");
  return "";
}

function metricHtml(id, result) {
  if (!result || result.skipped) return `<p>${esc(t("battery.todo"))}</p>`;
  const rows = rowsFor(id, result);
  const pct = percentileOf(id, result);
  return `<ul class="metrics">${rows
    .map((r) => `<li><span>${esc(r[0])}</span><strong>${esc(r[1])} ${esc(r[2] || "")}</strong></li>`)
    .join("")}</ul>${
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
    return shell(`<section data-screen="results"><h1>${esc(t("results.title"))}</h1><p>${esc(t("results.empty"))}</p></section>`, { back: true });
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
      <div class="disclaimer box">${esc(t("results.disclaimer"))}</div>
      ${session.hasSample ? `<p class="note">${esc(t("results.sampleNote"))}</p>` : ""}
      ${mature}
      ${blocks || `<p>${esc(t("results.empty"))}</p>`}
      <p>${esc(t("results.referral"))}</p>
      <p><strong>${esc(t("results.notSelection"))}</strong></p>
      <button type="button" class="btn primary xl" data-act="share">${esc(t("results.share"))}</button>
      <button type="button" class="btn ghost" data-act="goto" data-to="timeline">${esc(t("timeline.title"))}</button>
    </section>`,
    { back: true, title: t("results.title") }
  );
}

function viewTimeline() {
  const who = user();
  const rows = db.sessions.filter((s) => s.athleteId === who?.id);
  const points = rows
    .slice()
    .reverse()
    .map((s) => s.tests?.cmj?.jumpHeightCm)
    .filter((n) => Number.isFinite(n));
  return shell(
    `<section data-screen="timeline"><h1>${esc(t("timeline.title"))}</h1>
    ${spark(points)}
    ${
      rows.length
        ? `<ul class="metrics">${rows
            .map((s) => {
              const jump = s.tests?.cmj?.jumpHeightCm;
              const when = new Date(s.completedAt).toLocaleDateString();
              return `<li><span>${esc(when)}</span><strong>${jump ? esc(fmt(jump, 1) + " " + t("unit.cm")) : "✓"}</strong></li>`;
            })
            .join("")}</ul>`
        : `<p>${esc(t("timeline.empty"))}</p>`
    }
    <p class="disclaimer">${esc(t("results.disclaimer"))}</p></section>`,
    { back: true, title: t("nav.progress") }
  );
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

function onClick(event) {
  const btn = event.target.closest("[data-act]");
  if (!btn) return;
  const act = btn.dataset.act;
  if (act === "buddy") return;
  if (act === "goto") return go(btn.dataset.to);
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
  if (act === "run-stage") return runStage(false);
  if (act === "use-sample") return useSample();
  if (act === "skip-practice") return skipPractice();
  if (act === "skip-test" || act === "safety-stop") return skipTest();
  if (act === "test-next") return go("battery");
  if (act === "hear") return speak(stageScript() || t("home.how"), currentLocale());
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
  ui.flow = { id, index: 0, card: "ready", parts: [], error: "", result: null, taps: 0, turns: 0 };
  ui.screen = "test";
  history.pushState({ screen: "test" }, "", `${location.pathname}${location.search}#/test`);
  ensureDraft();
  db.inProgress.testId = id;
  persist();
  render();
  speak(t(SCRIPT[id][0]), currentLocale());
}

async function runStage(fromSample) {
  const flow = ui.flow;
  if (!flow || flow.card === "do") return;
  const token = ++ui.runToken;
  ui.cancelers = [];
  const stage = STAGES[flow.id][flow.index];
  if (!stage) return;
  flow.error = "";
  try {
    if (!fromSample && stage.kind !== "rt" && stage.kind !== "tap" && stage.kind !== "ppg") {
      const perm = await requestMotionPermission();
      if (perm === "denied") {
        flow.error = "sensor";
        flow.card = "ready";
        render();
        return;
      }
    }
    speak(t(SCRIPT[flow.id][1]), currentLocale());
    if (stage.kind !== "ppg") await countdown(token);
    if (token !== ui.runToken) return;
    let piece = null;
    if (stage.kind === "cmj") piece = await captureCmj(stage, token);
    else if (stage.kind === "repeat") piece = await captureRepeat(stage, token);
    else if (stage.kind === "balance") piece = await captureBalance(stage, token);
    else if (stage.kind === "situp") piece = await captureSitup(stage, token);
    else if (stage.kind === "steps") piece = await captureSteps(stage, token);
    else if (stage.kind === "ppg") piece = await capturePpg(stage, token);
    else if (stage.kind === "rt") piece = await captureRt(stage, token);
    else if (stage.kind === "tap") piece = await captureTap(stage, token);
    else if (stage.kind === "sprint") piece = await captureSprint(token);
    else if (stage.kind === "shuttle") piece = await captureShuttle(token);
    if (token !== ui.runToken || !piece) return;
    piece.stage = stage.id;
    const blocking = !isPractice(stage);
    if (!piece.ok && blocking && stage.kind !== "ppg") {
      flow.error = piece.reason || "unclear";
      flow.card = "ready";
      render();
      return;
    }
    if (!piece.ok && stage.kind === "ppg") {
      flow.parts.push({ ...piece, stage: stage.id, bpm: null, skippedHeart: true });
      flow.error = piece.reason || "finger";
    } else flow.parts.push(piece);
    flow.index += 1;
    if (flow.index >= STAGES[flow.id].length) return finishFlow(false);
    flow.card = "ready";
    flow.error = stage.kind === "ppg" && !piece.ok ? piece.reason : "";
    render();
    speak(t(SCRIPT[flow.id][2]), currentLocale());
  } catch (error) {
    if (error?.message !== "cancel") {
      flow.error = "unclear";
      flow.card = "ready";
      render();
    }
  }
}

async function countdown(token) {
  ui.flow.card = "do";
  ui.flow.count = 3;
  render();
  for (const n of [3, 2, 1]) {
    if (token !== ui.runToken) throw new Error("cancel");
    const el = document.getElementById("count");
    if (el) el.textContent = String(n);
    beep(n === 1 ? 880 : 620, 130);
    await sleep(650);
  }
  beep(990, 200);
  const el = document.getElementById("count");
  if (el) el.textContent = t("test.recording");
}

async function recordSeconds(seconds, token, onTick) {
  const rec = startMotionRecording();
  ui.flow.rec = rec;
  const start = performance.now();
  const timer = setInterval(() => {
    const left = Math.max(0, seconds - (performance.now() - start) / 1000);
    const count = document.getElementById("count");
    if (count) count.textContent = `${Math.ceil(left)}s`;
    const last = rec.samples[rec.samples.length - 1];
    const meter = document.getElementById("meter");
    if (meter && last) meter.style.width = `${Math.max(6, Math.min(100, last.bw * 30))}%`;
    if (onTick) onTick(rec, last);
  }, 200);
  ui.cancelers.push(() => clearInterval(timer));
  await sleep(seconds * 1000);
  clearInterval(timer);
  if (token !== ui.runToken) throw new Error("cancel");
  return rec.stop();
}

async function captureCmj(stage, token) {
  const samples = await recordSeconds(stage.seconds, token);
  if (samples.length < 8) return { ok: false, reason: "sensor", stage: stage.id };
  const raw = liveCmj(samples, user() || {});
  return { ...raw, stage: stage.id };
}
async function captureRepeat(stage, token) {
  const samples = await recordSeconds(stage.seconds, token);
  if (samples.length < 8) return { ok: false, reason: "sensor" };
  return liveRepeat(samples);
}
async function captureBalance(stage, token) {
  let foot = false;
  ui.flow.foot = false;
  const samples = await recordSeconds(stage.seconds, token);
  foot = ui.flow.foot;
  if (samples.length < 8) return { ok: false, reason: "sensor" };
  return { ...analyzeBalance(samples, { footTouched: foot }), leg: stage.id };
}
async function captureSitup(stage, token) {
  const samples = await recordSeconds(stage.seconds, token);
  if (samples.length < 8) return { ok: false, reason: "sensor" };
  return liveSitup(samples);
}
async function captureSteps(stage, token) {
  const metro = setInterval(() => beep(ui.flow.up ? 520 : 740, 70), 1200);
  ui.flow.up = true;
  ui.cancelers.push(() => clearInterval(metro));
  const samples = await recordSeconds(stage.seconds, token);
  clearInterval(metro);
  if (samples.length < 8) return { ok: false, reason: "sensor" };
  const counted = liveSteps(samples);
  if (stage.id === "practice") return { ...counted, ok: true };
  return counted;
}
async function capturePpg(stage) {
  ui.flow.card = "do";
  render();
  const video = document.getElementById("ppg-video");
  const canvas = document.getElementById("ppg-canvas");
  if (!video || !canvas) return { ok: false, reason: "finger", bpm: null };
  const hr = await measureHeartRate(video, canvas, (stage.seconds || 12) * 1000);
  return { ok: hr.ok, reason: hr.reason, bpm: hr.bpm, stage: stage.id };
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

function finishFlow() {
  const flow = ui.flow;
  const id = flow.id;
  const result = combineParts(id, flow.parts);
  flow.result = result;
  flow.card = "done";
  storeResult(id, result);
  render();
  speak(t(SCRIPT[id][2]), currentLocale());
}

function combineParts(id, parts) {
  if (id === "cmj") {
    const trials = parts.filter((p) => p.stage === "trial");
    return bestCmj(trials) || { ok: false, reason: "unclear" };
  }
  if (id === "repeat") return parts.filter((p) => p.stage === "trial").pop() || { ok: false, reason: "lost" };
  if (id === "balance") {
    const left = parts.find((p) => p.leg === "left" || p.stage === "left");
    const right = parts.find((p) => p.leg === "right" || p.stage === "right");
    return combineBalance(left, right, false);
  }
  if (id === "situp") return parts.filter((p) => p.stage === "trial").pop() || { ok: false, reason: "small" };
  if (id === "react") {
    const reaction = parts.find((p) => p.stage === "rt") || parts.find((p) => p.medianMs != null);
    const taps = parts.find((p) => p.stage === "tap") || parts.find((p) => p.taps != null);
    return { ok: Boolean(reaction?.ok && taps?.ok), sample: false, reaction, taps };
  }
  if (id === "step") {
    const steps = parts.find((p) => p.stage === "trial") || { steps: 0, ok: false };
    const pre = parts.find((p) => p.stage === "ppg1");
    const post = parts.find((p) => p.stage === "ppg2");
    return {
      ok: Boolean(steps.ok),
      sample: false,
      steps: steps.steps || 0,
      preBpm: pre?.bpm || null,
      postBpm: post?.bpm || null,
      percentileKey: steps.ok ? "steps" : null,
      percentileValue: steps.steps || 0,
      reason: steps.reason || null
    };
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
    qcPassed: CORE_TESTS.some((id) => tests[id]?.ok && !tests[id].sample)
  };
  db.sessions.unshift(session);
  db.sessions = db.sessions.slice(0, 50);
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
  g.fillStyle = "#F7FAFC";
  g.fillRect(0, 0, 720, 960);
  g.fillStyle = "#0D9488";
  g.fillRect(0, 0, 720, 180);
  g.fillStyle = "#ffffff";
  g.font = "800 56px Nunito, sans-serif";
  g.fillText(displayName(), 48, 110);
  g.fillStyle = "#134E4A";
  g.font = "700 36px Nunito, sans-serif";
  g.fillText(who.name, 48, 260);
  g.font = "600 24px Nunito, sans-serif";
  g.fillStyle = "#5B6B73";
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
    shuttle: '<path d="M4 12h16M16 8l4 4-4 4M8 8L4 12l4 4"/>'
  };
  return `<svg ${common}>${paths[name] || paths.spark}</svg>`;
}

function art(name) {
  if (["hero", "hold", "cmj", "repeat", "balance", "situp", "step"].includes(name)) {
    return `<svg viewBox="0 0 160 140" class="art" aria-hidden="true">
      <rect x="18" y="108" width="124" height="10" rx="5" fill="#99f6e4"/>
      <circle cx="78" cy="28" r="12" fill="#0D9488"/>
      <path d="M78 40 v28" stroke="#134E4A" stroke-width="6" stroke-linecap="round"/>
      <path d="M78 50 l-22 16M78 50 l18 10" stroke="#134E4A" stroke-width="6" stroke-linecap="round"/>
      <path d="M78 68 l-16 32M78 68 l14 32" stroke="#0F766E" stroke-width="6" stroke-linecap="round"/>
      <rect x="92" y="46" width="16" height="28" rx="3" fill="#F59E0B"/>
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
  if (!db.lang) {
    const detected = matchNavigator(navigator.languages || [navigator.language]);
    if (detected) {
      db.lang = detected;
      persist();
    } else ui.screen = "language";
  }
  await setLocale(db.lang || "en");
  document.title = displayName();
  const rootStyle = document.documentElement.style;
  rootStyle.setProperty("--primary", THEME.primary);
  rootStyle.setProperty("--bg", THEME.background);
  rootStyle.setProperty("--accent", THEME.accent);
  if (location.hash.startsWith("#/") && location.hash !== "#/test") ui.screen = location.hash.slice(2);
  document.body.addEventListener("click", onClick);
  document.body.addEventListener("change", onInput);
  document.body.addEventListener("input", onInput);
  window.addEventListener("popstate", () => {
    const next = (location.hash || "#/home").replace("#/", "") || "home";
    ui.screen = next === "test" ? "battery" : next;
    cancelRun();
    render();
  });
  if ("serviceWorker" in navigator && !location.search.includes("nosw=1")) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
  render();
}

boot();
