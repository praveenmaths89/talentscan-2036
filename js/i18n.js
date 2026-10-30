import { localeByCode } from "./locales.js";

const packs = {};
let current = "en";

export function currentLocale() {
  return current;
}

export async function ensurePack(code) {
  if (packs[code]) return packs[code];
  const url = new URL(`../locales/${code}.json`, import.meta.url);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Missing language pack ${code}`);
  packs[code] = await res.json();
  return packs[code];
}

export async function setLocale(code) {
  await ensurePack("en");
  const safe = localeByCode(code).code;
  await ensurePack(safe);
  current = safe;
  const dir = packs[safe]?.meta?.dir || localeByCode(safe).dir;
  if (typeof document !== "undefined") {
    document.documentElement.lang = safe;
    document.documentElement.dir = dir === "rtl" ? "rtl" : "ltr";
  }
  return safe;
}

export function packIsComplete(code = current) {
  return packs[code]?.meta?.complete === true;
}

export function t(key, vars) {
  const active = packs[current] || {};
  let value;
  if (active.meta?.complete === true && typeof active[key] === "string") value = active[key];
  else if (typeof packs.en?.[key] === "string") value = packs.en[key];
  else value = key;
  if (vars && typeof value === "string") {
    value = value.replace(/\{(\w+)\}/g, (_, k) => (vars[k] == null ? "" : String(vars[k])));
  }
  return value;
}
