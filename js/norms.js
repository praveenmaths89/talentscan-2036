import { NORMS_DISCLAIMER } from "./config.js";

/**
 * Placeholder age-band medians for the screening card.
 * These are NOT validated Indian norms. The label must stay visible.
 */
const BANDS = [9, 12, 15, 18, 29, 44, 200];

const MEDIANS = {
  cmj_cm: { M: [20, 26, 32, 36, 38, 34, 28], F: [18, 23, 27, 29, 30, 27, 22] },
  repeat_count: { M: [12, 16, 20, 22, 22, 18, 14], F: [12, 15, 18, 20, 20, 16, 12] },
  rsi: { M: [1.2, 1.5, 1.8, 2.0, 2.0, 1.7, 1.4], F: [1.1, 1.3, 1.5, 1.6, 1.6, 1.4, 1.2] },
  sway: { M: [0.35, 0.28, 0.22, 0.2, 0.2, 0.24, 0.32], F: [0.35, 0.28, 0.22, 0.2, 0.2, 0.24, 0.32] },
  situps: { M: [10, 14, 18, 20, 20, 16, 12], F: [8, 12, 15, 17, 17, 14, 10] },
  rt_ms: { M: [420, 340, 280, 250, 240, 260, 300], F: [430, 350, 290, 260, 250, 270, 310] },
  taps: { M: [40, 50, 58, 64, 66, 60, 50], F: [38, 48, 55, 60, 62, 56, 46] },
  steps: { M: [70, 90, 110, 120, 120, 100, 80], F: [70, 90, 110, 120, 120, 100, 80] },
  sprint_s: { M: [7.5, 6.4, 5.6, 5.0, 4.8, 5.2, 6.2], F: [8.0, 6.9, 6.2, 5.8, 5.6, 6.0, 7.0] },
  shuttle_s: { M: [14, 12.5, 11.5, 11, 10.8, 11.5, 13], F: [15, 13.5, 12.5, 12, 11.8, 12.5, 14] }
};

const LOWER_BETTER = new Set(["sway", "rt_ms", "sprint_s", "shuttle_s"]);

export function normCdf(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return z > 0 ? 1 - p : p;
}

function bandIndex(age) {
  const a = Number(age);
  if (!Number.isFinite(a)) return 2;
  for (let i = 0; i < BANDS.length; i++) {
    if (a <= BANDS[i]) return i;
  }
  return BANDS.length - 1;
}

function medianFor(metricKey, age, sex) {
  const table = MEDIANS[metricKey];
  if (!table) return null;
  const idx = bandIndex(age);
  const m = table.M[idx];
  const f = table.F[idx];
  if (sex === "M") return m;
  if (sex === "F") return f;
  return (m + f) / 2;
}

export function provisionalPercentile(metricKey, value, age, sex) {
  const median = medianFor(metricKey, age, sex);
  const v = Number(value);
  if (median == null || !Number.isFinite(v)) return null;
  const sd = Math.max(Math.abs(median) * 0.15, 1e-6);
  let z = (v - median) / sd;
  if (LOWER_BETTER.has(metricKey)) z = -z;
  const percentile = Math.max(1, Math.min(99, Math.round(normCdf(z) * 100)));
  return {
    percentile,
    median,
    label: NORMS_DISCLAIMER,
    validated: false
  };
}
