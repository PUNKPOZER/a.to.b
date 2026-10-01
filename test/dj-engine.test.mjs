import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const D = createRequire(import.meta.url)("../audio/dj-engine.js");

const vec = (seed, n = 6) => Array.from({ length: n }, (_, i) => Math.abs(Math.sin(seed * (i + 1))) + 0.1);
let uid = 0;
function mk(o = {}) {
  const seed = o.seed ?? ++uid;
  return { id: o.id ?? "t" + seed, bpm: o.bpm ?? 126, key: { camelot: o.cam ?? "8A" }, genre: { primary: o.genre ?? "House" },
    profile: { energy: o.energy ?? 60, danceability: o.dance ?? 70 },
    featureGroups: { genre: vec(seed + 1), rhythm: vec(seed + 2), drums: vec(seed + 3), bass: vec(seed + 4), melody: vec(seed + 5), harmony: vec(seed + 6), energy: vec(seed + 7), texture: vec(seed + 8) },
    energyCurve: o.curve ?? Array.from({ length: 40 }, (_, i) => 0.5 + 0.4 * Math.sin(i / 6 + seed)), introBars: o.intro ?? null, outroBars: o.outro ?? null,
    durationSec: o.dur ?? 360, beatCv: null, backendDance: null };
}

test("half/double-time is not a tempo conflict", () => {
  assert.ok(D.tempoScore(65, 130) > 80); assert.ok(D.tempoScore(130, 65) > 80);
  assert.ok(D.tempoScore(126, 126) === 100); assert.ok(D.tempoScore(126, 140) < 40);
});
test("identical track: similarity high, structure scored from curves", () => {
  const a = mk({ seed: 3 }); const s = D.similarity(a, a);
  assert.ok(s.overall > 95 && s.structure > 95);
});
test("similarity weights follow the config (sum 1) and are applied", () => {
  assert.ok(Math.abs(Object.values(D.SIM_WEIGHTS).reduce((a, b) => a + b, 0) - 1) < 1e-9);
  assert.ok(Math.abs(Object.values(D.DJ_WEIGHTS).reduce((a, b) => a + b, 0) - 1) < 1e-9);
  const a = mk({ seed: 1 }), b = mk({ seed: 9, bpm: 140 });
  const onlyTempo = D.similarity(a, b, { tempo: 1 });
  assert.equal(onlyTempo.overall, D.tempoScore(126, 140));
});
test("DJ compat is not just Camelot: same key but 20 BPM apart is poor", () => {
  const a = mk({ seed: 1, cam: "8A", bpm: 124 }), far = mk({ seed: 2, cam: "8A", bpm: 145 }), near = mk({ seed: 2, cam: "9A", bpm: 125 });
  assert.ok(D.djCompat(a, near).overall > D.djCompat(a, far).overall);
});
test("structure: long outro + long intro scores high, unknown stays null and explains itself", () => {
  const a = mk({ outro: 32 }), b = mk({ intro: 16 }), c = mk({});
  assert.equal(D.djCompat(a, b).structure, 100);
  const unk = D.djCompat(a, c); assert.equal(unk.structure, null);
  assert.ok(unk.notes.some((n) => n.key === "structure" && n.level === "none"));
  assert.ok(D.djCompat(a, b).notes.find((n) => n.key === "structure").text.includes("32 bars"));
});
test("energy progression honours a target move from the set curve", () => {
  const a = mk({ energy: 50 }), up = mk({ energy: 70 });
  assert.ok(D.djCompat(a, up, undefined, undefined, { targetDelta: 20 }).energy > D.djCompat(a, up, undefined, undefined, { targetDelta: -20 }).energy);
});
test("buildSet: hits the length, no duplicates, follows the energy curve, deterministic", () => {
  const lib = Array.from({ length: 40 }, (_, i) => mk({ seed: i + 10, energy: 25 + ((i * 37) % 70), bpm: 120 + (i % 9), cam: ["8A", "9A", "7A", "8B"][i % 4], genre: ["House", "Techno", "Electro"][i % 3] }));
  const run = () => D.buildSet({ tracks: lib, targetMinutes: 45, curve: D.CURVES.buildup.pts, seed: 7 });
  const r = run(), r2 = run();
  assert.deepEqual(r.ids, r2.ids);
  assert.equal(new Set(r.ids).size, r.ids.length);
  assert.ok(r.effectiveSec >= 45 * 60 * 0.8 && r.effectiveSec <= 45 * 60 * 1.25, "effective " + r.effectiveSec);
  const en = r.ids.map((id) => lib.find((t) => t.id === id).profile.energy);
  assert.ok(en.slice(-3).reduce((a, b) => a + b, 0) > en.slice(0, 3).reduce((a, b) => a + b, 0), "build-up should end higher than it starts");
  assert.ok(r.avgDj > 60);
});
test("buildSet: start track is respected and lengths scale 30 < 60", () => {
  const lib = Array.from({ length: 40 }, (_, i) => mk({ seed: i + 100, energy: 40 + (i % 40) }));
  const a = D.buildSet({ tracks: lib, targetMinutes: 30, startId: lib[5].id, seed: 2 }), b = D.buildSet({ tracks: lib, targetMinutes: 60, startId: lib[5].id, seed: 2 });
  assert.equal(a.ids[0], lib[5].id); assert.ok(b.ids.length > a.ids.length);
});
test("genre relationship uses style activations when both tracks have them", () => {
  const a = { ...mk({ seed: 1 }), styles: { "Drum n Bass": 0.6, Halftime: 0.4 } }, b = { ...mk({ seed: 2 }), styles: { "Drum n Bass": 0.5, Jungle: 0.3 } }, c = { ...mk({ seed: 3 }), styles: { "Hardcore Hip-Hop": 0.6, "Boom Bap": 0.5 } };
  assert.ok(D.genreScore(a, b) > 50); assert.equal(D.genreScore(a, c), 0);
  assert.ok(D.djCompat(a, b).genre > D.djCompat(a, c).genre);
});
