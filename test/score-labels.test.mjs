// Phase 5: displayed labels must correspond to real numeric ranges; missing data re-normalises, it never inflates.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs"; import vm from "node:vm";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url), D = require("../audio/dj-engine.js"), S = require("../audio/set-tools.js"), SB = require("../audio/smart-build.js");

const ctx = { LOGO_PATH: "", MARK_PATH: "", MARK_BOX: [1, 1], t: (k) => k, window: {} }; vm.createContext(ctx);
vm.runInContext(fs.readFileSync(new URL("../ui/primitives.js", import.meta.url), "utf8") + ";this.UI = UI;", ctx);
const UI = ctx.UI;

test("score tone labels: good >= 80, mid 55-79, bad < 55, none for missing", () => {
  assert.equal(UI.tone(100), "good"); assert.equal(UI.tone(80), "good"); assert.equal(UI.tone(79.9), "mid"); assert.equal(UI.tone(55), "mid"); assert.equal(UI.tone(54.9), "bad"); assert.equal(UI.tone(0), "bad"); assert.equal(UI.tone(null), "none");
  assert.equal(UI.pct(null), "—"); assert.equal(UI.pct(86.4), "86%");
});
test("confidence labels follow the share of weight that had data (high >= 85 %, medium >= 60 %)", () => {
  assert.equal(D.levelOf(1), "high"); assert.equal(D.levelOf(0.85), "high"); assert.equal(D.levelOf(0.84), "medium"); assert.equal(D.levelOf(0.6), "medium"); assert.equal(D.levelOf(0.59), "low");
});
const vec = (s) => Array.from({ length: 6 }, (_, i) => Math.abs(Math.sin(s * (i + 1))) + 0.1);
const mk = (o) => ({ id: o.id, bpm: o.bpm ?? 126, key: { camelot: o.cam ?? "8A" }, genre: { primary: "House" }, profile: { energy: o.energy ?? 60, danceability: 60, bassDensity: 50 }, featureGroups: { genre: vec(1), rhythm: vec(2), drums: vec(3), bass: vec(4), melody: vec(5), harmony: vec(6), energy: vec(7), texture: vec(8) }, durationSec: 300, introBars: o.intro ?? null, outroBars: o.outro ?? null, beatCv: null, backendDance: null });
test("missing factors are left out and listed; the overall is the weighted mean of what exists (no neutral 50)", () => {
  const a = mk({ id: "a" }), b = mk({ id: "b", bpm: 127, cam: "9A" });
  const full = D.djCompat(a, b), noKey = D.djCompat({ ...a, key: { camelot: "unknown" } }, b);
  assert.equal(noKey.key, null); assert.ok(noKey.confidence.missing.includes("key")); assert.ok(noKey.coverage < full.coverage);
  const w = D.DJ_WEIGHTS; let s = 0, ws = 0; for (const k of Object.keys(w)) if (noKey[k] != null) { s += w[k] * noKey[k]; ws += w[k]; }
  assert.ok(Math.abs(noKey.overall - s / ws) < 0.15, `${noKey.overall} vs ${s / ws}`);
});
test("a clearly bad transition scores low and a clean one high (labels are earned)", () => {
  const a = mk({ id: "a", bpm: 126, cam: "8A", energy: 60 }), good = mk({ id: "g", bpm: 127, cam: "8A", energy: 62 }), bad = mk({ id: "b", bpm: 90, cam: "3B", energy: 20 });
  assert.ok(D.djCompat(a, good).overall >= 80, "good " + D.djCompat(a, good).overall);
  assert.ok(D.djCompat(a, bad).overall < 55, "bad " + D.djCompat(a, bad).overall);
});
test("estimated overlaps are never presented as measured, and the effective duration is below the sum", () => {
  const set = [mk({ id: "a" }), mk({ id: "b" }), mk({ id: "c" })];
  const d = SB.setDuration(set); assert.equal(d.measured, 0); assert.equal(d.estimated, 2); assert.ok(d.effectiveSec < d.sumSec);
  const m = SB.setDuration(set, () => ({ sec: 32, source: "grid" })); assert.equal(m.measured, 2); assert.equal(m.effectiveSec, 900 - 64);
});
test("manual reorder recalculates only new pairs; locked tracks keep their index through optimise", () => {
  assert.deepEqual(S.affectedPairs(["a", "b", "c", "d"], ["a", "c", "b", "d"]), [0, 1, 2]);
  assert.deepEqual(S.affectedPairs(["a", "b", "c", "d"], ["a", "b", "d", "c"]), [1, 2]);
});
