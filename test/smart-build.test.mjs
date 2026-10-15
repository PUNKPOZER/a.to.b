import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url), D = require("../audio/dj-engine.js"), SB = require("../audio/smart-build.js");
const vec = (s) => Array.from({ length: 6 }, (_, i) => Math.abs(Math.sin(s * (i + 1))) + 0.1);
let n = 0;
const mk = (o = {}) => { const s = ++n; return { id: o.id || "t" + s, bpm: o.bpm ?? 128, key: { camelot: o.cam ?? "8A" }, genre: { primary: o.genre ?? "House" }, profile: { energy: o.energy ?? 60, danceability: 70, bassDensity: 50 },
  featureGroups: { genre: vec(s + 1), rhythm: vec(s + 2), drums: vec(s + 3), bass: vec(s + 4), melody: vec(s + 5), harmony: vec(s + 6), energy: vec(s + 7), texture: vec(s + 8) }, durationSec: o.dur ?? 360, energyCurve: null, introBars: null, outroBars: null, beatCv: null, backendDance: null }; };
const compat = (a, b) => D.djCompat(a, b).overall;
const lib = () => Array.from({ length: 40 }, (_, i) => mk({ id: "L" + i, bpm: 124 + (i % 9), cam: ["8A", "9A", "7A", "8B", "10A"][i % 5], energy: 35 + (i * 11) % 55, dur: 280 + (i % 7) * 25, genre: ["UK Garage", "Breakbeat", "House"][i % 3] }));

test("duration is overlap-aware: effective < sum, and measured vs estimated overlaps are counted", () => {
  const set = [mk({ dur: 300 }), mk({ dur: 300 }), mk({ dur: 300 })];
  const ov = (a, b) => ({ sec: a === set[0] ? 30 : 20, source: a === set[0] ? "grid" : "estimate" });
  assert.deepEqual(SB.setDuration(set, ov), { sumSec: 900, overlapSec: 50, effectiveSec: 850, measured: 1, estimated: 1, transitions: 2 });
  assert.equal(SB.setDuration([mk({ dur: 100 })], ov).effectiveSec, 100);
});
test("builds close to the requested duration (within tolerance) without duplicates", () => {
  for (const target of [1800, 2400, 3600]) {
    const r = SB.build({ pool: lib(), targetSec: target, toleranceSec: 120, compat, curvePts: D.CURVES.journey.pts, seed: 4 });
    assert.equal(r.status, "ok", `target ${target}: diff ${r.diffSec}`); assert.ok(Math.abs(r.diffSec) <= 120);
    assert.equal(new Set(r.ids).size, r.ids.length);
    assert.ok(r.effectiveSec < r.duration.sumSec, "overlaps are subtracted");
  }
});
test("transition preference changes the result: smooth keeps every neighbour above its floor when it can", () => {
  const pool = lib(), s = SB.build({ pool, targetSec: 2400, compat, pref: "smooth", seed: 2 }), c = SB.build({ pool, targetSec: 2400, compat, pref: "creative", seed: 2 });
  assert.ok(s.minCompat >= SB.PREFS.smooth.floor - 10, "smooth min " + s.minCompat);
  assert.ok(s.avgCompat >= c.avgCompat - 0.5, `smooth ${s.avgCompat} vs creative ${c.avgCompat}`);
});
test("insufficient pool is reported, not silently padded or ignored", () => {
  const r = SB.build({ pool: lib().slice(0, 4), targetSec: 3600, compat });
  assert.equal(r.status, "insufficient"); assert.equal(r.matched, 4); assert.ok(r.availableSec < 3600 && r.availableSec > 0); assert.deepEqual(r.ids, []);
  const forced = SB.build({ pool: lib().slice(0, 4), targetSec: 3600, compat, allowShort: true });
  assert.ok(forced.ids.length >= 2); assert.ok(forced.diffSec < 0);
  assert.equal(SB.build({ pool: [], targetSec: 1800, compat }).status, "insufficient");
});
test("locked tracks: pinned to a position, or at least kept in the set", () => {
  const pool = lib(), r = SB.build({ pool, targetSec: 1800, compat, seed: 3, locked: [{ id: "L7", index: 2 }, { id: "L20" }] });
  assert.equal(r.ids[2], "L7"); assert.ok(r.ids.includes("L20"));
  const first = SB.build({ pool, targetSec: 1800, compat, locked: [{ id: "L5", index: 0 }] }); assert.equal(first.ids[0], "L5");
});
test("regenerate keeps locked positions and never repeats a track", () => {
  const pool = lib(), base = SB.build({ pool, targetSec: 2400, compat, seed: 1 }), order = base.ids.map((id) => pool.find((t) => t.id === id));
  const re = SB.regenerate(order, pool, { lockedIndexes: [0, 3], compat, curvePts: D.CURVES.smooth.pts });
  assert.equal(re.length, order.length); assert.equal(re[0].id, order[0].id); assert.equal(re[3].id, order[3].id); assert.equal(new Set(re.map((t) => t.id)).size, re.length);
  const sc = (o) => o.slice(1).reduce((s, t, i) => s + compat(o[i], t), 0);
  assert.ok(sc(re) >= sc(order) - 1e-6, "never worse than the previous order");
});
test("bridges are scored on every step (A>C and C>B), one or two tracks", () => {
  const A = mk({ id: "A", bpm: 124, cam: "8A", energy: 50 }), B = mk({ id: "B", bpm: 136, cam: "11A", energy: 80 }), pool = [mk({ id: "C1", bpm: 130, cam: "9A", energy: 65 }), mk({ id: "C2", bpm: 150, cam: "2B", energy: 90 }), mk({ id: "C3", bpm: 127, cam: "8A", energy: 55 }), mk({ id: "C4", bpm: 133, cam: "10A", energy: 72 })];
  const one = SB.findBridges(A, B, pool, { compat, max: 4 });
  assert.ok(one.every((r) => r.path.length === 1 && r.steps.length === 2));
  assert.ok(one[0].score >= one[one.length - 1].score);
  const two = SB.findBridges(A, B, pool, { compat, two: true, max: 6 });
  assert.ok(two.some((r) => r.path.length === 2 && r.steps.length === 3));
  const best1 = one[0].score, bestTwo = two.find((r) => r.path.length === 2); assert.ok(bestTwo.steps.every((s) => s >= 0 && s <= 100)); assert.ok(best1 >= 0);
});
