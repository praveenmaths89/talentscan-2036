/** Progress data and SVG charts. SVG draws on iOS Safari without a canvas library. */

const G = 9.80665;

export function valueOf(id, result) {
  if (!result || result.skipped) return null;
  const n = (v) => {
    const x = Number(v);
    return Number.isFinite(x) ? x : null;
  };
  if (id === "cmj") return n(result.jumpHeightCm);
  if (id === "repeat") return n(result.count);
  if (id === "balance") return n(result.swayRms);
  if (id === "situp") return n(result.reps);
  if (id === "react") return n(result.reaction?.medianMs);
  if (id === "step") return n(result.steps);
  if (id === "sprint" || id === "shuttle") return n(result.timeS);
  return null;
}

export const HIGHER_BETTER = {
  cmj: true,
  repeat: true,
  balance: false,
  situp: true,
  react: false,
  step: true,
  sprint: false,
  shuttle: false
};

export const TEST_IDS = ["cmj", "repeat", "balance", "situp", "react", "step", "sprint", "shuttle"];

export function sessionKey(session) {
  const bits = TEST_IDS.map((id) => {
    const value = valueOf(id, session?.tests?.[id]);
    return value == null ? "" : String(Math.round(value * 10) / 10);
  }).join(",");
  return `${session?.athleteId || ""}|${String(session?.completedAt || "").slice(0, 10)}|${bits}`;
}

/** Keep the newest copy when the same minute has the same numbers. */
export function dedupeSessions(sessions) {
  const seen = new Set();
  const out = [];
  for (const session of sessions || []) {
    const key = sessionKey(session);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(session);
  }
  return out;
}

export function historyFor(sessions, id) {
  return dedupeSessions(sessions)
    .filter((s) => s && !s.practiceSession)
    .slice()
    .sort((a, b) => String(a.completedAt).localeCompare(String(b.completedAt)))
    .map((session) => {
      const value = valueOf(id, session.tests?.[id]);
      if (value == null) return null;
      return { date: session.completedAt, value, sessionId: session.id };
    })
    .filter(Boolean);
}

export function trendNeed(count) {
  const n = Number(count) || 0;
  return n >= 2 ? 0 : 2 - n;
}

export function bestPoint(points, higherBetter) {
  if (!points?.length) return null;
  return points.reduce((best, point) => {
    if (!best) return point;
    return (higherBetter ? point.value > best.value : point.value < best.value) ? point : best;
  }, null);
}

function pct(result) {
  if (!result) return null;
  if (result.percentile?.percentile != null) return result.percentile.percentile;
  if (result.reaction?.percentile?.percentile != null) return result.reaction.percentile.percentile;
  return null;
}

function mean(values) {
  const nums = values.filter((n) => Number.isFinite(n));
  if (!nums.length) return 0;
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
}

export const RADAR_KEYS = ["power", "speed", "balance", "endurance", "reaction"];

export function radarScores(session) {
  const tests = session?.tests || {};
  return {
    power: mean([pct(tests.cmj), pct(tests.repeat)]),
    speed: mean([pct(tests.sprint), pct(tests.shuttle), pct(tests.repeat)]),
    balance: mean([pct(tests.balance)]),
    endurance: mean([pct(tests.step), pct(tests.situp)]),
    reaction: mean([pct(tests.react)])
  };
}

