/** Eighth Schedule languages plus English. RTL: Urdu and Kashmiri. */
export const LOCALES = [
  { code: "en", name: "English", native: "English", dir: "ltr" },
  { code: "as", name: "Assamese", native: "অসমীয়া", dir: "ltr" },
  { code: "bn", name: "Bengali", native: "বাংলা", dir: "ltr" },
  { code: "brx", name: "Bodo", native: "बड़ो", dir: "ltr" },
  { code: "doi", name: "Dogri", native: "डोगरी", dir: "ltr" },
  { code: "gu", name: "Gujarati", native: "ગુજરાતી", dir: "ltr" },
  { code: "hi", name: "Hindi", native: "हिन्दी", dir: "ltr" },
  { code: "kn", name: "Kannada", native: "ಕನ್ನಡ", dir: "ltr" },
  { code: "ks", name: "Kashmiri", native: "کٲشُر", dir: "rtl" },
  { code: "kok", name: "Konkani", native: "कोंकणी", dir: "ltr" },
  { code: "mai", name: "Maithili", native: "मैथिली", dir: "ltr" },
  { code: "ml", name: "Malayalam", native: "മലയാളം", dir: "ltr" },
  { code: "mni", name: "Manipuri", native: "ꯃꯤꯇꯩꯂꯣꯟ", dir: "ltr" },
  { code: "mr", name: "Marathi", native: "मराठी", dir: "ltr" },
  { code: "ne", name: "Nepali", native: "नेपाली", dir: "ltr" },
  { code: "or", name: "Odia", native: "ଓଡ଼ିଆ", dir: "ltr" },
  { code: "pa", name: "Punjabi", native: "ਪੰਜਾਬੀ", dir: "ltr" },
  { code: "sa", name: "Sanskrit", native: "संस्कृतम्", dir: "ltr" },
  { code: "sat", name: "Santali", native: "ᱥᱟᱱᱛᱟᱲᱤ", dir: "ltr" },
  { code: "sd", name: "Sindhi", native: "سنڌي", dir: "ltr" },
  { code: "ta", name: "Tamil", native: "தமிழ்", dir: "ltr" },
  { code: "te", name: "Telugu", native: "తెలుగు", dir: "ltr" },
  { code: "ur", name: "Urdu", native: "اردو", dir: "rtl" }
];

const ALIASES = {
  ori: "or",
  ben: "bn",
  pan: "pa",
  tam: "ta",
  tel: "te",
  urd: "ur",
  hin: "hi",
  mar: "mr",
  guj: "gu",
  kan: "kn",
  mal: "ml",
  kas: "ks",
  asm: "as",
  nep: "ne",
  san: "sa",
  snd: "sd"
};

export function localeByCode(code) {
  return LOCALES.find((l) => l.code === code) || LOCALES[0];
}

/** Prefer the phone language when it matches a pack. Null means ask. */
export function matchNavigator(languages) {
  const list = Array.isArray(languages) ? languages : [languages];
  for (const raw of list) {
    if (!raw) continue;
    const lowered = String(raw).toLowerCase().replace(/_/g, "-");
    const base = lowered.split("-")[0];
    const code = ALIASES[base] || base;
    if (LOCALES.some((l) => l.code === code)) return code;
  }
  return null;
}
