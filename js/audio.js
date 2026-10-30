let audioCtx = null;
let voiceOn = true;
let chosen = null;
let voicesReady = null;
const missingClips = new Set();
let currentAudio = null;

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

export const SPEECH_LANG = {
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

export function setVoiceOn(on) {
  voiceOn = Boolean(on);
  if (!voiceOn) stopSpeak();
}

export function isVoiceOn() {
  return voiceOn;
}

/** Higher is better. -1 means the voice is the wrong language. */
export function scoreVoice(voice, locale) {
  const lang = String(voice?.lang || "").toLowerCase().replace(/_/g, "-");
  const name = String(voice?.name || "").toLowerCase();
  const want = (SPEECH_LANG[locale] || locale || "en").toLowerCase();
  const base = want.split("-")[0];
  let score = 0;
  if (lang === want) score += 100;
  else if (lang.startsWith(`${base}-`) || lang === base) score += 45;
  else return -1;
  if (name.includes("google")) score += 35;
  if (name.includes("neural") || name.includes("natural") || name.includes("wavenet")) score += 30;
  if (name.includes("enhanced") || name.includes("premium")) score += 24;
  if (name.includes("compact") || name.includes("espeak") || name.includes("eloquence")) score -= 25;
  if (voice?.localService === false) score += 8;
  return score;
}

export function pickVoice(voices, locale) {
  let best = null;
  let bestScore = 0;
  for (const voice of voices || []) {
    const score = scoreVoice(voice, locale);
    if (score > bestScore) {
      bestScore = score;
      best = voice;
    }
  }
  return best;
}

export function loadVoices() {
  if (typeof window === "undefined" || !window.speechSynthesis) return Promise.resolve([]);
  if (voicesReady) return voicesReady;
  voicesReady = new Promise((resolve) => {
    const synth = window.speechSynthesis;
    const ready = synth.getVoices();
    if (ready && ready.length) {
      resolve(ready);
      return;
    }
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      resolve(synth.getVoices() || []);
    };
    synth.addEventListener("voiceschanged", finish, { once: true });
    setTimeout(finish, 1500);
  });
  return voicesReady;
}

async function ensureVoice(locale) {
  const voices = await loadVoices();
  chosen = pickVoice(voices, locale) || pickVoice(voices, "en");
  return chosen;
}

export function speak(text, locale = "en") {
  try {
    if (!voiceOn || !text || typeof window === "undefined" || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(String(text).replace(/\[BEEP\]/g, ""));
    utter.lang = SPEECH_LANG[locale] || locale;
    utter.rate = 0.9;
    utter.pitch = 1;
    if (chosen && scoreVoice(chosen, locale) > 0) utter.voice = chosen;
    else ensureVoice(locale).then((voice) => {
      if (voice) chosen = voice;
    });
    window.speechSynthesis.speak(utter);
  } catch {
    /* speech is optional */
  }
}

export function speakClip(locale, clipId, text) {
  if (!voiceOn) return;
  const key = `${locale}/${clipId}`;
  if (clipId && !missingClips.has(key) && typeof Audio !== "undefined") {
    try {
      if (currentAudio) {
        currentAudio.pause();
        currentAudio = null;
      }
      const audio = new Audio(`./assets/voice/${locale}/${clipId}.mp3`);
      currentAudio = audio;
      audio.onerror = () => {
        missingClips.add(key);
        if (currentAudio === audio) currentAudio = null;
        speak(text, locale);
      };
      audio.play().catch(() => {
        missingClips.add(key);
        speak(text, locale);
      });
      return;
    } catch {
      missingClips.add(key);
    }
  }
  speak(text, locale);
}

export function stopSpeak() {
  try {
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    if (currentAudio) {
      currentAudio.pause();
      currentAudio = null;
    }
  } catch {
    /* ignore */
  }
}

loadVoices().then((voices) => {
  chosen = pickVoice(voices, "en");
});
