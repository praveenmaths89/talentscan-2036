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
  if (name.includes("samsung")) score += 28;
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

let cueToken = 0;
const CLIP_LOCALES = new Set(["en", "hi"]);

export function hasVoiceClip(locale) {
  const code = String(locale || "").toLowerCase().split("-")[0];
  return CLIP_LOCALES.has(code);
}

/** A pause from the next cue is not a missing file. */
export function clipFailureShouldSpeak(err) {
  if (!err) return false;
  if (err.name === "AbortError" || err.aborted) return false;
  return true;
}

/** Call from the button tap, before any await, so iOS allows later speech. */
export function unlockVoice() {
  try {
    const ctx = context();
    if (ctx) {
      const buffer = ctx.createBuffer(1, 1, 22050);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(ctx.destination);
      src.start(0);
    }
  } catch {
    /* ignore */
  }
  try {
    if (typeof window !== "undefined" && window.speechSynthesis) {
      const primer = new SpeechSynthesisUtterance(" ");
      primer.volume = 0;
      primer.rate = 2;
      window.speechSynthesis.speak(primer);
    }
    if (typeof Audio !== "undefined") {
      const warm = new Audio("./assets/voice/en/count-3.mp3");
      warm.muted = true;
      const played = warm.play();
      if (played) played.then(() => warm.pause()).catch(() => {});
    }
  } catch {
    /* ignore */
  }
}

export function takeCueToken() {
  stopSpeak();
  return cueToken;
}

export function stopSpeak() {
  cueToken += 1;
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

export function speak(text, locale = "en") {
  const token = ++cueToken;
  return playCue(token, locale, "", text);
}

export function speakClip(locale, clipId, text) {
  const token = ++cueToken;
  return playCue(token, locale, clipId, text);
}

/** One ordered line. Later calls cancel anything still playing. */
export function playCue(token, locale, clipId, text) {
  if (!voiceOn) return Promise.resolve(false);
  return playOne(token, locale, clipId, text);
}

function playOne(token, locale, clipId, text) {
  if (token !== cueToken) return Promise.resolve(false);
  if (currentAudio) {
    currentAudio.pause();
    currentAudio = null;
  }
  const key = `${locale}/${clipId}`;
  if (clipId && hasVoiceClip(locale) && !missingClips.has(key) && typeof Audio !== "undefined") {
    return playFile(token, `./assets/voice/${locale}/${clipId}.mp3`).then(
      (ok) => ok === true,
      (err) => {
        if (!clipFailureShouldSpeak(err)) return false;
        missingClips.add(key);
        return playUtterance(token, text, locale);
      }
    );
  }
  return playUtterance(token, text, locale);
}

function playFile(token, url) {
  return new Promise((resolve, reject) => {
    if (token !== cueToken) return resolve(false);
    if (currentAudio) {
      currentAudio.pause();
      currentAudio = null;
    }
    const audio = new Audio(url);
    currentAudio = audio;
    audio.preload = "auto";
    let settled = false;
    const succeed = () => {
      if (settled) return;
      settled = true;
      if (currentAudio === audio) currentAudio = null;
      resolve(true);
    };
    const fail = (err) => {
      if (settled) return;
      settled = true;
      if (currentAudio === audio) currentAudio = null;
      reject(err || new Error("clip"));
    };
    audio.onended = succeed;
    audio.onerror = () => fail(Object.assign(new Error("missing"), { missing: true }));
    const played = audio.play();
    if (played && played.catch) {
      played.catch((err) => {
        if (err?.name === "AbortError") {
          if (settled) return;
          settled = true;
          if (currentAudio === audio) currentAudio = null;
          resolve(false);
          return;
        }
        fail(err);
      });
    }
    // Let a short countdown word finish. Do not pause it early.
    setTimeout(succeed, 2400);
  });
}

function playUtterance(token, text, locale) {
  return new Promise((resolve) => {
    if (!text || typeof window === "undefined" || !window.speechSynthesis) return resolve(false);
    const utter = new SpeechSynthesisUtterance(String(text).replace(/\[BEEP\]/g, ""));
    utter.lang = SPEECH_LANG[locale] || locale;
    utter.rate = 0.9;
    utter.pitch = 1;
    if (chosen && scoreVoice(chosen, locale) > 0) utter.voice = chosen;
    else ensureVoice(locale);
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve(token === cueToken);
    };
    // iOS and Android Chrome drop speech spoken in the same turn as cancel().
    // Android also pauses the queue until resume() is called again.
    window.speechSynthesis.cancel();
    const kick = setInterval(() => {
      try {
        if (window.speechSynthesis.paused) window.speechSynthesis.resume();
      } catch {
        /* the queue can already be gone */
      }
    }, 4000);
    const done = () => {
      clearInterval(kick);
      finish();
    };
    utter.onend = done;
    utter.onerror = done;
    setTimeout(() => {
      if (token !== cueToken) return done();
      try {
        if (window.speechSynthesis.paused) window.speechSynthesis.resume();
        window.speechSynthesis.speak(utter);
      } catch {
        done();
      }
    }, 80);
    setTimeout(done, 2500);
  });
}

loadVoices().then((voices) => {
  chosen = pickVoice(voices, "en");
});
