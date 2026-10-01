import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const F = createRequire(import.meta.url)("../audio/analysis-fusion.js");
const legacy = (a, p) => ({ value: a, reliability: 80, sources: ["legacy-autocorrelation", "legacy-peak-interval"], candidates: { autocorrelation: a, peakInterval: p } });

test("3 sources agree -> high reliability, essentia-dominated value", () => {
  const r = F.fuseBpm3(legacy(129.6, 129.2), { bpm: 130.0, confidence: 4 });
  assert.equal(r.sources.length, 3);
  assert.ok(Math.abs(r.value - 129.9) < 0.3);
  assert.ok(r.reliability >= 70);
});
test("half-time is not a conflict (65 vs 130)", () => {
  const r = F.fuseBpm3(legacy(130, 130), { bpm: 65, confidence: 3 });
  assert.equal(r.sources.length, 3);
  assert.ok(r.value >= 70 && r.value <= 190);
  assert.ok(Math.abs(r.value - 130) < 1);
});
test("total disagreement, low essentia confidence -> legacy value, low reliability", () => {
  const r = F.fuseBpm3(legacy(100, 100), { bpm: 113, confidence: 1 });
  assert.equal(r.value, 100); assert.equal(r.reliability, 35);
});
test("total disagreement, confident essentia -> essentia value, reliability 40", () => {
  const r = F.fuseBpm3(legacy(100, 100), { bpm: 113, confidence: 4 });
  assert.equal(r.value, 113); assert.equal(r.reliability, 40);
});
test("no essentia -> legacy unchanged", () => {
  const l = legacy(120, 120); assert.equal(F.fuseBpm3(l, null).value, 120);
});
test("camelot table: F minor = 4A, Bb minor = 3A (flats normalized)", () => {
  assert.equal(F.toCamelot("F", "minor").camelot, "4A");
  assert.equal(F.toCamelot("Bb", "minor").camelot, "3A");
  assert.equal(F.toCamelot("A", "major").camelot, "11B");
});
test("key fusion: match / neighbour / conflict", () => {
  const ek = [{ profile: "bgate", key: "F", scale: "minor", strength: 0.9 }];
  assert.equal(F.fuseKey({ camelot: "4A" }, ek).agreement, "match");
  assert.equal(F.fuseKey({ camelot: "4B" }, ek).agreement, "neighbour");
  assert.equal(F.fuseKey({ camelot: "9A" }, ek).agreement, "conflict");
  assert.equal(F.fuseKey({ camelot: "4A" }, []), null);
});
test("legacy hop-quantization at high tempo (145 vs 152) still counts as agreement", () => {
  const r = F.fuseBpm3(legacy(152, 117.5), { bpm: 145, confidence: 2 });
  assert.deepEqual(r.sources, ["essentia.js", "legacy-autocorrelation"]);
  assert.ok(r.value > 145 && r.value < 152);
});
test("essentia confidence 0 (silence) is ignored", () => {
  assert.equal(F.fuseBpm3(legacy(120, 120), { bpm: 129, confidence: 0 }).value, 120);
  assert.equal(F.fuseKey({ camelot: "8A" }, [{ profile: "bgate", key: "A", scale: "minor", strength: -1 }]), null);
});
test("backend BPM anchors the result; agreement share drives reliability", () => {
  const r = F.fuseBpmBackend({ value: 73.79, reliability: 100 }, { essentia: 73.6, autocorrelation: 152, peakInterval: 107.7 });
  assert.equal(r.value, 73.8);
  assert.deepEqual(r.sources, ["essentia-backend", "essentia.js", "legacy-autocorrelation"]);
  assert.equal(r.reliability, 75);
});
test("backend key reliability adjusts with local Essentia.js agreement", () => {
  assert.equal(F.fuseKeyBackend({ value: "3A", reliability: 80 }, "3A").reliability, 90);
  assert.equal(F.fuseKeyBackend({ value: "3A", reliability: 80 }, "8A").reliability, 40);
  assert.equal(F.fuseKeyBackend({ value: "3A", reliability: 80 }, null).reliability, 80);
});