export function downsample(values, max = 48) {
  const list = values || [];
  if (list.length <= max) return list.slice();
  const out = [];
  const step = (list.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(list[Math.round(i * step)]);
  return out;
}

function bodyWeight(sample) {
  if (sample && Number.isFinite(sample.bw)) return sample.bw;
  const mag = Math.hypot(Number(sample?.ax) || 0, Number(sample?.ay) || 0, Number(sample?.az) || 0);
  if (!(mag > 0.05)) return 1;
  return mag > 4 ? mag / G : mag;
}

export function traceFromSamples(kind, samples, extra = {}) {
  const list = Array.isArray(samples) ? samples : [];
  if (kind === "balance") {
    return {
      kind: "path",
      x: downsample(list.map((s) => Number(s.ax) || 0)),
      y: downsample(list.map((s) => Number(s.ay) || 0))
    };
  }
  if (kind === "react") {
    return { kind: "bars", y: (extra.timesMs || []).map(Number).filter((n) => Number.isFinite(n)) };
  }
  const y = downsample(list.map(bodyWeight));
  const t = downsample(list.map((s) => Number(s.t) || 0));
  const marks = [];
  if (y.length && Number.isFinite(extra.flightS)) {
    let minI = 0;
    for (let i = 1; i < y.length; i++) if (y[i] < y[minI]) minI = i;
    const at = t[minI] || 0;
    const half = extra.flightS / 2;
    marks.push({ t: Math.max(0, at - half), name: "takeoff" }, { t: at + half, name: "landing" });
  }
  return { kind: "line", t, y, marks };
}

function svgOpen(w, h) {
  return `<svg class="chart" viewBox="0 0 ${w} ${h}" role="img" width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet">`;
}

export function lineChartSvg(points, higherBetter) {
  const w = 340;
  const h = 230;
  const left = 46;
  const right = 12;
  const top = 16;
  const bottom = 36;
  if (!points?.length) return "";
  const values = points.map((p) => p.value);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (min === max) {
    min -= 1;
    max += 1;
  }
  const pad = (max - min) * 0.12;
  min -= pad;
  max += pad;
  const xAt = (i) => left + (points.length === 1 ? (w - left - right) / 2 : (i / (points.length - 1)) * (w - left - right));
  const yAt = (v) => top + (1 - (v - min) / (max - min)) * (h - top - bottom);
  const best = bestPoint(points, higherBetter);
  const last = points[points.length - 1];
  const poly = points.map((p, i) => `${i ? "L" : "M"}${xAt(i).toFixed(1)},${yAt(p.value).toFixed(1)}`).join(" ");
  const yTicks = [min + pad, (min + max) / 2, max - pad];
  const yLabels = yTicks
    .map((v) => `<text x="${left - 6}" y="${yAt(v).toFixed(1)}" text-anchor="end" class="chart-label">${v.toFixed(1)}</text>`)
    .join("");
  const xLabels = points
    .map((p, i) => `<text x="${xAt(i).toFixed(1)}" y="${h - 10}" text-anchor="middle" class="chart-label">${String(p.date).slice(5, 10)}</text>`)
    .join("");
  const dots = points
    .map((p, i) => {
      const latest = p === last;
      const isBest = p === best;
      const fill = latest ? "#1D4ED8" : isBest ? "#047857" : "#FFFFFF";
      const ring = isBest ? `<circle cx="${xAt(i).toFixed(1)}" cy="${yAt(p.value).toFixed(1)}" r="9" fill="none" stroke="#047857" stroke-width="2"/>` : "";
      return `${ring}<circle cx="${xAt(i).toFixed(1)}" cy="${yAt(p.value).toFixed(1)}" r="${latest || isBest ? 6 : 4}" fill="${fill}" stroke="#1D4ED8" stroke-width="2"/>`;
    })
    .join("");
  return `${svgOpen(w, h)}
    <line x1="${left}" y1="${top}" x2="${left}" y2="${h - bottom}" class="chart-axis"/>
    <line x1="${left}" y1="${h - bottom}" x2="${w - right}" y2="${h - bottom}" class="chart-axis"/>
    ${yLabels}${xLabels}
    <path d="${poly}" fill="none" stroke="#1D4ED8" stroke-width="3"/>
    ${dots}
  </svg>`;
}

export function traceSvg(trace) {
  if (!trace) return "";
  if (trace.kind === "bars") {
    const y = trace.y || [];
    const w = 340;
    const h = 200;
    const max = Math.max(1, ...y);
    const bars = y
      .map((v, i) => {
        const bw = (w - 40) / y.length;
        const bh = (v / max) * 140;
        return `<rect x="${24 + i * bw}" y="${160 - bh}" width="${Math.max(4, bw - 8)}" height="${bh}" rx="4" fill="#1D4ED8"/>
          <text x="${24 + i * bw + bw / 2}" y="180" text-anchor="middle" class="chart-label">${i + 1}</text>`;
      })
      .join("");
    return `${svgOpen(w, h)}<line x1="20" y1="160" x2="320" y2="160" class="chart-axis"/>${bars}</svg>`;
  }
  if (trace.kind === "path") {
    const xs = trace.x || [];
    const ys = trace.y || [];
    const w = 340;
    const h = 220;
    const all = xs.concat(ys);
    const lim = Math.max(0.2, ...all.map((n) => Math.abs(n)));
    const cx = w / 2;
    const cy = h / 2;
    const scale = 80 / lim;
    const d = xs
      .map((x, i) => `${i ? "L" : "M"}${(cx + x * scale).toFixed(1)},${(cy - (ys[i] || 0) * scale).toFixed(1)}`)
      .join(" ");
    return `${svgOpen(w, h)}
      <line x1="20" y1="${cy}" x2="${w - 20}" y2="${cy}" class="chart-axis"/>
      <line x1="${cx}" y1="16" x2="${cx}" y2="${h - 16}" class="chart-axis"/>
      <path d="${d}" fill="none" stroke="#1D4ED8" stroke-width="2"/>
    </svg>`;
  }
  const y = trace.y || [];
  if (!y.length) return "";
  const t = trace.t?.length === y.length ? trace.t : y.map((_, i) => i);
  const w = 340;
  const h = 210;
  const left = 36;
  const min = Math.min(...y);
  const max = Math.max(...y, min + 0.2);
  const xAt = (i) => left + (i / Math.max(1, y.length - 1)) * (w - left - 12);
  const yAt = (v) => 16 + (1 - (v - min) / (max - min)) * 150;
  const d = y.map((v, i) => `${i ? "L" : "M"}${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`).join(" ");
  const marks = (trace.marks || [])
    .map((mark) => {
      let idx = 0;
      let best = Infinity;
      t.forEach((time, i) => {
        const dist = Math.abs(time - mark.t);
        if (dist < best) {
          best = dist;
          idx = i;
        }
      });
      return `<line x1="${xAt(idx).toFixed(1)}" y1="16" x2="${xAt(idx).toFixed(1)}" y2="166" stroke="#93C5FD" stroke-dasharray="4 3"/>`;
    })
    .join("");
  return `${svgOpen(w, h)}
    <line x1="${left}" y1="16" x2="${left}" y2="166" class="chart-axis"/>
    <line x1="${left}" y1="166" x2="${w - 12}" y2="166" class="chart-axis"/>
    <text x="4" y="24" class="chart-label">${max.toFixed(1)}</text>
    <text x="4" y="166" class="chart-label">${min.toFixed(1)}</text>
    ${marks}
    <path d="${d}" fill="none" stroke="#1D4ED8" stroke-width="3"/>
  </svg>`;
}

export function radarSvg(first, latest) {
  const w = 340;
  const h = 280;
  const cx = 170;
  const cy = 130;
  const r = 90;
  const keys = RADAR_KEYS;
  const angle = (i) => -Math.PI / 2 + (i * 2 * Math.PI) / keys.length;
  const pt = (scores, i) => {
    const mag = (Number(scores[keys[i]]) || 0) / 100;
    return [cx + Math.cos(angle(i)) * r * mag, cy + Math.sin(angle(i)) * r * mag];
  };
  const poly = (scores) => keys.map((_, i) => pt(scores, i).map((n) => n.toFixed(1)).join(",")).join(" ");
  const rings = [0.25, 0.5, 0.75, 1]
    .map((scale) => {
      const d = keys
        .map((_, i) => {
          const x = cx + Math.cos(angle(i)) * r * scale;
          const y = cy + Math.sin(angle(i)) * r * scale;
          return `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
        })
        .join(" ") + " Z";
      return `<path d="${d}" fill="none" class="chart-axis"/>`;
    })
    .join("");
  const spokes = keys
    .map((_, i) => `<line x1="${cx}" y1="${cy}" x2="${(cx + Math.cos(angle(i)) * r).toFixed(1)}" y2="${(cy + Math.sin(angle(i)) * r).toFixed(1)}" class="chart-axis"/>`)
    .join("");
  const labels = keys
    .map((key, i) => {
      const x = cx + Math.cos(angle(i)) * (r + 28);
      const y = cy + Math.sin(angle(i)) * (r + 28);
      return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" class="chart-label" data-axis="${key}">${key}</text>`;
    })
    .join("");
  return `${svgOpen(w, h)}
    ${rings}${spokes}
    <polygon points="${poly(first)}" fill="rgba(147,197,253,0.35)" stroke="#93C5FD" stroke-width="2"/>
    <polygon points="${poly(latest)}" fill="rgba(29,78,216,0.2)" stroke="#1D4ED8" stroke-width="2"/>
    ${labels}
  </svg>`;
}
