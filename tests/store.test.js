import test from "node:test";
import assert from "node:assert/strict";
import {
  addNomination,
  blankState,
  canStartBattery,
  computeBadges,
  createUser,
  isDemoMode,
  redeemInvite
} from "../js/store.js";

function memory() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k)
  };
}

test("under-18 athletes need guardian consent before a check", () => {
  assert.equal(canStartBattery(null), false);
  assert.equal(canStartBattery({ name: "A", age: 12 }), false);
  assert.equal(canStartBattery({ name: "A", age: 12, guardianConsent: { name: "Parent" } }), true);
  assert.equal(canStartBattery({ name: "A", age: 20 }), true);
});

test("invite graph blocks self-invites and counts community builder", () => {
  const state = blankState();
  const a = createUser(state, { name: "Asha", age: 30, sex: "F" });
  const b = createUser(state, { name: "Dev", age: 16, sex: "M" });
  assert.equal(redeemInvite(state, a.inviteCode, a.id).reason, "self");
  assert.equal(redeemInvite(state, a.inviteCode, b.id).ok, true);
  assert.equal(redeemInvite(state, a.inviteCode, b.id).reason, "already");
  assert.equal(computeBadges(state, a.id).includes("community_builder"), true);
  assert.equal(isDemoMode(), true);
  memory();
});

test("spot a talent stores no score and requires consent", () => {
  const state = blankState();
  const a = createUser(state, { name: "Coach", age: 34, sex: "M" });
  assert.equal(addNomination(state, { nominatorId: a.id, name: "Ria", consentAttested: false }).ok, false);
  const saved = addNomination(state, {
    nominatorId: a.id,
    name: "Ria",
    contact: "9000000000",
    under18: true,
    parentConsent: true,
    consentAttested: true
  });
  assert.equal(saved.ok, true);
  assert.equal(saved.nomination.status, "pending");
  assert.equal(state.sessions.length, 0);
  const child = createUser(state, { name: "Ria", age: 11, sex: "F" });
  assert.equal(redeemInvite(state, saved.nomination.code, child.id).kind, "spot");
  assert.equal(saved.nomination.status, "joined");
  assert.equal(computeBadges(state, a.id).includes("talent_spotter"), false);
});
