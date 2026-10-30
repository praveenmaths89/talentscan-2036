import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { APP_NAME } from "../js/config.js";
import { LOCALES, matchNavigator } from "../js/locales.js";

const read = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));

test("English and Hindi packs have the same string keys", () => {
  const en = read("../locales/en.json");
  const hi = read("../locales/hi.json");
  assert.equal(en.meta.complete, true);
  assert.equal(hi.meta.complete, true);
  const keys = (pack) => Object.keys(pack).filter((k) => k !== "meta").sort();
  assert.deepEqual(keys(hi), keys(en));
  assert.ok(keys(en).length > 40);
});

test("the other 21 Eighth Schedule packs fall back to English", () => {
  assert.equal(LOCALES.length, 23);
  const stubs = LOCALES.filter((l) => l.code !== "en" && l.code !== "hi");
  assert.equal(stubs.length, 21);
  for (const loc of stubs) {
    const pack = read(`../locales/${loc.code}.json`);
    assert.equal(pack.meta.complete, false);
    assert.equal(pack.meta.fallback, "en");
    assert.equal(pack.meta.code, loc.code);
    assert.equal(pack.meta.dir, loc.dir);
  }
  assert.equal(LOCALES.find((l) => l.code === "ur").dir, "rtl");
  assert.equal(LOCALES.find((l) => l.code === "ks").dir, "rtl");
});

test("phone language auto-detect matches a pack or asks", () => {
  assert.equal(matchNavigator(["hi-IN", "en-US"]), "hi");
  assert.equal(matchNavigator(["en-GB"]), "en");
  assert.equal(matchNavigator(["ur"]), "ur");
  assert.equal(matchNavigator(["fr-FR", "de"]), null);
});

test("install name matches the app name constant", () => {
  const manifest = read("../manifest.json");
  assert.equal(manifest.name, APP_NAME);
  assert.equal(manifest.short_name, APP_NAME);
  assert.equal(manifest.theme_color, "#1D4ED8");
  assert.equal(manifest.background_color, "#F8FAFC");
});
