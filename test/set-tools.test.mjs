import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const D = require("../audio/dj-engine.js"), S = require("../audio/set-tools.js");

const vec = (seed, n = 6) => Array.from({ length: n }, (_, i) => Math.abs(Math.sin(seed * (i + 1))) + 0.1);
let uid = 0;
const mk = (o = {}) => { const seed = o.seed ?? ++uid; return { id: o.id ?? "t" + seed, bpm: o.bpm ?? 126, key: { camelot: o.cam ?? "8A" }, genre: { primary: o.genre ?? "House" }, profile: { energy: o.energy ?? 60, danceability: 70 },
  featureGroups: { genre: vec(seed + 1), rhythm: vec(seed + 2), drums: vec(seed + 3), bass: vec(seed + 4), melody: vec(seed + 5), harmony: vec(seed + 6), energy: vec(seed + 7), texture: vec(seed + 8) },
  energyCurve: null, introBars: null, outroBars: null, durationSec: o.dur ?? 360, beatCv: null, backendDance: null }; };

test("a reorder recalculates only the pairs that did not exist before", () => {
  const ids = ["A", "B", "C", "D"], moved = ["A", "C", "B", "D"];
  assert.deepEqual(S.affectedPairs(ids, moved), [0, 1, 2]);                 // A>C, C>B, B>D are all new
  assert.deepEqual(S.affectedPairs(ids, ["A", "B", "C", "X"]), [2]);        // only C>X is new
  const lib = Object.fromEntries(["A", "B", "C", "D"].map((id, i) => [id, mk({ id, seed: i + 1 })]));
  const cache = new S.TransitionCache((a, b) => D.djCompat(a, b));
  for (let i = 0; i < 3; i++) cache.get(lib[ids[i]], lib[ids[i + 1]]);
  assert.equal(cache.computations, 3);
  const order = ["A", "B", "D", "C"]; for (let i = 0; i < 3; i++) cache.get(lib[order[i]], lib[order[i + 1]]);
  assert.equal(cache.computations, 5, "A>B reused; B>D and D>C computed");
  cache.invalidate(); cache.get(lib.A, lib.B); assert.equal(cache.computations, 6);
});
test("set analysis: totals, flows, genre mix and an explainable score with reasons", () => {
  const t = [mk({ id: "1", energy: 50, bpm: 120 }), mk({ id: "2", energy: 51, bpm: 121 }), mk({ id: "3", energy: 50, bpm: 121, cam: "2B" }), mk({ id: "4", energy: 51, bpm: 134, genre: "Techno" })];
  const tr = t.slice(1).map((b, i) => D.djCompat(t[i], b));
  const a = S.analyzeSet(t, tr, { curvePts: D.CURVES.buildup.pts });
  assert.equal(a.trackCount, 4); assert.equal(a.bpm.start, 120); assert.equal(a.bpm.end, 134); assert.equal(a.genres[0].genre, "House");
  assert.ok(a.score.total >= 0 && a.score.total <= 100); assert.ok(Object.keys(a.score.components).length >= 4);
  assert.ok(a.score.attention.some((x) => x.code === "flatEnergy"), "3+ tracks at the same energy are flagged");
  assert.ok(a.score.attention.some((x) => x.code === "harmonicConflict" || x.code === "tempoJump" || x.code === "weakTransition"));
});
test("missing data is excluded from the score, not counted as zero; confidence reflects coverage", () => {
  const t = [mk({ id: "1" }), mk({ id: "2" })]; const tr = [D.djCompat(t[0], t[1])];
  const a = S.analyzeSet(t, tr, {}); assert.equal(a.score.components.coherence, undefined); assert.ok(["medium", "high"].includes(a.score.confidence));
  assert.equal(S.analyzeSet([mk()], [], {}).score, null);
});
test("optimise keeps locked tracks in place and never makes the set worse", () => {
  const lib = Array.from({ length: 10 }, (_, i) => mk({ id: "t" + i, seed: i + 30, energy: 30 + i * 6, bpm: 120 + (i % 5), cam: ["8A", "9A", "7A", "8B", "3B"][i % 5] }));
  const pair = (a, b) => D.djCompat(a, b).overall;
  const shuffled = [lib[7], lib[2], lib[9], lib[0], lib[5], lib[3], lib[8], lib[1], lib[6], lib[4]];
  const locked = new Set([shuffled[0].id, shuffled[9].id]);
  const before = shuffled.reduce((s, t, i) => s + (i ? pair(shuffled[i - 1], t) : 0), 0);
  const r = S.optimizeOrder(shuffled, { pair, lockedIds: locked, seed: 3, curvePts: D.CURVES.buildup.pts });
  assert.equal(r.order[0].id, shuffled[0].id); assert.equal(r.order[9].id, shuffled[9].id);
  assert.equal(new Set(r.order.map((t) => t.id)).size, 10);
  const after = r.order.reduce((s, t, i) => s + (i ? pair(r.order[i - 1], t) : 0), 0);
  assert.ok(after >= before - 1e-6);
});
test("alternatives are judged against both neighbours", () => {
  const A = mk({ id: "A", bpm: 126, cam: "8A", energy: 55, seed: 1 }), C = mk({ id: "C", bpm: 128, cam: "9A", energy: 62, seed: 2 }), B = mk({ id: "B", bpm: 127, cam: "8A", seed: 3 });
  const good = mk({ id: "good", bpm: 127, cam: "8A", energy: 58, seed: 4 }), nearA = mk({ id: "nearA", bpm: 126, cam: "8A", energy: 55, seed: 5 }), nearC = mk({ id: "nearC", bpm: 150, cam: "3B", energy: 90, seed: 6 });
  const rows = S.findAlternatives([A, B, C], 1, [good, nearA, nearC, A]);
  assert.ok(rows.every((r) => r.prev && r.next), "both sides evaluated"); assert.ok(!rows.some((r) => r.track.id === "A"), "tracks already in the set are excluded");
  assert.notEqual(rows[0].track.id, "nearC"); assert.ok(rows[0].worst >= rows[rows.length - 1].worst - 100);
  assert.deepEqual(S.findAlternatives([A, B], 0, [good]).map((r) => r.prev), [null]);   // first position: only the next side counts
});

test("nextCandidates: every mode ranks, energy modes respect direction, genreSwitch prefers another genre", () => {
  const last = mk({ id: "L", energy: 60, genre: "House" });
  const c = [mk({ id: "up", energy: 74, genre: "House" }), mk({ id: "down", energy: 46, genre: "House" }), mk({ id: "other", energy: 60, genre: "Techno" })];
  for (const m of S.NEXT_MODES) { const r = S.nextCandidates(last, c, m, { seed: 5 }); assert.equal(r.length, 3); assert.ok(r.every((x) => isFinite(x.score))); }
  assert.equal(S.nextCandidates(last, c, "energyUp")[0].track.id, "up");
  assert.equal(S.nextCandidates(last, c, "energyDown")[0].track.id, "down");
  assert.equal(S.nextCandidates(last, c, "genreSwitch")[0].track.id, "other");
  assert.deepEqual(S.nextCandidates(last, c, "surprise", { seed: 9 }).map((x) => x.track.id), S.nextCandidates(last, c, "surprise", { seed: 9 }).map((x) => x.track.id));
});
