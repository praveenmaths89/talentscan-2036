import test from "node:test";
import assert from "node:assert/strict";
import {
  dedupeSessions,
  historyFor,
  lineChartSvg,
  radarScores,
  radarSvg,
  sessionKey,
  traceFromSamples,
  traceSvg,
  trendNeed
} from "../js/progress.js";

test("duplicate same-minute results collapse to one", () => {
  const a = {
    id: "1",
    athleteId: "u",
    completedAt: "2026-10-30T10:01:02.000Z",
    tests: { cmj: { jumpHeightCm: 25.1 } }
  };
  const b = {
    id: "2",
    athleteId: "u",
    completedAt: "2026-10-30T10:01:40.000Z",
    tests: { cmj: { jumpHeightCm: 25.12 } }
  };
  const kept = dedupeSessions([a, b]);
  assert.equal(kept.length, 1);
  assert.equal(sessionKey(a), sessionKey(b));
  const otherDay = { ...b, id: "3", completedAt: "2026-10-28T10:01:00.000Z", tests: { cmj: { jumpHeightCm: 22 } } };
  assert.equal(dedupeSessions([a, otherDay]).length, 2);
});

test("history chart svg has axes, dates, and best or latest marks", () => {
  const points = historyFor(
    [
      { id: "b", athleteId: "u", completedAt: "2026-10-02", practiceSession: false, tests: { cmj: { jumpHeightCm: 30 } } },
      { id: "a", athleteId: "u", completedAt: "2026-09-01", practiceSession: false, tests: { cmj: { jumpHeightCm: 24 } } },
      { id: "dup", athleteId: "u", completedAt: "2026-10-02T00:10:00", practiceSession: false, tests: { cmj: { jumpHeightCm: 30 } } }
    ],
    "cmj"
  );
  assert.deepEqual(points.map((p) => p.value), [24, 30]);
  assert.equal(trendNeed(0), 2);
  assert.equal(trendNeed(1), 1);
  assert.equal(trendNeed(2), 0);
  const svg = lineChartSvg(points, true);
  assert.ok(svg.includes("chart-axis"));
  assert.ok(svg.includes("09-01"));
  assert.ok(svg.includes("10-02"));
  assert.ok(svg.includes("#047857"));
  assert.ok(svg.includes("#1D4ED8"));
});

test("trace and radar svgs draw the series", () => {
  const samples = [];
  for (let i = 0; i < 40; i++) samples.push({ t: i / 20, ax: 0, ay: 0, az: i > 15 && i < 25 ? 2 : 9.8 });
  const trace = traceFromSamples("cmj", samples, { flightS: 0.4 });
  const svg = traceSvg(trace);
  assert.ok(svg.includes("chart-axis"));
  assert.ok(svg.includes("<path"));
  const radar = radarSvg(
    radarScores({ tests: { cmj: { percentile: { percentile: 40 } } } }),
    radarScores({ tests: { cmj: { percentile: { percentile: 70 } }, balance: { percentile: { percentile: 80 } } } })
  );
  assert.equal((radar.match(/<polygon/g) || []).length, 2);
  assert.ok(radar.includes("data-axis=\"power\""));
});
