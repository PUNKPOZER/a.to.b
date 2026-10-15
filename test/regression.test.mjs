// Phase 0 safety net for the 2.0 work: pins the behaviour that existed before Rekordbox import / Smart Build / history / Explore were added.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs"; import path from "node:path"; import vm from "node:vm";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url), root = path.join(path.dirname(new URL(import.meta.url).pathname), "..");
const D = require("../audio/dj-engine.js"), S = require("../audio/set-tools.js"), T = require("../audio/transition.js"), X = require("../audio/export.js");

/* ---- the app is still assembled the same way ---- */
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]);
test("every script referenced by index.html exists and parses", () => {
  assert.ok(scripts.length > 30);
  for (const s of scripts) { const f = path.join(root, s); assert.ok(fs.existsSync(f), "missing " + s); new vm.Script(fs.readFileSync(f, "utf8"), { filename: s }); }
});
test("all five original views and their routes are still wired", () => {
  const src = scripts.filter((s) => /^(app|ui)\//.test(s)).map((s) => fs.readFileSync(path.join(root, s), "utf8")).join("\n");
  for (const fn of ["renderAnalyzeView", "renderLibraryView", "renderSetBuilderView", "renderSetsView", "renderExploreView", "renderSettingsView"]) assert.match(src, new RegExp("function " + fn), fn);
  for (const tab of ["analyze", "library", "setbuilder", "sets", "explore"]) assert.ok(html.includes(`data-tab="${tab}"`), tab);
  assert.match(src, /const TABS = \["analyze", "library", "setbuilder", "sets", "explore", "settings"\]/);
});
test("DOM ids the app code looks up exist in the shell or in a template", () => {
  const files = ["index.html", ...scripts.filter((s) => /^(app|ui)\//.test(s))], all = files.map((f) => fs.readFileSync(path.join(root, f), "utf8")).join("\n");
  const missing = new Set();
  for (const m of all.matchAll(/getElementById\("([A-Za-z0-9_-]+)"\)/g)) if (!new RegExp(`id="${m[1]}"|id=\\\\"${m[1]}|id: "${m[1]}"|\\.id = "${m[1]}"`).test(all)) missing.add(m[1]);
  assert.deepEqual([...missing], []);
});
test("localStorage keys of existing user data are unchanged", () => {
  const st = fs.readFileSync(path.join(root, "app/state.js"), "utf8");
  for (const k of ['"ts_v2_library"', '"ts_v2_sets"', '"ts_v3_weights"', '"atob_ui"', '"noesis_ui"', '"atob_current_set"', '"atob_crate"']) assert.ok(st.includes(k), k);
});

/* ---- scoring behaviour that must survive ---- */
const vec = (seed, n = 6) => Array.from({ length: n }, (_, i) => Math.abs(Math.sin(seed * (i + 1))) + 0.1);
let uid = 0;
const mk = (o = {}) => { const seed = o.seed ?? ++uid; return { id: o.id ?? "t" + seed, bpm: o.bpm ?? 126, key: { camelot: o.cam ?? "8A" }, genre: { primary: o.genre ?? "House" }, profile: { energy: o.energy ?? 60, danceability: 70, bassDensity: 50 },
  featureGroups: { genre: vec(seed + 1), rhythm: vec(seed + 2), drums: vec(seed + 3), bass: vec(seed + 4), melody: vec(seed + 5), harmony: vec(seed + 6), energy: vec(seed + 7), texture: vec(seed + 8) },
  energyCurve: null, introBars: null, outroBars: null, durationSec: o.dur ?? 360, beatCv: null, backendDance: null }; };
test("tempo and key scoring keep their meaning", () => {
  assert.ok(D.tempoScore(126, 126) >= 99);
  assert.ok(D.tempoScore(126, 128) > D.tempoScore(126, 140));
  assert.ok(D.tempoScore(70, 140) > 60, "half/double time still counts");
  assert.equal(D.keyScore("8A", "8A"), 100);
  assert.ok(D.keyScore("8A", "9A") >= 80 && D.keyScore("8A", "9A") < 100);
  assert.ok(D.keyScore("8A", "2B") < 40);
  assert.equal(D.keyScore("unknown", "8A"), null, "unknown key is left out, not scored 50");
});
test("DJ compatibility: full data -> high confidence; missing factors are listed and the rest re-normalised", () => {
  const a = mk({ bpm: 126, cam: "8A" }), b = mk({ bpm: 127, cam: "9A" });
  const d = D.djCompat(a, b);
  assert.ok(d.overall >= 0 && d.overall <= 100);
  assert.ok(Array.isArray(d.notes) && d.notes.length >= 3);
  const noKey = D.djCompat({ ...a, key: { camelot: "unknown" } }, b);
  assert.ok(noKey.confidence.missing.includes("key")); assert.ok(Number.isFinite(noKey.overall));
});
test("the automatic set generator still builds a set near the target length from a library", () => {
  const lib = Array.from({ length: 24 }, (_, i) => mk({ id: "t" + i, seed: i + 1, bpm: 122 + (i % 8), cam: ["8A", "9A", "7A", "8B"][i % 4], energy: 40 + (i * 7) % 50, dur: 300 + (i % 5) * 20 }));
  const r = D.buildSet({ tracks: lib, targetMinutes: 30, curve: D.CURVES.journey.pts, seed: 1 });
  assert.ok(r.ids.length >= 4); assert.equal(new Set(r.ids).size, r.ids.length, "no duplicates");
  assert.ok(Math.abs(r.effectiveSec - 1800) < 600, "effective " + r.effectiveSec);
});
test("set score still explains itself and reacts to a bad transition", () => {
  const good = [mk({ id: "a", bpm: 126, cam: "8A" }), mk({ id: "b", bpm: 127, cam: "8A" }), mk({ id: "c", bpm: 128, cam: "9A" })];
  const bad = [good[0], mk({ id: "z", bpm: 170, cam: "3B" }), good[2]];
  const sc = (set) => S.analyzeSet(set, set.slice(1).map((t, i) => D.djCompat(set[i], t)), {}).score;
  assert.ok(sc(good).total > sc(bad).total);
  assert.ok(["high", "medium", "low"].includes(sc(good).confidence));
});
test("locked tracks stay put when the set is optimised", () => {
  const set = Array.from({ length: 6 }, (_, i) => mk({ id: "t" + i, seed: i + 1, bpm: 120 + i * 3 }));
  const r = S.optimizeOrder(set, { lockedIds: new Set(["t2", "t5"]), pair: (a, b) => D.djCompat(a, b).overall, seed: 3 });
  assert.equal(r.order[2].id, "t2"); assert.equal(r.order[5].id, "t5");
});
test("transition guide and the four export formats keep working on the same inputs", () => {
  const d = Array.from({ length: 100 }, (_, i) => 0.3 + i * 2);
  const A = { ...mk({ id: "a", dur: 220 }), downbeats: d, gridKind: "analyzed", segments: null, bpmReliability: 90 }, B = { ...A, id: "b" };
  const g = T.guide(A, B); assert.ok(g.available); assert.ok(T.TYPES.includes(g.type.key));
  const tracks = [{ id: "a", artist: "X", title: "One", durationSec: 220, bpm: 120, key: { tonic: "A", mode: "min", camelot: "8A" }, filename: "one.mp3", relPath: "set/one.mp3" }, { id: "b", artist: "Y", title: "Two", durationSec: 200, bpm: 121, key: { tonic: "C", mode: "maj", camelot: "8B" }, filename: "two.mp3" }];
  assert.match(X.rekordboxXml(tracks, [null], { baseDir: "/Music", name: "S" }), /<DJ_PLAYLISTS Version="1.0.0">/);
  assert.match(X.m3u8(tracks, { baseDir: "/Music" }), /^#EXTM3U/); assert.match(X.tracklist(tracks, [null], {}), /01\. X — One/);
  assert.equal(X.transitionSheet(tracks, [null], {}).rows.length, 1);
});
