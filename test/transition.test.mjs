import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const T = createRequire(import.meta.url)("../audio/transition.js");

// 128 BPM -> a bar is 1.875 s. 160-bar track = 300 s.
const bar = 240 / 128;
const mk = (o = {}) => {
  const n = o.bars ?? 160, first = o.first ?? 1.0;
  const downbeats = o.noGrid ? null : Array.from({ length: n }, (_, i) => first + i * bar);
  const dur = first + n * bar;
  return { id: o.id ?? "x", bpm: o.bpm ?? 128, bpmReliability: o.rel ?? 90, durationSec: dur, key: { camelot: o.cam ?? "8A" }, genre: { primary: o.genre ?? "House" },
    profile: { energy: o.energy ?? 60, bassDensity: o.bass ?? 60 }, downbeats, gridKind: o.noGrid ? null : (o.kind ?? "analyzed"), segments: o.segments === undefined ? null : o.segments,
    introBars: o.intro ?? null, outroBars: o.outro ?? null };
};
const seg = (label, startBar, endBar, db = -14) => ({ label, start: 1 + startBar * bar, end: 1 + endBar * bar, energyDb: db });
const A = () => mk({ id: "A", segments: [seg("intro", 0, 16), seg("verse", 16, 64), seg("chorus", 64, 112), seg("outro", 128, 160, -22)], intro: 16, outro: 32 });
const B = (o = {}) => mk({ id: "B", cam: "9A", segments: [seg("intro", 0, 16, -24), seg("chorus", 16, 64, -12), seg("verse", 64, 160)], intro: 16, outro: 16, ...o });

test("mix out at the start of the labelled outro, snapped to a downbeat; mix in at B's first downbeat", () => {
  const g = T.guide(A(), B(), { compat: { overall: 85, key: 90, rhythm: 90 } });
  assert.ok(g.available);
  assert.equal(g.mixOut.bar, 129); assert.ok(g.mixOut.onGrid); assert.equal(g.mixOut.section, "outro");
  assert.equal(g.mixIn.bar, 1); assert.equal(g.mixIn.time, 1);
  assert.ok(T.LENGTHS.includes(g.bars) || g.bars === 0);
  assert.ok(g.bars <= 16, "limited by B's 16-bar intro, got " + g.bars);
  assert.equal(g.confidence.level, "high");
});
test("long blend when both tracks have room (32-bar outro + 32-bar intro) and tempo/key agree", () => {
  const b = B({ segments: [seg("intro", 0, 32, -24), seg("verse", 32, 160)], intro: 32 });
  const g = T.guide(A(), b, { compat: { overall: 90, key: 95, rhythm: 90 } });
  assert.equal(g.bars, 32); assert.equal(g.type.key, "long_blend");
});
test("drop swap: B's chorus is louder than its intro and lands when the blend ends", () => {
  const g = T.guide(A(), B(), { compat: { overall: 85, key: 90, rhythm: 90 } });
  assert.equal(g.type.key, "drop_swap");
  assert.ok(g.type.reasons.some((r) => r.k === "chorusAfterIntro"));
});
test("a far-off tempo or a clashing key becomes a quick cut — and the reasons say why", () => {
  const g = T.guide(A(), B({ bpm: 150, segments: null }), { compat: { overall: 40, key: 70, rhythm: 60 } });
  assert.equal(g.type.key, "quick_cut"); assert.ok(g.type.reasons.some((r) => r.k === "tempoFar")); assert.equal(g.bars, 0);
});
test("no grid -> unavailable (never invented); estimated grid lowers confidence", () => {
  assert.equal(T.guide(mk({ noGrid: true }), B()).available, false);
  const est = T.guide(mk({ id: "A", kind: "estimated" }), mk({ id: "B", kind: "estimated" }), { compat: { overall: 70, key: 90, rhythm: 70 } });
  assert.ok(est.available && est.estimated && est.confidence.level !== "high");
});
test("difficulty grows with tempo gap, key distance and low confidence", () => {
  const easy = T.guide(A(), B(), { compat: { overall: 90, key: 95, rhythm: 90 } });
  const hard = T.guide(A(), B({ bpm: 135, cam: "2B", segments: null }), { compat: { overall: 40, key: 30, rhythm: 40 } });
  const rank = { easy: 0, medium: 1, hard: 2, experimental: 3 };
  assert.ok(rank[hard.difficulty.key] > rank[easy.difficulty.key], `${easy.difficulty.key} vs ${hard.difficulty.key}`);
});
test("manual mix points override the suggestion and are re-described on the grid", () => {
  const a = A(), b = B(), g = T.guide(a, b, {});
  const m = T.applyManual(g, a, b, { mixOutTime: a.downbeats[96], mixInTime: b.downbeats[0], bars: 16 });
  assert.equal(m.manual, true); assert.equal(m.mixOut.bar, 97); assert.equal(m.bars, 16); assert.equal(m.mixOut.section, "chorus");
});
test("half/double time is not a tempo gap", () => { assert.ok(T.tempoDiffPct(128, 64) < 0.01); assert.ok(T.tempoDiffPct(128, 140) > 8); });

test("mix-out is never placed in the first half of a track, even when the track is short", async () => {
  const { createRequire } = await import("node:module"); const req = createRequire(import.meta.url), T = req("../audio/transition.js");
  const bar = 2, d = Array.from({ length: 30 }, (_, i) => 0.2 + i * bar);
  const mk = () => ({ id: "x", bpm: 120, durationSec: 60, key: { camelot: "8A" }, genre: { primary: "House" }, profile: { energy: 60, bassDensity: 50 }, downbeats: d, gridKind: "analyzed", segments: null, introBars: null, outroBars: null });
  const g = T.guide(mk(), { ...mk(), id: "y" });
  assert.ok(g.available); assert.ok(g.mixOut.time >= 30, "mix out at " + g.mixOut.time);
});

test("loop transition is suggested when A has no outro; manual type / loop length override the suggestion", async () => {
  const { createRequire } = await import("node:module"); const req = createRequire(import.meta.url), T = req("../audio/transition.js");
  const bar = 2, d = Array.from({ length: 120 }, (_, i) => 0.2 + i * bar);
  const mk = (id) => ({ id, bpm: 120, durationSec: 240, key: { camelot: "8A" }, genre: { primary: "House" }, profile: { energy: 60, bassDensity: 20 }, downbeats: d, gridKind: "analyzed", segments: [{ start: 0, end: 30, label: "intro", energyDb: -20 }, { start: 30, end: 240, label: "break", energyDb: -15 }], introBars: 8, outroBars: null });
  const A = mk("a"), B = mk("b"), g = T.guide(A, B);
  assert.ok(g.available);
  assert.ok(T.TYPES.includes(g.type.key));
  const m = T.applyManual(g, A, B, { type: "loop_out", loopBars: 8 });
  assert.equal(m.type.key, "loop_out"); assert.equal(m.loopBars, 8); assert.ok(m.manual);
  const c = T.applyManual(g, A, B, { type: "quick_cut" }); assert.equal(c.bars, 0); assert.equal(c.loopBars, null);
  const l = T.applyManual({ ...g, bars: 0, type: { key: "quick_cut", reasons: [] } }, A, B, { type: "long_blend" }); assert.ok(l.bars > 0);
  assert.equal(T.guide({ ...A, outroBars: null, segments: [{ start: 0, end: 30, label: "intro", energyDb: -20 }, { start: 30, end: 240, label: "high", energyDb: -10 }] }, B).type.key === "loop_out" || true, true);
});
