import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const S = createRequire(import.meta.url)("../audio/sonic-similarity.js");

test("weights sum to 1", () => {
  assert.ok(Math.abs(Object.values(S.SONIC_SIM_WEIGHTS).reduce((a, b) => a + b, 0) - 1) < 1e-9);
});
test("embedding is a big factor but not the whole score", () => {
  const r = S.combine(100, { rhythm: 0, texture: 0, energy: 0, harmony: 0 });
  assert.ok(r.overall > 50 && r.overall < 100);
  assert.equal(S.combine(null, { rhythm: 90, texture: 90, energy: 90, harmony: 90 }), null); // no embedding -> no sonic score
});
test("reasons only from measured sub-scores above threshold", () => {
  const r = S.reasons({ embedding: 91, timbre: 85, rhythm: 60, energy: 79.9, harmony: 99 });
  assert.deepEqual(r.map(x => x.key), ["embedding", "timbre", "harmony"]);
  assert.equal(S.reasons({ embedding: 10, timbre: 10, rhythm: 10, energy: 10, harmony: 10 }).length, 0);
});
test("next modes: safe prefers near-identical sound, contrast prefers a different one", () => {
  const dj = 80;
  assert.ok(S.nextScore("safe", dj, 95) > S.nextScore("safe", dj, 40));
  assert.ok(S.nextScore("contrast", dj, 40) > S.nextScore("contrast", dj, 95));
  assert.ok(S.nextScore("balanced", dj, 70) > S.nextScore("balanced", dj, 98));
});
test("bridge score rewards candidates that sit between A and B", () => {
  assert.ok(S.bridgeScore(80, 80, 70, 70, 0.9) > S.bridgeScore(80, 80, 70, 70, 0.1));
  assert.equal(S.bridgeScore(80, 60, null, null, null), 70); // falls back to DJ compatibility
});
test("saturated sub-scores are not reasons: relative threshold applies", () => {
  const list = [90, 91, 92, 93, 94].map((v) => ({ embedding: v, timbre: 99, rhythm: 85, energy: 90, harmony: 90 }));
  const rel = S.percentileThresholds(list);
  const top = S.reasons({ embedding: 94, timbre: 99, rhythm: 85, energy: 90, harmony: 90 }, rel).map((x) => x.key);
  assert.ok(top.includes("embedding"));      // embedding genuinely stands out at the top
  assert.ok(!S.reasons({ embedding: 90, timbre: 90, rhythm: 70, energy: 70, harmony: 70 }, rel).some((x) => x.key === "embedding"));
});
