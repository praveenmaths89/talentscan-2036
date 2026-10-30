import { STORAGE_KEY } from "./config.js";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "./env.js";

export function isDemoMode() {
  return !SUPABASE_URL || !SUPABASE_ANON_KEY;
}

export function newId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function makeInviteCode(existing) {
  const used = new Set(existing || []);
  for (let n = 0; n < 20; n++) {
    let code = "";
    for (let i = 0; i < 6; i++) {
      code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    }
    if (!used.has(code)) return code;
  }
  return `T${Date.now().toString(36).toUpperCase().slice(-5)}`;
}

export function blankState() {
  return {
    version: 2,
    currentUserId: null,
    users: {},
    sessions: [],
    nominations: [],
    inviteLedger: [],
    pendingInvite: null,
    inProgress: null,
    lang: null,
    askedLang: false,
    voiceOn: true,
    textSize: "normal",
    area: null,
    areaChoice: null
  };
}

/** Mid-check reload. A finished test (index past the last stage) is not reopened. */
export function resumeTarget(state, stageCount) {
  const saved = state?.inProgress?.resume;
  if (!saved?.id) return null;
  const index = Number(saved.index) || 0;
  const total = Number(stageCount);
  if (Number.isFinite(total) && index >= total) return null;
  return { id: saved.id, index, parts: Array.isArray(saved.parts) ? saved.parts : [] };
}

export function canStartBattery(user) {
  if (!user || !user.name) return false;
  const age = Number(user.age);
  if (Number.isFinite(age) && age < 18 && !user.guardianConsent) return false;
  return true;
}

export function loadState(storage) {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return blankState();
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== 2 || typeof parsed.users !== "object") return blankState();
    return { ...blankState(), ...parsed };
  } catch {
    return blankState();
  }
}

export function saveState(storage, state) {
  storage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function createUser(state, fields) {
  const codes = Object.values(state.users).map((u) => u.inviteCode);
  for (const n of state.nominations) codes.push(n.code);
  const user = {
    id: newId(),
    name: String(fields.name || "").trim(),
    age: fields.age == null || fields.age === "" ? null : Number(fields.age),
    sex: fields.sex || "X",
    heightCm: numOrNull(fields.heightCm),
    weightKg: numOrNull(fields.weightKg),
    sittingHeightCm: numOrNull(fields.sittingHeightCm),
    mode: fields.mode === "athlete" ? "athlete" : "casual",
    sport: fields.sport || "",
    role: fields.role || "self",
    guardianId: fields.guardianId || null,
    childIds: [],
    guardianConsent: fields.guardianConsent || null,
    verification: "self-tested",
    centre: null,
    inviteCode: makeInviteCode(codes),
    invitedBy: null,
    orgName: fields.orgName || "",
    orgKind: fields.orgKind || "",
    orgRole: fields.orgRole || "",
    createdAt: new Date().toISOString()
  };
  state.users[user.id] = user;
  if (user.guardianId && state.users[user.guardianId]) {
    state.users[user.guardianId].childIds = state.users[user.guardianId].childIds || [];
    state.users[user.guardianId].childIds.push(user.id);
  }
  return user;
}

function numOrNull(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Join-invite graph. Self-invites and a second credit for the same person are refused.
 * Spot-a-talent codes update the nomination instead of the community-builder count.
 */
export function redeemInvite(state, code, userId) {
  const user = state.users[userId];
  if (!user || !code) return { ok: false, reason: "missing" };
  const cleaned = String(code).trim().toUpperCase();
  if (cleaned === user.inviteCode) return { ok: false, reason: "self" };
  const nom = state.nominations.find((n) => n.code === cleaned);
  if (nom) {
    if (nom.nominatorId === userId) return { ok: false, reason: "self" };
    if (!nom.consentAttested) return { ok: false, reason: "consent" };
    nom.status = nom.status === "qc" ? "qc" : "joined";
    nom.inviteeId = userId;
    nom.joinedAt = nom.joinedAt || new Date().toISOString();
    user.invitedBy = nom.nominatorId;
    return { ok: true, kind: "spot" };
  }
  const inviter = Object.values(state.users).find((u) => u.inviteCode === cleaned);
  if (!inviter) return { ok: false, reason: "unknown" };
  if (inviter.id === userId) return { ok: false, reason: "self" };
  if (state.inviteLedger.some((row) => row.inviteeId === userId)) return { ok: false, reason: "already" };
  const mine = state.inviteLedger.filter((row) => row.inviterId === inviter.id);
  if (mine.length >= 30) return { ok: false, reason: "rate" };
  state.inviteLedger.push({
    inviterCode: cleaned,
    inviterId: inviter.id,
    inviteeId: userId,
    inviteeName: user.name,
    at: new Date().toISOString(),
    qc: false
  });
  user.invitedBy = inviter.id;
  return { ok: true, kind: "invite" };
}

export function inviteesOf(state, userId) {
  return state.inviteLedger.filter((row) => row.inviterId === userId);
}

export function markInviteQc(state, userId) {
  const row = state.inviteLedger.find((r) => r.inviteeId === userId);
  if (row) row.qc = true;
  for (const nom of state.nominations) {
    if (nom.inviteeId === userId && nom.status === "joined") nom.status = "qc";
  }
}

export function addNomination(state, fields) {
  if (!fields?.consentAttested) return { ok: false, reason: "consent" };
  if (fields.under18 && !fields.parentConsent) return { ok: false, reason: "parent" };
  const name = String(fields.name || "").trim();
  if (!name) return { ok: false, reason: "name" };
  const codes = [
    ...Object.values(state.users).map((u) => u.inviteCode),
    ...state.nominations.map((n) => n.code)
  ];
  const nom = {
    id: newId(),
    nominatorId: fields.nominatorId,
    name,
    contact: String(fields.contact || "").trim(),
    under18: Boolean(fields.under18),
    consentAttested: true,
    parentConsent: Boolean(fields.parentConsent),
    code: makeInviteCode(codes),
    status: "pending",
    inviteeId: null,
    createdAt: new Date().toISOString()
  };
  state.nominations.push(nom);
  return { ok: true, nomination: nom };
}

export function computeBadges(state, userId) {
  const user = state.users[userId];
  if (!user) return [];
  const badges = [];
  const sessions = state.sessions.filter((s) => s.athleteId === userId && !s.practiceSession);
  if (sessions.length) badges.push("first_check");
  if (sessions.some((s) => s.realCore)) badges.push("core_complete");
  const invited = inviteesOf(state, userId);
  if (invited.length >= 1) badges.push("community_builder");
  if (invited.length >= 5) badges.push("community_builder_5");
  if (state.nominations.some((n) => n.nominatorId === userId && n.status === "qc")) badges.push("talent_spotter");
  return badges;
}

export async function trySyncSession(session) {
  if (isDemoMode()) return { mode: "demo" };
  try {
    const res = await fetch(`${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/sessions`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal"
      },
      body: JSON.stringify({
        id: session.id,
        athlete_id: session.athleteId,
        mode: session.mode,
        started_at: session.startedAt,
        completed_at: session.completedAt,
        qc_summary: { qcPassed: session.qcPassed, practice: Boolean(session.practiceSession) }
      })
    });
    return { mode: "cloud", ok: res.ok, status: res.status };
  } catch (error) {
    return { mode: "demo", ok: false, error: String(error) };
  }
}
