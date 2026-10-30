let audioCtx = null;

function context() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  if (!audioCtx) audioCtx = new Ctx();
  if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
  return audioCtx;
}

export function beep(freq = 660, durationMs = 140) {
  try {
    const ctx = context();
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.value = 0.12;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    const stopAt = ctx.currentTime + durationMs / 1000;
    gain.gain.exponentialRampToValueAtTime(0.0001, stopAt);
    osc.stop(stopAt + 0.02);
  } catch {
    /* audio is optional */
  }
}

const SPEECH_LANG = {
  en: "en-IN",
  hi: "hi-IN",
  ur: "ur-IN",
  ks: "ks-IN",
  ta: "ta-IN",
  te: "te-IN",
  bn: "bn-IN",
  mr: "mr-IN",
  gu: "gu-IN",
  kn: "kn-IN",
  ml: "ml-IN",
  pa: "pa-IN",
  or: "or-IN",
  as: "as-IN",
  ne: "ne-NP"
};

export function speak(text, locale = "en") {
  try {
    if (!text || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(String(text).replace(/\[BEEP\]/g, ""));
    utter.lang = SPEECH_LANG[locale] || locale;
    utter.rate = 0.95;
    window.speechSynthesis.speak(utter);
  } catch {
    /* speech is optional */
  }
}

export function stopSpeak() {
  try {
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
  } catch {
    /* ignore */
  }
}
